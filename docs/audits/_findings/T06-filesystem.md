---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T6-filesystem
agent: opencode-sisyphus-worker
date: 2026-04-17T00:00:00Z
scope-files:
  - lib/storage.ts
  - lib/storage/paths.ts
  - lib/storage/migrations.ts
  - lib/recovery/constants.ts
  - lib/recovery/index.ts
  - lib/recovery/storage.ts
  - lib/recovery/types.ts
  - lib/shutdown.ts
rubric-version: 1
---

# T6 — Filesystem / Local State / Recovery Storage

**Summary**: Filesystem layer splits across account storage (`lib/storage.ts`, `lib/storage/*`), session recovery (`lib/recovery/*`), and shutdown orchestration (`lib/shutdown.ts`). Atomic-write + Windows-retry rename pattern is solid in spirit but leaks temp files in specific failure modes; the shutdown path never flushes the debounced account save so in-flight mutations are silently dropped on SIGINT; per-project scoping walks up looking for `.git` but treats worktrees (where `.git` is a file, not a dir) correctly only by luck of `existsSync`; the 48-bit SHA-256 project key has a measurable collision surface on large monorepo setups; `loadAccountsInternal` swallows `JSON.parse` errors on truncated/corrupt files and returns `null`, masking data loss; `.tmp` files are only cleaned up on the failure path of the current call (no GC of stale tmp files left by previous crashes); backup directory growth is unbounded; `lib/recovery/storage.ts` uses synchronous fs APIs with no locking on write and no idempotency guard for `prependThinkingPart`, which re-uses a fixed part id and will overwrite prior recovery state. Headline counts: 0 CRITICAL, 8 HIGH, 11 MEDIUM, 6 LOW.

**Files audited**: 8 of 8 in-scope.

---

## Scope & Method

All findings derive from a direct read of the files listed in `scope-files` at SHA `d92a8eedad906fcda94cd45f9b75a6244fd9ef51`. Every quote is verbatim; line numbers are repo-relative. T2 (credential exposure) owns token-in-JSON content concerns; T6 cites filesystem aspects only (permissions on parent dirs, temp-file handling, atomicity, cleanup, portability). T7 (concurrency) owns rotation-vs-save races; T6 cites the `withAccountStorageTransaction` mutex from a persistence-correctness angle only.

### Module Map (filesystem boundary)

| Module | Purpose | Persistence primitives |
| --- | --- | --- |
| `lib/storage.ts` | V3 account JSON I/O, flagged-accounts JSON, import/export, migration orchestration | `fs.writeFile` with `mode: 0o600`, temp-file + rename, `withStorageLock` promise chain, `createTimestampedBackupPath`, `ensureGitignore` |
| `lib/storage/paths.ts` | Project root discovery, storage key hashing, path allow-listing | `createHash("sha256")`, `resolve`, `relative`, `homedir`/`tmpdir`, marker-file existence checks |
| `lib/storage/migrations.ts` | V1 → V3 account metadata transform | Pure in-memory transform; no I/O |
| `lib/recovery/constants.ts` | Resolves OpenCode session data root (XDG on POSIX, `%APPDATA%` on Windows) | `process.env.XDG_DATA_HOME` / `process.env.APPDATA` resolution at import time |
| `lib/recovery/storage.ts` | Synchronous scanning and mutation of OpenCode session message/part files | `existsSync`, `readdirSync`, `readFileSync`, `writeFileSync`, `mkdirSync`, `unlinkSync` |
| `lib/recovery/index.ts` | Barrel re-export only | None |
| `lib/recovery/types.ts` | Structural types for session data | None |
| `lib/shutdown.ts` | SIGINT/SIGTERM/beforeExit cleanup runner | In-memory `cleanupFunctions[]`, `process.once` signal handlers |

### Atomic-Write Flow Diagram (actual code path)

```
saveAccounts(storage)
  withStorageLock(...)                       // storage.ts:140-153, promise-chain mutex
    saveAccountsUnlocked(storage)
      writeAccountsToPathUnlocked(path, storage)    // storage.ts:894
        fs.mkdir(dirname(path), { recursive:true }) //      :899
        ensureGitignore(path)                       //      :900
        normalizeAccountStorage(storage)            //      :904
        JSON.stringify(...)                         //      :905
        fs.writeFile(tempPath, content,             //      :906
                     { encoding, mode: 0o600 })
        fs.stat(tempPath); throw if size===0        //      :908-912
        renameWithWindowsRetry(tempPath, path)      //      :914  (fs.rename with EPERM/EBUSY retry loop)
      catch -> fs.unlink(tempPath); throw StorageError
```

