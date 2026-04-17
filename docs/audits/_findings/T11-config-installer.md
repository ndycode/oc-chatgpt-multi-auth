---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T11-config-installer
agent: opencode-build
date: 2026-04-17T00:00:00Z
scope-files:
  - lib/config.ts
  - lib/storage/migrations.ts
  - lib/storage.ts
  - lib/schemas.ts
  - config/opencode-modern.json
  - config/opencode-legacy.json
  - config/minimal-opencode.json
  - config/README.md
  - scripts/install-oc-codex-multi-auth.js
  - scripts/install-oc-codex-multi-auth-core.js
  - scripts/copy-oauth-success.js
  - scripts/audit-dev-allowlist.js
  - scripts/test-all-models.sh
  - scripts/validate-model-map.sh
  - docs/development/CONFIG_FLOW.md
  - docs/development/CONFIG_FIELDS.md
rubric-version: 1
---

# T11 — Config / Installer / Migration Audit

**Summary**: Audit of plugin runtime config loader (`lib/config.ts`), account-storage migration path (`lib/storage/migrations.ts` + `lib/storage.ts` + `lib/schemas.ts`), installer scripts (`scripts/install-oc-codex-multi-auth{,-core}.js`), shipped config templates (`config/opencode-{modern,legacy,minimal}.json`), and helper shell/JS scripts. Headline findings: 4 HIGH (silent forward-compat data loss on `V4`+ storage, absent `V2` migrator, installer provider-block overwrite, home-dir resolver drift between installer and runtime), 11 MEDIUM, 6 LOW. Cross-cuts: `T05-type-safety.md` (safeParsePluginConfig unused), `T06-filesystem.md` (atomic-write contract, git-worktree project key), `T02-security.md` (mode 0o600 / backup retention).

**Files audited**: 16 of 16 in-scope.

**Rubric reference**: `docs/audits/_meta/AUDIT-RUBRIC.md` (rubric-version 1).

**Cross-reference**: `docs/development/CONFIG_FLOW.md` and `docs/development/CONFIG_FIELDS.md` describe the intended configuration surfaces. Alignment and drift are called out inline in each relevant finding and in the `Config Flow Cross-Reference` section below.

---

## Context

### Config Surfaces

Two distinct config files are in play, and the installer only touches one of them:

| Surface | Path (resolved via) | Writer | Reader |
|---|---|---|---|
| OpenCode global config | `~/.config/opencode/opencode.json` (installer: `env.HOME \|\| env.USERPROFILE \|\| homedir()`) | `scripts/install-oc-codex-multi-auth-core.js` | OpenCode core |
| Plugin runtime config | `~/.opencode/openai-codex-auth-config.json` (runtime: `node:os homedir()`) | user edits manually | `lib/config.ts:13` |
| Account storage (global) | `~/.opencode/oc-codex-multi-auth-accounts.json` | `lib/storage.ts:894` | `lib/storage.ts:714` |
| Account storage (per-project) | `~/.opencode/projects/<hash>/oc-codex-multi-auth-accounts.json` | `lib/storage.ts:894` | `lib/storage.ts:714` |

Intended behavior documented in `docs/development/CONFIG_FLOW.md:165-175`.

### Storage Format Versions

| Version | Status | Schema | Migrator |
|---|---|---|---|
| `V1` | Legacy read | `AccountStorageV1Schema` (`lib/schemas.ts:180-184`) | `migrateV1ToV3` (`lib/storage/migrations.ts:76-111`) |
| `V2` | **Absent from code entirely** | no schema | **no migrator** (gap) |
| `V3` | Current write format | `AccountStorageV3Schema` (`lib/schemas.ts:143-148`) | n/a (source) |
| `V4+` | Not yet defined | rejected by schema; rejected by `normalizeAccountStorage` (`lib/storage.ts:630-634`) | n/a |

### Installer Modes

`scripts/install-oc-codex-multi-auth-core.js:94` enumerates three modes: `modern` (shipped template), `legacy` (explicit presets), and `full` (default, merge of both). `--dry-run` and `--no-cache-clear` are the only action-modifiers; `--help` prints usage.

---

## Findings

### [HIGH | confidence=high] V4+ storage silently discarded — writable callers can clobber forward-compat data

- **File**: `lib/storage.ts:624-635`
- **Quote**:

  ```ts
  export function normalizeAccountStorage(data: unknown): AccountStorageV3 | null {
    if (!isRecord(data)) {
      log.warn("Invalid storage format, ignoring");
      return null;
    }

    if (data.version !== 1 && data.version !== 3) {
      log.warn("Unknown storage version, ignoring", {
        version: (data as { version?: unknown }).version,
      });
      return null;
    }
  ```

- **Issue**: Forward-compat for a future `V4` storage format is not handled. When a user downgrades the plugin across a format bump (e.g., after installing a `V4`-writing version, then reinstalling a `V3`-only build), `normalizeAccountStorage` returns `null`. `loadAccountsInternal` (`:820-834`) then returns `null` for the whole file, and because `withAccountStorageTransaction` (`:951-959`) uses `current: null` to seed subsequent writes, the next legitimate write via `saveAccountsUnlocked` (`lib/storage.ts:894-944`) silently overwrites the on-disk `V4` payload with a `V3` document that contains whatever `handler` decided to persist. End-state: forward-compat account data is dropped with no prompt, no backup, no `.bak` sibling. The only surface that survives is a single `log.warn` line.
- **Recommendation**: In `normalizeAccountStorage`, branch on `version > 3` separately: do not return `null`; instead raise a typed `StorageError` (already exported from `lib/errors.ts` per storage.ts:935) or return a sentinel (e.g. `"future-version"`) and have `loadAccountsInternal` refuse to persist any mutation while a future-version file is present. Add a named backup before any write so the original payload can be restored. Reflect the new behavior in `docs/development/CONFIG_FLOW.md` and `docs/development/CONFIG_FIELDS.md`.
- **Evidence**: `AnyAccountStorageSchema` in `lib/schemas.ts:191-194` is a `z.discriminatedUnion("version", [AccountStorageV1Schema, AccountStorageV3Schema])`; a `version: 4` payload cannot even produce validation warnings because it fails the discriminator before any sub-schema runs. Cross-references `T06-filesystem.md` and inherited wisdom from T6 seed ("V2 migrator absent, version=4+ discarded silently").

