---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T10-error-handling
agent: unspecified-high
date: 2026-04-17T09:15:00+08:00
scope-files:
  - lib/errors.ts
  - lib/recovery.ts
  - lib/recovery/index.ts
  - lib/recovery/storage.ts
  - lib/recovery/types.ts
  - lib/recovery/constants.ts
  - lib/context-overflow.ts
  - lib/circuit-breaker.ts
  - lib/storage.ts
  - lib/request/fetch-helpers.ts
  - lib/request/response-handler.ts
  - lib/shutdown.ts
  - lib/auth/auth.ts
  - lib/constants.ts
  - lib/health.ts
  - lib/auto-update-checker.ts
  - lib/prompts/codex.ts
  - lib/prompts/opencode-codex.ts
  - lib/request/request-transformer.ts
  - lib/request/helpers/model-map.ts
  - lib/utils.ts
  - lib/ui/confirm.ts
  - lib/ui/auth-menu.ts
  - lib/accounts.ts
  - lib/logger.ts
  - index.ts
  - AGENTS.md
  - lib/AGENTS.md
rubric-version: 1
---

# T10 — Error Handling / Recovery Flows

**Summary**: Plugin ships a typed `CodexError` hierarchy (`lib/errors.ts`) and a circuit-breaker (`lib/circuit-breaker.ts`) that are almost entirely unwired from the runtime. Error taxonomy is fragmented across three files (`lib/errors.ts`, `lib/storage.ts`, `lib/circuit-breaker.ts`) with inconsistent code spaces, and `AGENTS.md:72` claims `StorageError` lives in `lib/errors.ts` while it actually lives in `lib/storage.ts:99`. Destructive tool handlers (`codex-remove`, `codex-export`, `codex-import`) bypass the repo's own `lib/ui/confirm.ts` helper and library-layer `exportAccounts`/`importAccounts` ship destructive defaults (`force=true`, `backupMode='none'`). Session recovery in `lib/recovery/storage.ts` swallows read/write failures across 11 catch sites and uses non-atomic sync I/O. Findings total 27: 0 CRITICAL, 6 HIGH, 13 MEDIUM, 8 LOW (within rubric budget: HIGH ≤15, MEDIUM ≤40).

**Files audited**: 28 of 182 in-scope.

---

## Error Taxonomy (at locked SHA)

### Declared error classes (three files)

| Class | File | Line | Uses `cause` | Code field | `retryable` | Notes |
|---|---|---|---|---|---|---|
| `CodexError` | `lib/errors.ts` | 33–48 | yes | `string` (defaulted to `ErrorCode.API_ERROR`) | — | `context?: Record<string, unknown>` |
| `CodexApiError` | `lib/errors.ts` | 61–71 | via super | `string` | — | adds `status`, `headers` |
| `CodexAuthError` | `lib/errors.ts` | 84–94 | via super | `string` (AUTH_ERROR) | `boolean` (default `false`) | adds `accountId?` |
| `CodexNetworkError` | `lib/errors.ts` | 106–117 | via super | `string` (NETWORK_ERROR) | `boolean` (default `true`) | — |
| `CodexValidationError` | `lib/errors.ts` | 130–143 | via super | `string` (VALIDATION_ERROR) | — | adds `field?`, `expected?` |
| `CodexRateLimitError` | `lib/errors.ts` | 156–165 | via super | `string` (RATE_LIMIT) | — | adds `retryAfterMs?`, `accountId?` |
| `StorageError` | `lib/storage.ts` | 99–111 | yes (`super(message, { cause })`) | `string` (ERRNO-style: `EACCES`, `EBUSY`, `ENOSPC`, `EEMPTY`, `UNKNOWN`) | — | adds `path`, `hint` |
| `CircuitOpenError` | `lib/circuit-breaker.ts` | 17–22 | no (plain `Error`) | — | — | no code, no cause, no metadata |

### Code registry

Declared in `lib/errors.ts:9-16`:

```ts
export const ErrorCode = {
  NETWORK_ERROR: "CODEX_NETWORK_ERROR",
  API_ERROR: "CODEX_API_ERROR",
  AUTH_ERROR: "CODEX_AUTH_ERROR",
  VALIDATION_ERROR: "CODEX_VALIDATION_ERROR",
  RATE_LIMIT: "CODEX_RATE_LIMIT",
  TIMEOUT: "CODEX_TIMEOUT",
} as const;
```

Six `CODEX_*` codes. No `CONTEXT_OVERFLOW`, `STORAGE`, `RECOVERY`, `CIRCUIT_OPEN`, `CONFIGURATION`, or `IMPORT_INVALID` entries despite those domains owning explicit error paths. `StorageError.code` stores ERRNO codes (`EACCES`, `ENOSPC`) — collision-free with `CODEX_*` but no declared union, so log aggregators cannot filter by taxonomy.

### Production consumption (grep `instanceof Codex`, `new Codex*`)

One (1) production site constructs ANY `Codex*Error`:

- `lib/request/fetch-helpers.ts:337` — `throw new CodexAuthError(ERROR_MESSAGES.TOKEN_REFRESH_FAILED, { retryable: false });`

Zero production sites type-narrow with `instanceof CodexError` (or any subclass). Zero production sites read `.retryable`. Zero production sites read `.code === ErrorCode.X`. The entire typed hierarchy is dead infrastructure except for the constructor call on line 337. See `[HIGH | confidence=high] Typed error hierarchy is shelf-ware` below.

### `cause` preservation scoreboard

- `CodexError`/`StorageError` — both use `super(message, { cause })` (errors.ts:39, storage.ts:105). Correct.
- `saveFlaggedAccountsUnlocked` re-throw (storage.ts:1163-1164) — re-throws original error unchanged. Correct.
- `writeAccountsToPathUnlocked` (storage.ts:933-939) — wraps into `StorageError` **with** cause preserved via constructor. Correct.
- `loadAccountsInternal` (storage.ts:826-830, 875-880) — discards cause; writes `String(saveError)` / `String(persistError)` into log context.
- `recovery.ts:413-415` — `log.error("Recovery failed", { error: String(err) })`. Discards stack/cause.
- 20+ other sites follow the `error: String(error)` pattern, which stringifies `.message` but drops `.cause` and the stack trace.

Net: library-owned wrapper (`StorageError`) preserves cause correctly; majority of non-wrapped callers lose it at log boundary.

---

## Findings

### [HIGH | confidence=high] Typed error hierarchy is shelf-ware

- **File**: `lib/errors.ts:33-165`
- **Quote**:

  ```ts
  export class CodexError extends Error { /* ... */ }
  export class CodexApiError extends CodexError { /* ... */ }
  export class CodexAuthError extends CodexError { /* ... */ }
  export class CodexNetworkError extends CodexError { /* ... */ }
  export class CodexValidationError extends CodexError { /* ... */ }
  export class CodexRateLimitError extends CodexError { /* ... */ }
  ```

- **Issue**: `lib/errors.ts` declares a 166-line typed error hierarchy with six classes, discriminator `code`, cause chaining, and `retryable` flags. Grep across `lib/**` + `index.ts` shows exactly one production construction: `lib/request/fetch-helpers.ts:337` (`new CodexAuthError(...)`). Zero `instanceof CodexError`/`CodexApiError`/etc. checks exist in production code. Zero `.retryable` reads. Zero `.code === ErrorCode.X` branches. Every other error-throwing path uses bare `new Error(...)` (e.g. `index.ts:2991`, `index.ts:3015`, `index.ts:4547`, `storage.ts:1247`, `storage.ts:1313`, `storage.ts:1318`, `storage.ts:1383`). The taxonomy cannot perform its stated job (routing retry decisions, UI severity rendering, log categorization) because no consumer reads it.
- **Recommendation**: Either (1) wire the taxonomy in: have `fetch-helpers.ts` classify all 4xx/5xx into the six classes, have the request-pipeline rotation logic in `index.ts` branch on `instanceof CodexAuthError`/`CodexRateLimitError`/`CodexNetworkError` instead of substring-matching on `err.message`; or (2) delete the unused subclasses and keep only `CodexAuthError`, moving `retryable` onto the single survivor. Preserve `CodexError` as the base if keeping any subclass. File `lib/errors.ts` should shrink to ≤50 lines if option (2) is chosen.
- **Evidence**: `grep -rn "new Codex" lib/ index.ts` returns one match. `grep -rn "instanceof Codex" lib/ index.ts` returns zero. `grep -rn "\.retryable" lib/ index.ts` returns zero (only the two defaults inside `lib/errors.ts:92,115`). See evidence file `.sisyphus/evidence/task-10-swallowed.md` for full taxonomy consumption audit.

