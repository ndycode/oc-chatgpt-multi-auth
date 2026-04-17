---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T01-architecture
agent: opencode-claude-opus-4-7
date: 2026-04-17T08:29:38Z
scope-files:
  - index.ts
  - lib/index.ts
  - lib/accounts.ts
  - lib/accounts/rate-limits.ts
  - lib/audit.ts
  - lib/auth/auth.ts
  - lib/auth/server.ts
  - lib/auth-rate-limit.ts
  - lib/cli.ts
  - lib/config.ts
  - lib/constants.ts
  - lib/prompts/codex.ts
  - lib/recovery.ts
  - lib/recovery/index.ts
  - lib/recovery/storage.ts
  - lib/recovery/types.ts
  - lib/request/fetch-helpers.ts
  - lib/request/request-transformer.ts
  - lib/runtime-contracts.ts
  - lib/schemas.ts
  - lib/storage.ts
  - lib/storage/migrations.ts
  - lib/storage/paths.ts
  - lib/types.ts
  - lib/utils.ts
  - docs/development/ARCHITECTURE.md
rubric-version: 1
---

> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Task**: T1 | **Agent**: opencode-claude-opus-4-7 | **Date**: 2026-04-17T08:29:38Z

# T1 — Architecture + Module Boundary Audit

**Summary**: Audited the plugin's module topology (`index.ts` + 57 `.ts` files under `lib/`), cross-referenced the user-facing `docs/development/ARCHITECTURE.md`, and constructed a dependency graph via `Select-String` on import statements. Top structural concerns: `index.ts` has ballooned to 5975 lines (plugin entry + 18 inline tool definitions + runtime metrics + beginner UX helpers + OAuth menu glue), `lib/storage.ts` is a 1296-line god module with ~30 top-level exports, and the recovery domain is fractured across `lib/recovery.ts` + `lib/recovery/` directory with a non-obvious boundary. `lib/runtime-contracts.ts` is a misleadingly-named 28-line OAuth constants file that `AGENTS.md:360` advertises as a contract module. `lib/auth/auth.ts:12` defines `REDIRECT_URI` via `localhost` while `lib/runtime-contracts.ts:6` defines the bind host as `127.0.0.1` (RFC 8252 §7.3 mismatch the `ARCHITECTURE.md` does not describe). Severity distribution: 0 CRITICAL, 3 HIGH, 7 MEDIUM, 2 LOW.

**Files audited**: 26 of 182 in-scope.

---

## Module Dependency Graph

Import fan-in (number of unique internal imports sourced by each file, from `Select-String -Path ... -Pattern '^(?:import|export)\s+.*from\s+"(\./[^"]+|\.\./[^"]+)"'`):

| File | Internal imports | Notes |
| --- | ---: | --- |
| `index.ts` | 35 | plugin entry, depends on virtually every top-level module |
| `lib/request/fetch-helpers.ts` | 9 | request pipeline hub |
| `lib/storage.ts` | 6 | account persistence hub |
| `lib/request/request-transformer.ts` | 6 | model + prompt normalization |
| `lib/ui/auth-menu.ts` | 5 | UI entry |
| `lib/accounts.ts` | 5 | multi-account manager |
| `lib/proactive-refresh.ts` | 4 | token refresh pump |
| `lib/auth/login-runner.ts` | 4 | login orchestrator |
| `lib/auth/auth.ts` | 4 | OAuth primitives |
| `lib/auth/token-utils.ts` | 4 | JWT parsing helpers |
| `lib/parallel-probe.ts` | 4 | probe fan-out |

Text-table rendering of the primary architectural layers:

```
          ┌──────────────────────────────────────────────┐
          │          index.ts (5975 lines)               │
          │  plugin entry | 18 tools | runtime metrics   │
          └───────┬────────────┬──────────────┬──────────┘
                  │            │              │
         auth layer         request layer   account layer
         /         \           |               |
  auth/auth.ts  auth/server  request/         accounts.ts
  auth/device-  (port 1455)  fetch-helpers    rotation.ts
  code.ts                    request-         refresh-queue
  auth/login-               transformer       proactive-
  runner.ts                  response-        refresh
  auth/browser.ts            handler
  auth/token-utils           helpers/{input,
                             model-map,
                             tool-utils}
                             rate-limit-
                             backoff
                             retry-budget
                                 │
                                 └─> prompts/{codex,
                                     codex-opencode-bridge,
                                     opencode-codex}
                                         │
                              (GitHub ETag cache, model
                               family detection)
                                 │
          storage layer (6 import edges)
          /          |          \
  storage.ts   storage/        storage/
  (god file)   migrations.ts   paths.ts
          |
  accounts/rate-limits.ts  (extracted)
  schemas.ts               (Zod source of truth)
  types.ts                 (re-exports schema types)
  runtime-contracts.ts     (OAuth constants only)

          ui layer                       recovery layer
          /      \                       /           \
  ui/auth-menu  ui/beginner    recovery.ts    recovery/
  ui/format     ui/select      (thinking      (storage.ts,
  ui/runtime    ui/theme       recovery,      types.ts,
  ui/confirm    ui/ansi        hooks)         constants.ts)
```

---

## Findings

### [HIGH | confidence=high] `index.ts` is a 5975-line monolith housing plugin entry + 18 inline tool definitions + beginner UX + runtime metrics