---

### [HIGH | confidence=high] V2 format has neither schema nor migrator

- **File**: `lib/storage/migrations.ts:1-112`
- **Quote**:

  ```ts
  /**
   * Storage migration utilities for account data format upgrades.
   * Extracted from storage.ts to reduce module size.
   */

  import { MODEL_FAMILIES, type ModelFamily } from "../prompts/codex.js";
  import type { AccountIdSource } from "../types.js";

  export type CooldownReason = "auth-failure" | "network-error";
  ```

- **Issue**: The migrations module jumps directly from `V1` interfaces to `V3` interfaces with no `V2` types and no `migrateV2ToV3` function. `lib/schemas.ts:191-194` reinforces the gap: the discriminated union only lists `AccountStorageV1Schema` and `AccountStorageV3Schema`. Any real-world `V2` artefact (either one that escaped from a pre-release build, was hand-written by a user following out-of-date docs, or was produced by a third-party tool following the same shape convention) is rejected by `normalizeAccountStorage` and ends up in the same data-loss path as finding #1. There is no code path nor test asserting a deliberate "V2 was never shipped" stance.
- **Recommendation**: Either (a) add a minimal `migrateV2ToV3` translator plus `AccountStorageV2Schema` so an on-disk `V2` file is either migrated or explicitly refused with a user-readable error, or (b) document at the top of `lib/storage/migrations.ts` (and in `docs/development/CONFIG_FLOW.md`) that `V2` was intentionally skipped and cite the commit/PR that justifies the skip. Option (a) is safer; option (b) at minimum prevents future readers from assuming the gap is a bug.
- **Evidence**: Direct read of `lib/storage/migrations.ts` shows only `migrateV1ToV3`. `lib/schemas.ts:181` `version: z.literal(1)` and `:144` `version: z.literal(3)` with no `literal(2)` peer. Cross-reference `T06-filesystem.md`.

---

### [HIGH | confidence=high] Installer overwrites `provider.openai` wholesale — user customisations silently lost

- **File**: `scripts/install-oc-codex-multi-auth-core.js:321-338`
- **Quote**:

  ```js
  	if (existsSync(paths.configPath)) {
  		const backupPath = await backupConfig(paths.configPath, dryRun);
  		log(`${dryRun ? "[dry-run] Would create backup" : "Backup created"}: ${backupPath}`);

  		try {
  			const existing = await readJson(paths.configPath);
  			const merged = { ...existing };
  			merged.plugin = normalizePluginList(existing.plugin);
  			const provider = (existing.provider && typeof existing.provider === "object")
  				? { ...existing.provider }
  				: {};
  			provider.openai = template.provider.openai;
  			merged.provider = provider;
  			nextConfig = merged;
  ```

- **Issue**: The installer preserves `existing.provider.<other-keys>` (anthropic, azure, etc.) but replaces `provider.openai` verbatim with the template's block. Users who customised `provider.openai.options` (e.g., set `reasoningEffort: "xhigh"` globally), who added bespoke model entries (e.g., a workspace-gated `gpt-5.3-codex-spark`), who removed shipped entries they never use, or who configured provider-level headers will lose those customisations on every `npx oc-codex-multi-auth@latest` re-run. The only artefact left is the timestamped `.bak` copy created earlier in the same function. This violates the "idempotent, non-destructive" property that users expect from an installer that runs on every plugin update.
- **Recommendation**: Deep-merge the template's `provider.openai` into `existing.provider.openai` rather than replacing. Merge rules should be: template wins for the `models` keys it ships, existing wins for `models` keys unique to the user, and `options` should merge shallowly with existing taking precedence unless an `--overwrite-options` flag is passed. Document merge semantics in `config/README.md` and `docs/development/CONFIG_FLOW.md`. Alternative: print a one-line diff summary of discarded keys so silent loss becomes loud.
- **Evidence**: `scripts/install-oc-codex-multi-auth-core.js:332` assigns `provider.openai = template.provider.openai` unconditionally. `docs/development/CONFIG_FLOW.md:50-53` describes the replace-openai step as intentional — this finding flags that the documented intent is itself the bug, since user customisations are not round-tripped.

---

### [HIGH | confidence=medium] Home-dir resolver drift: installer vs runtime can target different directories

- **File**: `scripts/install-oc-codex-multi-auth-core.js:56-73`
- **Quote**:

  ```js
  function resolveHomeDirectory(env = process.env) {
  	return env.HOME || env.USERPROFILE || homedir();
  }

  function buildPaths(homeDir) {
  	const configDir = join(homeDir, ".config", "opencode");
  	const cacheDir = join(homeDir, ".cache", "opencode");
  	return {
  		configDir,
  		configPath: join(configDir, "opencode.json"),
  		cacheDir,
  		cacheNodeModulesPaths: getManagedPackageNames().map((name) => join(cacheDir, "node_modules", name)),
  		cacheBunLock: join(cacheDir, "bun.lock"),
  		cachePackageJson: join(cacheDir, "package.json"),
  		modernTemplatePath,
  		legacyTemplatePath,
  	};
  }
  ```

