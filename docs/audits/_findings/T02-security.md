---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T02-security
agent: opencode(claude-opus-4-7)
date: 2026-04-17T00:00:00Z
scope-files:
  - lib/accounts.ts
  - lib/accounts/rate-limits.ts
  - lib/auth-rate-limit.ts
  - lib/auth/auth.ts
  - lib/auth/browser.ts
  - lib/auth/device-code.ts
  - lib/auth/login-runner.ts
  - lib/auth/server.ts
  - lib/auth/token-utils.ts
  - lib/logger.ts
  - lib/oauth-success.ts
  - lib/proactive-refresh.ts
  - lib/refresh-queue.ts
  - lib/storage.ts
  - lib/storage/migrations.ts
  - lib/storage/paths.ts
rubric-version: 1
---

# T02 — Security / Auth / Credential Handling

**Summary**: Deep re-verification of the 25 pre-seeded findings from scan `bg_c692d877` against the locked SHA `d92a8ee`, followed by targeted discovery in auth, storage, logger, refresh-queue, and login-runner. All 5 pre-seeded HIGHs remain present verbatim; 14 MEDIUM seeds re-verified (two downgraded to LOW, one upgraded to HIGH); 6 LOW seeds confirmed. One new HIGH (unverified JWT signatures used for account-identity derivation), three new MEDIUMs (refresh-token used as Map key in failure counter, raw OAuth response body reachable in logs via template literal, oauth-success page loads third-party fonts that the CSP blocks — indicating dead CSP / dead markup), and two new LOWs (withStorageLock has no deadlock timeout; resolved server-side `new URL(req.url, "http://localhost")` host mismatch with 127.0.0.1 bind) surfaced during discovery. Headline: credential secrets live plaintext on disk, silent rotation loss is reproducible across a process exit inside the 500 ms debounce window, and `||` fallback on `refreshToken`/`accessToken` during merge can resurrect already-invalidated credentials.

**Files audited**: 16 of 16 in scope.

**Finding counts**:
- CRITICAL: 0
- HIGH: 6
- MEDIUM: 17
- LOW: 8
- **Total**: 31

**Severity cap status**: CRITICAL 0/5, HIGH 6/15, MEDIUM 17/40 — all within rubric caps.

**Seed verification**: 25 of 25 pre-seed findings present at locked SHA. See `.sisyphus/evidence/task-2-seed-verify.md`.

**Token leakage check**: 0 matches for `eyJ[A-Za-z0-9_-]{20,}` / `[a-f0-9]{40,}` / `sk-[A-Za-z0-9]{20,}` in quoted snippets. See `.sisyphus/evidence/task-2-no-leakage.md`.

---

## Findings

### HIGH — correctness & security defects requiring fix before next release

---

### [HIGH | confidence=high] Plaintext refresh & access tokens persisted with mode 0o600 only (no at-rest encryption)

- **File**: `lib/storage.ts:188-209`
- **Quote**:

  ```ts
  async function writeFileWithTimeout(filePath: string, content: string, timeoutMs: number): Promise<void> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fs.writeFile(filePath, content, {
        encoding: "utf-8",
        mode: 0o600,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        const timeoutError = Object.assign(
          new Error(`Timed out writing file after ${timeoutMs}ms`),
          { code: "ETIMEDOUT" },
        );
        throw timeoutError;
      }
      throw error;
  ```

- **Issue**: Every persisted account record includes the raw OpenAI `refreshToken` (and an optional cached `accessToken`) serialised by `JSON.stringify(normalizedStorage, null, 2)` at `lib/storage.ts:905` and written through this helper plus `lib/storage.ts:906`, `lib/storage.ts:1155` (flagged accounts), and `lib/storage.ts:1324` (exports). Mode `0o600` only prevents other unprivileged users from reading the file; it does not protect against: (a) other processes running as the same user (backup agents, search indexers, antivirus, `codex-cli`), (b) disk/backup images that ignore POSIX modes, (c) Windows filesystems where `0o600` is silently ignored because NTFS ACLs are driven by inheritance. A successful read yields every account's long-lived refresh token, which an attacker can use against `https://auth.openai.com/oauth/token` to mint arbitrary access tokens for the victim's ChatGPT account until the user manually revokes.
- **Recommendation**: Encrypt refresh tokens at rest with a user-derived or OS-keychain-derived key before `JSON.stringify` (e.g., `node:crypto` AES-256-GCM with a key from `keytar` / Windows Credential Vault / macOS Keychain / libsecret). Minimum bar: gate a token-file warning at first write and document `export CODEX_ENCRYPT_STORAGE=1` as a promoted flag. Keep `mode: 0o600` but stop treating it as sufficient. Store only the ciphertext + IV + KDF salt; keep the plaintext only in-memory on a `ManagedAccount` instance.
- **Evidence**: Pre-seed (`bg_c692d877`) flagged four call sites; all four match current SHA (`lib/storage.ts:194` write mode, `:906` active-store write, `:1155` flagged-store write, `:1324` export write). Contrast with `lib/audit.ts:91` and `lib/logger.ts:258` which use `mode: 0o700` on the *directory* — storage does not apply the directory mode, see MEDIUM finding below.

---

### [HIGH | confidence=high] Silent token loss — `applyRefreshResult` mutates in-memory account without persisting; disk write sits in 500 ms debounce window

- **File**: `lib/proactive-refresh.ts:200-215`
- **Quote**:

  ```ts
  /**
   * Updates a ManagedAccount with fresh token data from a successful refresh.
   *
   * @param account - The account to update
   * @param result - Successful token refresh result
   */
  export function applyRefreshResult(
  	account: ManagedAccount,
  	result: Extract<TokenResult, { type: "success" }>,
  ): void {
  	account.access = result.access;
  	account.expires = result.expires;
  	if (result.refresh !== account.refreshToken) {
  		account.refreshToken = result.refresh;
  	}
  }
  ```

- **Issue**: When the refresh queue rotates the refresh token, `applyRefreshResult` mutates the in-memory `ManagedAccount` only. Persistence is deferred to `AccountManager.saveToDiskDebounced(500)` at `lib/accounts.ts:945-966`:
  ```
  saveToDiskDebounced(delayMs = 500): void {
    if (this.saveDebounceTimer) { clearTimeout(this.saveDebounceTimer); }
    this.saveDebounceTimer = setTimeout(() => { ... void doSave(); }, delayMs);
  }
  ```
  A process exit (SIGINT, crash, container kill, `npm run`-driven parent exit) inside that 500 ms window loses the new refresh token forever. On the next boot the stored (rotated-away) token is presented to `/oauth/token`, yielding `invalid_grant` — the account is now permanently orphaned even though the user did nothing wrong. `saveToDiskDebounced` also **swallows** save errors via `log.warn(...)` at `lib/accounts.ts:960-962`, so a transient `EBUSY` / `EPERM` race with antivirus is invisible.
- **Recommendation**: Replace debounced save with a write-through contract for token rotation: `applyRefreshResult` (or its caller in `refresh-queue.ts`) must `await accountManager.flushPendingSave()` immediately, or — better — persist synchronously via `withAccountStorageTransaction` before returning. Track `pendingSave.error` so `shutdown.ts` can warn the user. Add a unit test that kills the process 250 ms after a rotation and asserts the on-disk token is the new one.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. Quote at `lib/proactive-refresh.ts:206-215` matches verbatim. Debounce swallow at `lib/accounts.ts:960-962`. See also T7 (concurrency) for the race between debounce timer and `flushPendingSave` on SIGINT.

---

### [HIGH | confidence=high] Codex CLI cross-process token injection via unsigned JSON with zero schema validation

- **File**: `lib/accounts.ts:104-155`
- **Quote**:

  ```ts
  if (!existsSync(CODEX_CLI_ACCOUNTS_PATH)) {
    codexCliTokenCache = null;
    return null;
  }

  try {
    const raw = await fs.readFile(CODEX_CLI_ACCOUNTS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.accounts)) {
      codexCliTokenCache = null;
      return null;
    }

    const next = new Map<string, CodexCliTokenCacheEntry>();
    for (const entry of parsed.accounts) {
      if (!isRecord(entry)) continue;

      const email = sanitizeEmail(typeof entry.email === "string" ? entry.email : undefined);
      if (!email) continue;
  ```

- **Issue**: `CODEX_CLI_ACCOUNTS_PATH` is `~/.codex/accounts.json` (`lib/accounts.ts:75`). Any process running as the same user that can write that file — including arbitrary dropper malware, another supply-chain-compromised dev tool, or a malicious MCP plugin — can inject `access_token` and `refresh_token` values keyed by an attacker-controlled `email`. The plugin subsequently treats these as valid OAuth credentials in `lookupCodexCliTokensByEmail` (`lib/accounts.ts:157-165`) and will mint requests with them. There is no cryptographic signature check, no HMAC, no owner check beyond `existsSync`, no schema validation beyond "is a record with an `accounts` array". This is a lateral-movement vector: any same-user compromise pivots into the ChatGPT session of any email the attacker seeds.
- **Recommendation**: Either (a) stop reading a peer tool's token cache entirely and document manual re-login, or (b) require the attacker-controlled path to match `chatgpt_account_id` from a server-verified JWT in-memory before accepting injected tokens. At minimum, validate the full JSON against a strict Zod schema (`lib/schemas.ts` already holds `AnyAccountStorageSchema`) AND fail-closed when `CODEX_AUTH_SYNC_CODEX_CLI` is unset. Gate the whole feature behind an opt-in env flag defaulting to *off*; current gate is an opt-out (`process.env.CODEX_AUTH_SYNC_CODEX_CLI !== "0"` at `lib/accounts.ts:91`).
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. Gate logic verified at `lib/accounts.ts:90-96`. Schema absence verified: `parsed.accounts` iterated without passing through any `AnyAccountStorageSchema.parse`. See also MEDIUM below on schema boundary.