- **File**: `index.ts:250-5975`
- **Quote**:

  ```ts
  export const OpenAIOAuthPlugin: Plugin = async ({ client }: PluginInput) => {
  	initLogger(client);
  	let cachedAccountManager: AccountManager | null = null;
  	let accountManagerPromise: Promise<AccountManager> | null = null;
  	let loaderMutex: Promise<void> | null = null;
  	let startupPrewarmTriggered = false;
  	let startupPreflightShown = false;
  	let beginnerSafeModeEnabled = false;
  ```

- **Issue**: The entire plugin (loader, 7-step fetch pipeline, 18 `codex-*` tool handlers, runtime-metrics formatting, routing-visibility rendering, beginner wizard logic, OAuth menu glue, toast helpers, event handler) lives inside a single 5975-line file with a single exported plugin factory closing over >30 private helpers. `Select-String -Path index.ts -Pattern '^\s*"codex-[^"]+"\s*:\s*tool\(\{'` returns 18 tool definitions (codex-list / codex-switch / codex-status / codex-limits / codex-metrics / codex-help / codex-setup / codex-doctor / codex-next / codex-label / codex-tag / codex-note / codex-dashboard / codex-health / codex-remove / codex-refresh / codex-export / codex-import), each with its own schema, handler, JSON/text renderer, and error path inlined. `index.ts:35` already imports 35 internal modules; new features must touch this file. `ARCHITECTURE.md:17-55` describes the plugin as a clean 4-layer stack (OpenCode → Provider → Plugin → ChatGPT Backend), which does not reflect that "Plugin" is one giant file.
- **Recommendation**: Extract tool definitions into `lib/tools/*.ts` (one file per tool or grouped by domain: `lib/tools/accounts.ts` for list/switch/label/tag/note/remove, `lib/tools/diagnostics.ts` for status/limits/metrics/health/doctor/next/dashboard, `lib/tools/backup.ts` for export/import/refresh, `lib/tools/onboarding.ts` for help/setup) returning `Record<string, ReturnType<typeof tool>>`. Keep `index.ts` as pure orchestration: `loader()`, `event`, fetch pipeline, and a spread of the extracted tool records. Move runtime metrics + routing visibility snapshot builders to `lib/metrics.ts`. Target: `index.ts` ≤ 1500 lines.
- **Evidence**: `Get-Content index.ts | Measure-Object -Line` = 5975 lines; `Select-String -Path index.ts -Pattern '^\s*"codex-[^"]+"\s*:\s*tool\(\{' | Measure-Object` = 18 matches; `Select-String -Path index.ts -Pattern 'from\s+["''']\./lib/' -AllMatches` = 35 unique internal imports.

### [HIGH | confidence=high] `lib/storage.ts` is a 1296-line god module mixing atomic I/O, migration dispatch, import/export, flagged-account store, and schema normalization

- **File**: `lib/storage.ts:1-1461`
- **Quote**:

  ```ts
  import { promises as fs, existsSync } from "node:fs";
  import { randomBytes } from "node:crypto";
  import { basename, dirname, join } from "node:path";
  import {
    ACCOUNT_LIMITS,
    ACCOUNTS_FILE_NAME,
    FLAGGED_ACCOUNTS_FILE_NAME,
    LEGACY_ACCOUNTS_FILE_NAME,
    LEGACY_BLOCKED_ACCOUNTS_FILE_NAME,
    LEGACY_FLAGGED_ACCOUNTS_FILE_NAME,
  } from "./constants.js";
  ```

- **Issue**: `storage.ts` exports ~30 top-level symbols covering at least six distinct responsibilities: (1) atomic write + mutex/transaction (`withAccountStorageTransaction`, `loadAccounts`, `saveAccounts`, `clearAccounts`), (2) flagged-account persistence (`loadFlaggedAccounts`, `saveFlaggedAccounts`, `clearFlaggedAccounts`, `withFlaggedAccountStorageTransaction`), (3) normalization/dedup (`normalizeAccountStorage`, `deduplicateAccounts`, `deduplicateAccountsByEmail`), (4) import/export/backup (`exportAccounts`, `importAccounts`, `previewImportAccounts`, `createTimestampedBackupPath`), (5) workspace identity (`getWorkspaceIdentityKey`), (6) storage-path routing (`setStoragePath`, `setStoragePathDirect`, `getStoragePath`, `getFlaggedAccountsPath`) — the latter partially duplicated in the already-extracted `lib/storage/paths.ts` (which hosts `getConfigDir`, `getProjectConfigDir`, `getProjectGlobalConfigDir`, `findProjectRoot`). `ARCHITECTURE.md` does not describe any of these internal sub-responsibilities despite one of them (`importAccounts`) having a pre-seeded HIGH security finding referenced in `.sisyphus/plans/repo-audit.md:36`. Monolithic size inflates compile time, obscures review, and forces cross-concern testing (`test/storage.test.ts`, `test/storage-async.test.ts`).
- **Recommendation**: Split into (a) `lib/storage/atomic.ts` — `withAccountStorageTransaction`, atomic write primitive, mutex; (b) `lib/storage/accounts.ts` — load/save/clear for the active-account store; (c) `lib/storage/flagged.ts` — load/save/clear for flagged accounts; (d) `lib/storage/import-export.ts` — `importAccounts`, `exportAccounts`, `previewImportAccounts`, `createTimestampedBackupPath`; (e) `lib/storage/normalize.ts` — `normalizeAccountStorage`, `deduplicateAccounts`, `deduplicateAccountsByEmail`, `getWorkspaceIdentityKey`. Promote `lib/storage/index.ts` as the façade that re-exports the stable public surface; existing `lib/storage/{migrations,paths}.ts` files already demonstrate the pattern works. Move `StorageError`/`formatStorageErrorHint` to `lib/errors.ts` (which already exists and is ideal). Target: no individual storage file >400 lines.
- **Evidence**: `Get-Content lib/storage.ts | Measure-Object -Line` = 1296 lines; `Select-String -Path lib/storage.ts -Pattern '^export\s+(class\|function\|const\|interface\|type\|async)'` returned 25+ exports spanning the six responsibilities above; sibling `lib/storage/paths.ts` + `lib/storage/migrations.ts` prove the slicing pattern is already in use and reduces scope per file.