- **Issue**: The installer resolves home via `env.HOME || env.USERPROFILE || homedir()`, but every runtime module (`lib/config.ts:13`, `lib/storage/paths.ts:16`, `lib/logger.ts:124`, `lib/audit.ts:74`, `lib/accounts.ts:75`, `lib/auto-update-checker.ts:10`, `lib/recovery/constants.ts:8`) imports `homedir` from `node:os` and uses only that. On Windows environments that set `HOME` non-standardly (Git Bash, WSL-influenced shells, Cygwin remnants, corporate-managed `HOME=%USERPROFILE%/dev` style overrides), the installer writes `~/.config/opencode/opencode.json` under `$HOME`, while the plugin at runtime resolves `homedir()` which on Windows is the `USERPROFILE`-backed path. If `HOME !== os.homedir()`, the installer's written config lives in one tree and the plugin looks somewhere else.
- **Recommendation**: Unify home-directory resolution across installer and runtime. Replace `env.HOME || env.USERPROFILE || homedir()` in `install-oc-codex-multi-auth-core.js` with a single `homedir()` call, or (safer) factor resolution into a shared helper under `lib/storage/paths.ts` and re-export for installer use. Add a test that asserts installer and runtime resolve to the same absolute path under `HOME` vs `USERPROFILE` mismatch.
- **Evidence**: `lib/storage/paths.ts:16` `return join(homedir(), ".opencode");` vs installer line 57 `return env.HOME || env.USERPROFILE || homedir();`. Reproduction: set `HOME=C:\tmp\home` on a Windows shell, run `npx oc-codex-multi-auth`, then run a plugin command — the plugin's account-storage probes will not find the config the installer wrote. Confidence reduced from `high` to `medium` because default Windows shells do not set `HOME`, so most users never trip the drift.

---

### [MEDIUM | confidence=high] `loadPluginConfig` spreads unvalidated user keys — silent contract widening

- **File**: `lib/config.ts:66-107`
- **Quote**:

  ```ts
  export function loadPluginConfig(): PluginConfig {
  	try {
  		if (!existsSync(CONFIG_PATH)) {
  			return DEFAULT_CONFIG;
  		}

  		const fileContent = readFileSync(CONFIG_PATH, "utf-8");
  		const normalizedFileContent = stripUtf8Bom(fileContent);
  		const userConfig = JSON.parse(normalizedFileContent) as unknown;
  ```

- **Issue**: After validating via `getValidationErrors(PluginConfigSchema, userConfig)` at `:92` and emitting a `logWarn` on errors, the function still spreads `...(userConfig as Partial<PluginConfig>)` at `:99`. Any unknown top-level key, and any typed field whose value failed validation, is retained in the returned config. Downstream `resolve*Setting` helpers rescue numeric/string shape drift through `typeof` guards, but the contract declared by `PluginConfig` is no longer a reliable shape.
- **Recommendation**: Use the already-exported `safeParsePluginConfig` (`lib/schemas.ts:277-283`): on success, spread the parsed object; on failure, `logWarn` once and return `DEFAULT_CONFIG`. Keep the pre-parse legacy-key heuristic at `:79-89` so the "legacy fallback settings detected" warning still works. See `T05-type-safety.md` finding on this function for detailed wording; this audit cross-references rather than re-logs.
- **Evidence**: `safeParsePluginConfig` exists at `lib/schemas.ts:277` and is exercised only by `test/schemas.test.ts` (lines 416-429). Cross-ref `docs/audits/_findings/T05-type-safety.md:215-217`.

---

### [MEDIUM | confidence=high] Installer has no rollback on partial-write failure

- **File**: `scripts/install-oc-codex-multi-auth-core.js:295-370`
- **Quote**:

  ```js
  export async function runInstaller(argv = process.argv.slice(2), options = {}) {
  	const parsed = parseCliArgs(argv);
  	if (parsed.wantsHelp) {
  		printHelp();
  		return { exitCode: 0, action: "help" };
  	}

  	const { env = process.env } = options;
  	const { configMode, dryRun, skipCacheClear } = parsed;
  	const paths = buildPaths(resolveHomeDirectory(env));
  ```

- **Issue**: `runInstaller` calls `backupConfig` (`:322`), then `writeFileAtomic` (`:346`), then `clearCache` (`:350`) — but there is no `try/catch` around the write or cache steps that restores the backup on failure. If `writeFileAtomic` throws mid-rename on a locked Windows file after the partial write, or if `clearCache` fails after the config is updated, the user is left with a potentially inconsistent state (new config, but no plugin cache clear) and must manually locate the `${configPath}.bak-<timestamp>` file and copy it back. The installer's top-level wrapper at `scripts/install-oc-codex-multi-auth.js:10-14` only logs `Installer failed: <message>` and exits non-zero; there is no rollback.
- **Recommendation**: Wrap the write-and-cache block in `try { ... } catch (e) { if (backupPath) await copyFileWithWindowsRetry(backupPath, configPath); throw e; }`. Document the rollback contract in `docs/development/CONFIG_FLOW.md` and in the installer `--help` output. Optionally add a `--no-rollback` flag for advanced users who want to inspect post-crash state.
- **Evidence**: Direct read of `runInstaller`; no try/catch around `writeFileAtomic` or `clearCache`. `copyFileWithWindowsRetry` (`:193-213`) already exists and would suit rollback.

---

### [MEDIUM | confidence=high] Corrupt `opencode.json` triggers silent replacement with template

- **File**: `scripts/install-oc-codex-multi-auth-core.js:325-338`
- **Quote**:

  ```js
  		try {
  			const existing = await readJson(paths.configPath);
  			const merged = { ...existing };
  			merged.plugin = normalizePluginList(existing.plugin);
  			const provider = (existing.provider && typeof existing.provider === "object")
  				? { ...existing.provider }
  				: {};
  			provider.openai = template.provider.openai;
  			merged.provider = provider;
  			nextConfig = merged;
  		} catch (error) {
  			log(`Warning: Could not parse existing config (${formatErrorForLog(error)}). Replacing with template.`);
  			nextConfig = template;
  		}
  ```