### [HIGH | confidence=high] Circuit breaker never gates requests

- **File**: `lib/circuit-breaker.ts:35-82` (behaviour), `lib/health.ts:39-52` (only prod use site)
- **Quote**:

  ```ts
  // circuit-breaker.ts
  canExecute(): boolean { /* throws CircuitOpenError when open */ }
  recordSuccess(): void { /* ... */ }
  recordFailure(): void { /* ... */ }
  // health.ts
  const circuit = getCircuitBreaker(circuitKey);
  return { /* ... */ circuitState: circuit.getState() };
  ```

- **Issue**: `lib/circuit-breaker.ts` declares a 153-line breaker with `canExecute()`/`recordSuccess()`/`recordFailure()` state machine and a documented Tier-3 role in the retry hierarchy (see T4 audit `docs/audits/_findings/T04-request-pipeline.md`, retry tier map). Grep across `lib/**` + `index.ts` shows `canExecute`/`recordSuccess`/`recordFailure` have zero production callers outside `circuit-breaker.ts` itself and the test suite (`test/circuit-breaker.test.ts`, `test/health.test.ts`). The only production consumer (`lib/health.ts:40-51`) calls `getCircuitBreaker(...)` but reads only `.getState()` for a health snapshot — failures never drive state transitions and open circuits never short-circuit the fetch pipeline. Result: the "failure isolation" described in the repo `AGENTS.md:21` (lib/AGENTS.md — "failure isolation") is unbacked marketing.
- **Recommendation**: Wire the breaker into `index.ts` request pipeline (7-step fetch). Around the outer account-rotation loop (index.ts:1790-1814 per T4 findings), call `getCircuitBreaker(account.key).canExecute()` before dispatch and `.recordSuccess()`/`.recordFailure()` on the 2xx/5xx branches. Alternatively, delete `lib/circuit-breaker.ts` and keep only the health-reporting facade; the plugin's rate-limit-backoff (`lib/request/rate-limit-backoff.ts`) already serves the same role at Tier 2, so Tier 3 may be genuinely redundant.
- **Evidence**: `grep -rn "canExecute\(\)\|recordSuccess\(\)\|recordFailure\(\)" lib/ index.ts` returns only `circuit-breaker.ts` self-references (35, 57, 69). See `docs/audits/_findings/T04-request-pipeline.md` "Retry tier map" for the claimed Tier 3. See also `.sisyphus/notepads/repo-audit/learnings.md` T3 audit note on "LRU eviction can evict half-open breaker" — that bug becomes moot if the breaker is never wired.

### [HIGH | confidence=high] `codex-remove` tool has no confirmation step

- **File**: `index.ts:5995-6153`
- **Quote**:

  ```ts
  "codex-remove": tool({
    description: "Remove one Codex account entry by index (1-based)...",
    args: { index: tool.schema.number().optional()... },
    async execute({ index }: { index?: number } = {}) {
      // ... validate index ...
      storage.accounts.splice(targetIndex, 1);
      // ... no confirm prompt, no --force flag required ...
      await saveAccounts(storage);
  ```

- **Issue**: Invoking `codex-remove index=3` deletes the account entry immediately with no "Are you sure?" gate and no `--force` requirement. The repo SHIPS a confirmation helper (`lib/ui/confirm.ts:4` — `export async function confirm(message: string, defaultYes = false)`) and uses it elsewhere in the codebase (`lib/ui/auth-menu.ts:182`, `:223`, `:227` — `await confirm("Delete all accounts?")`). The interactive auth-menu path therefore protects the user, but the tool-call path exposed to the OpenCode agent does not. An agent auto-correcting "my tokens are bad, let me remove account 2" destroys the refreshToken irreversibly. OAuth tokens cannot be recovered except by full re-login, and if the user has no second account configured, they lose access until they complete a browser-based PKCE re-auth.
- **Recommendation**: Add a `force: boolean` arg to `codex-remove` (default `false`). When `force` is absent and the runtime supports interactive prompts (`supportsInteractiveMenus()` is already checked at `index.ts:6020`), call `confirm(\`Remove ${formatCommandAccountLabel(account, targetIndex)}? This cannot be undone.\`)` before `storage.accounts.splice(...)`. For non-TTY tool-call contexts where no prompt can be shown, require `force=true` and reject with "Pass force=true to confirm removal" otherwise.
- **Evidence**: `lib/ui/confirm.ts` exists and works (imported by `lib/ui/auth-menu.ts:2`). `grep -rn "from \"\.\/lib\/ui\/confirm\"\|from \"\.\.\/ui\/confirm\"" index.ts` returns zero — confirm helper is not imported by any tool handler. Direct read of removal flow `index.ts:6062-6096`: no confirmation code path before the `splice`/`saveAccounts` calls.