### [HIGH | confidence=high] `REDIRECT_URI` uses `localhost` while OAuth server binds on `127.0.0.1` — docs/code drift against `ARCHITECTURE.md`

- **File**: `lib/auth/auth.ts:12`
- **Quote**:

  ```ts
  export const REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;
  ```

- **Issue**: The client-side OAuth redirect sent to `auth.openai.com` is constructed with `http://localhost:1455/auth/callback`, but the OAuth callback server binds on `127.0.0.1` (see `lib/runtime-contracts.ts:6` → `export const OAUTH_CALLBACK_LOOPBACK_HOST = "127.0.0.1"` and `lib/auth/server.ts:56` → `.listen(OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_LOOPBACK_HOST, …)`). RFC 8252 §7.3 ("Loopback Interface Redirection") recommends native apps use the literal loopback IP, not the `localhost` alias, because the alias resolves differently on IPv6-first or DNS-overriding hosts (e.g. WSL with hosts-file edits). When a user's resolver maps `localhost` to `::1` but the server is bound only on IPv4 `127.0.0.1`, the browser callback never reaches the server and the UX falls back to the "OAuth callback timed out" toast in `index.ts:712-719`. `docs/development/ARCHITECTURE.md` discusses the stateless mode, reasoning-content flow, and multi-account rotation at length but contains zero references to the loopback binding contract — silently-failing DNS mismatches on user machines will surface as mysterious login failures. This is a documentation + code alignment drift.
- **Recommendation**: Either (a) change `lib/auth/auth.ts:12` to `` `http://${OAUTH_CALLBACK_LOOPBACK_HOST}:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}` `` (import the constant already defined next to `OAUTH_CALLBACK_PORT`) so the advertised redirect matches the bind literally, or (b) add an explicit server binding fallback to the IPv6 loopback when `localhost` is preferred. Document the chosen invariant in a new subsection of `docs/development/ARCHITECTURE.md` titled "OAuth Loopback Binding" citing RFC 8252 §7.3. Flag this as the canonical example of drift for T17 synthesis.
- **Evidence**: `lib/auth/auth.ts:12` literal shown; `lib/runtime-contracts.ts:6` → `export const OAUTH_CALLBACK_LOOPBACK_HOST = "127.0.0.1";`; `lib/auth/server.ts:56` → `.listen(OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_LOOPBACK_HOST, () => {`; `.sisyphus/plans/repo-audit.md:37` also lists "REDIRECT_URI `localhost` vs server `127.0.0.1` mismatch (auth.ts:12 vs runtime-contracts.ts)" as a seeded MEDIUM security finding — T2 will own the security aspect; T1 owns the docs/architecture drift.

### [MEDIUM | confidence=high] `lib/runtime-contracts.ts` is a misleadingly-named 28-line OAuth-constants file, not the "runtime invariants" module advertised in AGENTS.md