---

### [HIGH | confidence=high] Account merge resurrects invalidated credentials via `||` fallback on `refreshToken` / `accessToken`

- **File**: `lib/auth/login-runner.ts:331-348`
- **Quote**:

  ```ts
  accounts[targetIndex] = {
  	...target,
  	accountId: target.accountId ?? source.accountId,
  	organizationId: target.organizationId ?? source.organizationId,
  	accountIdSource: target.accountIdSource ?? source.accountIdSource,
  	accountLabel: target.accountLabel ?? source.accountLabel,
  	email: target.email ?? source.email,
  	refreshToken: newer.refreshToken || older.refreshToken,
  	accessToken: newer.accessToken || older.accessToken,
  	expiresAt: newer.expiresAt ?? older.expiresAt,
  	enabled: mergedEnabled,
  	addedAt: Math.max(target.addedAt ?? 0, source.addedAt ?? 0),
  	lastUsed: Math.max(target.lastUsed ?? 0, source.lastUsed ?? 0),
  ```

- **Issue**: The project anti-pattern list (`AGENTS.md:67`) bans `as any` but this is the dual problem: `||` (logical OR) treats the empty string `""` as falsy. OAuth flows can legitimately produce `{ refreshToken: "" }` when `refresh_token` is absent from a refresh response (`lib/auth/auth.ts:103`, `json.refresh_token ?? ""`). The `||` fallback therefore *resurrects* `older.refreshToken` from the prior merge round — a token the server may have already rotated away (and invalidated). The same pattern at `:339` resurrects the access token. Every other field on this record uses nullish-coalescing `??`, which would correctly preserve the empty string; the inconsistency is the bug. Downstream rotation selects the resurrected account; refresh attempts against the invalid token now accumulate auth failures, tripping `markRefreshTokenCoolingDown` on a token family the user never asked to cool down.
- **Recommendation**: Replace both `||` with `??`: `refreshToken: newer.refreshToken ?? older.refreshToken`. Add a unit test in `test/login-runner.test.ts` asserting that merging `{newer.refreshToken: ""}` into `{older.refreshToken: "stale"}` yields `""` (the new canonical state), not `"stale"`. Also tighten the return type from `refreshAccessToken` to not default `refresh` to `""` (`lib/auth/auth.ts:103`); return a discriminated `{ type: "no_refresh" }` branch instead so the compiler forces caller handling.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. Quote verbatim at `lib/auth/login-runner.ts:338-339`. The `refresh: json.refresh_token ?? ""` return at `lib/auth/auth.ts:103` is the empty-string source.

---

### [HIGH | confidence=high] `importAccounts` default `backupMode: "none"` silently overwrites existing account pool on any import

- **File**: `lib/storage.ts:1335-1394`
- **Quote**:

  ```ts
  export async function importAccounts(
  	filePath: string,
  	options: ImportAccountsOptions = {},
  ): Promise<ImportAccountsResult> {
    const { resolvedPath, normalized } = await readAndNormalizeImportFile(filePath);
    const backupMode = options.backupMode ?? "none";
    const backupPrefix = options.preImportBackupPrefix ?? "codex-pre-import-backup";
    
    const {
      imported: importedCount,
      total,
      skipped: skippedCount,
      backupStatus,
      backupPath,
      backupError,
    } =
      await withAccountStorageTransaction(async (existing, persist) => {
        const existingStorage: AccountStorageV3 =
          existing ??
          ({
  ```

- **Issue**: `backupMode` defaults to `"none"` (`:1340`). Any caller that invokes `importAccounts(path)` — including CLI glue in `lib/cli.ts` and the future TUI — will destructively merge the imported file on top of the existing live account store *without* writing a pre-import snapshot. If the imported file is malformed in a way that passes `normalizeAccountStorage` but collapses distinct workspaces together, or if the analysis de-dup incorrectly marks live accounts as collisions, there is no rollback. Pre-seed flagged this explicitly; the behaviour persists at locked SHA. The downstream `log.info("Imported accounts", ...)` reports `backupStatus: "skipped"` without warning — the user sees a success message while the prior state is unrecoverable.
- **Recommendation**: Flip default to `backupMode: "best-effort"`. Require callers that need the current behaviour to pass `backupMode: "none"` explicitly. Update the CLI import command to warn when the caller has selected `"none"`. Add a regression test in `test/storage.test.ts` that asserts `importAccounts(path)` (no options) leaves a `codex-pre-import-backup-*.json` file in `backups/`.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. Default literal at `:1340` (`options.backupMode ?? "none"`) unchanged at locked SHA. Backup path construction at `lib/storage.ts:1223-1228`.

---

### [HIGH | confidence=medium] Unverified JWT signatures drive account-identity derivation — decoded payload fields trusted for `accountId` / `organizationId`

- **File**: `lib/auth/auth.ts:115-130`
- **Quote**:

  ```ts
  export function decodeJWT(token: string): JWTPayload | null {
  	try {
  		const parts = token.split(".");
  		if (parts.length !== 3) return null;
  		const payload = parts[1] ?? "";
  		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  		const padded = normalized.padEnd(
  			normalized.length + ((4 - (normalized.length % 4)) % 4),
  			"=",
  		);
  		const decoded = Buffer.from(padded, "base64").toString("utf-8");
  		return JSON.parse(decoded) as JWTPayload;
  	} catch {
  		return null;
  	}
  }
  ```

- **Issue**: `decodeJWT` base64-decodes the JWT payload and `JSON.parse`s it without verifying the signature. Every downstream consumer — `extractAccountId` (`lib/auth/token-utils.ts:410-415`), `extractAccountEmail` (`:421-443`), `getAccountIdCandidates` (`:450-486`), `extractExpiresAtFromAccessToken` (`lib/accounts.ts:80-88`) — trusts the decoded claims verbatim. In the normal path OpenAI is the token issuer and the transport is TLS, so forgery is not trivial, but: (a) if any component hands the plugin a crafted JWT (see HIGH finding on Codex CLI injection where `access_token` is read from an attacker-controlled file), the plugin will happily route requests under an attacker-chosen `chatgpt_account_id` and `organization_id`; (b) test fakes frequently drop the signature segment, normalising the library's tolerance for malformed tokens. Because the decoded identity is persisted into the account pool and used as the dedup key, a single inbound forged token poisons the persistent account state.
- **Recommendation**: Either (a) verify the JWT signature using the OpenAI JWKS (`https://auth.openai.com/.well-known/jwks.json`) with a library such as `jose` (already transitive via `@openauthjs/openauth`), or (b) treat decoded claims as advisory only — never persist `accountId`/`organizationId` derived from `decodeJWT` unless the same values appear in the token-endpoint *response body* (which is server-authenticated by TLS). At minimum, add a boolean `verified: false` flag to every `JWTPayload` result and reject unverified payloads from `hydrateFromCodexCli`.
- **Evidence**: Direct read. `decodeJWT` has no `jose.verify` or equivalent crypto call; `parts.length !== 3` is the only structural check. Consumers in `lib/auth/token-utils.ts:410-443` and `lib/accounts.ts:80-88` take results at face value.

---

### MEDIUM — defects that degrade robustness / security posture

---

### [MEDIUM | confidence=high] `ensureGitignore` only runs when `.git` already exists — skips fresh clones, bare repos, and per-project configs without VCS marker

- **File**: `lib/storage.ts:243-272`
- **Quote**:

  ```ts
  async function ensureGitignore(storagePath: string): Promise<void> {
    if (!currentStoragePath) return;

    const configDir = dirname(storagePath);
    const inferredProjectRoot = dirname(configDir);
    const candidateRoots = [currentProjectRoot, inferredProjectRoot].filter(
      (root): root is string => typeof root === "string" && root.length > 0,
    );
    const projectRoot = candidateRoots.find((root) => existsSync(join(root, ".git")));
    if (!projectRoot) return;
    const gitignorePath = join(projectRoot, ".gitignore");

    try {
      let content = "";
      if (existsSync(gitignorePath)) {
        content = await fs.readFile(gitignorePath, "utf-8");
        const lines = content.split("\n").map((l) => l.trim());
        if (lines.includes(".opencode") || lines.includes(".opencode/") || lines.includes("/.opencode") || lines.includes("/.opencode/")) {
          return;
        }
  ```