- **Issue**: A malformed existing `opencode.json` (truncated write, antivirus interference, mid-edit power loss) is caught at the `readJson` boundary and replaced with the bare template. The backup at `:322` does cover this case, but the log line buries the destruction of the user's config behind a `Warning:` prefix and no hard stop / no prompt. If the corruption is transient (e.g., a crashed editor with swap files), the user loses their real config to a dumb template even though the underlying file could have been recovered.
- **Recommendation**: When the parse fails, do **not** overwrite. Abort with a clear error message that names the backup path and instructs the user to fix the file (or pass `--force` to overwrite). Alternatively, detect corruption heuristically (empty file, null bytes, zero-length): for those, overwrite; for parse errors on non-empty files, refuse.
- **Evidence**: Direct read. `readJson` at `:136-139` calls `JSON.parse(content)` without any sanity check; any `SyntaxError` lands in the `catch`.

---

### [MEDIUM | confidence=high] `writeFileAtomic` temp-file suffix uses non-crypto randomness

- **File**: `scripts/install-oc-codex-multi-auth-core.js:163-175`
- **Quote**:

  ```js
  async function writeFileAtomic(filePath, content) {
  	const uniqueSuffix = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  	const tempPath = `${filePath}.${uniqueSuffix}.tmp`;

  	try {
  		await mkdir(dirname(filePath), { recursive: true });
  		await writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 });
  		await renameWithWindowsRetry(tempPath, filePath);
  	} catch (error) {
  		await rm(tempPath, { force: true }).catch(() => {});
  		throw error;
  	}
  }
  ```

- **Issue**: `Math.random().toString(36).slice(2, 8)` gives ~30 bits of entropy at best. Two concurrent installer processes that collide on `Date.now()` (same millisecond) and the same 6-char Math.random suffix can race on `tempPath`. `lib/storage.ts:895` uses the same approach for the real storage path. Parity is good, but the pattern is not collision-proof, especially when `npx` bootstraps two shells that land on identical timestamps.
- **Recommendation**: Use `node:crypto` `randomBytes(8).toString("hex")` for the suffix. No perf cost at install time; fully aligns with security review guidance in T06 filesystem findings. Keep the pattern identical in `lib/storage.ts:895` to preserve audit parity.
- **Evidence**: Direct read of `writeFileAtomic` at install-core.js:163-175 and parallel read of `writeAccountsToPathUnlocked` at `lib/storage.ts:895-896`.

---

### [MEDIUM | confidence=high] Backup filename timestamp has millisecond-collision risk and no retention policy

- **File**: `scripts/install-oc-codex-multi-auth-core.js:215-226`
- **Quote**:

  ```js
  async function backupConfig(sourcePath, dryRun) {
  	const timestamp = new Date()
  		.toISOString()
  		.replace(/[:.]/g, "-")
  		.replace("T", "_")
  		.replace("Z", "");
  	const backupPath = `${sourcePath}.bak-${timestamp}`;
  	if (!dryRun) {
  		await copyFileWithWindowsRetry(sourcePath, backupPath);
  	}
  	return backupPath;
  }
  ```

- **Issue**: Two issues compound: (a) `new Date().toISOString()` has millisecond resolution, so concurrent installs within the same millisecond (rare but reachable, e.g., an editor that watches and re-triggers) write to the same `backupPath` and the second overwrites the first without error. (b) There is no retention policy — every re-run accumulates a new `.bak-<timestamp>` next to `opencode.json`, with no warning when the directory grows, no cleanup flag, no cap.
- **Recommendation**: Add a random suffix to the timestamp (`${timestamp}-${randomBytes(4).toString("hex")}`) and implement a simple retention rule (keep last N=10 by default) with a `--keep-backups=N` flag. Document the new behavior in `config/README.md` Spark/usage section.
- **Evidence**: Direct read.

---

### [MEDIUM | confidence=medium] Plugin-list normaliser does not detect file-path plugin entries

- **File**: `scripts/install-oc-codex-multi-auth-core.js:98-106`
- **Quote**:

  ```js
  function normalizePluginList(list) {
  	const entries = Array.isArray(list) ? list.filter(Boolean) : [];
  	const managedNames = getManagedPackageNames();
  	const filtered = entries.filter((entry) => {
  		if (typeof entry !== "string") return true;
  		return !managedNames.some((name) => entry === name || entry.startsWith(`${name}@`));
  	});
  	return [...filtered, PACKAGE_NAME];
  }
  ```

- **Issue**: The filter matches exact names and `name@...` pins, but not local paths or protocol-prefixed entries. Users who set `"plugin": ["file:///home/u/dev/oc-codex-multi-auth"]` or `"/abs/path/to/oc-codex-multi-auth/dist"` (see `scripts/test-all-models.sh:152` which actively rewrites to `"file://...dist"`) will keep both the file-path entry *and* a newly-appended plain `oc-codex-multi-auth`, causing duplicate plugin loads and potentially double-applied fetch interception.
- **Recommendation**: Extend the filter to detect path-like entries (contains `/` or `\\` or starts with `file:`) that also resolve to the managed package. At minimum warn: if the filtered list still contains a path-like entry referencing the managed packages, log a conflict warning instead of blindly appending.
- **Evidence**: Direct read of `normalizePluginList`. `scripts/test-all-models.sh:152` uses `sed` to inject a `file://` entry, exercising this edge case.

---

### [MEDIUM | confidence=high] `rateLimitResetTime > now` drops exact-boundary cooldowns during V1→V3 migration

- **File**: `lib/storage/migrations.ts:76-111`
- **Quote**:

  ```ts
  export function migrateV1ToV3(v1: AccountStorageV1): AccountStorageV3 {
  	const now = nowMs();
  	return {
  		version: 3,
  		accounts: v1.accounts.map((account) => {
  			const rateLimitResetTimes: RateLimitStateV3 = {};
  			if (typeof account.rateLimitResetTime === "number" && account.rateLimitResetTime > now) {
  				for (const family of MODEL_FAMILIES) {
  					rateLimitResetTimes[family] = account.rateLimitResetTime;
  				}
  			}
  ```