- **File**: `lib/runtime-contracts.ts:1-28`
- **Quote**:

  ```ts
  /**
   * Shared runtime constants and sentinel helpers only. This module is pure: it
   * does not perform I/O, persistence, or logging, so centralizing these values
   * does not introduce new Windows lock or token-redaction surfaces.
   */
  export const OAUTH_CALLBACK_LOOPBACK_HOST = "127.0.0.1";
  export const OAUTH_CALLBACK_PORT = 1455;
  export const OAUTH_CALLBACK_PATH = "/auth/callback";
  export const OAUTH_CALLBACK_BIND_URL = `http://${OAUTH_CALLBACK_LOOPBACK_HOST}:${OAUTH_CALLBACK_PORT}`;
  
  export const DEACTIVATED_WORKSPACE_ERROR_CODE = "deactivated_workspace";
  export const USAGE_REQUEST_TIMEOUT_MESSAGE = "Usage request timed out";
  ```

- **Issue**: `AGENTS.md:360` / `.sisyphus/plans/repo-audit.md:360` describes `lib/runtime-contracts.ts` as "top-level runtime invariants" and lists it alongside `lib/schemas.ts` and `lib/types.ts` as a "Type/Contract References" set worthy of duplicate-hotspot investigation. In reality the file holds only four OAuth constants (host/port/path/bind-url) and two string sentinels (`DEACTIVATED_WORKSPACE_ERROR_CODE`, `USAGE_REQUEST_TIMEOUT_MESSAGE`) plus two tiny factory helpers. The name "runtime contracts" invites future additions of validation code, Zod guards, or state-machine invariants that would break the file's stated "pure, no I/O" purpose. There is **no overlap** with `lib/schemas.ts` (Zod schemas, 301 lines) or `lib/types.ts` (TS interfaces re-exported from schemas, 146 lines) — the Metis note about duplication is a false alarm. The real issue is naming: the file is 50% OAuth constants that belong in `lib/constants.ts` (already exists with OAuth-adjacent entries like `AUTH_LABELS` at `lib/constants.ts:89-98`) and 50% error sentinels that belong in `lib/errors.ts`.
- **Recommendation**: Either rename the file to `lib/oauth-constants.ts` (and move `DEACTIVATED_WORKSPACE_ERROR_CODE` + `USAGE_REQUEST_TIMEOUT_MESSAGE` into `lib/errors.ts` next to `StorageError`/`CodexAuthError`), OR keep the name and flesh out the file to justify it — for example, consolidating `ERROR_MESSAGES` from `lib/constants.ts:67-71` and the error-code sentinels scattered through `lib/request/fetch-helpers.ts` into a true runtime-contracts registry. Do not leave the current 28-line non-module occupying the name. Update `AGENTS.md:360` once the rename lands.
- **Evidence**: Full file reproduced above; `lib/errors.ts` exists (145 lines) and is the idiomatic error-class home; `lib/constants.ts:89-98` already holds OAuth labels + port implications (`AUTH_LABELS.OAUTH`, instructions strings) and is the idiomatic constants home.

### [MEDIUM | confidence=high] Recovery domain fractured across `lib/recovery.ts` (431 lines) AND `lib/recovery/` directory — boundary is non-obvious

- **File**: `lib/recovery.ts:1-21`
- **Quote**:

  ```ts
  import type { PluginInput } from "@opencode-ai/plugin";
  import { createLogger } from "./logger.js";
  import type { PluginConfig } from "./types.js";
  import {
    readParts,
    findMessagesWithThinkingBlocks,
    findMessagesWithOrphanThinking,
    findMessageByIndexNeedingThinking,
    prependThinkingPart,
    stripThinkingParts,
  } from "./recovery/storage.js";
  import type {
    MessageInfo,
    MessageData,
    MessagePart,
    RecoveryErrorType,
    ResumeConfig,
    ToolResultPart,
  } from "./recovery/types.js";
  ```

- **Issue**: The recovery domain is split into two locations with a non-idiomatic layout. `lib/recovery.ts` (431 lines) contains the orchestration layer (hook factory `createSessionRecoveryHook`, error-type detection, `getRecoveryToastContent`, etc.) and imports from `lib/recovery/storage.ts`. `lib/recovery/index.ts` exists but is a 12-line barrel (`export * from "./types.js"; export * from "./constants.js"; export * from "./storage.js";`) that is **not imported anywhere from `lib/recovery.ts`**. `lib/index.ts:11-19` barrel exports `./recovery.js` but never re-exports the `./recovery/index.js` barrel, so `export * from './recovery/storage'` reachable only by importing the directory directly. This violates Node/TS convention: a file `lib/recovery.ts` and a directory `lib/recovery/` with `index.ts` cannot both exist cleanly in `"moduleResolution": "bundler"` (`tsconfig.json:8`) — `import "./recovery"` is ambiguous to human readers even though the resolver picks the `.ts` file first. `ARCHITECTURE.md:408-458` mentions "Multi-Account Rotation" but never describes the recovery domain structure.
- **Recommendation**: Merge into a single structure. Option A: rename `lib/recovery.ts` → `lib/recovery/hook.ts` (orchestration-only) and expose the public API through `lib/recovery/index.ts` as `export { createSessionRecoveryHook, isRecoverableError, detectErrorType, getRecoveryToastContent } from "./hook.js"; export * from "./types.js"; export * from "./constants.js"; export * from "./storage.js";`. Option B (less disruptive): rename `lib/recovery/` → `lib/recovery-storage/` and keep `lib/recovery.ts` as the façade. Update `lib/index.ts:11` and `index.ts:200-205` imports. Add a subsection to `docs/development/ARCHITECTURE.md` documenting the recovery module contract.
- **Evidence**: `Test-Path lib/recovery.ts` = True (431 lines); `Test-Path lib/recovery/index.ts` = True (12 lines, trivial barrel); `Select-String -Path lib/recovery.ts -Pattern 'from\s+["''']\./recovery/'` shows imports into the subdirectory; `Select-String -Path lib/index.ts -Pattern 'recovery'` shows only `export * from "./recovery.js"` — the subdirectory is never reached through the barrel.

### [MEDIUM | confidence=high] `lib/accounts.ts` is 1010 lines with a single `AccountManager` class holding ≥38 async methods — responsibility overrun

- **File**: `lib/accounts.ts:209-1010`
- **Quote**:

  ```ts
  export class AccountManager {
  	private accounts: ManagedAccount[] = [];
  	private cursorByFamily: Record<ModelFamily, number> = initFamilyState(0);
  	private currentAccountIndexByFamily: Record<ModelFamily, number> = initFamilyState(-1);
  	private lastToastAccountIndex = -1;
  	private lastToastTime = 0;
  	private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  	private pendingSave: Promise<void> | null = null;
  	private authFailuresByRefreshToken: Map<string, number> = new Map();
  ```