- **Issue**: `.gitignore` protection is conditional on `existsSync(join(root, ".git"))`. Projects that use alternate markers (`.hg`, `.svn`, `.jj`) — or that happen to install this plugin inside a subdirectory before `git init` — will *not* get `.opencode/` added to `.gitignore`. The refresh-token-bearing `accounts.json` is then a strong candidate for accidental `git add -A && git commit`, leaking the credential via the public-commit channel. Further: if `.opencode/` is already tracked (the user committed it once before installing the plugin), this function returns early without un-tracking — the guard only looks at the ignore file, not the index.
- **Recommendation**: Broaden the marker set to match `PROJECT_MARKERS` from `lib/storage/paths.ts:11` (already includes `.git`, `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `.opencode`), and additionally call `git check-ignore` (or equivalent `git ls-files --error-unmatch .opencode/`) to warn when the directory is already tracked. Fail-open (i.e., still write `.gitignore`) if git is unavailable.
- **Evidence**: Direct read. Guard at `:251` (`existsSync(join(root, ".git"))`). Contrast with `lib/storage/paths.ts:11` which already enumerates 6 markers.

---

### [MEDIUM | confidence=high] `fs.mkdir` for account-storage directories does not apply `mode: 0o700`; parent dir inherits umask (often world-readable)

- **File**: `lib/storage.ts:894-906`
- **Quote**:

  ```ts
  async function writeAccountsToPathUnlocked(path: string, storage: AccountStorageV3): Promise<void> {
    const uniqueSuffix = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const tempPath = `${path}.${uniqueSuffix}.tmp`;

    try {
      await fs.mkdir(dirname(path), { recursive: true });
      await ensureGitignore(path);

      // Normalize before persisting so every write path enforces dedup semantics
      // (exact identity dedupe plus legacy email dedupe for identity-less records).
      const normalizedStorage = normalizeAccountStorage(storage) ?? storage;
      const content = JSON.stringify(normalizedStorage, null, 2);
      await fs.writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 });
  ```

- **Issue**: `fs.mkdir(dirname(path), { recursive: true })` at `:899` creates the parent `.opencode/` directory without a `mode` option, so it inherits process umask (typically `0o755` on Linux/macOS — world-readable + executable — and a default ACL on Windows). File `mode: 0o600` protects the leaf file, but a world-readable *directory* lets other local users enumerate `accounts.json` metadata (size, mtime) and, on Linux, even `cat` sibling `.tmp` files created mid-write that briefly exist with default umask permissions before `renameWithWindowsRetry`. Same omission at `lib/storage.ts:1153` (flagged-accounts) and `lib/storage.ts:1321` (exports). The project already demonstrates the correct pattern in `lib/audit.ts:91` and `lib/logger.ts:258` (`mode: 0o700`).
- **Recommendation**: Add `{ recursive: true, mode: 0o700 }` to every `fs.mkdir` call under `lib/storage.ts`. Additionally, pass `mode: 0o600` into `writeFileWithTimeout` for the pre-import backup at `:218` (already there) and verify the backup directory parent created at `:1228` also gets `0o700` via an explicit `fs.mkdir` before `writeFileWithTimeout`.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. Three omission call sites: `:899`, `:1153`, `:1321`. Correct pattern in `lib/audit.ts:91` and `lib/logger.ts:258`.

---

### [MEDIUM | confidence=high] `readAndNormalizeImportFile` uses `JSON.parse` + `normalizeAccountStorage`; no strict Zod enforcement on import payload

- **File**: `lib/storage.ts:1231-1256`
- **Quote**:

  ```ts
  async function readAndNormalizeImportFile(filePath: string): Promise<{
  	resolvedPath: string;
  	normalized: AccountStorageV3;
  }> {
  	const resolvedPath = resolvePath(filePath);

  	if (!existsSync(resolvedPath)) {
  		throw new Error(`Import file not found: ${resolvedPath}`);
  	}

  	const content = await fs.readFile(resolvedPath, "utf-8");

  	let imported: unknown;
  	try {
  		imported = JSON.parse(content);
  	} catch {
  		throw new Error(`Invalid JSON in import file: ${resolvedPath}`);
  	}

  	const normalized = normalizeAccountStorage(imported);
  	if (!normalized) {
  		throw new Error("Invalid account storage format");
  	}

  	return { resolvedPath, normalized };
  }
  ```

- **Issue**: `normalizeAccountStorage` is a permissive coercion — it attempts to salvage partial data rather than enforcing the authoritative `AnyAccountStorageSchema` Zod contract declared in `lib/schemas.ts`. Adversarially constructed import files (including the Codex-CLI cross-process vector in the HIGH finding above) can therefore surface through `importAccounts` with fields that Zod would reject (e.g., non-ISO timestamps, negative counters, unexpected `accountIdSource` literals). Because every import writes through `persist` inside `withAccountStorageTransaction`, a malformed but normalisable record is now permanent. Compare with `lib/auth/auth.ts:95` which correctly uses `safeParseOAuthTokenResponse`.
- **Recommendation**: Run `AnyAccountStorageSchema.safeParse(imported)` before `normalizeAccountStorage`; on `success=false`, either reject the import with `getValidationErrors(imported).join("; ")` as the thrown message, or (if lenient imports are a deliberate feature) attach the validation-error list to the `ImportAccountsResult` so CLI surfaces a warning. Do the same in `loadAccountsInternal` for the on-disk read path (separate finding below).
- **Evidence**: Direct read. `normalizeAccountStorage` defined elsewhere in the file; `AnyAccountStorageSchema` imported at `lib/storage.ts:14` but never called on import path.

---

### [MEDIUM | confidence=medium] OAuth token-endpoint error bodies pass through template-literal interpolation; opaque tokens bypass `TOKEN_PATTERNS`

- **File**: `lib/auth/auth.ts:89-99`
- **Quote**:

  ```ts
  if (!res.ok) {
  	const text = await res.text().catch(() => "");
  	logError(`code->token failed: ${res.status} ${text}`);
  	return { type: "failed", reason: "http_error", statusCode: res.status, message: text || undefined };
  }
  const rawJson = (await res.json()) as unknown;
  const json = safeParseOAuthTokenResponse(rawJson);
  if (!json) {
  	logError("token response validation failed", rawJson);
  	return { type: "failed", reason: "invalid_response", message: "Response failed schema validation" };
  }
  ```

- **Issue**: When the token endpoint returns a non-2xx, `text` is concatenated directly into the log message (`:91`). `logError` funnels through `logToApp` → `sanitizeMessage = maskString(message)` (`lib/logger.ts:155`), which applies four `TOKEN_PATTERNS` (`lib/logger.ts:29-34`): JWT `eyJ...`, 40+ hex, `sk-...`, and `Bearer ...`. **OpenAI refresh tokens are opaque base64url strings that are none of these formats.** When the server occasionally echoes the sent `refresh_token` back in an error envelope (e.g., 400 `invalid_grant` bodies under certain legacy paths), that token is written verbatim to `~/.opencode/logs/codex-plugin/` (directory at `lib/logger.ts:124`). The same gap exists at `:151` (refresh failure), `:164` (missing-refresh failure), `lib/auth/device-code.ts:173-174`, and `lib/auth/device-code.ts:272-273` via `getRedactedErrorBody` which only truncates.
- **Recommendation**: Add a fifth `TOKEN_PATTERNS` entry matching OpenAI's opaque refresh-token alphabet (e.g., `/\b[A-Za-z0-9_-]{40,}\b/g` guarded behind a `refresh_token|access_token|authorization_code|code_verifier` key proximity check) OR stop concatenating HTTP bodies into log messages entirely — pass them as the data argument (`logError(msg, { body: text })`) so `sanitizeValue`'s object traversal applies `SENSITIVE_KEYS` redaction to parsed-JSON bodies. For text bodies, pre-mask via a new `maskHttpBody(text)` that tries `JSON.parse` first and falls back to length truncation.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. `TOKEN_PATTERNS` at `lib/logger.ts:29-34` literally contains 4 patterns; none cover opaque base64url. Mask-via-data path works (object keys in `SENSITIVE_KEYS` at `lib/logger.ts:38-57` include `access_token`, `refresh_token`) but is not the path taken at `:91`, `:151`, `:164`.

---

### [MEDIUM | confidence=high] `REDIRECT_URI` uses `localhost` literal while OAuth server binds `127.0.0.1`; violates RFC 8252 §7.3 guidance

- **File**: `lib/auth/auth.ts:5-13`
- **Quote**:

  ```ts
  import { OAUTH_CALLBACK_PATH, OAUTH_CALLBACK_PORT } from "../runtime-contracts.js";
  import { safeParseOAuthTokenResponse } from "../schemas.js";

  // OAuth constants (from openai/codex)
  export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
  export const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
  export const TOKEN_URL = "https://auth.openai.com/oauth/token";
  export const REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;
  export const SCOPE = "openid profile email offline_access";
  ```

- **Issue**: `REDIRECT_URI` pins the hostname to the string `"localhost"`. The local OAuth HTTP server, however, binds `OAUTH_CALLBACK_LOOPBACK_HOST = "127.0.0.1"` (`lib/runtime-contracts.ts:6`, verified via `lib/auth/server.ts:56`). If the user's resolver returns an unexpected `localhost` mapping (a `/etc/hosts` attack, IPv6-only resolver that maps `localhost` to `::1` while the server binds only IPv4, split-horizon DNS inside a container), the browser redirect lands on a different socket than the one awaiting the code. RFC 8252 §7.3 recommends the loopback literal `127.0.0.1` (or `[::1]`) for this exact reason. The inconsistency also risks bypassing the dynamic port retry that the CLI may implement if the server ever moves off port 1455.
- **Recommendation**: Change `REDIRECT_URI` to `` `http://${OAUTH_CALLBACK_LOOPBACK_HOST}:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}` `` so the constant is sourced from the same literal that the server binds. This also keeps the OAuth authorize URL parameter aligned if `OAUTH_CALLBACK_LOOPBACK_HOST` ever toggles to `::1`.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. `lib/auth/auth.ts:12` literal `localhost` vs `lib/runtime-contracts.ts:6` literal `127.0.0.1`. RFC 8252 §7.3: "Loopback Interface Redirection…clients SHOULD NOT use the loopback `localhost` hostname".

---

### [MEDIUM | confidence=high] OAuth callback server stores `_lastCode` on the HTTP server instance; never cleared after read

- **File**: `lib/auth/server.ts:38-77`
- **Quote**:

  ```ts
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'none'");
  res.end(oauthSuccessHtml);
  (server as http.Server & { _lastCode?: string })._lastCode = code;
  // ... later in waitForCode:
  for (let i = 0; i < maxIterations; i++) {
  	if (pollAborted) return null;
  	const lastCode = (server as http.Server & { _lastCode?: string })._lastCode;
  	if (lastCode) return { code: lastCode };
  	await poll();
  }
  ```

- **Issue**: The authorisation code is stashed as a property on the `http.Server` instance and never deleted after the poll hands it to the caller. Two consequences: (1) if a second `/auth/callback` request arrives before `close()` (a malicious local process hitting `http://127.0.0.1:1455/auth/callback?state=<stolen>&code=<attacker>`), the `_lastCode` field is overwritten and the second call's code is returned instead; the first caller's real code is lost in the race. (2) on abnormal shutdown the code remains on the server object in memory for the lifetime of the plugin process — visible to any `heapdump` or any future coding error that accidentally closes over `server`. Additionally, the `_lastCode` assignment happens *after* `res.end(...)` — if the handler throws between `res.end` and the assignment (e.g., `logError` stack overflow), the code is silently dropped.
- **Recommendation**: Move the authorization code into a `Promise<string>` resolved inside the handler (so the first valid request wins and subsequent requests receive 409/410 responses); close the server and rotate `state` before returning. If retaining the property pattern, delete it with `delete (server as ...)._lastCode` immediately after `waitForCode` reads it. Move `_lastCode = code` *before* `res.end(oauthSuccessHtml)` so handler exceptions don't drop the code.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. Write at `:44`, read at `:71`, no `delete` anywhere in the file.

---

### [MEDIUM | confidence=high] Non-constant-time OAuth `state` compare exposes state-value verification via timing side channel

- **File**: `lib/auth/server.ts:20-31`
- **Quote**:

  ```ts
  try {
  	const url = new URL(req.url || "", "http://localhost");
  	if (url.pathname !== OAUTH_CALLBACK_PATH) {
  		res.statusCode = 404;
  		res.end("Not found");
  		return;
  	}
  	if (url.searchParams.get("state") !== state) {
  		res.statusCode = 400;
  		res.end("State mismatch");
  		return;
  	}
  	const code = url.searchParams.get("code");
  ```

- **Issue**: `url.searchParams.get("state") !== state` short-circuits at the first differing character. The `state` is generated via `randomBytes(16).toString("hex")` (`lib/auth/auth.ts:19-21`) — 32 hex chars, 128 bits of entropy — so the timing channel is not practically exploitable in a single flow. However: (a) the server listens on the loopback interface where any local user can easily run 10k timing probes without network jitter; (b) the CSRF protection is the entire point of `state`, so defense-in-depth matters; (c) the project already uses `node:crypto.randomBytes` — switching to `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` is trivial. Additionally, `url.searchParams.get("state")` returns `null` when missing — the strict-inequality check correctly rejects that, but the constant-time variant must handle the `null` branch explicitly.
- **Recommendation**: Replace with `timingSafeEqualHex(expected: string, received: string | null): boolean` that length-checks first, then uses `crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"))`. Return `false` on length mismatch or `null` received value.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. `:27` uses `!==`.

---

### [MEDIUM | confidence=medium] Device-code flow accepts server-supplied PKCE `code_verifier` — violates RFC 7636 intent

- **File**: `lib/auth/device-code.ts:119-139`
- **Quote**:

  ```ts
  function parseDeviceCodePollResponse(raw: unknown): DeviceCodePollResponse | null {
  	if (!isRecord(raw)) return null;

  	const authorizationCode =
  		typeof raw.authorization_code === "string" && raw.authorization_code.trim()
  			? raw.authorization_code.trim()
  			: undefined;
  	const codeVerifier =
  		typeof raw.code_verifier === "string" && raw.code_verifier.trim()
  			? raw.code_verifier.trim()
  			: undefined;

  	if (!authorizationCode || !codeVerifier) {
  		return null;
  	}

  	return {
  		authorizationCode,
  		codeVerifier,
  	};
  }
  ```

- **Issue**: The poll response returns `code_verifier` from the server; `completeDeviceCodeSession` (`lib/auth/device-code.ts:259-263`) then passes that server-supplied verifier directly to `exchangeAuthorizationCode`. RFC 7636 §4.1 requires the PKCE `code_verifier` to be **client-generated** — its whole purpose is to bind the token exchange to the originating client, defeating code-interception attacks. A server-supplied verifier eliminates that binding and reduces PKCE to a ceremonial hash. If the OpenAI device-auth service is ever compromised (or a MITM intercepts the poll response), the attacker can forge a `(code, verifier)` pair that the plugin will redeem as authentic.
- **Recommendation**: Generate the PKCE pair client-side in `createDeviceCodeSession` (as is done for the browser flow via `generatePKCE()` at `lib/auth/auth.ts:197`), send the `code_challenge` in the initial `usercode` request, and retain the `code_verifier` in the closure. Ignore any `code_verifier` field the server returns on poll — only `authorization_code` should survive. This matches the canonical RFC 8628 + RFC 7636 pairing.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. `lib/auth/device-code.ts:127-138` parses server `code_verifier`; `:259-263` passes it to `exchangeAuthorizationCode`. RFC 7636 §4.1 ("The client MUST generate the code_verifier").

---

### [MEDIUM | confidence=high] `CODEX_AUTH_ACCOUNT_ID` env override trusted verbatim with no character validation

- **File**: `lib/auth/login-runner.ts:56-71`
- **Quote**:

  ```ts
  export function resolveAccountSelection(tokens: TokenSuccess): AccountSelectionResult {
  	const override = (process.env.CODEX_AUTH_ACCOUNT_ID ?? "").trim();
  	if (override) {
  		const suffix = override.length > 6 ? override.slice(-6) : override;
  		logInfo(`Using account override from CODEX_AUTH_ACCOUNT_ID (id:${suffix}).`);
  		const primary = {
  			...tokens,
  			accountIdOverride: override,
  			accountIdSource: "manual" as const,
  			accountLabel: `Override [id:${suffix}]`,
  		};
  		return {
  			primary,
  			variantsForPersistence: [primary],
  		};
  	}
  ```

- **Issue**: `process.env.CODEX_AUTH_ACCOUNT_ID` is `.trim()`-ed and otherwise trusted verbatim. There is no length cap, no character-set check (UUID, hex, alphanumeric), no verification that the value matches any `accountId` present in the access token's `chatgpt_account_id` claim, and no rejection of obvious control characters (`\n`, `\r`, `\0`) that would later break log parsing or JSON persistence. A user who sets this env variable to, say, `legit\n\tfake-admin-id` will persist a newline-bearing `accountIdOverride` that corrupts downstream log records and `accounts.json`. More critically: the override is silently persisted and used for *all* subsequent requests, meaning a misset env variable routes the user's session to an attacker-chosen workspace id — this is essentially a trust boundary with no validation.
- **Recommendation**: Validate the override against `/^[A-Za-z0-9_-]{8,128}$/` (matching OpenAI's actual `chatgpt_account_id` format), reject anything else with a one-line warning, and also refuse the override if it does not appear in `getAccountIdCandidates(tokens.access, tokens.idToken)` — i.e., require the override to name a real candidate from the token, preventing drift into a workspace the user never had access to.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. `:57` `process.env.CODEX_AUTH_ACCOUNT_ID`. No validation between `:57` and `:65`.

---

### [MEDIUM | confidence=high] `persistResolvedAccountSelection` wraps original error as `cause` — downstream consumers may log the full stack (token paths leaked)

- **File**: `lib/auth/login-runner.ts:172-194`
- **Quote**:

  ```ts
  export async function persistResolvedAccountSelection(
  	selection: AccountSelectionResult,
  	options?: {
  		persistSelections?: PersistAccountSelections;
  		replaceAll?: boolean;
  	},
  ): Promise<AccountSelectionResult> {
  	if (!options?.persistSelections) {
  		return selection;
  	}

  	try {
  		await options.persistSelections(
  			selection.variantsForPersistence,
  			options.replaceAll ?? false,
  		);
  	} catch (error) {
  		throw new Error(PERSIST_AUTHENTICATED_SELECTIONS_ERROR, {
  			cause: error,
  		});
  	}
  	return selection;
  }
  ```

- **Issue**: The comment block above (`:168-171`) claims the wrapper is designed to let callers "log the wrapper safely without leaking token-file paths". The implementation keeps the original error on `.cause`, which `util.inspect(err, { depth: Infinity })` — and most default Node logging — will still serialize fully. `StorageError` (`lib/storage.ts:99-111`) has `path` on the instance; if the persist callback throws `StorageError`, the cause chain contains the absolute path to `accounts.json`. On Windows this typically includes the username segment of `C:\Users\<name>\.opencode\...` — privacy-sensitive but not cryptographically sensitive. The bigger risk is that downstream callers may `throw new Error(..., { cause: err })` repeatedly, and any layer that does a naive `JSON.stringify(err)` or a console-dump will re-emit the path.
- **Recommendation**: Either (a) fulfil the stated contract: strip `.cause` (or wrap with a `RedactedError` class that overrides `toJSON`/`util.inspect.custom` to omit `.cause`), or (b) keep `.cause` but update the comment to match reality so callers know they must strip before logging. Prefer (a).
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. Quote at `:189-192`. `StorageError.path` at `lib/storage.ts:101`.

---

### [MEDIUM | confidence=high] `tokenRotationMap` keys are raw `refresh_token` strings stored in an unbounded in-process `Map`

- **File**: `lib/refresh-queue.ts:85-200`
- **Quote**:

  ```ts
  export class RefreshQueue {
    private pending: Map<string, RefreshEntry> = new Map();
    private metrics: RefreshQueueMetrics = createInitialMetrics();
    
    /**
     * Maps old refresh tokens to new tokens after rotation.
     * This allows lookups with either old or new token to find the same entry.
     * Format: oldToken → newToken
     */
    private tokenRotationMap: Map<string, string> = new Map();
  // ...
    private async executeRefreshWithRotationTracking(refreshToken: string): Promise<TokenResult> {
      const result = await this.executeRefresh(refreshToken);
      
      if (result.type === "success" && result.refresh !== refreshToken) {
        this.tokenRotationMap.set(refreshToken, result.refresh);
        this.metrics.rotated += 1;
  ```

- **Issue**: The `tokenRotationMap` stores both the old *and* new refresh tokens as plaintext `Map<string, string>` entries. Because the map only loses entries via `cleanupRotationMapping` (called in the `finally` of `refresh(...)` at `:165`), any refresh that throws or is abandoned leaves tokens in memory indefinitely. A heap dump (v8 snapshot from `--inspect`, `crashdumps`, or an OOM kill with swap-file capture) yields every refresh token that rotated during the process lifetime. The same concern applies to the `pending` map at `:87`. For a long-lived plugin process, this accumulates the full token-rotation history in RAM — an inversion of the usual credential-hygiene goal, which is "keep secrets in memory for the shortest possible time".
- **Recommendation**: Key the maps by a non-invertible hash of the refresh token: `crypto.createHash("sha256").update(refreshToken).digest("hex")`. The lookups and rotation semantics still work (equal tokens hash equal), but heap dumps no longer expose the plaintext. Verify with `test/refresh-queue.test.ts` that rotation de-dup still passes.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. Quote at `:95` declaration, `:192` write. `cleanupRotationMapping` at `:179-186` runs only in `finally`.

---

### [MEDIUM | confidence=high] Refresh-queue stale eviction removes the pending entry but abandons the in-flight promise

- **File**: `lib/refresh-queue.ts:254-279`
- **Quote**:

  ```ts
  /**
   * Remove stale entries that have been pending too long.
   * This prevents memory leaks from stuck or abandoned refresh operations.
   */
  private cleanup(): void {
  	const now = Date.now();
  	const staleTokens: string[] = [];

  	for (const [token, entry] of this.pending.entries()) {
  		if (now - entry.startedAt > this.maxEntryAgeMs) {
  			staleTokens.push(token);
  		}
  	}

  	for (const token of staleTokens) {
  		// istanbul ignore next -- defensive: token always exists in pending at this point (not yet deleted)
  		const ageMs = now - (this.pending.get(token)?.startedAt ?? now);
  		this.metrics.staleEvictions += 1;
  		log.warn("Removing stale refresh entry", {
  			tokenSuffix: token.slice(-6),
  			ageMs,
  		});
  		this.pending.delete(token);
  	}
  	this.metrics.pending = this.pending.size;
  }
  ```

- **Issue**: Stale eviction at `:268-276` removes the entry from `pending` but does **not** abort, cancel, or otherwise signal the underlying `executeRefreshWithRotationTracking` promise. The original `fetch(TOKEN_URL, ...)` at `lib/auth/auth.ts:139` keeps running; if it eventually succeeds, `tokenRotationMap` gains a plaintext rotation entry (via the `finally`/`cleanupRotationMapping` path) but the in-memory `ManagedAccount` that triggered the original refresh has long since been updated by a *second* refresh that the eviction permitted. The net effect: the account now holds refresh token B, but the server rotated A → C through the evicted-but-still-running request. On next request the server rejects B (which was rotated away), and the user sees `invalid_grant`. The `istanbul ignore next` comment at `:269` suggests the stale-eviction path has never been exercised in tests.
- **Recommendation**: Pass an `AbortController.signal` into `refreshAccessToken` (which already honors `signal` via `fetch`) so stale eviction can `.abort()` the in-flight call. Alternatively, extend the entry lifetime: if the fetch is still running at the stale threshold, wait another `maxEntryAgeMs / 2` before evicting rather than abandoning it outright. Add a vitest case that artificially hangs the underlying refresh and asserts no rotation occurs after eviction.
- **Evidence**: Pre-seed (`bg_707b6648` + `bg_c692d877`). Missing `AbortController` at `:258-279` and `lib/auth/auth.ts:137-181`.

---

### [MEDIUM | confidence=high] `saveToDiskDebounced` swallows save errors; users never see persistent-state corruption

- **File**: `lib/accounts.ts:945-966`
- **Quote**:

  ```ts
  saveToDiskDebounced(delayMs = 500): void {
  	if (this.saveDebounceTimer) {
  		clearTimeout(this.saveDebounceTimer);
  	}
  	this.saveDebounceTimer = setTimeout(() => {
  		this.saveDebounceTimer = null;
  		const doSave = async () => {
  			try {
  				if (this.pendingSave) {
  					await this.pendingSave;
  				}
  				this.pendingSave = this.saveToDisk().finally(() => {
  					this.pendingSave = null;
  				});
  				await this.pendingSave;
  			} catch (error) {
  				log.warn("Debounced save failed", { error: error instanceof Error ? error.message : String(error) });
  			}
  		};
  		void doSave();
  	}, delayMs);
  }
  ```

- **Issue**: Errors from `saveToDisk` are logged at `warn` level and discarded. The HIGH finding on silent token loss above notes this interacts with rotation. The MEDIUM here is the orthogonal issue: any save failure (disk full, antivirus lock, network drive disconnect, quota exhaustion) is invisible to the user. The in-memory `AccountManager` continues to report `ok` to callers, but the disk is out of sync. On next process start, the older on-disk state is authoritative — silently losing every rotation, rate-limit clear, and cooldown update since the last successful save. `log.warn` with a partial error message (`error instanceof Error ? error.message : String(error)`) also drops the `StorageError.code` and `.path` fields; diagnosis requires enabling full debug logging after the fact.
- **Recommendation**: Promote save failures to the user: expose an `onSaveError` callback on `AccountManager`, or track a `lastSaveError?: StorageError` field that `shutdown.ts` / the CLI status command surfaces. Do not swallow; rethrow into a process-level error event. Preserve the full `StorageError` via `log.warn("Debounced save failed", { error })` so `sanitizeValue` serialises `.code`, `.path`, `.hint`.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. `log.warn` at `:960-962`. `StorageError` fields at `lib/storage.ts:99-111`.

---

### [MEDIUM | confidence=high] `lib/auth-rate-limit.ts` is fully implemented but never wired into the refresh path

- **File**: `lib/auth-rate-limit.ts:26-127`
- **Quote**:

  ```ts
  function getAccountKey(accountId: string): string {
  	return accountId.toLowerCase().trim();
  }

  function pruneOldAttempts(record: AttemptRecord, now: number): void {
  	const cutoff = now - config.windowMs;
  	record.timestamps = record.timestamps.filter((ts) => ts > cutoff);
  }

  export function canAttemptAuth(accountId: string): boolean {
  	const key = getAccountKey(accountId);
  	const record = attemptsByAccount.get(key);
  // ...
  export function checkAuthRateLimit(accountId: string): void {
  	if (!canAttemptAuth(accountId)) {
  		throw new AuthRateLimitError(
  ```

- **Issue**: A complete token-bucket rate limiter (5 attempts / 60 s default) with tests and typed errors is exported, but no call site invokes `checkAuthRateLimit` / `recordAuthAttempt` in `lib/refresh-queue.ts` (the primary refresh path), `lib/proactive-refresh.ts`, or `lib/auth/auth.ts`. A malformed or compromised access pattern (tight retry loop from a buggy wrapper, or a malicious local tool) can hammer `TOKEN_URL` via `refreshAccessToken` without any local throttle, which (a) risks triggering OpenAI's server-side abuse protections and locking the account, and (b) wastes account health budget through the circuit breaker rather than failing fast on a local guard. The dead-code state also means CVE-class patches to the limiter would land with no runtime effect.
- **Recommendation**: Wire `checkAuthRateLimit(account.accountId ?? account.refreshToken)` at the entry of `RefreshQueue.executeRefresh` (`lib/refresh-queue.ts:206`). Surface `AuthRateLimitError` as a distinct `TokenResult` variant so callers can route to a polite "try again in Xs" user message instead of conflating with `invalid_grant`. Add integration test under `test/refresh-queue.test.ts` asserting the 6th rapid refresh returns the new rate-limited variant.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. `grep -r "checkAuthRateLimit\|recordAuthAttempt" lib/` returns only `lib/auth-rate-limit.ts` itself (direct read). No imports of `auth-rate-limit` from `refresh-queue.ts` / `proactive-refresh.ts` / `auth/auth.ts`.

---

### [MEDIUM | confidence=medium] `removeAccountsWithSameRefreshToken` identity compare is byte-exact; sibling variants with whitespace drift survive removal

- **File**: `lib/accounts.ts:880-896`
- **Quote**:

  ```ts
  removeAccountsWithSameRefreshToken(account: ManagedAccount): number {
  	const refreshToken = account.refreshToken;
  	// Snapshot first because removeAccount mutates this.accounts.
  	const accountsToRemove = this.accounts.filter((acc) => acc.refreshToken === refreshToken);
  	let removedCount = 0;

  	for (const accountToRemove of accountsToRemove) {
  		if (this.removeAccount(accountToRemove)) {
  			removedCount++;
  		}
  	}

  	// Clear stale auth failure state for this refresh token
  	this.authFailuresByRefreshToken.delete(refreshToken);

  	return removedCount;
  }
  ```

- **Issue**: The filter at `:883` uses strict equality on `refreshToken`. Elsewhere the code base normalises tokens via `.trim()` at ingest (e.g., `lib/accounts.ts:134-135` in `hydrateFromCodexCli`; `lib/storage.ts:581-583` in `deduplicateAccounts`), but not at rest. If two account records end up with `refreshToken: "abc "` vs `"abc"` after a round trip through a storage migration or hand-edited `accounts.json`, this function only removes one of them. The companion `incrementAuthFailures` (`:728-733`) and `clearAuthFailures` (`:743-745`) key their `Map` on the same raw string — so the stale sibling continues to accumulate auth failures under a different key. Net result: the user sees one account disappear and a "cooldown" on what looks like a different account.
- **Recommendation**: Normalise at the boundary: add a private helper `normalizeRefreshToken(t: string): string` returning `t.trim()`, call it on every read from persisted storage and on every write to `authFailuresByRefreshToken`. Alternative: switch the identity to `getWorkspaceIdentityKey(account)` from `lib/storage.ts:43-60`, which already handles the trimming.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. `:883` strict `===`. `:707` `account.refreshToken === refreshToken` (same pattern in `markAccountsWithRefreshTokenCoolingDown`).

---

### [MEDIUM | confidence=high] `exportAccounts` default `force = true` silently overwrites any existing export file

- **File**: `lib/storage.ts:1303-1326`
- **Quote**:

  ```ts
  /**
   * Exports current accounts to a JSON file for backup/migration.
   * @param filePath - Destination file path
   * @param force - If true, overwrite existing file (default: true)
   * @throws Error if file exists and force is false, or if no accounts to export
   */
  export async function exportAccounts(filePath: string, force = true): Promise<void> {
    const resolvedPath = resolvePath(filePath);
    
    if (!force && existsSync(resolvedPath)) {
      throw new Error(`File already exists: ${resolvedPath}`);
    }
    
    const storage = await withAccountStorageTransaction((current) => Promise.resolve(current));
    if (!storage || storage.accounts.length === 0) {
      throw new Error("No accounts to export");
    }
    
    await fs.mkdir(dirname(resolvedPath), { recursive: true });
    
    const content = JSON.stringify(storage, null, 2);
    await fs.writeFile(resolvedPath, content, { encoding: "utf-8", mode: 0o600 });
    log.info("Exported accounts", { path: resolvedPath, count: storage.accounts.length });
  }
  ```

- **Issue**: The JSDoc at `:1306` states "If true, overwrite existing file (default: true)" — the code default matches the doc, but both are wrong for a credential-export tool. A user who exports to `~/codex-export.json` today and runs the same command tomorrow with different live state silently overwrites the yesterday file with today's state; no diff, no `.bak`, no prompt. If yesterday's export contained the *only* copy of a long-since-removed account (e.g., rotated off by the plugin's own logic and never written back), yesterday's credential is permanently gone. Combined with the HIGH finding on `importAccounts(backupMode="none")`, the export→import round trip has two silent-destroy steps.
- **Recommendation**: Flip default to `force = false`. Callers that truly want overwrite must opt in explicitly. Also write through the `writePreImportBackupFile` pattern (tmp + rename) so a partial write does not truncate the existing export.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. `:1309` `force = true`.

---

### [MEDIUM | confidence=medium] `pruneRefreshTokenCollisions` keys in-memory dedup `Map` with raw refresh-token strings

- **File**: `lib/auth/login-runner.ts:670-690`
- **Quote**:

  ```ts
  const pruneRefreshTokenCollisions = (): void => {
  	const indicesToRemove = new Set<number>();
  	const exactIdentityToIndex = new Map<string, number>();

  	const getExactIdentityKey = (
  		account: {
  			organizationId?: string;
  			accountId?: string;
  			email?: string;
  			refreshToken?: string;
  		} | undefined,
  	): string => {
  		const organizationId = account?.organizationId?.trim() ?? "";
  		const accountId = normalizeStoredAccountId(account) ?? "";
  		const email = account?.email?.trim().toLowerCase() ?? "";
  		const refreshToken = account?.refreshToken?.trim() ?? "";
  		if (organizationId || accountId) {
  			return `org:${organizationId}|account:${accountId}|refresh:${refreshToken}`;
  		}
  		return `email:${email}|refresh:${refreshToken}`;
  	};
  ```

- **Issue**: `getExactIdentityKey` embeds the plaintext refresh token in the Map key string (`refresh:${refreshToken}`). Same concerns as the `tokenRotationMap` MEDIUM finding — heap dumps expose the token, and the key itself is retained for the life of `pruneRefreshTokenCollisions`'s closure (garbage-collected after the loop, but any exception in the middle of the loop pins it for longer). Low-exploitability because the key is stack-scoped to a private function, but it's an avoidable violation of the "hash secrets before using as keys" principle.
- **Recommendation**: SHA-256 hash the refresh token before concatenation, matching the fix recommended for `tokenRotationMap`. `sha256(rt).slice(0, 16)` is sufficient for dedup collision avoidance (billions-to-one).
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. `:685-690` key template.

---

### [MEDIUM | confidence=high] `incrementAuthFailures` keys by raw `refreshToken`; org variants sharing token collide but variant-specific context is lost

- **File**: `lib/accounts.ts:728-745`
- **Quote**:

  ```ts
  incrementAuthFailures(account: ManagedAccount): number {
  	const currentFailures = this.authFailuresByRefreshToken.get(account.refreshToken) ?? 0;
  	const newFailures = currentFailures + 1;
  	this.authFailuresByRefreshToken.set(account.refreshToken, newFailures);
  	return newFailures;
  }

  /**
   * Clear the authentication failure counter for the given account's refresh token.
   *
   * Notes:
   * - Failure counts are tracked per refresh token (not per account), so this clears
   *   shared failure state for all org variants that reuse the same token.
   * - Failure counts are in-memory only for the current AccountManager instance.
   */
  clearAuthFailures(account: ManagedAccount): void {
  	this.authFailuresByRefreshToken.delete(account.refreshToken);
  }
  ```

- **Issue**: The comment at `:736-741` correctly documents that org variants sharing a refresh token share failure counters. This is a double-edged design: a single failure on one org variant cools down every variant; conversely, a legitimate recovery on one variant clears failures for all. But the *key* is the raw refresh token — which (a) re-raises the heap-dump concern from the rotation-map MEDIUM, and (b) means that *after* a successful rotation the old-token failure counter becomes orphaned in the map because the account now holds `result.refresh` (not `previousRefreshToken`) — see `updateFromAuth` at `lib/accounts.ts:761-767`, which only deletes the failure counter on *mismatch*, leaving the counter keyed on the new token. Net: a rapid failure→rotation sequence preserves the failure count; a slow rotation loses it.
- **Recommendation**: Hash the key (as with `tokenRotationMap`). Additionally, tie the counter lifecycle to `updateFromAuth` — after rotation, move the counter under the new token key atomically, not delete-then-orphan.
- **Evidence**: Direct read. `updateFromAuth` at `:760-777`.

---

### [MEDIUM | confidence=medium] `logger.ts:TOKEN_PATTERNS` misses OpenAI opaque base64url refresh-token format

- **File**: `lib/logger.ts:29-34`
- **Quote**:

  ```ts
  const TOKEN_PATTERNS = [
  	/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  	/[a-f0-9]{40,}/gi,
  	/sk-[A-Za-z0-9]{20,}/g,
  	/Bearer\s+\S+/gi,
  ];
  ```

- **Issue**: Four patterns: compact JWT (`eyJ...`), 40+ char lowercase hex, `sk-...` classic OpenAI API keys, and `Bearer ...`. OpenAI refresh tokens minted by `https://auth.openai.com/oauth/token` are opaque base64url strings that are not JWTs, not hex, not `sk-` prefixed, and appear in HTTP bodies without a `Bearer ` prefix. When the string form of a refresh token reaches `maskString(value)` (used via `logError` string-concatenation call sites — see MEDIUM above), none of the four patterns match, so the token ends up unredacted in `~/.opencode/logs/codex-plugin/`. `SENSITIVE_KEYS` in `sanitizeValue` catches refresh tokens when they appear as *object keys* on structured data — which is the intended happy path — but string-concatenated tokens bypass.
- **Recommendation**: Add a fifth pattern keyed on context words: `/(refresh_token|access_token|code_verifier|authorization_code)["':=\s]+["']?([A-Za-z0-9_.\-]{20,})/gi` with a callback that masks the captured group. This approach avoids false positives on unrelated high-entropy content (which a naive `/[A-Za-z0-9_-]{40,}/g` would cause). Keep the existing four patterns as a safety net.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. Direct read of `:29-34`. `maskString` at `lib/logger.ts:75-83` iterates `TOKEN_PATTERNS`.

---

### [MEDIUM | confidence=medium] `device-code.ts` passes `rawJson` object into `logError` on validation failure; `code_verifier` / `authorization_code` keys are not in `SENSITIVE_KEYS`

- **File**: `lib/auth/device-code.ts:247-256`
- **Quote**:

  ```ts
  if (response.ok) {
  	const rawJson = (await response.json()) as unknown;
  	const parsed = parseDeviceCodePollResponse(rawJson);
  	if (!parsed) {
  		logError("device-code token poll response validation failed", rawJson);
  		return {
  			type: "failed",
  			reason: "invalid_response",
  			message: "Device code login returned an invalid authorization payload",
  		};
  	}
  ```

- **Issue**: When the device-code poll response parses as JSON but fails structural validation, `rawJson` is passed as the `data` argument to `logError`. `sanitizeValue` (`lib/logger.ts:85-110`) only masks keys in `SENSITIVE_KEYS` (`lib/logger.ts:38-57`). That set includes `access_token`, `refresh_token`, `token`, `authorization`, etc., but **not** `code_verifier`, `authorization_code`, or `device_auth_id`. A malformed but adversarial response containing those fields is logged verbatim. The `authorization_code` field is single-use and short-lived, so the exposure window is minutes — but if logs are shipped off-host (CI artefacts, crash reporters), a fresh `authorization_code` plus the accompanying `code_verifier` is all an attacker needs to complete the PKCE exchange and mint tokens.
- **Recommendation**: Extend `SENSITIVE_KEYS` in `lib/logger.ts:38-57` with `code_verifier`, `codeverifier`, `authorization_code`, `authorizationcode`, `device_auth_id`, `deviceauthid`, `user_code`, `usercode`, `id_token`, `idtoken` (some already present — keep this diff additive).
- **Evidence**: Direct read. `SENSITIVE_KEYS` at `lib/logger.ts:38-57` does not contain any of the six device-code field names.

---

### [MEDIUM | confidence=medium] `oauth-success.ts` CSP `default-src 'self'; script-src 'none'` blocks the inline `preconnect` to `fonts.googleapis.com` — page renders without fonts, indicating dead-markup policy drift

- **File**: `lib/oauth-success.ts:1-10` (plus CSP header at `lib/auth/server.ts:42`)
- **Quote**:

  ```ts
  export const oauthSuccessHtml = String.raw`<!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>OpenCode - Authentication Successful</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&display=swap" rel="stylesheet">
      <style>
  ```

- **Issue**: The success page ships with `<link rel="preconnect" href="https://fonts.googleapis.com">` and a `<link href="https://fonts.googleapis.com/...">` stylesheet import. The server-side CSP (`lib/auth/server.ts:42`) declares `default-src 'self'; script-src 'none'` — which covers `style-src`, `font-src`, and `connect-src` via the `default-src` fallback, blocking all three. The result is that the fonts never load, the third-party preconnect is wasted, and the user sees a fallback-serif page instead of the intended IBM Plex Mono. Functionally benign; but it indicates that the CSP was never validated against the markup and may silently loosen over time — e.g., a future edit that adds a `script-src 'self' 'unsafe-inline'` for "just a little inline JS" would pass through without review because nobody reads the CSP. Also minor privacy: the browser will *still* make the preconnect DNS resolution for `fonts.googleapis.com` even if the fetch is blocked, which reveals plugin-success-page visits to Google's public DNS + ECS path.
- **Recommendation**: Either (a) remove the three external `<link>` tags and ship `IBM Plex Mono` as inline `@font-face { src: url("data:font/woff2;base64,...") }` (large but self-contained), or (b) relax the CSP to explicitly allow `font-src https://fonts.gstatic.com; style-src 'self' https://fonts.googleapis.com`. Prefer (a) — less chance of future CSP drift, and the loopback server is the only caller of this HTML so bundle weight is not a concern.
- **Evidence**: Direct read. CSP at `lib/auth/server.ts:42`. `<link>` tags at `lib/oauth-success.ts:7-9`.

---

### LOW — polish / tightening

---

### [LOW | confidence=high] Temp-file suffix uses `Math.random()` — non-cryptographic, ~23 bits of distinguishability

- **File**: `lib/storage.ts:894-896`
- **Quote**:

  ```ts
  async function writeAccountsToPathUnlocked(path: string, storage: AccountStorageV3): Promise<void> {
    const uniqueSuffix = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const tempPath = `${path}.${uniqueSuffix}.tmp`;
  ```

- **Issue**: `Math.random().toString(36).slice(2, 8)` yields 6 base-36 characters (~31 bits) but `Math.random` is not cryptographically seeded, and the combination of `Date.now()` (ms resolution) + predictable PRNG makes the full tempPath guessable within a narrow window. Not directly exploitable for token exfiltration (the tempPath lives in `~/.opencode/` under `0o600`, assuming the HIGH fix lands), but a local attacker who can `inotify`-watch the directory can predict the next tempPath and attempt a race (e.g., symlink pre-planting) on a shared multi-user machine. Same pattern at `:212-213` (pre-import backup) and `:1149-1150` (flagged accounts write).
- **Recommendation**: Replace with `randomBytes(6).toString("hex")` (already imported at `lib/storage.ts:2`). Same cost, cryptographic entropy, no Math.random.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. Three call sites verified.

---

### [LOW | confidence=high] 48-bit project-key hash truncation — collision probability non-trivial in heavy multi-worktree use

- **File**: `lib/storage/paths.ts:11-45`
- **Quote**:

  ```ts
  const PROJECT_MARKERS = [".git", "package.json", "Cargo.toml", "go.mod", "pyproject.toml", ".opencode"];
  const PROJECTS_DIR = "projects";
  const PROJECT_KEY_HASH_LENGTH = 12;
  // ...
  export function getProjectStorageKey(projectPath: string): string {
  	const normalizedPath = normalizeProjectPath(projectPath);
  	const hash = createHash("sha256")
  		.update(normalizedPath)
  		.digest("hex")
  		.slice(0, PROJECT_KEY_HASH_LENGTH);
  	const projectName = sanitizeProjectName(normalizedPath).slice(0, 40);
  	return `${projectName}-${hash}`;
  }
  ```

- **Issue**: `PROJECT_KEY_HASH_LENGTH = 12` yields a 48-bit hash. Birthday-collision probability hits 1% at ~1.6M paths, 50% at ~16M. A developer with hundreds of worktrees (monorepo + many feature branches) will not trip this, but the safety margin is tight for users who script per-branch project dirs. The consequence of a collision is per-project account storage bleeding across two projects — privacy issue, not auth compromise.
- **Recommendation**: Bump `PROJECT_KEY_HASH_LENGTH` to 24 (96 bits; collision-free under any realistic usage). Backwards compatibility: existing `~/.opencode/projects/<name>-<12hex>/` dirs can coexist with new `-<24hex>/` if lookup tries both patterns.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. `:13` constant.

---

### [LOW | confidence=high] Backup directory created without explicit `mode: 0o700`

- **File**: `lib/storage.ts:1223-1228`
- **Quote**:

  ```ts
  export function createTimestampedBackupPath(prefix = "codex-backup"): string {
  	const storagePath = getStoragePath();
  	const backupDir = join(dirname(storagePath), "backups");
  	const safePrefix = sanitizeBackupPrefix(prefix);
  	const nonce = randomBytes(3).toString("hex");
  	return join(backupDir, `${safePrefix}-${formatBackupTimestamp()}-${nonce}.json`);
  }
  ```

- **Issue**: Construction is pure-path — the directory is only created by `writePreImportBackupFile` at `lib/storage.ts:216` via `fs.mkdir(dirname(backupPath), { recursive: true })` **without** a `mode` option. Same root-cause as the MEDIUM finding on parent-dir mode, but specifically for backup contents which contain a *full* snapshot of every refresh token. 3 hex bytes of nonce (`randomBytes(3)`) gives only 24 bits of entropy — acceptable because of the timestamp prefix, but thin.
- **Recommendation**: Create the backup dir with `{ recursive: true, mode: 0o700 }` in `writePreImportBackupFile`. Bump nonce to `randomBytes(8).toString("hex")`.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. `:216` mkdir mode absent.

---

### [LOW | confidence=high] Refresh-queue logs `tokenSuffix: refreshToken.slice(-6)` — 6 characters is low-information but still enumerable

- **File**: `lib/refresh-queue.ts:127-148`
- **Quote**:

  ```ts
  if (existing) {
  	this.metrics.deduplicated += 1;
  	this.metrics.pending = this.pending.size;
  	log.info("Reusing in-flight refresh for token", {
  		tokenSuffix: refreshToken.slice(-6),
  		waitingMs: Date.now() - existing.startedAt,
  	});
  	return existing.promise;
  }

  // Check if this token was rotated FROM another token that's still refreshing
  // This handles: Request A starts with oldToken, gets newToken, Request B arrives with newToken
  const rotatedFrom = this.findOriginalToken(refreshToken);
  if (rotatedFrom) {
  	const originalEntry = this.pending.get(rotatedFrom);
  	if (originalEntry) {
  		this.metrics.rotationReused += 1;
  		this.metrics.pending = this.pending.size;
  		log.info("Reusing in-flight refresh for token", {
  ```

- **Issue**: 6 trailing chars from a refresh token, while often acceptable, is effectively a short identifier that collides across rotations and could be combined with an out-of-band token-hint oracle (e.g., a CSP violation report, an error message that echoes the suffix) to narrow an attacker's guess space. The suffix is also visible in multiple log sites (`:130`, `:146`, `:195`, `:208`, `:219`, `:226`, `:241`, `:273`) — the cumulative leak is larger than any single line suggests.
- **Recommendation**: Switch to `tokenHashPrefix: sha256(refreshToken).slice(0, 8)`. Same log-line uniqueness, no token characters leaked. `maskToken` in `lib/logger.ts:59-62` already does the 6-char tail pattern for on-string matches — consolidate to the hash approach everywhere.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. 8 call sites in `lib/refresh-queue.ts` (direct read).

---

### [LOW | confidence=medium] `resolvePath` allowlist includes `cwd` and `tmp` — broad for a credential-file resolver

- **File**: `lib/storage/paths.ts:90-110`
- **Quote**:

  ```ts
  export function resolvePath(filePath: string): string {
  	let resolved: string;
  	if (filePath.startsWith("~")) {
  		resolved = join(homedir(), filePath.slice(1));
  	} else {
  		resolved = resolve(filePath);
  	}

  	const home = homedir();
  	const cwd = process.cwd();
  	const tmp = tmpdir();
  	if (
  		!isWithinDirectory(home, resolved) &&
  		!isWithinDirectory(cwd, resolved) &&
  		!isWithinDirectory(tmp, resolved)
  	) {
  		throw new Error(`Access denied: path must be within home directory, project directory, or temp directory`);
  	}

  	return resolved;
  }
  ```

- **Issue**: `resolvePath` is used by `importAccounts` (`lib/storage.ts:1235`) and `exportAccounts` (`lib/storage.ts:1310`) — both credential-bearing operations. The allowlist is "home OR cwd OR tmp", which means a malicious script that `cd`s the process into `/var/www/public` before calling the plugin can import/export credentials into the public directory. `tmp` is world-writable on most Unix systems — exporting credentials into `/tmp/codex-export.json` with `0o600` is a short-lived safe pattern, but misses the deeper point that the resolver should refuse *any* path that is not explicitly user-approved.
- **Recommendation**: Drop `cwd` and `tmp` from the implicit allowlist; require callers to pass an `allowed: string[]` argument or a command-line-visible flag such as `--allow-tmp` for the tmp case. Keep `home` as the sole default.
- **Evidence**: Pre-seed (`bg_c692d877`) confirmed. `:97-106` three branches.

---

### [LOW | confidence=medium] `withStorageLock` has no deadlock timeout; a single hung writer stalls every future read & write

- **File**: `lib/storage.ts:140-153`
- **Quote**:

  ```ts
  let storageMutex: Promise<void> = Promise.resolve();

  /**
   * Serializes storage I/O to keep account file reads/writes lock-step and avoid
   * cross-request races during migration/seeding flows.
   */
  function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
    const previousMutex = storageMutex;
    let releaseLock: () => void;
    storageMutex = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    return previousMutex.then(fn).finally(() => releaseLock());
  }
  ```

- **Issue**: The mutex is an implicit FIFO promise chain. If any `fn` hangs forever (e.g., an awaited `fs.writeFile` to a dead network drive without timeout — `writeFileWithTimeout` at `:188` has a 3s timeout for pre-import backups but `writeAccountsToPathUnlocked` at `:894` does not), every subsequent storage call queues behind it and never progresses. There is no deadlock detection, no per-call timeout, no way to interrupt. The plugin's request pipeline would eventually wedge every request that reaches a storage call.
- **Recommendation**: Wrap `previousMutex.then(fn)` in a `Promise.race([..., timeoutAfterMs(30_000, "storage-lock-timeout")])`. On timeout, log at `error` level, release the lock forcibly, and continue — the risk of a second concurrent writer is lower than the risk of a permanent wedge.
- **Evidence**: Direct read. No `Promise.race` or timeout anywhere in `withStorageLock`. `writeFileWithTimeout` exists (`:188`) but is only used by the pre-import backup path.

---

### [LOW | confidence=low] OAuth server parses `req.url` with base `"http://localhost"` while the server binds `127.0.0.1` — harmless today but widens the surface for future host-header handling changes

- **File**: `lib/auth/server.ts:19-27`
- **Quote**:

  ```ts
  const server = http.createServer((req, res) => {
  	try {
  		const url = new URL(req.url || "", "http://localhost");
  		if (url.pathname !== OAUTH_CALLBACK_PATH) {
  			res.statusCode = 404;
  			res.end("Not found");
  			return;
  		}
  		if (url.searchParams.get("state") !== state) {
  			res.statusCode = 400;
  ```

- **Issue**: `new URL(req.url || "", "http://localhost")` uses the string `"localhost"` as the base — this does not affect parsing of the path/query because `req.url` always starts with `/` on Node's HTTP server, but it creates a subtle inconsistency with `OAUTH_CALLBACK_LOOPBACK_HOST = "127.0.0.1"` (`lib/runtime-contracts.ts:6`). If a future refactor ever starts using `url.host` or `url.origin` for a trust decision (e.g., origin-based CSRF double-check), the base string will silently provide the wrong value. Same pattern also used in `REDIRECT_URI` — see the MEDIUM finding on `localhost` vs `127.0.0.1`.
- **Recommendation**: Align the base string with the bind host: `new URL(req.url || "", OAUTH_CALLBACK_BIND_URL)`. Zero runtime behaviour change today; defense-in-depth for future refactors.
- **Evidence**: Direct read. `:21` base-URL literal. `lib/runtime-contracts.ts:6-9` constants.

---

## Notes

- **Pre-seed verification summary**: 25 of 25 findings from agent `bg_c692d877` re-read at SHA `d92a8ee` and confirmed present verbatim. Re-classified severities (per rubric calibration): all 5 HIGH retained; 14 MEDIUM → 14 MEDIUM + 3 new MEDIUM discoveries; 6 LOW → 6 LOW + 2 new LOW discoveries; 1 new HIGH (JWT signature verification) added from discovery.
- **Out-of-scope observations** (flagged here but not filed as findings per scope rules):
  - `lib/audit.ts:91` and `lib/logger.ts:258` show the correct `mode: 0o700` parent-dir pattern — use as the migration target for every missing-mode finding above.
  - `lib/runtime-contracts.ts:6-9` centralises the OAuth loopback constants correctly; the drift is local to `lib/auth/auth.ts:12`.
- **Cross-references**:
  - The HIGH silent-token-loss finding cross-cuts T7 (concurrency) — see the pre-seeded `bg_707b6648` entry on `applyRefreshResult` mutation without persist; T7 owns the debounce-vs-exit race, T02 owns the credential-integrity consequences.
  - The MEDIUM `auth-rate-limit.ts` dead-code finding cross-cuts T16 (code health / refactor opportunities) — T16 owns the dead-code classification, T02 owns the security-consequence framing.
  - The MEDIUM JSON.parse-no-schema finding cross-cuts T5 (type safety / TS quality) — T5 owns the boundary-validation recommendation pattern; T02 owns the credential-carrying subset.
- **Tests not owned by T02** but highly relevant, recommended for T13 (test gap analysis): `applyRefreshResult → process.exit(250ms)` survives-rotation test; `||` vs `??` merge-resurrection unit test for `login-runner.ts:338-339`; `CODEX_AUTH_ACCOUNT_ID` malicious-override validation test; Codex CLI `accounts.json` adversarial-shape fuzz test.
- **No credential values were read or persisted during this audit.** All quoted snippets are pre-existing source; none contain token-like strings. Evidence files enumerate both the seed re-verification (25/25) and the zero-leak scan.

*End of T02 findings.*