- **Issue**: The strict `> now` comparison drops the cooldown for accounts whose `rateLimitResetTime` is exactly `now` at migration time. The boundary case is tiny but reachable: a user whose cooldown expired the same millisecond the plugin starts migrating. Rate-limit timers that have *just* expired should probably still inform the health-score initial state (rotation.ts consumes them) rather than being elided.
- **Recommendation**: Use `>=` and let downstream consumers treat "expired exactly now" as not-cooling-down rather than silently losing the data point. Alternative: carry the value forward and let `clearExpiredRateLimits` (`lib/accounts/rate-limits.ts`) decide.
- **Evidence**: Direct read. Corresponds to pre-seeded T13 test-gap note about "boundary off-by-one in migration".

---

### [MEDIUM | confidence=high] `normalizeAccountStorage` doesn't persist a backup before overwriting migrated data

- **File**: `lib/storage.ts:807-834`
- **Quote**:

  ```ts
  async function loadAccountsInternal(
    persistMigration: ((storage: AccountStorageV3) => Promise<void>) | null,
  ): Promise<AccountStorageV3 | null> {
    try {
      const path = getStoragePath();
      const content = await fs.readFile(path, "utf-8");
      const data = JSON.parse(content) as unknown;

      const schemaErrors = getValidationErrors(AnyAccountStorageSchema, data);
      if (schemaErrors.length > 0) {
        log.warn("Account storage schema validation warnings", { errors: schemaErrors.slice(0, 5) });
      }

      const normalized = normalizeAccountStorage(data);

      const storedVersion = isRecord(data) ? (data as { version?: unknown }).version : undefined;
      if (normalized && storedVersion !== normalized.version) {
        log.info("Migrating account storage to v3", { from: storedVersion, to: normalized.version });
        if (persistMigration) {
          try {
            await persistMigration(normalized);
          } catch (saveError) {
            log.warn("Failed to persist migrated storage", { error: String(saveError) });
          }
        }
      }
  ```

- **Issue**: The migration path overwrites the on-disk `V1` file with the normalised `V3` payload via `persistMigration(normalized)` without first creating a sibling backup. If the migration logic in `migrateV1ToV3` has a regression (see finding above, or any future change), the original `V1` data is irrecoverable. Unlike the installer (which backs up the opencode.json before touching it), the storage layer performs an in-place replacement of a credential-bearing file.
- **Recommendation**: Before `persistMigration`, copy the original file to `${path}.v1.bak-${isoTimestamp}` with `mode: 0o600`. Delete the backup only after the migrated file verifies (e.g., after a round-trip read-parse succeeds). Document the backup in `docs/development/CONFIG_FLOW.md` so users who spot `.v1.bak` files know what they are.
- **Evidence**: Direct read of `loadAccountsInternal`. `writeAccountsToPathUnlocked` at `:894-941` has its own atomicity but no pre-write snapshot.

---

### [MEDIUM | confidence=medium] Cache-clear path hardcoded to `.cache/opencode` regardless of OS

- **File**: `scripts/install-oc-codex-multi-auth-core.js:60-73`
- **Quote**:

  ```js
  function buildPaths(homeDir) {
  	const configDir = join(homeDir, ".config", "opencode");
  	const cacheDir = join(homeDir, ".cache", "opencode");
  	return {
  		configDir,
  		configPath: join(configDir, "opencode.json"),
  		cacheDir,
  		cacheNodeModulesPaths: getManagedPackageNames().map((name) => join(cacheDir, "node_modules", name)),
  		cacheBunLock: join(cacheDir, "bun.lock"),
  		cachePackageJson: join(cacheDir, "package.json"),
  		modernTemplatePath,
  		legacyTemplatePath,
  	};
  }
  ```