- **Issue**: `AccountManager` consolidates too many concerns on one class: account-pool state (accounts, cursorByFamily, currentAccountIndexByFamily), debounced persistence (saveDebounceTimer, pendingSave), auth-failure tracking (authFailuresByRefreshToken), toast rate-limiting (lastToastAccountIndex, lastToastTime), Codex-CLI hydration (`hydrateFromCodexCli`), and rotation (delegates into `lib/rotation.ts`). `Select-String -Path lib/accounts.ts -Pattern '^\s{1,2}(private\s+|public\s+|static\s+)?(async\s+)?[a-z][a-zA-Z0-9_]*\s*\('` returns 106 method-shaped lines (many are narrow helpers but at least 38 are `async` operations per the tighter `async\s+\w+` grep). The file additionally re-exports selected functions from `./auth/token-utils.js` and `./accounts/rate-limits.js` (`lib/accounts.ts:25-49`), acting as a partial barrel — this mixes "class home" and "barrel" responsibilities. `AGENTS.md:77` lists this file simply as "multi-account pool, rotation, health scoring" without signaling the scope drift. `ARCHITECTURE.md:408-460` describes account selection algorithmically but doesn't enumerate which class-method does what.
- **Recommendation**: Split `AccountManager` along the state boundaries: (a) `lib/accounts/pool.ts` — pool state + getters/setters + `hasRefreshToken`/`getAccountCount`; (b) `lib/accounts/persistence.ts` — debounced save, `loadFromDisk`, `saveToDisk`; (c) `lib/accounts/auth-failure-tracker.ts` — `authFailuresByRefreshToken` + increment/reset methods; (d) `lib/accounts/toast-throttle.ts` — the toast-debounce state (or move to `lib/ui/`); (e) `lib/accounts/manager.ts` — slim orchestrator that composes the above. Remove the re-exports from `lib/accounts.ts` (line 25-49) and require callers to import directly from `./auth/token-utils.js` + `./accounts/rate-limits.js`; update `index.ts:117` accordingly. Target: no accounts file >400 lines.
- **Evidence**: `Get-Content lib/accounts.ts | Measure-Object -Line` = 1010 lines; `Select-String -Path lib/accounts.ts -Pattern '^\s*async\s+\w+\|^\s+\w+\([^)]*\)\s*:' | Measure-Object` = 38 matches; `Select-String -Path lib/accounts.ts -Pattern '^export\s+\{' -Context 0,5` shows two barrel-style `export { ... } from "…"` blocks at lines 25-49.

### [MEDIUM | confidence=medium] `lib/request/fetch-helpers.ts` (870 lines) duplicates error-classification responsibility with `lib/request/request-transformer.ts`

- **File**: `lib/request/fetch-helpers.ts:1-80`
- **Quote**:

  ```ts
  /**
   * Helper functions for the custom fetch implementation
   * These functions break down the complex fetch logic into manageable, testable units
   */
  
  import type { Auth, OpencodeClient } from "@opencode-ai/sdk";
  import { queuedRefresh } from "../refresh-queue.js";
  import { logRequest, logError, logWarn } from "../logger.js";
  import { getCodexInstructions, getModelFamily } from "../prompts/codex.js";
  import { transformRequestBody, normalizeModel } from "./request-transformer.js";
  import { convertSseToJson, ensureContentType } from "./response-handler.js";
  import type { UserConfig, RequestBody } from "../types.js";
  import { CodexAuthError } from "../errors.js";
  import { DEACTIVATED_WORKSPACE_ERROR_CODE } from "../runtime-contracts.js";
  import { isRecord } from "../utils.js";
  import {
          CODEX_BASE_URL,
          HTTP_STATUS,
          OPENAI_HEADERS,
          OPENAI_HEADER_VALUES,
          URL_PATHS,
          ERROR_MESSAGES,
          LOG_STAGES,
  } from "../constants.js";
  ```

- **Issue**: `fetch-helpers.ts` has 870 lines and exports at least 16 functions (`DEFAULT_UNSUPPORTED_CODEX_FALLBACK_CHAIN`, `extractUnsupportedCodexModelFromText`, `getUnsupportedCodexModelInfo`, `resolveUnsupportedCodexFallbackModel`, `shouldFallbackToGpt52OnUnsupportedGpt53`, `isEntitlementError`, `createEntitlementErrorResponse`, `isDeactivatedWorkspaceError`, `shouldRefreshToken`, `refreshAndUpdateToken`, `extractRequestUrl`, `rewriteUrlForCodex`, `transformRequestForCodex`, `createCodexHeaders`, `handleErrorResponse`, `handleSuccessResponse`). At least 5 of those are pure error classification (`isEntitlementError`, `createEntitlementErrorResponse`, `isDeactivatedWorkspaceError`, `getUnsupportedCodexModelInfo`, `resolveUnsupportedCodexFallbackModel`) and belong in a dedicated `lib/request/error-classifier.ts`. Keeping them here increases coupling: a change to how unsupported-model fallback works touches the same file as header construction and response handling. `ARCHITECTURE.md:257-286` describes a clean 5-step "Request Pipeline" which does not reflect that one file owns both "shape outgoing request" AND "classify response errors" AND "derive fallback models".
- **Recommendation**: Extract the model-fallback + error-classification functions into `lib/request/error-classifier.ts` (keep `CHATGPT_CODEX_UNSUPPORTED_MODEL_CODE`, the regex patterns, `canonicalizeModelName`, and the fallback-chain functions). Leave `fetch-helpers.ts` with only outbound request shaping (`createCodexHeaders`, `rewriteUrlForCodex`, `transformRequestForCodex`, `shouldRefreshToken`, `refreshAndUpdateToken`, `handleErrorResponse`, `handleSuccessResponse`). Target: `fetch-helpers.ts` ≤ 500 lines. Update `index.ts` imports (currently imports from `fetch-helpers.js` at index.ts:140-152).
- **Evidence**: `Get-Content lib/request/fetch-helpers.ts | Measure-Object -Line` = 870 lines; `Select-String -Path lib/request/fetch-helpers.ts -Pattern '^(export\s+(async\s+)?function\|export\s+const)'` = 16 top-level exports (listed in quote context); `lib/request/request-transformer.ts` is a separate 998-line file that already owns "shape outgoing request body" — so `fetch-helpers.ts` is duplicating that scope on the HTTP-layer side rather than pure error classification.