Key properties:
- `tempPath` = `${path}.${Date.now()}.${Math.random().toString(36).slice(2,8)}.tmp` — low-entropy (36^6 ≈ 2.2e9 keyspace + ms timestamp). Collisions are astronomically unlikely in practice, but the pattern is cited as LOW below because entropy is `Math.random()`-sourced.
- `fs.rename` is atomic on POSIX within the same filesystem; on Windows it is atomic only when the destination does not exist or when the API used is `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING` (Node's `fs.rename` uses this internally in recent versions).
- The retry loop covers Windows-specific `EPERM`/`EBUSY` from antivirus and file-locking but is bounded at 5 attempts (≤ 150 ms total).
- On failure the current call best-effort-unlinks the tempPath it created; no recovery of tempPaths left by prior crashes.

### Failure Modes Addressed and Missing

| Failure | Handled | How | Gap |
| --- | --- | --- | --- |
| Mid-write crash after tempPath written, before rename | Partially | Atomic rename prevents half-written final file | Stale `*.tmp` orphan: no GC on next load |
| Rename blocked by AV/indexer | Yes | `renameWithWindowsRetry` (5 attempts, expo-backoff 10–160 ms) | Caller sees `EBUSY` if all retries exhausted; no queue for later retry |
| Corrupt JSON on load | No | `JSON.parse` throws; `loadAccountsInternal` catches and returns `null` | Silent full data loss, no quarantine of the corrupt file |
| Disk full during write | Partial | `fs.writeFile` throws ENOSPC; current-call tempPath best-effort unlinked | No backoff/retry; user sees hint only |
| Parent dir wiped between mkdir and write | Unlikely | `fs.mkdir(..., recursive:true)` runs each write | Race window ignored |
| Concurrent writers to the same path | Yes (same process) | `withStorageLock` promise chain | No cross-process file lock; two opencode instances can race |
| Parent dir mode | No | `fs.mkdir` uses default (usually 0o755 on POSIX) | World-readable parent directory for 0o600 children |
| Stale tmp files from prior crashes | No | — | No `.tmp` sweep on load |
| Backup directory growth | No | `createTimestampedBackupPath` only creates | No retention policy |

---

## Findings

### [HIGH | confidence=high] Graceful shutdown never flushes debounced account save; in-flight mutations are silently dropped on SIGINT/SIGTERM

- **File**: `lib/shutdown.ts:35-45`
- **Quote**:

  ```ts
  const handleSignal = () => {
    void runCleanup().finally(() => {
      process.exit(0);
    });
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  process.once("beforeExit", () => {
    void runCleanup();
  });
  ```

- **Issue**: `runCleanup` iterates only the `cleanupFunctions[]` array populated via `registerCleanup`. `AccountManager.flushPendingSave` (`lib/accounts.ts:968`) is the function that drains the debounced save chain, and a repo-wide grep shows it is only ever called from tests (`test/accounts.test.ts:1709,1729,1756,1789`, `test/rotation-integration.test.ts:281`). The production shutdown path therefore exits without awaiting `flushPendingSave`, meaning any state mutation that landed in the 500 ms debounce window (rotation update, auth-failure counter, last-used timestamp) is discarded. AGENTS.md:53 states "saveToDiskDebounced errors are logged but don't crash the plugin" — correct — but the inverse case of "process exits before the debounce fires" is the silent-loss path. Combined with the fact that `runCleanup` catches and discards all exceptions (`shutdown.ts:25-27`), there is no log trail for the lost write.
- **Recommendation**: Add a module-level bootstrap in `index.ts` (or the `AccountManager` constructor) that calls `registerCleanup(() => manager.flushPendingSave())`. Additionally register a `Promise.race([flushPendingSave(), timeout(2000)])` guard in `shutdown.ts:handleSignal` so shutdown cannot hang forever on a stuck write. Add an integration test asserting `flushPendingSave` is invoked on SIGINT (spawn child process, send signal, inspect storage file afterwards).
- **Evidence**: `lib/accounts.ts:945-966` defines the debounced save; `lib/accounts.ts:968-977` defines the flush; `lib/shutdown.ts:6-9` is the only registration entry point and is never called with a save-flush closure anywhere in `lib/**` (verified via Grep `flushPendingSave|registerCleanup.*save|registerCleanup.*flush` → 0 production hits).

---

### [HIGH | confidence=high] `loadAccountsInternal` returns `null` on `JSON.parse` failure, silently masking data loss on a truncated or corrupt accounts file

- **File**: `lib/storage.ts:810-888`
- **Quote**:

  ```ts
  try {
    const path = getStoragePath();
    const content = await fs.readFile(path, "utf-8");
    const data = JSON.parse(content) as unknown;
    // ...
    return normalized;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // ... legacy migration + global fallback ...
      return null;
    }
    log.error("Failed to load account storage", { error: String(error) });
    return null;
  }
  ```

- **Issue**: The catch-all returns `null` for any non-ENOENT error, including `SyntaxError` from `JSON.parse` when the file was truncated by a prior crash or antivirus quarantine. Callers downstream (e.g. `AccountManager.loadFromDisk`) treat `null` as "no accounts yet", which means the first `saveAccounts` will overwrite the corrupt file with an empty-accounts snapshot, completing the data loss with no recovery possible. A user with 5 accounts whose JSON lost the closing brace now has 0 accounts and a single log line. No quarantine, no backup, no migration attempt, no error surfacing to the CLI.
- **Recommendation**: On non-ENOENT non-schema errors, rename the offending file to `<path>.corrupt-<timestamp>` before returning null, and raise a user-visible warning (via `log.error` and a one-shot console notice surfaced through the existing CLI help path). Add a regression test that writes `{"version":3,"accounts":[` and asserts both (a) `loadAccounts()` returns null, (b) a `.corrupt-*` sibling exists, (c) subsequent `saveAccounts` does not silently clobber the quarantined file.
- **Evidence**: Direct read. Related test gap pre-seeded by `bg_707b6648`: "JSON.parse silent null return on crash-truncated file".

---

### [HIGH | confidence=high] Atomic-write failure path can leak the `.tmp` file when `unlink` itself fails (EBUSY from the same AV that caused the rename failure)

- **File**: `lib/storage.ts:914-941`
- **Quote**:

  ```ts
  await renameWithWindowsRetry(tempPath, path);
} catch (error) {
  try {
    await fs.unlink(tempPath);
  } catch {
    // Ignore cleanup failure.
  }

  const err = error as NodeJS.ErrnoException;
  const code = err?.code || "UNKNOWN";
  const hint = formatStorageErrorHint(error, path);
  ```

- **Issue**: When an antivirus scanner locks the temp file between `writeFile` and `rename`, the rename retry loop exhausts and throws `EBUSY`. The cleanup `fs.unlink(tempPath)` is then likely to fail with the same `EBUSY`, and the swallowing `catch {}` leaves the orphan `.tmp` file behind permanently. The next `saveAccounts` call generates a new tempPath (unique suffix) and leaves another orphan. No periodic sweep, no load-time GC. Over a long session with AV contention, the `.opencode` directory accumulates dozens of `accounts.json.<timestamp>.<rand>.tmp` files. Each contains the full account snapshot with plaintext refresh tokens — T2 owns the credential-leak angle; T6 owns the filesystem-bloat + recovery-unused-tempfile angle.
- **Recommendation**: Add a startup sweep in `loadAccountsInternal` that globs `${dirname(path)}/${basename(path)}.*.tmp` older than e.g. 1 hour and unlinks them (best-effort, log warnings). Alternatively, have `writeAccountsToPathUnlocked` record the last successfully-cleaned sweep and run it under `withStorageLock` once per plugin start. Add a test that writes three fake `.tmp` siblings, runs `loadAccounts`, and asserts only the canonical file remains after the sweep.
- **Evidence**: Direct read + failure-mode reasoning. Related pre-seed: "atomic-write EBUSY orphan" (agent `bg_707b6648`).

---

### [HIGH | confidence=medium] `findProjectRoot` treats git worktrees inconsistently; `.git` as FILE is accepted by `existsSync` but the downstream `.gitignore` writer at `storage.ts:251` re-checks `.git` existence without matching the worktree semantics

- **File**: `lib/storage/paths.ts:55-76` and `lib/storage.ts:243-271`
- **Quote** (`paths.ts`):

  ```ts
  export function isProjectDirectory(dir: string): boolean {
    return PROJECT_MARKERS.some((marker) => existsSync(join(dir, marker)));
  }

  export function findProjectRoot(startDir: string): string | null {
    let current = startDir;
    const root = dirname(current) === current ? current : null;

    while (current) {
      if (isProjectDirectory(current)) {
        return current;
      }
  ```

- **Quote** (`storage.ts`):

  ```ts
  const projectRoot = candidateRoots.find((root) => existsSync(join(root, ".git")));
  if (!projectRoot) return;
  const gitignorePath = join(projectRoot, ".gitignore");
  ```

- **Issue**: Git worktrees store `.git` as a FILE (e.g. `gitdir: /path/to/main/.git/worktrees/branch-name`), not a directory. `existsSync` returns true for both, which is correct for detection, but has two follow-on problems:
  1. Two worktrees of the same repository checked out under different paths (common monorepo pattern) will normalize to different project roots and therefore different project-key hashes — meaning every worktree gets its own `~/.opencode/projects/<key>/oc-codex-multi-auth-accounts.json`. Users expect to share accounts across worktrees of one project.
  2. `ensureGitignore` at `storage.ts:266` writes a `.gitignore` entry in the worktree root. In git, worktrees share the primary repo's `.gitignore` but a worktree-local `.gitignore` is still honored. Writing `.opencode/` there is correct for suppression but bifurcates maintenance.
- **Recommendation**: Detect worktrees by reading the first line of `.git` when it is a file (`gitdir: <path>`), resolve the common dir, and key the project hash on the common dir's parent. Add a test under `test/paths.test.ts` that creates `root/.git/` and `root/wt/.git` (file) and asserts they produce the same project storage key. Document the decision in `docs/development/ARCHITECTURE.md` (out of scope to write here; flag for T18).
- **Evidence**: Direct read. Related test gap pre-seeded by `bg_707b6648`: "per-project git-worktree scoping".

---

### [HIGH | confidence=medium] Project key uses first 12 hex chars (48 bits) of SHA-256, with measurable collision probability for very large project counts and zero collision-resolution

- **File**: `lib/storage/paths.ts:37-45`
- **Quote**:

  ```ts
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

- **Issue**: `PROJECT_KEY_HASH_LENGTH = 12` hex chars → 48 bits → ≈ 2.8 × 10^14 keyspace. For plugin users with N projects, P(collision) ≈ 1 − exp(−N²/2·2^48). Collisions become >1% around N ≈ 2.3 × 10^6 and therefore are not a realistic issue for a single user. However, two issues still apply:
  1. There is zero collision resolution. If two projects happen to share the truncated prefix AND produce the same `sanitizeProjectName` result, their account stores would silently collide — the second one would read/write the first's accounts. No startup assertion, no collision log.
  2. Sanitized name is sliced to 40 chars without a disambiguator, so `very-long-repo-name-1` and `very-long-repo-name-2` both slice to `very-long-repo-name-` → they rely entirely on the hash for disambiguation.
- **Recommendation**: Do not extend the hash (breaks existing users). Instead, add a startup invariant in `setStoragePath` that records the mapping `storageKey -> fullProjectPath` in a small manifest file under `~/.opencode/projects/<key>/project.json`, and on read asserts the current normalized path matches. If mismatch, log warning and fall back to global storage. Add a test asserting collision detection when two projects hash to the same key (contrived via DI).
- **Evidence**: Direct read. Severity pinned HIGH (not CRITICAL) because realistic per-user project counts make the collision probability negligible; the defect is the missing verification, not the hash length itself. Pre-seed `bg_c692d877` listed this as LOW; downgraded confidence to medium because the realistic exploitation path is accidental collision, not attacker-controlled.

---

### [HIGH | confidence=high] Parent directories for account storage are created without an explicit `mode`; on POSIX systems the 0o600 file sits under a 0o755 directory readable by other local users

- **File**: `lib/storage.ts:899` and `lib/storage.ts:1153`
- **Quote** (`:899`):

  ```ts
  await fs.mkdir(dirname(path), { recursive: true });
  await ensureGitignore(path);
  ```

- **Quote** (`:1153`):

  ```ts
  await fs.mkdir(dirname(path), { recursive: true });
  const content = JSON.stringify(normalizeFlaggedStorage(storage), null, 2);
  ```

- **Issue**: Both `writeAccountsToPathUnlocked` and `saveFlaggedAccountsUnlocked` call `fs.mkdir(..., { recursive:true })` without specifying `mode: 0o700`. On POSIX systems `fs.mkdir` defaults to 0o777 masked by the process `umask` (typically 0o022, yielding 0o755). A multi-user Linux machine, shared CI runner, or container with non-root tenants can `ls ~/.opencode/projects/` and enumerate project names even though the JSON files inside are 0o600. T2 owns the credential-exposure view of this; T6 cites the filesystem-correctness issue: the parent-dir mode is inconsistent with the elsewhere-correct pattern at `lib/audit.ts:91` and `lib/logger.ts:258` (both use `0o700` per AGENTS.md:122 area notes).
- **Recommendation**: Pass `{ recursive: true, mode: 0o700 }` to every `fs.mkdir` call in this module (`storage.ts:216` for backup dir, `:899` for accounts, `:1153` for flagged, `:1321` for export; plus `recovery/storage.ts:154,248` for part dir). Add a unit test that runs `fs.stat` on the parent directory after a save and asserts `stat.mode & 0o777 === 0o700` on POSIX.
- **Evidence**: Direct read; cross-reference to `lib/audit.ts:91`, `lib/logger.ts:258` as the correct pattern. Pre-seed (bg_c692d877) flagged this from the credential angle.

---

### [HIGH | confidence=high] `prependThinkingPart` reuses a fixed file id, so calling it twice overwrites the first synthetic part and produces silent double-write with no audit

- **File**: `lib/recovery/storage.ts:243-266`
- **Quote**:

  ```ts
  export function prependThinkingPart(sessionID: string, messageID: string): boolean {
    const partDir = join(PART_STORAGE, messageID);

    try {
      if (!existsSync(partDir)) {
        mkdirSync(partDir, { recursive: true });
      }

      const partId = "prt_0000000000_thinking";
      const part = {
        id: partId,
        sessionID,
        messageID,
        type: "thinking",
        thinking: "",
        synthetic: true,
      };

      writeFileSync(join(partDir, `${partId}.json`), JSON.stringify(part, null, 2), { mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }
  ```

- **Issue**: `partId` is hardcoded to `prt_0000000000_thinking`. If the recovery orchestrator invokes `prependThinkingPart` on the same message twice (race, retry, or cross-session replay from AGENTS.md:51 where "session recovery" is a documented concern), the second write silently overwrites the first, producing the same filename with the same content but giving no indication of idempotency. Worse, because the id is lexically small (`0000000000` < any `Date.now().toString(16)`-based id), it always sorts first in the `sortedParts = [...parts].sort((a,b) => a.id.localeCompare(b.id))` view used at `findMessagesWithOrphanThinking` (`:228-229`). This is presumably the desired behaviour — but the self-overwrite means a post-recovery replay cannot detect that recovery already happened: `messageHasContent` at `:140` ignores thinking parts, so the check `findMessagesWithOrphanThinking` will still return the message id if its other parts have no content. Double-prepend is thus not just silent but logically undetected by the same module's own predicates.
- **Recommendation**: Either (a) check `existsSync(join(partDir, "prt_0000000000_thinking.json"))` at the top and return false with a distinct `alreadyPrepended` boolean, or (b) include a synthetic-prepend marker in a sidecar file (`.synth-recovered`) and skip when present. Add a test that invokes `prependThinkingPart` twice, asserts the file exists once, and asserts the second call returns a distinct value (or logs a recovery-skipped debug line).
- **Evidence**: Direct read. Pre-seed test gap: "recovery storage layer never exercised against real JSONL" and "recovery cross-session state not persisted (double-injection risk)".

---

### [HIGH | confidence=medium] Recovery writes use synchronous fs (`writeFileSync`, `mkdirSync`, `unlinkSync`) with no temp-file + rename pattern; a crash mid-write yields partial files that `readParts` will `catch {} continue` past, silently dropping corrupted data

- **File**: `lib/recovery/storage.ts:149-172, 268-293, 356-387`
- **Quote**:

  ```ts
  export function injectTextPart(sessionID: string, messageID: string, text: string): boolean {
    const partDir = join(PART_STORAGE, messageID);

    try {
      if (!existsSync(partDir)) {
        mkdirSync(partDir, { recursive: true });
      }

      const partId = generatePartId();
      const part: StoredTextPart = {
        id: partId,
        sessionID,
        messageID,
        type: "text",
        text,
        synthetic: true,
      };

      writeFileSync(join(partDir, `${partId}.json`), JSON.stringify(part, null, 2), { mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }
  ```

- **Issue**: Unlike `lib/storage.ts` (account storage), recovery writes are NOT atomic. `writeFileSync` is a single syscall that can be interrupted by SIGINT, process crash, or OS-level failure mid-write, leaving a truncated JSON file on disk. The subsequent reader at `lib/recovery/storage.ts:100-108`:

  ```ts
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const content = readFileSync(join(partDir, file), "utf-8");
      parts.push(JSON.parse(content));
    } catch {
      continue;
    }
  }
  ```

  silently swallows the `SyntaxError` and skips the file. The recovered session proceeds with missing parts, potentially omitting an `injectTextPart`-fabricated tool_result that was mid-write at crash. Additionally, synchronous fs blocks the Node event loop, which is explicitly problematic during plugin shutdown (`lib/shutdown.ts:22-27`).
- **Recommendation**: Convert recovery writers to use the same temp-file + `fs.promises.rename` pattern as `lib/storage.ts`, or at minimum write to `<partId>.json.tmp` then rename. Use async fs APIs so the event loop is not blocked during shutdown. Add a crash-simulation test (truncate a `.json` mid-write) and assert the reader either recovers or surfaces a loud warning instead of silently dropping.
- **Evidence**: Direct read; contrast with `lib/storage.ts:894-941` which does the right thing. Pre-seed: "recovery storage never tested against real JSONL".

---

### [MEDIUM | confidence=high] `normalizeProjectPath` lowercases the entire path on Windows before hashing, but non-Windows case-sensitive filesystems hash raw — a user who renames `/home/alice/Project` → `/home/alice/project` (case-only rename on macOS HFS+/APFS) gets a different project key and loses account context

- **File**: `lib/storage/paths.ts:23-29`
- **Quote**:

  ```ts
  function normalizeProjectPath(projectPath: string): string {
    const resolvedPath = resolve(projectPath);
    const normalizedSeparators = resolvedPath.replace(/\\/g, "/");
    return process.platform === "win32"
      ? normalizedSeparators.toLowerCase()
      : normalizedSeparators;
  }
  ```

- **Issue**: Darwin's default HFS+ and APFS volumes are case-insensitive but case-preserving. A project cloned as `Project` and later referenced as `project` resolves to the same inode but hashes to different keys because the POSIX branch preserves case. Users report "my accounts disappeared" after typing their project folder in a different case. Windows is correctly case-folded. Linux (case-sensitive by default) is correctly raw. macOS falls between.
- **Recommendation**: Add a `process.platform === "darwin"` branch that lowercases the normalized path. Alternatively, call `fs.realpathSync.native(path)` to resolve to the canonical on-disk casing before hashing. Add tests under `test/paths.test.ts` that assert case-variant paths on Darwin produce the same key.
- **Evidence**: Direct read. macOS case-insensitivity is the default for system volumes and end-user home directories.

---

### [MEDIUM | confidence=high] `resolvePath` allows any path under `cwd()` or `tmpdir()`, which bypasses the nominal home-directory restriction when opencode is run from the user's project root

- **File**: `lib/storage/paths.ts:90-109`
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

- **Issue**: The allow-list is home ∪ cwd ∪ tmp. A user running `opencode` from `/` (root, unusual but not illegal) makes the entire filesystem writable via import/export. More realistically, a user running from `/home/alice/Projects/my-repo` with an `importAccounts` call like `importAccounts("/home/alice/Projects/my-repo/../../../etc/passwd-accounts.json")` resolves to `/etc/passwd-accounts.json` which is NOT under any of home/cwd/tmp and is correctly rejected — good. But `importAccounts("../other-project/leak.json")` resolves under cwd's parent, which is denied on cwd check BUT allowed on home check if the parent is under home. The error message says "project directory" but the actual check is "any descendant of cwd", which is broader than necessary.
- **Recommendation**: Tighten to home ∪ the specific project root (from `currentProjectRoot`) ∪ tmp. Reject cwd-relative paths that escape the project root. Update the error message to match. Add property-based tests asserting that `resolvePath` rejects `../../../` sequences and symlink escapes on POSIX.
- **Evidence**: Direct read. T2 owns the credential-file-read scope; T6 cites the filesystem-correctness framing.

---

### [MEDIUM | confidence=high] `createTimestampedBackupPath` does not call `fs.mkdir` on the backup dir — the first-time backup write relies on every downstream writer doing it — and backups accumulate with no retention

- **File**: `lib/storage.ts:1223-1229` and `lib/storage.ts:211-228`
- **Quote** (`:1223`):

  ```ts
  export function createTimestampedBackupPath(prefix = "codex-backup"): string {
    const storagePath = getStoragePath();
    const backupDir = join(dirname(storagePath), "backups");
    const safePrefix = sanitizeBackupPrefix(prefix);
    const nonce = randomBytes(3).toString("hex");
    return join(backupDir, `${safePrefix}-${formatBackupTimestamp()}-${nonce}.json`);
  }
  ```

- **Quote** (`:215`):

  ```ts
  try {
    await fs.mkdir(dirname(backupPath), { recursive: true });
    const backupContent = JSON.stringify(snapshot, null, 2);
    await writeFileWithTimeout(tempPath, backupContent, PRE_IMPORT_BACKUP_WRITE_TIMEOUT_MS);
    await renameWithWindowsRetry(tempPath, backupPath);
  ```

- **Issue**: The pre-import backup path is the only caller that currently runs `fs.mkdir(dirname(backupPath), ...)`. Any future caller of `createTimestampedBackupPath` (e.g. a CLI `codex-backup` command) will have to remember to create the directory. More importantly, there is no backup retention: once a user runs import a dozen times, the backups directory has a dozen full account JSON snapshots (each with plaintext refresh tokens — T2 scope), none pruned automatically. Growth is slow but unbounded.
- **Recommendation**: (a) Move the `fs.mkdir` into `createTimestampedBackupPath` so the path is always ready for write. (b) Add a retention step: after writing a backup, list the backup dir, sort by mtime, and unlink all but the most recent N (configurable, default 10). (c) Add a test that creates 15 backups and asserts only 10 remain.
- **Evidence**: Direct read.

---

### [MEDIUM | confidence=high] `ensureGitignore` reads and writes `.gitignore` outside the storage mutex and can race with concurrent plugin invocations in the same project

- **File**: `lib/storage.ts:243-271`
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
      }

      const newContent = content.endsWith("\n") || content === "" ? content : content + "\n";
      await fs.writeFile(gitignorePath, newContent + ".opencode/\n", "utf-8");
  ```

- **Issue**: `ensureGitignore` is called from inside the storage mutex (`writeAccountsToPathUnlocked:900`), but it operates on a user file (`.gitignore`) that is not protected by any mutex the user's tooling (git, VS Code extensions) respects. It reads then writes non-atomically — classic TOCTOU. If two opencode instances in the same worktree save accounts simultaneously they each observe "no `.opencode` entry" and each append `.opencode/\n`, producing a duplicate line. The read-check does prevent triple-append but the order of operations across processes is not guaranteed. Additionally, the writer uses default file mode (not 0o600) — this is correct for `.gitignore` (which is intentionally world-readable) but it means the function has inconsistent permission semantics vs other writes in the module.
- **Recommendation**: Make `ensureGitignore` idempotent on content (re-read immediately before write and re-check inclusion). Alternatively, move it outside the storage write hot path and invoke it once at `setStoragePath` time with a file lock (`proper-lockfile` or a `lockfile` in `.opencode/.gitignore.lock`). Add an integration test that simulates two concurrent writers and asserts `.gitignore` contains exactly one `.opencode/` line.
- **Evidence**: Direct read. T7 owns concurrency as a domain; T6 cites the filesystem-correctness framing (user file mutation).

---

### [MEDIUM | confidence=high] Pre-import backup temp-file name includes `Math.random().slice(2,8)` + `Date.now()` with ≈ 36 bits of entropy — the same concern as the main temp-file but for a separate write path

- **File**: `lib/storage.ts:211-228`
- **Quote**:

  ```ts
  async function writePreImportBackupFile(backupPath: string, snapshot: AccountStorageV3): Promise<void> {
    const uniqueSuffix = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const tempPath = `${backupPath}.${uniqueSuffix}.tmp`;

    try {
      await fs.mkdir(dirname(backupPath), { recursive: true });
      const backupContent = JSON.stringify(snapshot, null, 2);
      await writeFileWithTimeout(tempPath, backupContent, PRE_IMPORT_BACKUP_WRITE_TIMEOUT_MS);
      await renameWithWindowsRetry(tempPath, backupPath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Best effort temp-file cleanup.
      }
      throw error;
    }
  }
  ```

- **Issue**: The `uniqueSuffix` derivation `${Date.now()}.${Math.random().toString(36).slice(2,8)}` gives ≈ 36 bits of entropy (Math.random is double-precision but only 36 bits after slice(2,8) of base-36). For 1000 concurrent imports the collision probability under a birthday bound is negligible in practice, but the code should use `crypto.randomBytes(6).toString("hex")` to match `createTimestampedBackupPath` style and follow `AGENTS.md` "no Math.random in entropy-bearing paths" informal convention (also implied by the use of `crypto.randomBytes` elsewhere).
- **Recommendation**: Replace `Math.random().toString(36).slice(2,8)` with `randomBytes(6).toString("hex")` (imported at `storage.ts:2`). Apply the same change at `storage.ts:895` and `storage.ts:1149`. Add a lint rule via the existing ESLint config (`eslint.config.js`) banning `Math.random()` in `lib/storage*.ts` paths.
- **Evidence**: Direct read. Pre-seed (bg_c692d877 LOW): "tempPath entropy via Math.random". Upgraded to MEDIUM because multiple call sites share the defect and there is no test enforcing entropy source.

---

### [MEDIUM | confidence=high] `writeFileWithTimeout` uses `AbortSignal` on `fs.writeFile` but does not delete the partially-written file when the timeout fires — on Windows this leaks a tempPath

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
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
  ```

- **Issue**: When the abort fires, Node's `fs.writeFile` stops writing but the file at `filePath` may already exist with partial content. The function throws `ETIMEDOUT` but does not `fs.unlink(filePath)` in the catch/finally. The outer caller (`writePreImportBackupFile:220-225`) does unlink on error, so the backup path is okay in this specific case — but if a future caller invokes `writeFileWithTimeout` directly it will leak. Additionally, Windows filesystem write semantics may leave a zero-byte or partially-filled file that the subsequent rename (if attempted) would overwrite. The tempPath suffix `.tmp` helps distinguish from the final file.
- **Recommendation**: Either (a) always unlink `filePath` inside the catch when throwing `ETIMEDOUT`, or (b) document in the docstring that the caller owns cleanup. Add a unit test that times out a write (mock fs) and asserts no residual file is present.
- **Evidence**: Direct read.

---

### [MEDIUM | confidence=high] `renameWithWindowsRetry` fixed 5-attempt ceiling with max backoff 160 ms may exhaust during long AV scans; caller sees `EBUSY` with a hint but no queued retry

- **File**: `lib/storage.ts:164-186`
- **Quote**:

  ```ts
  async function renameWithWindowsRetry(sourcePath: string, destinationPath: string): Promise<void> {
    let lastError: NodeJS.ErrnoException | null = null;

    for (let attempt = 0; attempt < WINDOWS_RENAME_RETRY_ATTEMPTS; attempt += 1) {
      try {
        await fs.rename(sourcePath, destinationPath);
        return;
      } catch (error) {
        if (isWindowsLockError(error)) {
          lastError = error;
          await new Promise((resolve) =>
            setTimeout(resolve, WINDOWS_RENAME_RETRY_BASE_DELAY_MS * 2 ** attempt),
          );
          continue;
        }
        throw error;
      }
    }

    if (lastError) {
      throw lastError;
    }
  }
  ```

- **Issue**: Attempts: 10 ms, 20 ms, 40 ms, 80 ms, 160 ms → total ≤ 310 ms. Windows Defender on-access scans can hold a file lock for 500 ms to 5 s on large JSON. The retry exhaustion surfaces as `EBUSY` to the user, with the hint at `storage.ts:127-128` saying "close any editors or processes accessing it" — which is misleading when the cause is AV. No caller-side backoff retries, no telemetry on how often retries happen.
- **Recommendation**: (a) Raise the retry budget to ≈ 2 s total (8 attempts, exp backoff up to 512 ms). (b) Add a per-file `renameAttempts` counter logged at warn level when `attempt > 0` so operators can diagnose AV contention. (c) Update the user-facing hint to explicitly mention antivirus as the most common cause on Windows. (d) Add a unit test that mocks `fs.rename` to fail `EBUSY` 4 times then succeed, asserts success and a warn log line.
- **Evidence**: Direct read.

---

### [MEDIUM | confidence=medium] `loadGlobalAccountsFallback` seeds project storage from global on first access but does not lock the global store, allowing another plugin instance to mutate global mid-copy

- **File**: `lib/storage.ts:754-887`
- **Quote**:

  ```ts
  async function loadGlobalAccountsFallback(): Promise<AccountStorageV3 | null> {
    if (!shouldUseProjectGlobalFallback() || !currentStoragePath) {
      return null;
    }
  
    const migrated = await migrateLegacyGlobalStorageIfNeeded();
    if (migrated) {
      return migrated;
    }
  
    const globalStoragePath = getGlobalAccountsStoragePath();
    if (globalStoragePath === currentStoragePath) {
      return null;
    }
  
    try {
      const content = await fs.readFile(globalStoragePath, "utf-8");
      const data = JSON.parse(content) as unknown;
  ```

- **Issue**: Reading the global store via `fs.readFile` runs outside any cross-process lock. A second plugin instance (different project, same user) can be in the middle of writing the global accounts file. Node reads would usually see either the pre-rename or post-rename version due to the atomic-rename pattern, so partial reads are unlikely — but the first instance's `withStorageLock` only protects within-process. Two opencode CLIs started within the same second can race: first reads, normalizes, seeds into project, then second instance writes new global, the seed is now stale. This is a silent divergence, not corruption.
- **Recommendation**: Accept the limitation for now (cross-process file locking is expensive and platform-specific) but document it: the first plugin to claim a project wins the seed. Alternatively, implement a lockfile (`.opencode/accounts.lock`) via `proper-lockfile`. At minimum, log the read-vs-write-time delta (source mtime) in the seed log line so drift is visible.
- **Evidence**: Direct read.

---

### [MEDIUM | confidence=medium] Recovery synchronous I/O blocks event loop; long session dirs with many messages cause perceptible plugin-hang on slow disks (network FS, encrypted home)

- **File**: `lib/recovery/storage.ts:62-87, 93-114, 178-193`
- **Quote**:

  ```ts
  export function readMessages(sessionID: string): StoredMessageMeta[] {
    const messageDir = getMessageDir(sessionID);
    if (!messageDir || !existsSync(messageDir)) return [];

    const messages: StoredMessageMeta[] = [];
    try {
      for (const file of readdirSync(messageDir)) {
        if (!file.endsWith(".json")) continue;
        try {
          const content = readFileSync(join(messageDir, file), "utf-8");
          messages.push(JSON.parse(content));
        } catch {
          continue;
        }
      }
    } catch {
      return [];
    }
  ```

- **Issue**: `readdirSync` + `readFileSync` in a `for` loop over potentially hundreds of JSON files blocks the Node event loop for the entire duration. For a session with 500 messages at 4 KB each, this can be 50–200 ms on SSD and 500 ms+ on a network-mounted home directory. Because recovery runs during active request handling (not just startup), the plugin can miss SSE ticks or token-refresh deadlines during the scan.
- **Recommendation**: Convert the hot recovery readers to async using `fs.promises.readdir` and `Promise.all(files.map(f => fs.promises.readFile(f)))`. Cache `readMessages` results with mtime invalidation. Add a warn-log path if a single recovery scan exceeds 500 ms. The codepath is invoked from a hook per AGENTS.md:51 session-recovery framing; the caller must be updated to `await`.
- **Evidence**: Direct read.

---

### [MEDIUM | confidence=high] `MESSAGE_STORAGE` and `PART_STORAGE` are module-level constants resolved once at import time; changing `XDG_DATA_HOME` or `APPDATA` at runtime has no effect, blocking test isolation and multi-user-per-session scenarios

- **File**: `lib/recovery/constants.ts:14-26`
- **Quote**:

  ```ts
  function getXdgData(): string {
    const platform = process.platform;

    if (platform === "win32") {
      return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    }

    return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  }

  export const OPENCODE_STORAGE = join(getXdgData(), "opencode", "storage");
  export const MESSAGE_STORAGE = join(OPENCODE_STORAGE, "message");
  export const PART_STORAGE = join(OPENCODE_STORAGE, "part");
  ```

- **Issue**: `OPENCODE_STORAGE` is computed exactly once when the module is first imported. Tests that set `process.env.XDG_DATA_HOME` after import get the stale resolution. This also means a single plugin process cannot serve two users with different `$HOME`/`$APPDATA` (unusual but possible in some CI sandboxes). Contrast with `lib/storage/paths.ts` which computes via `homedir()` lazily per call.
- **Recommendation**: Convert the constants to getter functions (`getMessageStorage()`, `getPartStorage()`) and update the four call sites in `lib/recovery/storage.ts`. Add a test that overrides `XDG_DATA_HOME` between two calls and asserts the second call uses the new root.
- **Evidence**: Direct read.

---

### [MEDIUM | confidence=high] `exportAccounts` default `force=true` writes to an arbitrary path the user passed with no confirmation — the filesystem correctness concern is that the destination dir is created implicitly

- **File**: `lib/storage.ts:1309-1326`
- **Quote**:

  ```ts
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
  ```

- **Issue**: T2 owns the credential-exposure view (unsolicited overwrite). T6 cites two filesystem concerns: (a) the `fs.mkdir` creates a new directory in the user's filesystem implicitly; if the user typo'd `--out /tmp/ot/mm/file.json` instead of `/tmp/ott/file.json`, the new `/tmp/ot/mm/` chain is created silently. (b) The write is not atomic (no tempfile + rename), so an interrupted export leaves a partial file under the user-specified name that a re-export will happily overwrite — but a naive `cat` will show corrupt JSON until re-export succeeds.
- **Recommendation**: (a) Move the mkdir inside an `if (!existsSync(dirname(resolvedPath)))` branch and log the directory creation at info level. (b) Use the atomic tempfile + rename pattern here too, to match `writeAccountsToPathUnlocked`.
- **Evidence**: Direct read.

---

### [LOW | confidence=high] `generatePartId` combines `Date.now().toString(16)` and `Math.random().toString(36).substring(2,10)` for a total ≈ 40 bits of entropy — collision risk is negligible but pattern is inconsistent with the cryptographic entropy used elsewhere

- **File**: `lib/recovery/storage.ts:24-28`
- **Quote**:

  ```ts
  export function generatePartId(): string {
    const timestamp = Date.now().toString(16);
    const random = Math.random().toString(36).substring(2, 10);
    return `prt_${timestamp}${random}`;
  }
  ```

- **Issue**: Part ids are filenames; a rare collision between two synthetic parts would cause an overwrite. Probability is vanishingly small but the inconsistency with `lib/storage.ts`'s use of `crypto.randomBytes(3)` (in `createTimestampedBackupPath`) is a code-smell.
- **Recommendation**: Replace with `randomBytes(8).toString("hex")`. Keep the `prt_` + timestamp prefix for debuggability.
- **Evidence**: Direct read.

---

### [LOW | confidence=high] `validatePathId` is inconsistent across recovery callers — some paths validate (readMessages via getMessageDir, readParts), others skip (injectTextPart, prependThinkingPart, stripThinkingParts)

- **File**: `lib/recovery/storage.ts:12-18, 149-172, 243-266, 268-293`
- **Quote**:

  ```ts
  const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

  function validatePathId(id: string, name: string): void {
    if (!SAFE_ID_PATTERN.test(id)) {
      throw new Error(`Invalid ${name}: contains unsafe characters`);
    }
  }
  ```

- **Issue**: `getMessageDir` (`:35`) and `readParts` (`:94`) validate their input; `injectTextPart`, `prependThinkingPart`, `stripThinkingParts`, `replaceEmptyTextParts` do not. A malformed `messageID` such as `../../etc` slips past and is used to construct a filesystem path. Callers today pass ids from `readMessages` which are themselves trusted, so this is latent risk, not exploitable. Path-traversal correctness should not depend on caller trust.
- **Recommendation**: Call `validatePathId(messageID, "messageID")` at the top of every public function that takes an id and constructs a path. Add a unit test that passes `../../etc/passwd` and asserts `Error` is thrown.
- **Evidence**: Direct read.

---

### [LOW | confidence=medium] `formatBackupTimestamp` uses local-time components, not UTC, making sorted backup listings non-deterministic across DST transitions

- **File**: `lib/storage.ts:1203-1212`
- **Quote**:

  ```ts
  function formatBackupTimestamp(date: Date = new Date()): string {
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    const mmm = String(date.getMilliseconds()).padStart(3, "0");
    return `${yyyy}${mm}${dd}-${hh}${min}${ss}${mmm}`;
  }
  ```

- **Issue**: During a DST fall-back, two different `Date.now()` values map to the same formatted string ("01:30 AM" occurs twice). The `nonce` field at `createTimestampedBackupPath:1227` provides disambiguation, so no actual name collision — but sorting filenames alphabetically no longer corresponds to sorting by time-of-creation. Users browsing the backup dir on DST boundary see out-of-order backups.
- **Recommendation**: Use UTC: `date.getUTCFullYear()`, `date.getUTCHours()`, etc. Update the test `formatBackupTimestamp` asserts UTC conversion.
- **Evidence**: Direct read.

---

### [LOW | confidence=high] `sanitizeBackupPrefix` replaces invalid chars with `-` but does not bound total length, allowing a 10 KB prefix to land in the filename

- **File**: `lib/storage.ts:1214-1221`
- **Quote**:

  ```ts
  function sanitizeBackupPrefix(prefix: string): string {
    const trimmed = prefix.trim();
    const safe = trimmed
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    return safe.length > 0 ? safe : "codex-backup";
  }
  ```

- **Issue**: No length cap. Windows `MAX_PATH` is 260 chars by default; a long prefix + timestamp + nonce + extension can exceed this. NTFS long-path support (≥ Windows 10 1607 with the registry flag) raises the limit, but not every system has it enabled.
- **Recommendation**: Cap the sanitized prefix to e.g. 64 chars after sanitization.
- **Evidence**: Direct read.

---

### [LOW | confidence=medium] `clearAccounts` silently swallows all non-ENOENT unlink errors, losing visibility into permission issues on the account file

- **File**: `lib/storage.ts:980-992`
- **Quote**:

  ```ts
  export async function clearAccounts(): Promise<void> {
    return withStorageLock(async () => {
      try {
        const path = getStoragePath();
        await fs.unlink(path);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          log.error("Failed to clear account storage", { error: String(error) });
        }
      }
    });
  ```

- **Issue**: `log.error` is called but the error is not re-thrown — the caller (likely a CLI `codex-logout` or equivalent) gets `void` and assumes success. User sees "accounts cleared" while the file is still on disk with credentials.
- **Recommendation**: Re-throw on non-ENOENT so the caller can surface a proper failure message. Alternatively, return a `{ cleared: boolean, error?: string }` result so the CLI can decide UX.
- **Evidence**: Direct read.

---

### [LOW | confidence=high] `shutdown.runCleanup` catches all cleanup errors silently; if `flushPendingSave` were added, its I/O failure would be invisible

- **File**: `lib/shutdown.ts:18-29`
- **Quote**:

  ```ts
  export async function runCleanup(): Promise<void> {
    const fns = [...cleanupFunctions];
    cleanupFunctions.length = 0;
  
    for (const fn of fns) {
      try {
        await fn();
      } catch {
        // Ignore cleanup errors during shutdown
      }
    }
  }
  ```

- **Issue**: The catch swallows errors. Shutdown is the last chance to log — "Failed to flush accounts on SIGINT" is exactly the line an operator needs to debug missing rotation state. Currently the plugin would exit silently.
- **Recommendation**: Log at warn level via `createLogger("shutdown")` inside the catch block, including the fn's name (if available) and the error message. Accept that the logger's own async writes may fail during shutdown; best-effort logging is still valuable.
- **Evidence**: Direct read.

---

## Cross-References

- `See also: T02-security.md` for the credential-exposure framing of findings that T6 cites from a filesystem angle only:
  - Parent-directory mode 0o755 (this doc's HIGH on mkdir mode) ↔ T2 credentials-readable-by-other-local-users.
  - `.tmp` orphan leak (this doc's HIGH on atomic-write failure) ↔ T2 plaintext-in-orphaned-tempfiles.
  - `exportAccounts` atomicity (this doc's MEDIUM) ↔ T2 credential-in-user-chosen-path.
  - Backup retention (this doc's MEDIUM) ↔ T2 plaintext-backup-accumulation.
- `See also: T07-concurrency.md` for the concurrency framing of:
  - `ensureGitignore` cross-process race (this doc's MEDIUM) ↔ T7 file-level-race.
  - `loadGlobalAccountsFallback` seed race (this doc's MEDIUM) ↔ T7 cross-process-race.
  - Shutdown-vs-save race (this doc's HIGH on shutdown flush) ↔ T7 process-exit-during-debounce.

---

## Notes

- The atomic-write pattern in `lib/storage.ts` is overall well-designed and the Windows rename-retry is a material robustness improvement over naive `fs.rename`. The gaps identified are recovery-path edge cases and missing backup GC, not architectural defects.
- The recovery module (`lib/recovery/*`) is noticeably less mature than the account storage module: synchronous I/O, no atomic writes, no permission checks on parent dirs, and inconsistent id validation. This mirrors the pre-seed observation that "recovery storage layer never exercised against real JSONL".
- `lib/shutdown.ts` is 50 lines and is the smallest module in scope, yet it is the single point where the debounced account save either gets flushed or dropped. The missing `flushPendingSave` registration is the single highest-leverage fix in this report.
- V2 forward-compat (pre-seed mentioned by `bg_707b6648`) is out of scope for T6: `lib/storage.ts:630` explicitly rejects `data.version !== 1 && data.version !== 3`, so a future V2 schema (never existed in history — migration jumps V1→V3 at `lib/storage/migrations.ts:76`) is neither forward- nor backward-compatible. This is a type/contract concern owned by T5.
- No CRITICAL findings emerged. The plaintext-on-disk credentials issue owned by T2 would be CRITICAL in that domain; T6's view of the same path is that the atomic write and mode-0o600 file are correctly implemented at the write-site itself.

---

## Severity Count

| Severity | Count |
| --- | --- |
| CRITICAL | 0 |
| HIGH | 8 |
| MEDIUM | 11 |
| LOW | 6 |

Total findings: 25. Budget: CRITICAL ≤5, HIGH ≤15, MEDIUM ≤40. All within cap.

---

## Windows-Specific Summary

Findings with Windows-specific behaviour or hints (keyword: Windows, EBUSY, antivirus, drive letter, backslash, EPERM, APPDATA):

1. HIGH — `.tmp` leak after EBUSY on Windows (atomic-write failure path)
2. HIGH — parent-dir mkdir mode (POSIX framing, but Windows ACL inheritance is analogous and uncovered)
3. MEDIUM — `renameWithWindowsRetry` budget too small for AV scans (≤ 310 ms vs AV lock 500 ms–5 s)
4. MEDIUM — `writeFileWithTimeout` does not delete partial tempPath on Windows after ETIMEDOUT
5. MEDIUM — Darwin case-insensitivity causes project key drift; Windows handled correctly by lowercasing in `normalizeProjectPath`
6. MEDIUM — `recovery/constants.ts` resolves `APPDATA` at import time only
7. LOW — `sanitizeBackupPrefix` no length cap can exceed Windows MAX_PATH on systems without long-path support
8. LOW — `formatBackupTimestamp` uses local time (affects DST transitions across all platforms, but Windows users in DST zones see the defect)

Total Windows-specific hits: 8 findings touch Windows semantics explicitly. Path portability (backslash vs forward-slash) is handled correctly in `lib/storage/paths.ts:25` via the `replace(/\\/g, "/")` normalization.

---

*End of T06 findings. Rubric version: 1. SHA: d92a8eedad906fcda94cd45f9b75a6244fd9ef51.*