- **Issue**: Both `.config/opencode` and `.cache/opencode` are XDG-style paths. On Windows, the canonical locations are `%APPDATA%/opencode` and `%LOCALAPPDATA%/opencode` respectively. The installer currently writes `C:\Users\<u>\.config\opencode\opencode.json` and `C:\Users\<u>\.cache\opencode\`. These work because OpenCode itself reads from the same XDG-style paths, but the resulting directories are non-standard on Windows and do not interoperate with OS-level disk-clean utilities. If OpenCode ever adopts platform-native path resolution, the installer diverges silently.
- **Recommendation**: Factor path resolution into a shared helper that matches OpenCode's own resolver. If OpenCode is committed to XDG paths on Windows, keep a comment referencing the upstream decision (with link) in `buildPaths` and in `docs/development/CONFIG_FLOW.md`. If OpenCode migrates in the future, bump the installer major version.
- **Evidence**: Direct read. `docs/development/CONFIG_FLOW.md:11-14` confirms the documented path is `~/.config/opencode/opencode.json` on all platforms.

---

### [MEDIUM | confidence=high] `mergeFullTemplate` throws on model-key overlap with no recovery hint

- **File**: `scripts/install-oc-codex-multi-auth-core.js:112-134`
- **Quote**:

  ```js
  function mergeFullTemplate(modernTemplate, legacyTemplate) {
  	const modernModels = modernTemplate.provider?.openai?.models ?? {};
  	const legacyModels = legacyTemplate.provider?.openai?.models ?? {};
  	const overlappingKeys = Object.keys(modernModels).filter((key) => Object.hasOwn(legacyModels, key));

  	if (overlappingKeys.length > 0) {
  		throw new Error(`Full config template collision for model keys: ${overlappingKeys.join(", ")}`);
  	}
  ```

- **Issue**: The collision guard is correct but the error message is the only feedback the user gets; there is no advice on how to fix it, and the throw blows up `runInstaller` without a `--force` or `--prefer-modern` fallback. A collision arises only when the shipped templates are modified inconsistently in this repo, so it is effectively a maintainer-only failure mode — but when it fires, a downstream user sees `Installer failed: Full config template collision for model keys: ...`, which is not actionable for them.
- **Recommendation**: Add a fallback strategy (e.g., prefer modern on overlap) or exit with a user-facing message like "this is a template packaging bug; please report to https://github.com/ndycode/oc-codex-multi-auth/issues with the collision list". Also add a CI test that re-runs `mergeFullTemplate` on both shipped templates and fails the build if a collision sneaks in.
- **Evidence**: Direct read.

---

### [MEDIUM | confidence=medium] Installer strips pinned versions without confirmation

- **File**: `scripts/install-oc-codex-multi-auth-core.js:98-106`
- **Quote**:

  ```js
  function normalizePluginList(list) {
  	const entries = Array.isArray(list) ? list.filter(Boolean) : [];
  	const managedNames = getManagedPackageNames();
  	const filtered = entries.filter((entry) => {
  		if (typeof entry !== "string") return true;
  		return !managedNames.some((name) => entry === name || entry.startsWith(`${name}@`));
  	});
  	return [...filtered, PACKAGE_NAME];
  }
  ```

- **Issue**: A user who pinned their plugin to a specific version (`"oc-codex-multi-auth@5.0.1"` or `"oc-codex-multi-auth@file:..."`) loses that pin on every `npx` re-run. The `printHelp` text (`:17-28`) mentions "Ensures plugin is unpinned (latest)" as a feature, but the plain plugin-list normaliser applies the same rule even under `--modern` or `--legacy`, where preserving a pin would be harmless.
- **Recommendation**: Add `--keep-pin` or `--preserve-plugin-entry` flag. Alternatively, default to pinning the plugin entry to the installer's declared version (read from installer script metadata) so re-running does not silently chase `latest`.
- **Evidence**: Cross-ref `docs/development/CONFIG_FLOW.md:57-58` which documents the unpinning as intentional; this finding flags UX cost, not behavior drift.

---

### [LOW | confidence=high] Installer magic numbers for Windows retry lack rationale

- **File**: `scripts/install-oc-codex-multi-auth-core.js:9-10`
- **Quote**:

  ```js
  const WINDOWS_RENAME_RETRY_ATTEMPTS = 5;
  const WINDOWS_RENAME_RETRY_BASE_DELAY_MS = 10;
  ```

- **Issue**: No comment explaining why 5 attempts and 10ms exponential base. Other retry budgets in the repo (`lib/request/retry-budget.ts`) are more documented; a magic-number constant here risks drift (someone bumps `ATTEMPTS` to 20 without understanding the worst-case wait time of ~30s).
- **Recommendation**: Add a one-line comment: `// Total max delay: 10 + 20 + 40 + 80 + 160 ≈ 310ms; sufficient for AV-held file handles`.
- **Evidence**: Direct read.

---

### [LOW | confidence=high] `minimal-opencode.json` omits `reasoning.encrypted_content` — breaks multi-turn sessions if used as-is

- **File**: `config/minimal-opencode.json:1-13`
- **Quote**:

  ```json
  {
    "$schema": "https://opencode.ai/config.json",
    "plugin": ["oc-codex-multi-auth"],

    "provider": {
      "openai": {
        "options": {
          "store": false
        }
      }
    },
    "model": "openai/gpt-5-codex"
  }
  ```

- **Issue**: `docs/development/CONFIG_FLOW.md:74` states `store: false plus include: ["reasoning.encrypted_content"]` as part of the contract with the ChatGPT backend. `minimal-opencode.json` ships `store: false` but omits the `include` entry. A user who copies this template verbatim will break multi-turn reasoning state. The file is intended for debugging per `config/README.md:73-74`, but the README entry does not flag the omission.
- **Recommendation**: Either add the `include` entry to the minimal template, or annotate in `config/README.md` that the minimal template intentionally drops encrypted-reasoning and name the symptom users will see (e.g., "state-less single-turn requests only").
- **Evidence**: Direct read of `minimal-opencode.json` and cross-check against `AGENTS.md:49` which asserts the Codex backend requires both settings.

---

### [LOW | confidence=high] `test-all-models.sh` is bash-only; no Windows parity

- **File**: `scripts/test-all-models.sh:1-17`
- **Quote**:

  ```bash
  #!/bin/bash

  # Test All Models - Verify API Configuration
  # This script tests all model configurations and verifies the actual API requests

  set -e

  # Colors for output
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m' # No Color
  ```

- **Issue**: The script uses `bash`, `pkill`, `sed -i.bak`, `rm -rf`, `find ... -print0 | xargs -0 ls -t`, and `jq`. None of these have cmd.exe or PowerShell parity, and `sed -i.bak` behaves differently between GNU sed and BSD sed (GitHub Actions macOS runners). Windows contributors cannot run this QA script locally. The repo advertises Windows as a supported install target (docs, installer retry logic, `isWindowsLockError`), but QA gates are POSIX-only.
- **Recommendation**: Port to a Node.js script that shells out via `execFile` with platform-specific kill commands, or add a PowerShell twin at `scripts/test-all-models.ps1`. Document the two-path contract in `CONTRIBUTING.md`. For now at minimum: add a top-of-file comment declaring "POSIX-only" and note in `config/README.md` how Windows contributors should invoke equivalent behavior.
- **Evidence**: Direct read of `scripts/test-all-models.sh`.

---

### [LOW | confidence=high] `validate-model-map.sh` is bash-only; same Windows-parity gap

- **File**: `scripts/validate-model-map.sh:1-15`
- **Quote**:

  ```bash
  #!/bin/bash

  # Simple Model Map Validation Script
  # Tests that OpenCode correctly uses models from config

  set -e

  # Colors
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m'

  REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  LOG_DIR="${HOME}/.opencode/logs/codex-plugin"
  ```

- **Issue**: Same category as the `test-all-models.sh` finding — `BASH_SOURCE`, `jq`, `find | grep -l`, `rm -rf "${LOG_DIR}"/*`. The script additionally assumes `HOME` is set, which is the same drift vector as the installer home-dir finding. `rm -rf "${LOG_DIR}"/*` on an unset `HOME` would wipe `/.opencode/logs/codex-plugin/*` (rooted at `/`) — genuinely dangerous.
- **Recommendation**: Add a guard `: "${HOME:?HOME is not set}"` at the top of both POSIX scripts. Long-term: port to Node alongside `test-all-models.sh` so the QA layer survives on Windows.
- **Evidence**: Direct read. Cross-refers to the home-dir-resolver finding above.

---

### [LOW | confidence=high] `audit-dev-allowlist.js` uses `execSync` and exits with no timeout

- **File**: `scripts/audit-dev-allowlist.js:30-53`
- **Quote**:

  ```js
  let rawAuditOutput = "";
  try {
  	rawAuditOutput = execSync("npm audit --json", {
  		encoding: "utf8",
  		stdio: ["ignore", "pipe", "pipe"],
  	}).trim();
  } catch (error) {
  	const execError = error;
  	const stdout =
  		execError &&
  		typeof execError === "object" &&
  		"stdout" in execError &&
  		typeof execError.stdout === "string"
  			? execError.stdout
  			: "";
  	const stderr =
  		execError &&
  		typeof execError === "object" &&
  		"stderr" in execError &&
  		typeof execError.stderr === "string"
  			? execError.stderr
  			: "";
  	rawAuditOutput = stdout.trim() || stderr.trim();
  }
  ```

- **Issue**: `execSync` with no `timeout` option can hang CI when npm's registry is slow, and blocks the Node event loop the whole time. Not dangerous, but a CI-time reliability risk.
- **Recommendation**: Pass `{ timeout: 60_000 }` to `execSync`, or convert to async `execFile`.
- **Evidence**: Direct read.

---

### [LOW | confidence=medium] `copy-oauth-success.js` case-folds only on win32, not covering UNC paths

- **File**: `scripts/copy-oauth-success.js:8-11`
- **Quote**:

  ```js
  function normalizePathForCompare(path) {
  	const resolved = resolve(path);
  	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }
  ```

- **Issue**: The `win32` branch lowercases the resolved path for comparison with `process.argv[1]`. UNC paths (`\\server\share\...`) also need normalisation for `resolve`-based comparison to match the entry-check branch. This only affects the "should this script auto-run when invoked directly?" check, so failure modes are cosmetic, but on networked dev environments the script could mistakenly run (or not run) when auto-detection was expected.
- **Recommendation**: Lowercase also when `resolved` starts with `\\\\` regardless of platform (for safety on tests mocking process.platform). Minor.
- **Evidence**: Direct read.

---

## Config Flow Cross-Reference

`docs/development/CONFIG_FLOW.md` at SHA `d92a8eedad906fcda94cd45f9b75a6244fd9ef51` (the audit SHA) describes:

| CONFIG_FLOW.md line(s) | Claim | Code evidence | Status |
|---|---|---|---|
| 11-14 | Installer writes `~/.config/opencode/opencode.json` | `scripts/install-oc-codex-multi-auth-core.js:60-65` | **Aligned** |
| 40-44 | Plugin runtime config at `~/.opencode/openai-codex-auth-config.json` | `lib/config.ts:13` | **Aligned** |
| 48-54 | Installer steps: load template, back up, normalize plugin list, replace `provider.openai`, clear cache | `scripts/install-oc-codex-multi-auth-core.js:317-350` | **Aligned** (but see HIGH finding on provider.openai overwrite) |
| 57-58 | "plugin entry as `oc-codex-multi-auth`, not `oc-codex-multi-auth@latest`" | `scripts/install-oc-codex-multi-auth-core.js:105` `return [...filtered, PACKAGE_NAME];` | **Aligned** |
| 137-148 | Runtime resolution flow (provider options, per-model, request shaping, model normalisation) | `lib/config.ts:188-194` + `lib/request/request-transformer.ts` | **Aligned** (details audited in T04) |
| 165-175 | File-locations table | Cross-checked against `lib/config.ts:13`, `lib/storage.ts:721`, `lib/storage/paths.ts:16`, `lib/logger.ts:124` | **Aligned** |

No drift detected between documented and actual behavior; however, **`CONFIG_FLOW.md` does not document**: (a) the forward-compat `V4+` rejection path, (b) the `V2`-is-absent stance, (c) the exact rules of `normalizePluginList`, (d) the millisecond-collision risk in `backupConfig`, (e) the home-dir drift between installer and runtime. Each of those is flagged in findings above with a recommendation to update `CONFIG_FLOW.md`.

`docs/development/CONFIG_FIELDS.md` was spot-checked; field-by-field parity with `lib/config.ts` `DEFAULT_CONFIG` (`:26-58`) and `lib/schemas.ts` `PluginConfigSchema` were not exhaustively re-verified here — owned by T5 scope.

---

## Windows vs POSIX Script Parity

| Script | POSIX | Windows | Notes |
|---|---|---|---|
| `scripts/install-oc-codex-multi-auth.js` | Y | Y | Thin wrapper over `-core.js`; Node ESM; platform-agnostic |
| `scripts/install-oc-codex-multi-auth-core.js` | Y | Y (with retry) | Uses `renameWithWindowsRetry` / `copyFileWithWindowsRetry` for EPERM/EBUSY; home-dir drift flagged above |
| `scripts/copy-oauth-success.js` | Y | Y | Case-folds only on `win32`; UNC edge case flagged |
| `scripts/audit-dev-allowlist.js` | Y | Y | Spawns `npm audit`; no timeout; `execSync` blocking |
| `scripts/test-all-models.sh` | Y | N | `#!/bin/bash`, `pkill`, `sed -i.bak`, `jq`, `find ... -print0` — no Windows parity |
| `scripts/validate-model-map.sh` | Y | N | Same as above; also assumes `HOME` set |

Windows-specific mitigations already in place in `install-core.js`: exponential-backoff rename/copy retry (`:141-161`, `:193-213`) guarded by `isWindowsLockError` which matches `EPERM` and `EBUSY` — the two common failure codes for antivirus-held handles.

Windows gaps: (a) no QA scripts run on Windows CI; (b) `test-all-models.sh` and `validate-model-map.sh` POSIX-only; (c) `cacheBunLock` cleanup assumes Bun is an option — on Windows `bun.lock` may not exist; the `rm` with `{ force: true }` handles that silently, which is fine.

---

## Idempotency Analysis

`runInstaller` should be safe to run multiple times. Observed idempotency properties:

- **Config file**: With existing config, merges `plugin` (de-dup via `normalizePluginList`) and replaces `provider.openai` (see HIGH finding #3). User edits to non-openai providers survive.
- **Backups**: Every run creates a new `.bak-<timestamp>` — no dedup, no retention (MEDIUM finding #9).
- **Cache clear**: `rm -rf` on `~/.cache/opencode/node_modules/{oc-codex-multi-auth,oc-chatgpt-multi-auth}` and `bun.lock` — idempotent (force:true tolerates missing files). `cachePackageJson` edit is also idempotent (only writes if changed).
- **Dry-run**: Logs only; does not mutate. Acceptance: `--dry-run` skips `copyFileWithWindowsRetry` in `backupConfig` (confirmed at `:222-224`) and skips `writeFileAtomic` at `:343-344`.

Net: installer is idempotent for **all** paths **except** user customisations of `provider.openai`, which are overwritten on every run (see HIGH finding #3).

---

## Migration Versions — `V1` → `V3`, with `V2` gap and `V4`+ future version handling

Observed migration matrix:

| From | To | Path | Result |
|---|---|---|---|
| `V1` on disk | `V3` in memory | `migrateV1ToV3` (`migrations.ts:76`), persisted via `persistMigration` (`storage.ts:824-831`) | Round-trip succeeds; boundary-case cooldown loss flagged (MEDIUM finding on `>` vs `>=`) |
| `V2` on disk (hypothetical) | n/a | No schema, no migrator — rejected by `AnyAccountStorageSchema` discriminator (`schemas.ts:191-194`) and by `normalizeAccountStorage` (`storage.ts:630-634`) | Returns null; data-loss risk same as `V4+` case |
| `V3` on disk | `V3` in memory | Direct parse, schema-validated | No-op |
| `V4+` / future version | n/a | Same null-return path as `V2` | **Forward-compat broken** (HIGH finding #1); pending write overwrites original |

Boundary cases addressed in detail:

- `rateLimitResetTime === now` during V1→V3: cooldown dropped (MEDIUM).
- Absent `V2` migrator: not documented anywhere in code or in `CONFIG_FLOW.md` as intentional (HIGH).
- `V4+` rejection: schema-level rejection plus `normalizeAccountStorage` early return; persist caller then overwrites (HIGH).

---

## Atomicity Analysis (Config Writes)

| Write site | Pattern | Atomic? |
|---|---|---|
| `scripts/install-oc-codex-multi-auth-core.js:163` `writeFileAtomic` | temp-file + `rename` with Windows retry | Yes (entropy risk noted MEDIUM) |
| `lib/storage.ts:894` `writeAccountsToPathUnlocked` | identical temp+rename pattern + size check + mode 0o600 | Yes |
| `lib/config.ts` | read-only | n/a |

The two write sites are shape-aligned — an intentional parity. Keep the parity when fixing the `Math.random()` finding.

---

## Implicit / Magical / Brittle Generated Config

- **Implicit**: `DEFAULT_CONFIG` at `lib/config.ts:26-58` is the authoritative list of runtime knobs; there is no generator from `PluginConfigSchema` — the two can drift silently. Not a finding on its own, but a maintenance concern cross-referenced to `T05-type-safety.md`.
- **Magical**: `mergeFullTemplate` auto-merges modern base entries with legacy preset entries; a maintainer who adds a new model to modern but forgets to reconcile legacy trips the collision throw (MEDIUM finding #14).
- **Brittle**: Installer rewrites `plugin` to strip all pins; users who needed a specific version for reproducibility lose it every re-run (MEDIUM finding #15).

---

## Multi-OpenCode-Version Compatibility

Two shipped templates map to two OpenCode versions per `config/README.md:7-10`:

- `opencode-modern.json` → v1.0.210+ (supports `variants`)
- `opencode-legacy.json` → v1.0.209 and below (explicit presets)

The default `full` mode of the installer merges both so a single config works across boundary versions. The merge throws on key collision, so future maintainers must keep the two template namespaces disjoint. That's a brittle contract worth a CI assertion (see MEDIUM finding #14). `CONFIG_FLOW.md:66-110` documents this correctly.

---

## Summary Count by Severity

- **CRITICAL**: 0
- **HIGH**: 4
- **MEDIUM**: 11
- **LOW**: 6
- **Total**: 21

All findings cite repo-relative paths and line ranges against SHA `d92a8eedad906fcda94cd45f9b75a6244fd9ef51`. Cross-references: `T05-type-safety.md` (safeParsePluginConfig), `T06-filesystem.md` (atomic write, per-project paths), `T02-security.md` (file mode 0o600, backup export defaults). No findings duplicate those of other audits; where an overlap exists, this doc cites only the config-installer aspect.

---

## Notes

- `config/README.md:45-49` mentions optional `model_context_window` / `model_auto_compact_token_limit` knobs; these are OpenCode-core knobs, not plugin knobs, so they are out of scope for `lib/config.ts` — flagged here only for cross-reference.
- `scripts/test-all-models.sh` and `scripts/validate-model-map.sh` live in-scope but are test/QA support scripts rather than installer scripts; their POSIX-only state was flagged as LOW (not HIGH) because they are developer tooling, not user-facing.
- No findings were downgraded for severity cap; all five HIGH-budget slots remain available (only 4 HIGH produced).
- No quoted code was paraphrased; all snippets match source verbatim at the audit SHA.

*End of T11 findings. Rubric version 1.*