### [MEDIUM | confidence=medium] `lib/request/request-transformer.ts` is 998 lines and mixes model normalization, prompt injection, orphan-tool recovery, and fast-session truncation

- **File**: `lib/request/request-transformer.ts:26`
- **Quote**:

  ```ts
  export {
  ```

- **Issue**: The file is 998 lines and `Select-String -Path lib/request/request-transformer.ts -Pattern '^export' -List` reports multiple export blocks covering at least four distinct domains: (1) model-name normalization (`normalizeModel`), (2) request-body transformation (`transformRequestBody`), (3) fast-session defaults (`applyFastSessionDefaults`, re-exported into `index.ts:159`), (4) orphan-tool-output handling (referenced in `ARCHITECTURE.md:310-311`), and (5) legacy-mode ID-stripping (documented extensively in `ARCHITECTURE.md:164-208`). A change to fast-session behavior (e.g., a new strategy mode) must open a file where the same edit-range also handles prompt injection and ID filtering; this forces reviewers to context-switch between unrelated concerns. `ARCHITECTURE.md:129-208` documents the "Message ID Handling (Legacy Mode)" as if it were a small function, but in reality it is one responsibility among many in a near-1000-line file.
- **Recommendation**: Split into (a) `lib/request/transformers/model.ts` — `normalizeModel` + model-map lookups (or move into `lib/request/helpers/model-map.ts` which already exists at 185 lines); (b) `lib/request/transformers/input-filter.ts` — `filterInput` + ID stripping + `item_reference` removal described in `ARCHITECTURE.md:165-184`; (c) `lib/request/transformers/fast-session.ts` — `applyFastSessionDefaults`; (d) `lib/request/transformers/orphan-tools.ts` — the orphan-tool-output conversion described in `ARCHITECTURE.md:310-311`; (e) `lib/request/transformers/index.ts` — façade re-exporting the public API (`transformRequestBody`, `normalizeModel`, `applyFastSessionDefaults`). Target: no single transformer file >400 lines.
- **Evidence**: `Get-Content lib/request/request-transformer.ts | Measure-Object -Line` = 998 lines; `ARCHITECTURE.md:129-208` (AI SDK compatibility), `ARCHITECTURE.md:310-311` (orphan-tool handling), and `ARCHITECTURE.md:257-286` (request pipeline) collectively describe ≥4 responsibilities that the file currently owns.

### [MEDIUM | confidence=medium] `index.ts` imports 35 modules directly but `lib/index.ts` barrel exports only 19 — two incompatible public surfaces

- **File**: `lib/index.ts:1-19`
- **Quote**:

  ```ts
  export * from "./accounts.js";
  export * from "./storage.js";
  export * from "./config.js";
  export * from "./constants.js";
  export * from "./types.js";
  export * from "./logger.js";
  export * from "./auth/auth.js";
  export * from "./auth/device-code.js";
  export * from "./auth/login-runner.js";
  export * from "./request/fetch-helpers.js";
  export * from "./request/request-transformer.js";
  export * from "./request/response-handler.js";
  export * from "./request/rate-limit-backoff.js";
  export * from "./prompts/codex.js";
  export * from "./shutdown.js";
  export * from "./circuit-breaker.js";
  export * from "./health.js";
  export * from "./table-formatter.js";
  export * from "./parallel-probe.js";
  ```

- **Issue**: The library barrel in `lib/index.ts` deliberately exposes 19 modules, but `index.ts` (the plugin entry) bypasses this barrel entirely and imports from 35 individual module paths (`./lib/auth/auth.js`, `./lib/auth/server.js`, `./lib/refresh-queue.js`, `./lib/auto-update-checker.js`, `./lib/context-overflow.js`, `./lib/schemas.js`, `./lib/runtime-contracts.js`, `./lib/rotation.js`, `./lib/table-formatter.js`, `./lib/ui/runtime.js`, `./lib/ui/format.js`, `./lib/ui/beginner.js`, `./lib/ui/select.js`, `./lib/recovery.js`, `./lib/request/retry-budget.js`, `./lib/request/rate-limit-backoff.js`, etc.). This means the barrel is **effectively unused by the plugin's own entry file** and exists only as a courtesy for `test/` (which reimports via `./lib/index.js` or paths that bypass it). Notably missing from the barrel: `lib/refresh-queue.ts`, `lib/proactive-refresh.ts`, `lib/recovery.ts`, `lib/recovery/index.ts`, `lib/schemas.ts`, `lib/runtime-contracts.ts`, `lib/rotation.ts`, `lib/errors.ts`, `lib/utils.ts`, `lib/auth/server.ts`, `lib/auth/browser.ts`, `lib/auth/token-utils.ts`, `lib/request/retry-budget.ts`, `lib/request/helpers/*.ts`, all of `lib/ui/*.ts`. The barrel is silently drifting from reality.
- **Recommendation**: Decide on a canonical public surface. Option A (recommended): delete `lib/index.ts` entirely; keep direct imports — this matches how `index.ts` already works. Option B: make the barrel exhaustive and use it from `index.ts`, converting 35 imports into one barrel import — risks accidental export of internal helpers and increases tree-shaking difficulty. Option C: treat `lib/index.ts` as a public-facing SDK surface intentionally narrower than internal modules and document which symbols are "public" vs internal in a new `docs/development/API_SURFACE.md`. The current state is the worst of three worlds: partial barrel that adds maintenance load without delivering a stable public API.
- **Evidence**: `lib/index.ts` full contents reproduced above (19 lines, 19 `export *` statements); `Select-String -Path index.ts -Pattern 'from\s+["''']\./lib/' -AllMatches` returned 35 distinct internal imports — none from `./lib/index.js` (the barrel). Every import path in `index.ts` targets a specific submodule.