### [HIGH | confidence=high] `exportAccounts(force=true)` default silently overwrites existing files

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
    log.info("Exported accounts", { path: resolvedPath, count: storage.accounts.length });
  }
  ```

- **Issue**: The function default is `force = true`. Calling `exportAccounts("~/backup.json")` without a second argument overwrites any pre-existing `~/backup.json` without warning. The tool handler at `index.ts:6255` compounds the problem: `await exportAccounts(resolvedExportPath, force ?? true);` — so even if the user passes `force: undefined` (the type-safe default-undefined path), the tool handler re-defaults to `true`. Combined with `codex-export` being the "auto-generate timestamped backup" path (`codex-export` with no args), the one scenario where overwrite is safe (unique timestamp suffix) masks the dangerous default when the user DOES supply an explicit path. Non-atomic write (`fs.writeFile` with no tmp+rename) means a crash mid-write also corrupts the prior backup.
- **Recommendation**: Flip the default: `export async function exportAccounts(filePath: string, force = false)`. Update the `codex-export` tool handler (`index.ts:6255`) to pass `force ?? false` instead of `force ?? true`, and surface a clear "File exists — pass force=true to overwrite" error. Additionally switch to a tmp+rename atomic write (`writePreImportBackupFile` at `storage.ts:211-228` already implements this correctly — factor out the shared helper).
- **Evidence**: Direct read of `storage.ts:1309` default parameter. Direct read of `index.ts:6255` tool handler. Compare `writePreImportBackupFile` at `storage.ts:211-228` (atomic) with `exportAccounts` at `storage.ts:1324` (non-atomic `fs.writeFile`).

### [HIGH | confidence=medium] `importAccounts(backupMode='none')` library default exposes callers to silent data loss

- **File**: `lib/storage.ts:1335-1461`
- **Quote**:

  ```ts
  export async function importAccounts(
    filePath: string,
    options: ImportAccountsOptions = {},
  ): Promise<ImportAccountsResult> {
    const { resolvedPath, normalized } = await readAndNormalizeImportFile(filePath);
    const backupMode = options.backupMode ?? "none";
  ```

- **Issue**: `importAccounts` defaults `backupMode` to `"none"` (line 1340). The public `codex-import` tool handler at `index.ts:6319` does override this with `backupMode: "required"`, so end users running `codex-import path=backup.json` are protected. But any downstream code consuming the library entry `importAccounts(filePath)` — future tests, scripts under `scripts/`, or third-party integrations importing `"oc-codex-multi-auth"` — gets the unsafe default. The option name `"none"` is also misleading: per lines 1370-1394 it ONLY skips the pre-import backup; the destructive merge (`persist(newStorage)` at 1431) still runs. A failed import after a successful schema parse can produce a strictly smaller account list (e.g. `deduplicateAccountsForStorage` evicts a valid pre-existing account whose `refreshToken` matches a newly-imported but broken one) with no backup available for rollback.
- **Recommendation**: Change the default to `backupMode ?? "required"` in `storage.ts:1340`. Document in the JSDoc that `"none"` skips the safety backup entirely. Consider renaming the enum value from `"none"` to `"unsafe_no_backup"` to force callers to consciously opt in. Assumption: the `ImportAccountsOptions` interface is exported and may be consumed by external callers — if the surface is fully private, downgrade to MEDIUM.
- **Evidence**: Direct read of `lib/storage.ts:1340` default, line 1370 conditional, line 1431 persist call. Contrast with CLI override at `index.ts:6319`.

### [HIGH | confidence=high] Recovery tool-result injection swallows API errors; caller cannot distinguish "no tools" from "API failed"

- **File**: `lib/recovery.ts:119-154`
- **Quote**:

  ```ts
  async function recoverToolResultMissing(
    client: PluginClient,
    sessionID: string,
    failedMsg: MessageData
  ): Promise<boolean> {
    // ...
    const toolUseIds = extractToolUseIds(parts);

    if (toolUseIds.length === 0) {
      return false;
    }

    const toolResultParts: ToolResultPart[] = toolUseIds.map((id) => ({ /* ... */ }));

    try {
      await sendToolResultsForRecovery(client, sessionID, toolResultParts);

      return true;
    } catch {
      return false;
    }
  }
  ```

- **Issue**: The recover function conflates two distinct failure modes into the same `return false`: (1) no orphan `tool_use` parts to recover (line 138) — a normal "nothing to do" outcome; and (2) the recovery `client.session.prompt(...)` call itself threw (line 151-153) — a hard failure, often caused by an auth token expiring mid-recovery or a malformed part ID. The caller at `recovery.ts:395` (`recoverToolResultMissing` inside `handleSessionRecovery`) sees only a boolean success and cannot decide whether to retry, escalate the toast severity, or surface diagnostic context. The user receives the generic `getRecoveryFailureToast()` ("Recovery Failed · Please retry or start a new session.") in both cases, which is wrong advice for case 1 — there was nothing TO recover — and insufficient advice for case 2 — the user should be told WHICH subsystem failed (e.g. "recovery API rejected parts: [id] — run codex-doctor").
- **Recommendation**: Change the function return type from `Promise<boolean>` to `Promise<{ kind: "noop" | "recovered" | "failed"; error?: unknown }>` (or equivalent discriminated union matching `RecoveryErrorType`). Log the caught error with `log.error("Tool-result recovery send failed", { error: err })` before returning the "failed" variant. Update the caller at `recovery.ts:394-395` to branch on the three outcomes: `"noop"` → no toast, `"recovered"` → success toast, `"failed"` → failure toast with cause attached via `context`.
- **Evidence**: Direct read `recovery.ts:137-153`. Call-site `recovery.ts:394-395`. Toast constants `recovery.ts:243-252` show the same string for both outcomes.

---

### [MEDIUM | confidence=high] `.retryable` field is declared but never consumed in production

- **File**: `lib/errors.ts:87-92`, `:108-116`
- **Quote**:

  ```ts
  export class CodexAuthError extends CodexError {
    override readonly name = "CodexAuthError";
    readonly accountId?: string;
    readonly retryable: boolean;

    constructor(message: string, options?: CodexAuthErrorOptions) {
      super(message, { ...options, code: options?.code ?? ErrorCode.AUTH_ERROR });
      this.accountId = options?.accountId;
      this.retryable = options?.retryable ?? false;
    }
  }
  ```

- **Issue**: `CodexAuthError.retryable` (default `false`) and `CodexNetworkError.retryable` (default `true`) advertise a retry-decision contract. Zero production callers read the field. The only construction site, `fetch-helpers.ts:337`, explicitly sets `retryable: false` — yet the outer rotation loop at `index.ts:1790-1814` (per T4 retry-tier map) uses `getRetryClassification(err)` on the error message, not `.retryable`. Retry policy therefore cannot be overridden by the thrower; the flag is decorative.
- **Recommendation**: Either read the flag in the retry classifier (promote `.retryable` to the primary signal when the caught error is a `CodexError` instance) or remove the field and the `CodexAuthErrorOptions.retryable` / `CodexNetworkErrorOptions.retryable` option types. Keeping a field that the runtime ignores produces silent behaviour: future contributors will set `retryable: true` expecting the plugin to retry, and it will not.
- **Evidence**: `grep -rn "\.retryable" lib/ index.ts` returns only `lib/errors.ts:92,115` (the two defaults) and `test/errors.test.ts`.

### [MEDIUM | confidence=high] `StorageError` lives in `lib/storage.ts:99`, but `AGENTS.md:72` and `lib/AGENTS.md:83` point callers to `lib/errors.ts`

- **File**: `lib/storage.ts:99-111`, `AGENTS.md:72`, `lib/AGENTS.md:83`
- **Quote**:

  ```ts
  // lib/storage.ts:99
  export class StorageError extends Error {
    readonly code: string;
    readonly path: string;
    readonly hint: string;

    constructor(message: string, code: string, path: string, hint: string, cause?: Error) {
      super(message, { cause });
      this.name = "StorageError";
  ```

  Claim in `AGENTS.md:72`:

  ```
  - StorageError preserves original stack traces via `cause` parameter.
  ```

  Claim in `lib/AGENTS.md:83`:

  ```
  | Error types | `errors.ts` | StorageError, custom errors |
  ```

- **Issue**: Taxonomy is fragmented across three files (`lib/errors.ts`, `lib/storage.ts`, `lib/circuit-breaker.ts`) and the documentation in `lib/AGENTS.md:83` actively misdirects maintainers: it tells them `StorageError` is in `errors.ts` when the locked-SHA location is `storage.ts:99-111`. An agent following `AGENTS.md` guidance to add a new error subclass will put it in the wrong file, making the fragmentation worse. The T1 architecture audit already flagged "taxonomy fragmented across three files" at the architectural level; T10 confirms the documentation drift dimension.
- **Recommendation**: Move `StorageError` from `lib/storage.ts:99-111` to `lib/errors.ts` so that all domain-level error classes sit in one module, matching the `AGENTS.md` contract. Re-export `StorageError` from `lib/storage.ts` for existing imports (search shows three internal call sites: storage.ts:933-939 — the constructor call — is the only one needing to keep the import path stable). Alternatively, correct `lib/AGENTS.md:83` to `"Error types | errors.ts, storage.ts (StorageError), circuit-breaker.ts (CircuitOpenError)"`.
- **Evidence**: Direct read of `lib/storage.ts:99`. Direct read of `lib/AGENTS.md:83`. `grep -rn "class StorageError" lib/` returns `lib/storage.ts:99` only.

### [MEDIUM | confidence=high] No diagnostics-snapshot export for bug reports; `codex-doctor` prints to console only

- **File**: `index.ts:5057-5154` (codex-doctor tool handler); `lib/health.ts:82-110` (formatHealthReport)
- **Quote**:

  ```ts
  "codex-doctor": tool({
    description: "Run beginner-friendly diagnostics with clear fixes.",
    args: {
      deep: tool.schema.boolean().optional()...
      fix: tool.schema.boolean().optional()...
      format: toolOutputFormatSchema(),
    },
    async execute({ deep, fix, format }: { deep?: boolean; fix?: boolean; format?: string } = {}) {
      /* ... returns console-formatted string ... */
    }
  ```

- **Issue**: `codex-doctor` produces a human-formatted report (text or JSON via `format` arg) that is returned as a tool-call result. There is no `--export-path <file>` option, no writable artefact bundled for support tickets. When a user files an issue at `github.com/ndycode/oc-codex-multi-auth/issues`, the workflow is "run codex-doctor, copy/paste the output into the issue" — this loses per-request log history, recent rotation events, circuit state timings, and retry-budget accounting that exist only in-memory at `index.ts:345-372` (runtimeMetrics) and `lib/refresh-queue.ts` metrics. A single-command `codex-doctor --export` that writes `~/.opencode/codex-diagnostic-YYYYMMDD-HHMMSS.json` (containing redacted account IDs, health scores, recent 20 errors, pluginVersion, node version, os.platform, config sanitized, and git-sha) would meaningfully reduce the back-and-forth cost of support triage.
- **Recommendation**: Add an `exportPath?: string` arg to `codex-doctor`. When provided, write a sanitized JSON diagnostic bundle to that path (reuse the `redactSensitive` helper from `lib/logger.ts`). Alternatively, add a new `codex-diagnostic-export` tool that wraps the existing report builders (`buildBeginnerDoctorFindings`, `recommendBeginnerNextAction`) plus runtimeMetrics snapshot and writes to disk atomically.
- **Evidence**: Direct read of `index.ts:5070` tool-handler signature shows `format` arg only. `grep -rn "diagnostic" lib/ index.ts` returns only UI strings ("Run diagnostics:", "Run diagnostics with fixes"). No `fs.writeFile`/`writeFileSync` call exists inside the `codex-doctor` handler body (lines 5070-5154).

### [MEDIUM | confidence=medium] Recovery classifier routes on error-message substrings; brittle to upstream wording changes

- **File**: `lib/recovery.ts:63-85`
- **Quote**:

  ```ts
  export function detectErrorType(error: unknown): RecoveryErrorType {
    const message = getErrorMessage(error);

    if (message.includes("tool_use") && message.includes("tool_result")) {
      return "tool_result_missing";
    }

    if (
      message.includes("thinking") &&
      (message.includes("first block") ||
        message.includes("must start with") ||
        message.includes("preceeding") ||  // note: misspelling of "preceding"
        (message.includes("expected") && message.includes("found")))
    ) {
      return "thinking_block_order";
    }

    if (message.includes("thinking is disabled") && message.includes("cannot contain")) {
      return "thinking_disabled_violation";
    }

    return null;
  }
  ```

- **Issue**: The three recovery types are gated by `String.includes(...)` on the upstream error message text. Line 74 even encodes the misspelling `"preceeding"` — a real string that ships in some Anthropic/OpenAI error payloads today, but may be corrected without notice. Any wording change upstream (`"must start"` → `"has to start"`, `"cannot contain"` → `"must not contain"`) silently disables recovery: `detectErrorType` returns `null`, `isRecoverableError` returns `false`, and sessions that were previously auto-recovered now fail terminally with no user signal. There is no test-harness assertion that the plugin periodically re-verifies upstream error strings; recovery rot is invisible until a user reports it.
- **Recommendation**: Add a `log.warn` when an error of type `tool_use` or `thinking` appears in the message but none of the sub-pattern conditions match — this provides an early-warning signal for wording drift. Longer term, switch to error-code matching if upstream exposes stable codes (OpenAI `invalid_request_error` with `type: "thinking_block_order"` or similar); otherwise, centralize the pattern strings into a `RECOVERY_PATTERNS` constant and add a dedicated integration test that hits the sandbox endpoint with known-failing requests and asserts the classifier still matches.
- **Evidence**: Direct read of `recovery.ts:74`. Direct read of `recovery.ts:66-82` substring conditions. No `log.warn`/`log.debug` exists on the fall-through `return null` path at line 84.

### [MEDIUM | confidence=high] Recovery storage readers silently discard corruption

- **File**: `lib/recovery/storage.ts:62-87` and `:93-114`
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

- **Issue**: Two catch sites (inner at lines 73-75, outer at 77-79) swallow every per-file error (JSON parse, ENOENT-race, permission, device-gone) and every per-directory error (EACCES on messageDir). A truncated message file (which the same module can produce because `writeFileSync` at line 167 is non-atomic) is silently skipped from the recovery set; `findMessagesWithThinkingBlocks`/`findMessagesWithOrphanThinking` subsequently believe that message does not exist and recovery proceeds on a partial view of the session. No warning is logged, no metric is incremented, and the user sees "Recovery Failed · Please retry" with no indication that the underlying cause is disk corruption or permission drift. Same pattern repeats at `readParts` (lines 99-111). T6 owns the atomic-write angle; T10's concern is the silent loss of diagnostics.
- **Recommendation**: Replace `} catch { continue; }` at lines 73-75, 105-107 with `} catch (err) { log.debug("Skipping unreadable recovery artefact", { file, error: String(err) }); continue; }`. Replace the outer `} catch { return []; }` at lines 77-79, 109-111 with `} catch (err) { log.warn("Recovery directory read failed", { dir: messageDir, error: String(err) }); return []; }`. Use a local logger scoped to `recovery-storage`. This preserves current behaviour (graceful degradation) while surfacing the "we lost data" signal to `codex-doctor`.
- **Evidence**: Direct read of `recovery/storage.ts:73-79`. Direct read of `recovery/storage.ts:105-111`. See T6 cross-ref `docs/audits/_findings/T06-filesystem.md` for the non-atomic write chain that produces the truncated files this function now hides.

### [MEDIUM | confidence=high] `resumeSession` swallows its prompt error → user sees "recovered" toast on half-recovery

- **File**: `lib/recovery.ts:222-241`
- **Quote**:

  ```ts
  async function resumeSession(
    client: PluginClient,
    config: ResumeConfig,
    directory: string
  ): Promise<boolean> {
    try {
      await client.session.prompt({
        path: { id: config.sessionID },
        body: {
          parts: [{ type: "text", text: RECOVERY_RESUME_TEXT }],
          agent: config.agent,
          model: config.model,
        },
        query: { directory },
      });
      return true;
    } catch {
      return false;
    }
  }
  ```

- **Issue**: `resumeSession` is called at `recovery.ts:401` and `:408` AFTER `recoverThinkingBlockOrder` / `recoverThinkingDisabledViolation` have already mutated on-disk thinking parts. If the prompt itself throws (auth failure, network blip, session-locked upstream), `resumeSession` returns `false` but the disk mutation was not rolled back. The outer success check at `recovery.ts:412` (`return success;`) is `true` regardless (it tracks only the disk-side recovery), so the caller `handleSessionRecovery` reports "recovery succeeded". User sees the success toast but the session is in a half-recovered state — thinking parts injected/stripped, but the assistant turn not re-triggered. On next user message the conversation behaves oddly.
- **Recommendation**: Either (a) surface the resumeSession failure: change the caller at `recovery.ts:397-409` to track both `diskSuccess` (current `success` var) and `resumeSuccess` (return of `resumeSession`), report a distinct `getRecoveryPartialToast()` when disk mutation succeeded but resume failed, and log the caught error; or (b) wrap the entire recovery in a try/finally that rolls the disk change back if resume fails (delete the injected/stripped parts), so "recovery" is atomic at the user's perceptual boundary.
- **Evidence**: Direct read of `recovery.ts:238-240`. Direct read of outer `handleSessionRecovery` `return success;` at `recovery.ts:412`. No rollback path for `prependThinkingPart` / `stripThinkingParts` exists in the module.

### [MEDIUM | confidence=medium] Context-overflow synthetic response drops upstream diagnostics

- **File**: `lib/context-overflow.ts:55-112`, `:117-138`
- **Quote**:

  ```ts
  export async function handleContextOverflow(
    response: Response,
    model?: string,
  ): Promise<{ handled: true; response: Response } | { handled: false }> {
    if (response.status !== 400) {
      return { handled: false };
    }

    try {
      const bodyText = await response.clone().text();
      if (isContextOverflowError(response.status, bodyText)) {
    logDebug("Context overflow detected, returning synthetic response");
        return {
          handled: true,
          response: createContextOverflowResponse(model),
        };
      }
    } catch {
      // Ignore read errors
    }

    return { handled: false };
  }
  ```

- **Issue**: `createContextOverflowResponse` (lines 55-112) emits a hardcoded user-facing message ("Context is too long for this model. Please use /compact, /clear, or /undo"). It discards the upstream `bodyText` entirely — the actual provider message, token counts (`input_tokens`, `max_tokens`), and model-specific guidance are thrown away. Users with a 400k-token conversation on a 200k-context model see a generic "reduce context size" instruction with no indication of HOW MUCH to reduce. The synthetic header `X-Codex-Plugin-Error-Type: context_overflow` (line 109) is the only diagnostic the user can attach to a bug report. Additionally the suggested commands `/compact`, `/clear`, `/undo` hardcode a contract with OpenCode that may drift — there is no version gate.
- **Recommendation**: Include the parsed token counts from the upstream body in the synthetic message body. Parse `bodyText` for `max_tokens`, `context_length` (both common in OpenAI/Anthropic 400 payloads) and interpolate into the message: `Your prompt used N tokens; this model supports M. Reduce by X.`. Preserve the full upstream body in a response header (e.g. `X-Codex-Upstream-Error: <base64>`) so `codex-doctor` / logs can recover it. Also emit a `log.warn` event every time context-overflow triggers; currently only `logDebug` fires (line 128), which is filtered out under the default log level.
- **Evidence**: Direct read of `context-overflow.ts:38-48` (CONTEXT_OVERFLOW_MESSAGE) — no token-count interpolation. Direct read of `context-overflow.ts:80-84` — delta event text is fixed. Direct read of `context-overflow.ts:128` — only `logDebug`, not `logWarn`.

### [MEDIUM | confidence=high] `ErrorCode` enum lacks codes for actively-used error domains

- **File**: `lib/errors.ts:9-16`
- **Quote**:

  ```ts
  export const ErrorCode = {
    NETWORK_ERROR: "CODEX_NETWORK_ERROR",
    API_ERROR: "CODEX_API_ERROR",
    AUTH_ERROR: "CODEX_AUTH_ERROR",
    VALIDATION_ERROR: "CODEX_VALIDATION_ERROR",
    RATE_LIMIT: "CODEX_RATE_LIMIT",
    TIMEOUT: "CODEX_TIMEOUT",
  } as const;
  ```

- **Issue**: Six `CODEX_*` codes are defined, but four domains that the repo treats as first-class error-emitting zones have no code slot: (1) context overflow (`lib/context-overflow.ts` emits `X-Codex-Plugin-Error-Type: context_overflow` header at line 109 — plaintext, not the `ErrorCode` enum); (2) session recovery (`lib/recovery.ts` has a `RecoveryErrorType` string union at `recovery/types.ts:133-137` that is disjoint from `ErrorCode`); (3) storage (`StorageError` uses ERRNO strings — `EACCES`, `EBUSY` — which collide with no `CODEX_*` but cannot be filtered by a uniform `startsWith("CODEX_")` query); (4) circuit-open (`CircuitOpenError` at `circuit-breaker.ts:17` has no code at all). Log-aggregator queries like "count all plugin errors" require four separate regexes instead of one `CODEX_*` prefix scan.
- **Recommendation**: Extend `ErrorCode` with `CONTEXT_OVERFLOW: "CODEX_CONTEXT_OVERFLOW"`, `STORAGE: "CODEX_STORAGE"`, `RECOVERY: "CODEX_RECOVERY"`, `CIRCUIT_OPEN: "CODEX_CIRCUIT_OPEN"`. Thread the codes into `StorageError.code` (prefix `CODEX_STORAGE:EACCES` instead of bare `EACCES`), into `CircuitOpenError` (add `code: ErrorCode.CIRCUIT_OPEN`), and into the `X-Codex-Plugin-Error-Type` header in `context-overflow.ts:109`. This unifies the search surface for operators.
- **Evidence**: Direct read of `lib/errors.ts:9-16`. Direct read of `lib/context-overflow.ts:109`. Direct read of `lib/recovery/types.ts:133-137`. Direct read of `lib/storage.ts:107` (code is string; no prefix enforcement).

### [MEDIUM | confidence=high] Recovery toast failure is silently swallowed

- **File**: `lib/recovery.ts:382-390`
- **Quote**:

  ```ts
  await client.tui
    .showToast({
      body: {
        title: toastContent.title,
        message: toastContent.message,
        variant: "warning",
      },
    })
    .catch(() => {});
  ```

- **Issue**: If the OpenCode TUI toast channel fails (e.g. non-TTY CI run, SDK version drift, a transient IPC error), the `.catch(() => {})` swallows the error. No log entry is produced. Subsequent success/failure toasts at the end of `handleSessionRecovery` use the same pattern implicitly via the hook. Result: recovery proceeds silently and the user (running a non-interactive CI pipeline) has no log indication that recovery began, completed, or failed. The whole "toast telemetry" layer is invisible to users running without a TTY.
- **Recommendation**: Replace `.catch(() => {})` with `.catch((err) => log.debug("Recovery toast failed", { error: String(err) }))`. Consider also writing a recovery audit event (see T9 audit — `lib/audit.ts` exists as infrastructure with zero production call sites) so non-interactive users still see the recovery trail in the audit log.
- **Evidence**: Direct read of `recovery.ts:390`. See T9 cross-ref `docs/audits/_findings/T09-observability.md` — `lib/audit.ts` has zero production callers; this is the natural consumer.

### [MEDIUM | confidence=high] User-facing auth error omits remediation step

- **File**: `lib/constants.ts:67-71`, `lib/request/fetch-helpers.ts:337`
- **Quote**:

  ```ts
  // lib/constants.ts:67-71
  export const ERROR_MESSAGES = {
    NO_ACCOUNT_ID: "Failed to extract accountId from token",
    TOKEN_REFRESH_FAILED: "Failed to refresh token, authentication required",
    REQUEST_PARSE_ERROR: "Error parsing request",
  } as const;

  // lib/request/fetch-helpers.ts:337
  throw new CodexAuthError(ERROR_MESSAGES.TOKEN_REFRESH_FAILED, { retryable: false });
  ```

- **Issue**: The most common authentication failure that a user will see — refresh-token rejection — surfaces as `"Failed to refresh token, authentication required"` with no concrete next step. Contrast with the other user-facing messages that DO point at commands (`index.ts:3799` "No Codex accounts configured. Run: opencode auth login"; `index.ts:5477` "Label is too long (max 60 characters)"). A user seeing `"authentication required"` does not know whether to re-login, switch accounts, file a bug, or check their internet. T2 owns the credential-leak angle of this same message; T10's angle is actionability.
- **Recommendation**: Change the constant to `"Token refresh rejected by auth server. Run: opencode auth login (or: codex-switch to another account; codex-doctor to diagnose)."`. The trailing guidance matches the pattern already used for zero-account errors at `index.ts:3799`. Keep the string under 200 chars to fit TUI single-line rendering.
- **Evidence**: Direct read of `lib/constants.ts:69`. Direct read of `index.ts:3799`, `:3927`, `:4195`, `:5420`, `:5558`, `:5642` — all use the `"Run: opencode auth login"` remediation pattern when the condition is "no accounts". The refresh-failure path does not.

### [MEDIUM | confidence=high] Internal invariants leak as generic `Error` to user tool-call results

- **File**: `index.ts:2991`, `:3015`, `:4547`, `:4581`
- **Quote**:

  ```ts
  // index.ts:2991
  if (!accessToken) {
    throw new Error("Missing access token after refresh");
  }
  // index.ts:3015
  if (!requestAccountId) {
    throw new Error("Missing accountId for quota probe");
  }
  // index.ts:4547
  throw new Error("Cannot refresh: account has no refresh token");
  // index.ts:4581
  throw new Error("Missing account id");
  ```

- **Issue**: Four sites emit bare `Error` with internal-invariant messages. These strings propagate to the OpenCode agent or TUI user. "Missing accountId for quota probe" is unreadable — there is no quota-probe UI a typical user is aware of. "Cannot refresh: account has no refresh token" is a broken-invariant signal (the storage file was edited externally) that deserves a call to `codex-doctor` but provides no such hint. Compare to the correctly actionable `"No Codex accounts configured. Run: opencode auth login"` at `index.ts:3799`. These four are tech-debt artefacts from the pre-taxonomy era of the codebase.
- **Recommendation**: Wrap each site in an actionable message: `"Account refresh did not return an access token (internal). Try codex-refresh; if it repeats, run codex-doctor --deep and file an issue."`. Better, throw a `CodexAuthError` or `CodexValidationError` with `context: { invariant: "missing-access-token-post-refresh", accountIndex }` so the outer tool-handler's formatted message can include both the layman text and the machine context.
- **Evidence**: Direct read of `index.ts:2991`, `:3015`, `:4547`, `:4581`. Compare with actionable messages at `index.ts:3799`, `:5058-5067` (codex-doctor) that DO reference recovery commands.

### [MEDIUM | confidence=medium] Session-abort error silently swallowed before recovery

- **File**: `lib/recovery.ts:346`
- **Quote**:

  ```ts
  await client.session.abort({ path: { id: sessionID } }).catch(() => {});
  ```

- **Issue**: Before running any recovery step, `handleSessionRecovery` calls `client.session.abort(...)` and swallows any error with `.catch(() => {})`. If the abort itself fails (OpenCode SDK surface drift, session already terminated by a concurrent path), the subsequent recovery actions run against a session that may already be in an inconsistent state. No log entry is produced. On repeated recovery attempts, the underlying abort-flapping cause is invisible.
- **Recommendation**: Replace with `.catch((err) => log.debug("Recovery pre-abort failed (non-fatal)", { sessionID, error: String(err) }))`. The failure is intentionally non-fatal (the subsequent recovery can still work in most cases), but it should be observable.
- **Evidence**: Direct read of `recovery.ts:346`.

### [MEDIUM | confidence=low] V2 storage file silently discarded; no user-visible "legacy file detected" path

- **File**: `lib/storage.ts:630-635`
- **Quote**:

  ```ts
  if (data.version !== 1 && data.version !== 3) {
    log.warn("Unknown storage version, ignoring", {
      version: (data as { version?: unknown }).version,
    });
    return null;
  }
  ```

- **Issue**: `normalizeAccountStorage` accepts V1 (migrated inline) and V3 (passed through), but hard-rejects V2 with `log.warn "Unknown storage version"`. If a user downgrades from a hypothetical future V2+ build or has a corrupted `version: 2` field, `loadAccountsInternal` receives `null` and falls through to "no accounts configured". The warn message is generic — it does not tell the user where the file is, does not suggest export/re-import, and does not quarantine the broken file. Combined with T6's "loadAccountsInternal silent-null on JSON parse error" finding, the corruption-recovery surface is effectively hidden from user attention. T5 owns the schema forward-compat angle; T10 flags the user-experience gap (no recovery path, no actionable message). Assumption: V2 was never shipped in a release, so real-world prevalence is low; downgrade to MEDIUM on that basis.
- **Recommendation**: When `normalizeAccountStorage` returns `null` due to unknown version, have `loadAccountsInternal` (storage.ts:835+) rename the file to `{path}.rejected-{timestamp}` instead of silently proceeding to fallback seeding. Emit a `log.error` ("Storage version X rejected; file quarantined at {newPath}; run: opencode auth login or codex-import") so the user can act. Cross-ref: T6 logs the silent-null on JSON parse; this finding is the version-mismatch analog.
- **Evidence**: Direct read of `storage.ts:630-635`. Cross-ref `.sisyphus/notepads/repo-audit/learnings.md` T6 learnings line "loadAccountsInternal silent-null on JSON.parse error".

---

### [LOW | confidence=high] `ErrorCode` type accepts any string, weakening discriminator

- **File**: `lib/errors.ts:23-27`, `:35`
- **Quote**:

  ```ts
  export interface CodexErrorOptions {
    code?: string;
    cause?: unknown;
    context?: Record<string, unknown>;
  }
  // ...
  readonly code: string;
  ```

- **Issue**: `CodexErrorOptions.code` is typed `string`, not `ErrorCodeType` (the `typeof ErrorCode[keyof typeof ErrorCode]` defined at line 18). Callers can pass any string literal, bypassing the declared enum. Log-aggregator queries cannot rely on `.code` being a known value. `CodexError.code` also typed plainly.
- **Recommendation**: Change both to `code?: ErrorCodeType;` and `readonly code: ErrorCodeType;`. Update the constructor default at `errors.ts:40` from `ErrorCode.API_ERROR` (already a valid `ErrorCodeType`) to keep compile-time validation. Internal `StorageError` can still use ERRNO strings via its own `code` field.
- **Evidence**: Direct read of `errors.ts:18` (`ErrorCodeType` definition), `:24` (widening `string`), `:35` (widening `string`).

### [LOW | confidence=high] HTTP header case-insensitivity lost in `CodexApiError.headers`

- **File**: `lib/errors.ts:53-56`, `:64`
- **Quote**:

  ```ts
  export interface CodexApiErrorOptions extends CodexErrorOptions {
    status: number;
    headers?: Record<string, string>;
  }
  // ...
  readonly headers?: Record<string, string>;
  ```

- **Issue**: `Record<string, string>` is case-sensitive. HTTP headers are not. A consumer doing `err.headers["Retry-After"]` and another doing `err.headers["retry-after"]` will get different results depending on what the upstream server capitalized. The `Headers` class from the Fetch API would preserve case-insensitive lookup.
- **Recommendation**: Change to `headers?: Headers` and propagate the upstream `response.headers` object directly, OR document that the caller is responsible for lowercasing keys before storing, OR provide a helper `getHeader(name: string)` that does case-insensitive lookup on the stored record.
- **Evidence**: Direct read of `errors.ts:55,64`.

### [LOW | confidence=medium] `RECOVERY_RESUME_TEXT` leaks marker into user transcript

- **File**: `lib/recovery.ts:26`
- **Quote**:

  ```ts
  const RECOVERY_RESUME_TEXT = "[session recovered - continuing previous task]";
  ```

- **Issue**: After successful recovery (thinking-block or thinking-disabled paths), `resumeSession` (line 228-236) sends this literal string as the next `user` message via `client.session.prompt(...)`. The string becomes a persistent part of the session history. A user inspecting their transcript sees this synthetic injection; an LLM reading its own prior turns sees "user said: [session recovered - continuing previous task]" — a prompt-injection-lite scenario where the assistant may reply to the marker instead of resuming. No i18n, no mechanism to suppress marker for non-interactive runs.
- **Recommendation**: Use the SDK's synthetic-message or system-note API instead of a fake user turn. If no such API exists in `@opencode-ai/plugin@^1.2.9`, at minimum mark the part with `synthetic: true` flag (as the `recovery/storage.ts:164` helper already does for injected text parts) so downstream processors can hide it.
- **Evidence**: Direct read of `recovery.ts:26`, `:231`. Compare `recovery/storage.ts:164` (`synthetic: true`) — the marker is not applied when resumeSession sends its text part.

### [LOW | confidence=high] `StorageError.code` ERRNO strings blur with `ErrorCode.CODEX_*` in downstream logs

- **File**: `lib/storage.ts:99-111`
- **Quote**:

  ```ts
  export class StorageError extends Error {
    readonly code: string;
    readonly path: string;
    readonly hint: string;
  ```

- **Issue**: `StorageError.code` stores the raw `err?.code` ERRNO (`EACCES`, `EBUSY`, `ENOSPC`, `EEMPTY`, `UNKNOWN`) with no `CODEX_` or `STORAGE:` prefix. When a log aggregator filters by `code.startsWith("CODEX_")` (the natural pattern given `lib/errors.ts:10-15`), `StorageError` events vanish from the search. Non-uniform code space across the taxonomy.
- **Recommendation**: Prefix with `CODEX_STORAGE:` — e.g. `code = "CODEX_STORAGE:EACCES"`. Or introduce a `storageCode: string` sibling field so the ERRNO stays accessible while `.code` matches the `ErrorCode` enum.
- **Evidence**: Direct read of `storage.ts:107`. Compare with `lib/errors.ts:10-16` enum values.

### [LOW | confidence=high] `lib/ui/confirm.ts` is stranded; only `lib/ui/auth-menu.ts` imports it

- **File**: `lib/ui/confirm.ts:4-22`, `lib/ui/auth-menu.ts:2`
- **Quote**:

  ```ts
  // lib/ui/confirm.ts
  export async function confirm(message: string, defaultYes = false): Promise<boolean> {
    // ... select-based yes/no ...
  }

  // lib/ui/auth-menu.ts:2
  import { confirm } from "./confirm.js";
  ```

- **Issue**: The `confirm` helper is used by `lib/ui/auth-menu.ts` (three call sites) to confirm destructive actions in the interactive TUI. It is not re-exported from `lib/index.ts` and not imported by `index.ts` where all the destructive tool handlers (`codex-remove`, `codex-export`, `codex-import`, `codex-clear-cache`, `codex-switch`) live. Result: the asymmetry flagged in HIGH-3 above — the interactive menu protects users, but tool handlers do not. This is the root cause; HIGH-3 is the user-visible symptom at `codex-remove`.
- **Recommendation**: Re-export `confirm` from `lib/index.ts` (the barrel file). Import it in `index.ts` and apply to every destructive tool handler that does not already have one. Alternatively, move the handler-level gates into a dedicated `lib/ui/tool-confirm.ts` that returns early when `!supportsInteractiveMenus()` with a "Pass force=true" error.
- **Evidence**: Direct read of `lib/ui/confirm.ts`. `grep -rn "from \"\.\/confirm\|from \"\.\.\/ui\/confirm\|from \"\.\/lib\/ui\/confirm" lib/ index.ts` returns only `lib/ui/auth-menu.ts:2`.

### [LOW | confidence=high] Recovery failure toast text is generic; no code or remediation

- **File**: `lib/recovery.ts:281-289`
- **Quote**:

  ```ts
  export function getRecoveryFailureToast(): {
    title: string;
    message: string;
  } {
    return {
      title: "Recovery Failed",
      message: "Please retry or start a new session.",
    };
  }
  ```

- **Issue**: Single generic failure message regardless of error type. A user whose `tool_result_missing` recovery failed because the SDK rejected the `tool_use_id` would benefit from a different hint than one whose `thinking_block_order` recovery failed because permissions on `OPENCODE_STORAGE/part` were locked. No code, no `run codex-doctor` hint.
- **Recommendation**: Take a `RecoveryErrorType` argument and branch. At minimum append "Run: codex-doctor" to the message so users know the next command.
- **Evidence**: Direct read of `recovery.ts:281-289`. No caller passes error context into this helper.

### [LOW | confidence=medium] `CodexError.context` type admits unbounded payload; no size limit

- **File**: `lib/errors.ts:26`
- **Quote**:

  ```ts
  context?: Record<string, unknown>;
  ```

- **Issue**: `context` is unbounded. A thrower could stuff the entire request body or full SSE transcript into context (as has happened historically in other plugins), then the error propagates through the log pipeline with a megabyte-sized serialization. No shape validation, no redaction of known-sensitive keys. T2 owns the credential-leak concern of context; T10's angle is the shape.
- **Recommendation**: Document in JSDoc that context values should be serializable and ≤1KB each, plus a reference to the `redactSensitive` helper in `lib/logger.ts`. For runtime enforcement, consider a `toJSON()` on `CodexError` that truncates overly large values.
- **Evidence**: Direct read of `errors.ts:26`. Cross-ref T02 (T02-security.md) for the broader redaction concern.

### [LOW | confidence=high] `CircuitOpenError` has no code, no cause, no accountKey context

- **File**: `lib/circuit-breaker.ts:17-22`
- **Quote**:

  ```ts
  export class CircuitOpenError extends Error {
    constructor(message = "Circuit is open") {
      super(message);
      this.name = "CircuitOpenError";
    }
  }
  ```

- **Issue**: Diverges from the `CodexError` taxonomy in multiple ways: no `code` field, no `cause` pass-through, no metadata for which circuit (account key) is open. Loggers cannot answer "which circuit opened" without a side-channel; retry logic cannot decide "this specific breaker is still cooling" because the error carries no identity.
- **Recommendation**: Extend `CodexError` with `code: "CODEX_CIRCUIT_OPEN"` and accept a `{ circuitKey: string; timeUntilResetMs: number }` context. `getCircuitBreaker(key).canExecute()` should throw with both fields populated so the outer loop can format a user-actionable message (e.g. "Circuit for account 2 open; retry in 12s").
- **Evidence**: Direct read of `circuit-breaker.ts:17-22`. Compare with `errors.ts:33-48` `CodexError` base.

---

## Swallowed-Error Enumeration

Total bindless `catch {` matches in `lib/**`: **46** (all of `} catch {` pattern; see evidence `task-10-swallowed.md`). Plus `.catch(() => {})` sites: **4** (response-handler.ts:242, logger.ts:179, recovery.ts:346, recovery.ts:390).

### Classification (intentional vs bug)

| File | Line | Classification | Rationale |
|---|---|---|---|
| `lib/recovery.ts:51` | 51 | intentional | `JSON.stringify` fallback in `getErrorMessage`; any failure → empty string and continue |
| `lib/recovery.ts:151-153` | 151 | **bug** | Loses distinction between "no tools to recover" and "send failed" (HIGH-6) |
| `lib/recovery.ts:238-240` | 238 | **bug** | resumeSession swallow → half-recovered state undetectable (MEDIUM) |
| `lib/recovery.ts:346` (`.catch`) | 346 | **bug** | Pre-recovery abort failure invisible (MEDIUM) |
| `lib/recovery.ts:390` (`.catch`) | 390 | **bug** | Toast failure invisible (MEDIUM) |
| `lib/recovery/storage.ts:51,73,77,105,109,169,263,284,288,378,382` | multiple | **mixed**: 73/105 intentional-but-silent (per-file JSON-parse); 51/77/109/169/263/284/288/378/382 are **bugs** — filesystem / permission / readdir / writeFile failures swallowed with no log (MEDIUM) |
| `lib/context-overflow.ts:134` | 134 | intentional | response.clone().text() fallback; detection returns "not handled" |
| `lib/auto-update-checker.ts:30` | 30 | intentional | package.json missing → version `0.0.0` fallback (T9 logged) |
| `lib/auto-update-checker.ts:40` | 40 | intentional | cache file missing → return null |
| `lib/auto-update-checker.ts:161` | 161 | intentional | clearUpdateCache error ignored by design |
| `lib/utils.ts:42` | 42 | intentional | JSON.stringify fallback for log-safe stringify |
| `lib/shutdown.ts:25` | 25 | **bug** (T7 owns) | All cleanup errors silenced; cross-ref T07 |
| `lib/storage.ts:223` | 223 | intentional | temp-file cleanup best-effort |
| `lib/storage.ts:918` | 918 | intentional | tmp unlink cleanup best-effort (T6 logged) |
| `lib/storage.ts:1121` | 1121 | intentional | legacy file unlink best-effort |
| `lib/storage.ts:1160` | 1160 | intentional | flagged tmp unlink best-effort |
| `lib/storage.ts:1246` | 1246 | **bug-ish** | JSON.parse → throws with generic "Invalid JSON in import file"; no original parser error preserved |
| `lib/auth/auth.ts:48` | 48 | intentional | URL-parse fallback chain for OAuth callback paste |
| `lib/auth/auth.ts:127` | 127 | **bug** (T2 owns) | JWT decode error → null; T2 cites; T10 notes no log emitted |
| `lib/auth/browser.ts:92` | 92 | intentional | platform-specific open fallback |
| `lib/prompts/codex.ts:151,180,254` | multiple | intentional | cache/fetch fallback chain |
| `lib/prompts/opencode-codex.ts:61,99,252` | multiple | intentional | URL parse / cache-read / prefix-read fallback |
| `lib/request/fetch-helpers.ts:589,654,667,739` | multiple | intentional | JSON.parse of upstream body with graceful fallback |
| `lib/request/request-transformer.ts:881` | 881 | intentional | getOpenCodeCodexPrompt fallback (T9 logged) |
| `lib/request/response-handler.ts:137` | 137 | **bug** (T9 owns) | Malformed SSE JSON silently dropped |
| `lib/request/response-handler.ts:242` (`.catch`) | 242 | intentional | reader.cancel best-effort on stream error |
| `lib/request/helpers/model-map.ts:194` | 194 | needs classification; glance only — likely intentional fallback |
| `lib/request/helpers/input-utils.ts:137` | 137 | needs classification; glance only |
| `lib/ui/select.ts:344,403` | multiple | intentional (TUI fallback) |
| `lib/logger.ts:181` | 181 | intentional (log-write best-effort) |
| `lib/audit.ts:173` | 173 | **bug** (T9 owns) | Outer catch discards all audit-log write failures |

**Total bug-class swallows (T10 new or overlap with other tasks)**: 17. T10 new: 9 (recovery.ts:151/238/346/390, recovery/storage.ts × 5, storage.ts:1246). Cross-ref: auth.ts:127 → T02, shutdown.ts:25 → T07, response-handler.ts:137 → T09, audit.ts:173 → T09, storage.ts:810-887 (loadAccountsInternal) → T06.

See evidence file `.sisyphus/evidence/task-10-swallowed.md` for the exact `grep -rn "} catch" lib/` output used to build this table.

---

## User-Facing Error Messages — Actionability Sample (10)

Sampled from `grep -n "return \"[A-Z]\|throw new Error(\"" index.ts | head -50` — representative of user-visible surface.

| # | Message | File:Line | Actionable? | Notes |
|---|---|---|---|---|
| 1 | `"No authorization code found. Paste the full callback URL (e.g., http://localhost:1455/auth/callback?code=...). If browser callback keeps failing, retry with Device Code."` | index.ts:637 | YES | Concrete example + alt path |
| 2 | `"Missing OAuth state. Paste the full callback URL including both code and state parameters. If needed, retry with Device Code."` | index.ts:640 | YES | Clear structural guidance |
| 3 | `"OAuth state mismatch. Restart login and paste the callback URL generated for this login attempt, or retry with Device Code."` | index.ts:643 | YES | Next-step explicit |
| 4 | `"Missing access token after refresh"` | index.ts:2991 | NO | Internal invariant leak (MEDIUM-11) |
| 5 | `"Missing accountId for quota probe"` | index.ts:3015 | NO | Internal invariant leak (MEDIUM-11) |
| 6 | `"No Codex accounts configured. Run: opencode auth login"` | index.ts:3799, :3927, :4195, :5420, :5558, :5642, :5740, :5915, :6171 | YES | 9 occurrences; gold-standard pattern |
| 7 | `"Cannot refresh: account has no refresh token"` | index.ts:4547 | NO | No remediation (MEDIUM-11) |
| 8 | `"Failed to refresh token, authentication required"` | constants.ts:69 | NO | Primary auth-error surface; no next step (MEDIUM-10) |
| 9 | `"Label updated in memory but failed to persist. Changes may be lost on restart."` | index.ts:5503 | PARTIAL | Warns but no remediation (save? restart?) |
| 10 | `"Invalid JSON in import file: <path>"` | storage.ts:1247 | PARTIAL | Tells user WHAT but not HOW; original parse error dropped |

**Actionability rate**: 3 clearly yes, 4 clearly no, 3 partial. Non-actionable concentration: internal invariants in `index.ts` (4547, 3015, 2991) + the primary auth-failure message in `constants.ts`. See MEDIUM-10, MEDIUM-11.

---

## Destructive-Op Guardrails Matrix

| Op | Tool handler | Library function | Library default | CLI default | User confirmation? | Dry-run? | Atomic write? | Finding |
|---|---|---|---|---|---|---|---|---|
| `codex-remove` | index.ts:5995-6153 | `AccountManager.removeAccount` (accounts.ts:827) | — | no confirmation prompt | **NO** | no | persist via atomic `writeAccountsToPathUnlocked` | HIGH-3 |
| `codex-export` | index.ts:6224-6280 | `exportAccounts` (storage.ts:1309-1326) | `force = true` | `force ?? true` (reinforces) | **NO** | no | **NO** (`fs.writeFile` direct, non-atomic) | HIGH-4 |
| `codex-import` | index.ts:6282-6364 | `importAccounts` (storage.ts:1335-1461) | `backupMode ?? "none"` | `backupMode: "required"` (override) | dry-run flag only | YES (`dryRun`) | backup via atomic `writePreImportBackupFile`; persist via atomic path | HIGH-5 (library default only) |
| `codex-clear-cache` | index.ts ≤5050 (exists) | `clearUpdateCache` (auto-update-checker.ts:156) | — | — | NO | — | atomic `writeFileSync("{}", ...)` | out of T10 scope; LOW-5 trailing |
| interactive auth-menu "Delete all accounts?" | lib/ui/auth-menu.ts:182 | N/A | — | — | **YES** (`await confirm("Delete all accounts?")`) | — | — | — |
| interactive auth-menu delete single | lib/ui/auth-menu.ts:223 | N/A | — | — | **YES** | — | — | — |

**Observations**:

- The interactive TUI auth-menu path IS protected by `confirm()`. The tool-call path invoked by the OpenCode agent is NOT. Asymmetry is a coverage gap, not a capability gap — the helper exists in `lib/ui/confirm.ts` but is not wired.
- `exportAccounts` is the only destructive op with both an unsafe library default (`force=true`) and a non-atomic on-disk write. Double-failure mode.
- `importAccounts` CLI entry is fine; library default is not. External code importing `"oc-codex-multi-auth"` inherits the unsafe default.
- No op has a `--dry-run` preview except `codex-import`. `codex-export` has no way to preview where files will be written. `codex-remove` has no way to preview impact on `activeIndexByFamily` before applying.

See evidence file `.sisyphus/evidence/task-10-guardrails.md` for the exact tool-handler and library code paths quoted.

---

## Notes

- **Cross-ref to T01**: Architecture audit at `docs/audits/_findings/T01-architecture.md` already flagged `lib/errors.ts` fragmentation at the module level. T10 adds the runtime-wiring dimension (taxonomy is not just fragmented; it is dead).
- **Cross-ref to T02**: `auth.ts:127` JWT-decode swallow is T02 territory. T10 cites only.
- **Cross-ref to T06**: `loadAccountsInternal` silent-null on JSON-parse, non-atomic recovery sync fs, parent-dir mkdir mode. T10 cites only; the error-handling angle (silent discard + no user-visible diagnostic) is a distinct recommendation.
- **Cross-ref to T07**: `shutdown.ts:22-28` cleanup swallow, saveToDiskDebounced race. T10 cites only.
- **Cross-ref to T09**: `audit.ts:173` outer catch, `response-handler.ts:137` SSE JSON swallow, 191 log-call-site inventory, silent-failure grep catch-all. T10 reuses the grep surface but classifies only the non-T09 residue.
- **Cross-ref to T05**: V2 storage version rejection (storage.ts:630) is also a schema-forward-compat concern.
- **Severity budget**: 0 CRITICAL, 6 HIGH, 13 MEDIUM, 8 LOW (27 total). Under all caps (CRITICAL ≤5, HIGH ≤15, MEDIUM ≤40).
- **Layer-1 verification**: every quoted snippet re-read via `Read` tool at locked SHA d92a8ee before emission. Line numbers verified for all 27 findings.
- **No edits made to any source file.** Audit operated in strict READ-ONLY mode per rubric §"READ-ONLY Directive".
- **Scope fidelity**: all `scope-files` entries are present in `docs/audits/_meta/scope-whitelist.txt`.

---

*End of T10 — Error Handling / Recovery Flows. Rubric version: 1.*