### [MEDIUM | confidence=medium] `lib/audit.ts` defines append-side logging queue but `lib/logger.ts` separately owns redaction + file logging — two file-log stacks

- **File**: `lib/audit.ts:1-40`
- **Quote**:

  ```ts
  import { mkdirSync, existsSync, statSync, renameSync, readdirSync, unlinkSync, appendFileSync } from "node:fs";
  
  // Simple in-memory queue to prevent EBUSY locks during highly concurrent writes
  const logQueue: string[] = [];
  let isFlushing = false;
  
  function flushLogQueue(logPath: string): void {
  	if (isFlushing || logQueue.length === 0) return;
  	isFlushing = true;
  ```

- **Issue**: The repo has two parallel file-logging implementations. `lib/audit.ts` (165 lines) implements its own append-side queue with EBUSY retry, rotating-file detection (`statSync`, `renameSync`, `readdirSync`, `unlinkSync`), and `AuditAction` enum for structured events. `lib/logger.ts` (350 lines) implements the general-purpose plugin logger with correlation IDs (`setCorrelationId`, `getCorrelationId`), redaction patterns (`TOKEN_PATTERNS` at `lib/logger.ts:29-34`), `maskEmail`, and its own file-sink. `lib/audit.ts:29` imports `getCorrelationId, maskEmail` from `./logger.js`, so audit writes through logger-provided redaction helpers — but the append path does not share the queue, so EBUSY on Windows/antivirus can occur twice (once for each sink). `ARCHITECTURE.md` doesn't mention an audit log at all — this whole subsystem is undocumented to users.
- **Recommendation**: Unify onto a single append-side implementation. Either (a) fold `lib/audit.ts` into `lib/logger.ts` as an `audit.record(action, metadata)` facet sharing the existing queue, or (b) pull the EBUSY-safe queue out of `lib/audit.ts:1-25` into a reusable `lib/fs-queue.ts` module consumed by both `lib/logger.ts` and `lib/audit.ts`. Option (b) is less disruptive but requires touching `lib/logger.ts`. Document the audit stream in `docs/development/ARCHITECTURE.md` under a new "Operational Logging" section. Also verify T9 (observability) is aware that `lib/audit.ts` exists — defer the content-coverage finding to T9.
- **Evidence**: `Get-Content lib/audit.ts | Measure-Object -Line` = 165 lines; `Get-Content lib/logger.ts | Measure-Object -Line` = 350 lines; `Select-String -Path lib/audit.ts -Pattern 'appendFileSync\|renameSync'` = 3 hits for its own fs operations; `Select-String -Path lib/audit.ts -Pattern 'from\s+["''']\./logger\.js"'` = 1 hit (only imports `getCorrelationId, maskEmail`, not the logger sink itself).

### [LOW | confidence=high] `lib/accounts.ts` acts as a partial barrel re-exporting from `auth/token-utils.js` and `accounts/rate-limits.js`

- **File**: `lib/accounts.ts:25-64`
- **Quote**:

  ```ts
  export {
  	extractAccountId,
  	extractAccountEmail,
  	getAccountIdCandidates,
  	selectBestAccountCandidate,
  	shouldUpdateAccountIdFromToken,
  	resolveRequestAccountId,
  	sanitizeEmail,
  	type AccountIdCandidate,
  } from "./auth/token-utils.js";
  
  export {
  	parseRateLimitReason,
  	getQuotaKey,
  	clampNonNegativeInt,
  	clearExpiredRateLimits,
  	isRateLimitedForQuotaKey,
  	isRateLimitedForFamily,
  	formatWaitTime,
  	type QuotaKey,
  	type BaseQuotaKey,
  	type RateLimitReason,
  	type RateLimitState,
  	type RateLimitedEntity,
  ```

- **Issue**: `lib/accounts.ts` re-exports 7 symbols from `./auth/token-utils.js` and 12 symbols from `./accounts/rate-limits.js`. Consumers (including `index.ts:105-118`) then import from `./lib/accounts.js` rather than the origin — `index.ts` imports `extractAccountEmail, extractAccountId, parseRateLimitReason` via `accounts.ts`, not via the actual origin files. This creates a soft API surface where symbols appear in two places (`lib/accounts.ts` and their actual home), violates the "one canonical location per symbol" convention, and complicates refactors (e.g., renaming `parseRateLimitReason` must touch two files). The extraction comment in `lib/accounts/rate-limits.ts:3` states "Extracted from accounts.ts to reduce module size" — so the re-exports were kept as a compatibility shim during the split, but the shim is still around.
- **Recommendation**: Rewrite `index.ts:105-118` + other consumers to import directly from `./lib/auth/token-utils.js` and `./lib/accounts/rate-limits.js`. Then delete the `export {...}` blocks at `lib/accounts.ts:25-64`. Verify no tests rely on the indirect path (`grep -r "from.*lib/accounts" test/`). This is a LOW-severity code-hygiene finding because behavior is unchanged; the benefit is clearer grep-to-definition navigation.
- **Evidence**: `lib/accounts.ts:25-49` (two `export { ... } from "..."` blocks reproduced above); `index.ts:107-117` imports `extractAccountEmail, extractAccountId, parseRateLimitReason` from `./lib/accounts.js` (not from `./lib/auth/token-utils.js` or `./lib/accounts/rate-limits.js` directly); `lib/accounts/rate-limits.ts:3` documents the extraction origin.

### [LOW | confidence=medium] `docs/development/ARCHITECTURE.md` describes v4.4.0+/v4.5.0+ features without mentioning v6.0.0 rebrand or per-project storage namespacing

- **File**: `docs/development/ARCHITECTURE.md:408`
- **Quote**:

  ```
  ## Multi-Account Rotation (v4.4.0+)
  
  ### Health-Based Account Selection
  
  The plugin tracks account health and uses intelligent rotation:
  ```

- **Issue**: `README.md` and `lib/constants.ts:13` both confirm the package is at `oc-codex-multi-auth` v6.0.0 (with `LEGACY_PACKAGE_NAME = "oc-chatgpt-multi-auth"` at `lib/constants.ts:10` retained for migration). `ARCHITECTURE.md` still titles sub-sections as "Multi-Account Rotation (v4.4.0+)" (line 408) and "RefreshQueue (v4.5.0+)" (line 446) without any v6.0 cutover section, and never documents: (a) the per-project vs global storage boundary (`lib/storage/paths.ts` → `getProjectStorageKey` hash-based namespacing under `~/.opencode/projects/<hash>/`); (b) the workspace-identity key (`lib/storage.ts:43` `getWorkspaceIdentityKey` composes organizationId/accountId/refreshToken into a stable key); (c) the beginner safe-mode + wizard flow (`index.ts:1274-1292` `runStartupPreflight` + `index.ts:1138-1272` `runSetupWizard`). These are central operational invariants that appear in the code but have no architectural documentation.
- **Recommendation**: Add a v6.0.0 changelog subsection and three new sections to `docs/development/ARCHITECTURE.md`: "Per-Project Storage Namespacing" (citing `lib/storage/paths.ts`), "Workspace Identity Key" (citing `lib/storage.ts:43-60`), and "Beginner Preflight + Wizard" (citing `index.ts:1274-1292` and `lib/ui/beginner.ts`). Either bump version markers on existing subsections ("Multi-Account Rotation (v4.4.0+, updated v6.0)") or remove version markers and use a dedicated "Version History" section. This is LOW because the code works; the finding is docs-drift.
- **Evidence**: `docs/development/ARCHITECTURE.md:408` → `## Multi-Account Rotation (v4.4.0+)`; `docs/development/ARCHITECTURE.md:446` → `### RefreshQueue (v4.5.0+)`; `lib/constants.ts:7` → `export const PACKAGE_NAME = "oc-codex-multi-auth";`; `lib/storage/paths.ts:11-14` defines the per-project markers + hash length; `index.ts:1274-1292` contains the `runStartupPreflight` function; the word "v6" appears **zero times** in `docs/development/ARCHITECTURE.md` (verified via `Select-String -Path docs/development/ARCHITECTURE.md -Pattern 'v6'` → no matches).

---

## Notes

- **Anti-pattern scan (cross-cuts T5)**: `Select-String -Path lib\*.ts,lib\*\*.ts,index.ts -Pattern '\bas any\b|@ts-ignore|@ts-expect-error' -AllMatches | Measure-Object` = **0 matches**. AGENTS.md:67 claim of "Do not use `as any`, `@ts-ignore`, `@ts-expect-error`" is currently honored. Confirms T5 scope.
- **Tool registration (cross-cuts T12 CLI/UI)**: 18 `codex-*` tools defined inline in `index.ts`; full names listed in Finding #1 Evidence. T12 should audit the per-tool schemas + render paths, not the fact that they are inline (T1 owns the structural finding).
- **Out-of-scope deferrals**: `lib/storage.ts` import-resurrection-merge bug (storage.ts:1245+) deferred to T2 (security) per seed list; `lib/refresh-queue.ts` race deferred to T7 (concurrency) per seed list; `lib/rotation.ts` hybrid scoring thrash deferred to T3 (rotation) per plan. Any overlap in T1 findings citing those files is structural-only.
- **`docs/development/ARCHITECTURE.md` cross-references**: Findings #1, #2, #3, #5, #7, #9, #10 all cite `docs/development/ARCHITECTURE.md` for drift or missing documentation. Finding #3 is the canonical code↔docs drift candidate; others are docs-coverage deficits.

---

## Severity Summary

| Severity | Count |
| --- | ---: |
| CRITICAL | 0 |
| HIGH | 3 |
| MEDIUM | 7 |
| LOW | 2 |
| **Total** | **12** |

---

*End of T01 architecture findings.*
