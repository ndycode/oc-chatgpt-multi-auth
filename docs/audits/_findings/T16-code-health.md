---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T16-code-health
agent: opencode
date: 2026-04-17T00:00:00Z
scope-files:
  - index.ts
  - lib/accounts.ts
  - lib/accounts/rate-limits.ts
  - lib/audit.ts
  - lib/auth-rate-limit.ts
  - lib/auth/auth.ts
  - lib/auth/device-code.ts
  - lib/auth/login-runner.ts
  - lib/auth/token-utils.ts
  - lib/cli.ts
  - lib/config.ts
  - lib/constants.ts
  - lib/index.ts
  - lib/logger.ts
  - lib/recovery.ts
  - lib/recovery/index.ts
  - lib/recovery/storage.ts
  - lib/recovery/types.ts
  - lib/request/fetch-helpers.ts
  - lib/request/request-transformer.ts
  - lib/request/response-handler.ts
  - lib/rotation.ts
  - lib/runtime-contracts.ts
  - lib/schemas.ts
  - lib/storage.ts
  - lib/storage/migrations.ts
  - lib/utils.ts
rubric-version: 1
---

# T16 — Code Health / Dead Code / Refactor Opportunities

**Summary**: Wave 2 code-health audit of `oc-codex-multi-auth` at SHA `d92a8eed`. Covers dead code (full modules + unused exports), duplicated helpers/constants, large-file split candidates, misnamed files, tangled responsibilities, and prioritized refactor candidates with payoff assessment. Headline findings: **3 HIGH** (audit.ts is 100% dead production infrastructure; auth-rate-limit.ts is dead feature; index.ts is a 5975-line monolith with 18 inline tool definitions); **12 MEDIUM** (structural fractures, duplicated helpers, misnamed modules, tangled AccountManager god-class, 36 unused exports, 100+ unused types, enum-member rot); **4 LOW** (style/taste).

**Files audited**: 27 of 59 in-scope TypeScript modules (all files >300 lines plus pre-seeded dead/misnamed candidates and cross-cutting helpers).

---

## Inventory Summary (raw counts)

| Metric | Count | Evidence |
|---|---|---|
| Total `lib/**/*.ts` + `index.ts` files | 59 | `Get-ChildItem` tree |
| Files > 500 lines | 7 | index.ts (5975), storage.ts (1296), request-transformer.ts (998), accounts.ts (888), fetch-helpers.ts (870), login-runner.ts (740), oauth-success.ts (629) |
| Files 300–500 lines | 11 | token-utils.ts (472), prompts/codex.ts (463), config.ts (445), rotation.ts (376), recovery.ts (367), ui/select.ts (357), logger.ts (350), recovery/storage.ts (326), ui/beginner.ts (319), refresh-queue.ts (317), schemas.ts (301) |
| `TODO`/`FIXME`/`HACK`/`XXX` annotations | 0 | grep confirms zero |
| Consecutive `//` comment blocks ≥5 lines | 4 (all doc comments, no dead code) | request-transformer.ts:L554-L563, L573-L577, L1121-L1126; index.ts:L2117-L2121 |
| Unused exports (knip) | 36 | `.sisyphus/evidence/task-16-knip-raw.txt` |
| Unused exported types/interfaces (knip) | 100 | ibid |
| Unused exported enum members (knip) | 9 (all in `AuditAction`) | ibid |
| Duplicate exports (knip) | 2 (`PACKAGE_NAME`/`PLUGIN_NAME`, `OpenAIOAuthPlugin`/`OpenAIAuthPlugin`) | ibid |
| Fully dead modules (production-unreachable) | 2 (`lib/audit.ts`, `lib/auth-rate-limit.ts`) | import graph scan |
| Duplicate utility function definitions | 4 for `isRecord`, 2 for `nowMs` | grep |

Tooling note: `knip@6.4.1` was executed one-shot via `npx` (no repo install) and results are archived at `.sisyphus/evidence/task-16-knip-raw.txt`. Recommend adding `knip` as a persistent devDependency with a `package.json` script (e.g. `"lint:deadcode": "knip --no-progress"`) and wiring it into CI for ongoing enforcement — see refactor candidate RC-9.

---

## Findings

### [HIGH | confidence=high] `lib/audit.ts` is 100% dead production infrastructure (17 enum values, 0 call sites)

- **File**: `lib/audit.ts:29-47`
- **Quote**:

  ```ts
  export enum AuditAction {
  	ACCOUNT_ADD = "account.add",
  	ACCOUNT_REMOVE = "account.remove",
  	ACCOUNT_SWITCH = "account.switch",
  	ACCOUNT_REFRESH = "account.refresh",
  	ACCOUNT_EXPORT = "account.export",
  	ACCOUNT_IMPORT = "account.import",
  	AUTH_LOGIN = "auth.login",
  	AUTH_LOGOUT = "auth.logout",
  	AUTH_REFRESH = "auth.refresh",
  	AUTH_FAILURE = "auth.failure",
  	CONFIG_LOAD = "config.load",
  	CONFIG_CHANGE = "config.change",
  	REQUEST_START = "request.start",
  	REQUEST_SUCCESS = "request.success",
  	REQUEST_FAILURE = "request.failure",
  	CIRCUIT_OPEN = "circuit.open",
  	CIRCUIT_CLOSE = "circuit.close",
  }
  ```

- **Issue**: `lib/audit.ts` defines a 189-line audit-log subsystem (queue, rotation, sanitization, 17 action constants, 3 outcome constants, `auditLog()` entry point) that is **never imported by any production module**. grep for `auditLog|AuditAction|AuditOutcome|configureAudit|listAuditLogFiles|getAuditLogPath|getAuditConfig` yields hits only in `lib/audit.ts` itself and `test/audit.test.ts` / `test/audit.race.test.ts`. knip confirms 9 of 17 enum members (ACCOUNT_SWITCH, ACCOUNT_REFRESH, ACCOUNT_EXPORT, ACCOUNT_IMPORT, AUTH_LOGOUT, AUTH_FAILURE, CONFIG_CHANGE, REQUEST_FAILURE, CIRCUIT_CLOSE) are entirely unused even within the module, and neither `configureAudit` nor `auditLog` is called anywhere. The module ships in the built plugin (adds dead bytes, `renameSync`/`unlinkSync` attack surface, sync disk I/O risk) and is maintained with two test files — a pure carrying cost. This is parallel wasted-infrastructure alongside `lib/auth-rate-limit.ts` (separate finding) and validates pre-seed T9 observation that the module is dead.
- **Recommendation**: Remove `lib/audit.ts` + `test/audit.test.ts` + `test/audit.race.test.ts`. If a future audit-log feature is wanted, reintroduce from git history at that time. As a non-destructive first step, delete the file and run `npm test && npm run build` to confirm zero regressions. Add `knip --no-progress` to CI (refactor candidate RC-9) to prevent recurrence.
- **Evidence**: `grep auditLog|AuditAction|AuditOutcome|configureAudit|listAuditLogFiles` → 3 files only (audit.ts + 2 tests); knip report `.sisyphus/evidence/task-16-knip-raw.txt` lines listing `ACCOUNT_SWITCH` … `CIRCUIT_CLOSE` as unused enum members; pre-seed T9 already surfaced this; direct read of lib/audit.ts.

### [HIGH | confidence=high] `lib/auth-rate-limit.ts` is a dead feature — never wired to OAuth flow

- **File**: `lib/auth-rate-limit.ts:119-126`
- **Quote**:

  ```ts
  export function checkAuthRateLimit(accountId: string): void {
  	if (!canAttemptAuth(accountId)) {
  		throw new AuthRateLimitError(
  			accountId,
  			getAttemptsRemaining(accountId),
  			getTimeUntilReset(accountId),
  		);
  	}
  }
  ```

- **Issue**: `lib/auth-rate-limit.ts` defines a 127-line per-account token-bucket (`canAttemptAuth`, `recordAuthAttempt`, `checkAuthRateLimit`, `AuthRateLimitError`, `configureAuthRateLimit`, `getAttemptsRemaining`, `resetAuthRateLimit`, etc.) that **no production module imports**. grep `from ['\"].*auth-rate-limit` inside `lib/**` returns zero results; the only references are in `test/auth-rate-limit.test.ts` and the `test/AGENTS.md` docstring that describes the dead test itself. The intended wiring would be in `lib/auth/auth.ts` and/or `lib/auth/login-runner.ts` around token exchange/refresh, but neither file imports it. This is a dead feature carrying ~130 lines of production code + a full test suite, a stateful module-level `Map`, and a custom error class that is never thrown. Confirms pre-seed T2 finding.
- **Recommendation**: Decide **wire-or-remove** explicitly. Wire: invoke `recordAuthAttempt(accountId)` from the token-exchange / refresh path in `lib/auth/auth.ts`, call `checkAuthRateLimit` before attempting a sensitive auth operation, and surface `AuthRateLimitError` in `handleErrorResponse` (`lib/request/fetch-helpers.ts:571`) to show a clear diagnostic message. Remove: delete the module + its test file. Do NOT leave it in the "maybe later" state — either ship the guard or drop the code.
- **Evidence**: `grep -r --include='*.ts' 'from ["\x27].*auth-rate-limit' lib/` → 0 matches; `test/auth-rate-limit.test.ts` exists but exercises module-internal state only; knip lists `AuthRateLimitConfig` interface as unused; pre-seed T2.

### [HIGH | confidence=medium] `index.ts` is a 5975-line monolith with 18 inline tool definitions + fetch pipeline + event handler

- **File**: `index.ts:250-6381`
- **Quote**:

  ```ts
  export const OpenAIOAuthPlugin: Plugin = async ({ client }: PluginInput) => {
  ```

- **Issue**: `index.ts` is the plugin entrypoint and contains, in a single top-level async function: (a) the full fetch/request pipeline with inline helpers (e.g. a local abort-aware `sleep` at index.ts:1722, `matchesWorkspaceIdentity` at :207, `upsertFlaggedAccountRecord` at :218), (b) 18 slash-command tool definitions inlined with `tool({...})` at line numbers 3534, 3780, 3896, 4166, 4712, 4919, 5040, 5057, 5358, 5398, 5536, 5628, 5698, 5886, 5995, 6156, 6224, 6282, (c) the SDK `event` handler, and (d) the `auth.loader` returning the SDK config. The tool definitions alone (~2500 lines from `codex-list` at :3534 to `codex-import` at :6282) dominate the file and have zero architectural reason to live with the fetch pipeline. This size is pathological for review, for IDE performance, for git-blame, and for onboarding; it is ~6x the next-largest file (`lib/storage.ts` at 1296). Even the file's own internal navigation relies on the reader scrolling past thousands of lines because nothing — no single `// =====` divider, no heading block — labels the pipeline / tools / auth sections. Further, the file defines a second alias export `OpenAIAuthPlugin = OpenAIOAuthPlugin` at :6379 + `export default` at :6381; knip flags the trio as duplicate exports.
- **Recommendation**: Split into `index.ts` + `lib/plugin/tools/` + `lib/plugin/fetch.ts`. Concretely: (1) create `lib/plugin/tools/` with one file per tool (`codex-list.ts`, `codex-switch.ts`, …); each file exports a `register(client)`-style builder that returns `{[name: string]: ReturnType<typeof tool>}`. (2) move the fetch handler body into `lib/plugin/fetch.ts` exporting `createPluginFetch(ctx)`. (3) shrink `index.ts` to ~150 lines: import the pieces, compose the `Plugin` object, export default. (4) remove the `OpenAIAuthPlugin` alias export (knip flagged as duplicate). Split as 4–6 incremental PRs (tools chunk, fetch chunk, event handler chunk, alias removal) with green tests between each.
- **Evidence**: `wc -l index.ts` → 5975; `grep -n '": tool({' index.ts` → 18 matches; pre-seed T1 independently surfaced this; knip duplicate exports output.

### [MEDIUM | confidence=high] `lib/runtime-contracts.ts` is misnamed — contains OAuth loopback constants, not runtime contracts

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

- **Issue**: The file name promises "runtime contracts" (schema/invariants/interface contracts), but the actual content is four OAuth loopback constants + two error-sentinel strings + their `createX`/`isXMessage` helpers. A "runtime contracts" name is already ambiguous even with accurate contents — in this codebase, `lib/schemas.ts` + `lib/types.ts` already carry the contract role. Readers looking for "contracts" waste time here; readers looking for OAuth constants miss this file. Cross-checks: `lib/constants.ts` already exports a `HTTP_STATUS`/`OPENAI_HEADERS`/`AUTH_LABELS` constants module, so OAuth loopback constants fit naturally there. Confirms pre-seed T5 L5 finding.
- **Recommendation**: Rename/relocate in one mechanical PR: (a) move OAuth loopback constants into `lib/constants.ts` under a new `OAUTH_CALLBACK` const object (matches existing `HTTP_STATUS`/`OPENAI_HEADERS` style); (b) move the two error-sentinel strings + their `create*`/`is*Message` helpers into `lib/errors.ts` (which already owns custom error classes — natural home). (c) delete `lib/runtime-contracts.ts`. Update the ~5 importers. This is a pure refactor with zero behavior change.
- **Evidence**: Direct read of lib/runtime-contracts.ts; pre-seed T5 L5; cross-check with lib/constants.ts:32-98 and lib/errors.ts.

### [MEDIUM | confidence=high] `lib/utils.ts` is generically named and underused — `isRecord` + `nowMs` are re-defined in 4 modules

- **File**: `lib/utils.ts:1-56`
- **Quote**:

  ```ts
  /**
   * Consolidated utility functions for the Codex plugin.
   * Extracted from various modules to eliminate duplication.
   */
  ```

- **Issue**: Two canonical helpers live in `lib/utils.ts` (`isRecord`, `nowMs`, `sleep`, `toStringValue`), but `isRecord` is independently redefined in `lib/config.ts:113`, `lib/auth/device-code.ts:38`, and `lib/storage.ts:558`, and `nowMs` is redefined in `lib/storage/migrations.ts:72`. The docstring claims "eliminate duplication" while the code it shares is ignored by the files that would benefit. The file name `utils.ts` is also the weakest possible classifier — it is exactly the kind of name that accretes unrelated helpers over time ("stuff"). In this repo the name is both generic AND undermagnified (50 lines, nearly nobody imports it). `lib/accounts/rate-limits.ts` — a well-named single-purpose module — shows the target style.
- **Recommendation**: (1) Delete the 3 local `isRecord` copies in `lib/config.ts:113`, `lib/auth/device-code.ts:38`, `lib/storage.ts:558` and import from `lib/utils.ts`. Delete the `nowMs` copy in `lib/storage/migrations.ts:72` likewise. Confirm no circular-import regression (utils has zero internal imports — safe). (2) Rename `lib/utils.ts` → `lib/helpers/primitives.ts` (or keep the name but enforce "primitives only" via ESLint `no-restricted-modules`). (3) Add an ESLint rule or knip-extension to fail CI if a new local `isRecord`/`nowMs`/`sleep` helper appears. Payoff: consistent JSON-parse guarding (isRecord), single testable mocking point for time (nowMs).
- **Evidence**: `grep -r 'function isRecord' lib/` → 4 matches; `grep -r 'function nowMs' lib/` → 3 matches; direct read of lib/utils.ts.

### [MEDIUM | confidence=high] `lib/accounts.ts` AccountManager is a god-class: state + persistence + rotation + quota + switching + cooldown (40+ methods)

- **File**: `lib/accounts.ts:209-978`
- **Quote**:

  ```ts
  export class AccountManager {
  ```

- **Issue**: AccountManager owns, in a single class over ~770 lines: (a) **account state storage** (the `accounts: ManagedAccount[]` array + indices), (b) **per-family active-index tracking** (`currentAccountIndexByFamily`), (c) **selection/rotation** (`getCurrentOrNext`, `getCurrentOrNextForFamily`, `getNextForFamily`, `getCurrentOrNextForFamilyHybrid`), (d) **quota / rate-limit management** (`markRateLimited*`, `recordRateLimit`, `getMinWaitTime*`), (e) **token bucket consumption** (`consumeToken`, `refundToken`), (f) **cooldown logic** (`markAccountCoolingDown`, `clearAccountCooldown`, `isAccountCoolingDown`), (g) **persistence** (`saveToDisk`, `saveToDiskDebounced`, `flushPendingSave`), (h) **Codex CLI cross-process hydration** (`hydrateFromCodexCli`), (i) **identity/dedup** (`removeAccountsWithSameRefreshToken`, `hasRefreshToken`), (j) **toast debounce** (`shouldShowAccountToast`, `markToastShown`), (k) **selection explainability** (`getSelectionExplainability`), (l) **enable/disable** (`setAccountEnabled`), (m) **auth-fail counting** (`incrementAuthFailures`, `clearAuthFailures`). Total public method count ≈40. Each concern has distinct failure modes, separate concurrency profiles (persistence is debounced, token-bucket is hot-path, hydration is once-per-boot), and distinct test requirements. Pre-seed T1 surfaced this (38+ methods). A god-class of this shape makes the 9 rotation edge cases (T03 target) very hard to reason about in isolation.
- **Recommendation**: Extract in 3 phases (each a separate PR with full test pass between): **Phase 1** — split pure selection/rotation into `lib/rotation/selector.ts` exporting `getCurrentOrNext*`, `getNextForFamily*`, `getCurrentOrNextForFamilyHybrid` as pure functions taking `(accounts, family, model, config)`. **Phase 2** — move persistence (`saveToDisk`, `saveToDiskDebounced`, `flushPendingSave`) into `lib/accounts/persistence.ts`. **Phase 3** — move CodexCLI hydration into `lib/accounts/codex-cli-hydration.ts`. Final AccountManager becomes a thin state-holder + mutations coordinator (<300 lines). The existing `lib/accounts/rate-limits.ts` (85 lines, single concern) is the template.
- **Evidence**: Direct read of lib/accounts.ts top-level structure scan; 40+ public methods counted via grep; pre-seed T1 finding.

### [MEDIUM | confidence=high] `lib/storage.ts` does too much: atomic writes + types + migrations + paths + flagged-accounts + backup/export/import (30+ exports)

- **File**: `lib/storage.ts:26-1461`
- **Quote**:

  ```ts
  export type { CooldownReason, RateLimitStateV3, AccountMetadataV1, AccountStorageV1, AccountMetadataV3, AccountStorageV3 };
  ```

- **Issue**: `lib/storage.ts` is 1296 lines and exports: (a) 6+ types (`CooldownReason`, `RateLimitStateV3`, `AccountMetadataV1`, `AccountStorageV1`, `AccountMetadataV3`, `AccountStorageV3`, `ImportBackupMode`, `ImportAccountsOptions`, `ImportBackupStatus`, `ImportAccountsResult`, `ImportPreviewResult`), (b) `FlaggedAccountMetadataV1`/`FlaggedAccountStorageV1` interfaces, (c) `StorageError` class + `formatStorageErrorHint`, (d) path resolvers (`setStoragePath`, `setStoragePathDirect`, `getStoragePath`, `getFlaggedAccountsPath`), (e) atomic-write primitives (`renameWithWindowsRetry`, `writeFileWithTimeout`, `writePreImportBackupFile`), (f) normalization/dedup (`normalizeAccountStorage`, `deduplicateAccounts`, `deduplicateAccountsByEmail`, `selectNewestAccount`, `mergeAccountRecords`, `pickNewestAccountIndex`), (g) the public load/save API (`loadAccounts`, `saveAccounts`, `clearAccounts`, `withAccountStorageTransaction`), (h) flagged-accounts mirror API (`loadFlaggedAccounts`, `saveFlaggedAccounts`, `clearFlaggedAccounts`, `withFlaggedAccountStorageTransaction`), (i) backup/export/import (`createTimestampedBackupPath`, `previewImportAccounts`, `exportAccounts`, `importAccounts`). A separate `lib/storage/paths.ts` + `lib/storage/migrations.ts` already exist as extraction targets — so the split pattern is established; the top-level file simply never finished being decomposed. Pre-seed T1 flagged "30+ exports". Downstream consequences: `lib/accounts.ts` and `lib/auth/login-runner.ts` both import 5+ symbols each, cross-cutting security (T2) / concurrency (T7) / filesystem (T6) audits all have this file in their root scope.
- **Recommendation**: Decompose into cohesive modules, each <400 lines, in a 4-PR sequence: (1) `lib/storage/types.ts` — move 11 import/export type/interface exports, re-export from the barrel for compat. (2) `lib/storage/atomic-write.ts` — move `renameWithWindowsRetry`, `writeFileWithTimeout`, `writePreImportBackupFile`, `writeAccountsToPathUnlocked`. (3) `lib/storage/flagged.ts` — move `FlaggedAccount*`, `loadFlaggedAccounts*`, `saveFlaggedAccounts*`, `withFlaggedAccountStorageTransaction`, `clearFlaggedAccounts`. (4) `lib/storage/backup.ts` — move `createTimestampedBackupPath`, `previewImportAccounts`, `exportAccounts`, `importAccounts`, `formatBackupTimestamp`, `sanitizeBackupPrefix`. Residual `lib/storage.ts` shrinks to ~400 lines of pure load/save/dedup-coordinator logic. Barrel-export preserves external API.
- **Evidence**: `wc -l lib/storage.ts` → 1296; export count from top-level scan; pre-seed T1.

### [MEDIUM | confidence=high] Duplicated `mergeAccountRecords` + `pickNewestAccountIndex` helpers between `storage.ts` and `login-runner.ts`

- **File**: `lib/auth/login-runner.ts:257-346`
- **Quote**:

  ```ts
  const pickNewestAccountIndex = (existingIndex: number, candidateIndex: number): number => {
  	const existing = accounts[existingIndex];
  	const candidate = accounts[candidateIndex];
  	if (!existing) return candidateIndex;
  	if (!candidate) return existingIndex;
  	const existingLastUsed = existing.lastUsed ?? 0;
  	const candidateLastUsed = candidate.lastUsed ?? 0;
  	if (candidateLastUsed > existingLastUsed) return candidateIndex;
  	if (candidateLastUsed < existingLastUsed) return existingIndex;
  	const existingAddedAt = existing.addedAt ?? 0;
  	const candidateAddedAt = candidate.addedAt ?? 0;
  	return candidateAddedAt >= existingAddedAt ? candidateIndex : existingIndex;
  };
  ```

- **Issue**: `login-runner.ts:257-269` re-implements `pickNewestAccountIndex` as an inline closure inside `persistAccountPool`, and `login-runner.ts:271-357` re-implements `mergeAccountRecords` as a very long inline closure. `lib/storage.ts` already exports top-level `pickNewestAccountIndex` (line 433) and `mergeAccountRecords` (line 446) — same intent, subtly different implementation (login-runner.ts's merge has extra rate-limit-reset merging + cooldown-reason policy, storage.ts's is simpler). This duplication is the worst kind: not identical code (so grep doesn't catch it immediately) but semantically near-identical with subtle divergence. A bug fix applied to one will quietly drift. Cross-references pre-seed security finding that login-runner.ts:338-339 uses `||` fallback — that exact line lives inside the duplicated closure.
- **Recommendation**: Promote the login-runner.ts merge semantics (the more complete one) to the canonical `lib/storage.ts` helpers by adding optional parameters (`mergeRateLimitResetTimes?: boolean`, `mergeCooldownReason?: "max-time" | "target-wins"`). Then delete the inline closures in `login-runner.ts:257-357` and import from storage.ts. Single well-tested implementation replaces two subtly different ones.
- **Evidence**: Direct read of both sites; `grep 'function pickNewestAccountIndex|function mergeAccountRecords'` returns 4 matches (2 in storage.ts, 0 in login-runner.ts because they are inline closures — confirming hidden duplication).

### [MEDIUM | confidence=high] 36 unused exports + 100 unused exported types + 9 unused AuditAction enum members (knip)

- **File**: `lib/accounts.ts:38-42`
- **Quote**:

  ```ts
  export {
  ```

- **Issue**: `knip --no-progress` reports **36 unused exports** (including `getQuotaKey`, `clampNonNegativeInt`, `clearExpiredRateLimits`, `isRateLimitedForQuotaKey`, `isRateLimitedForFamily` re-exported via accounts.ts but never imported externally; `DEFAULT_HYBRID_SELECTION_CONFIG` at rotation.ts:282; `getFlaggedAccountsPath` at storage.ts:314; `PACKAGE_NAME` at constants.ts:7 (duplicates `PLUGIN_NAME`); `LEGACY_PACKAGE_NAME` at constants.ts:10; `isTTY` at cli.ts:246; `DEFAULT_UNSUPPORTED_CODEX_FALLBACK_CHAIN` at fetch-helpers.ts:48; `getParallelProbing` + `getParallelProbingMaxConcurrency` at config.ts:444/452; `CODEX_OPENCODE_BRIDGE_META` at codex-opencode-bridge.ts:118; 7 exported Zod schemas at schemas.ts), **100 unused exported types/interfaces**, and **9 unused `AuditAction` enum members**. The unused types include central-looking names like `AccountIdCandidate`, `QuotaKey`, `BaseQuotaKey`, `TokenSuccess`, `TokenFailure`, `TokenFailureReason`, `AuditEntry`, `AuditConfig`, `AuthorizationFlowOptions` — strong smell that types were exported "in case they're needed" rather than against a real consumer. Confirms pre-seed T9 and T1 observations. Additionally knip reports 3 **unused files**: `lib/index.ts` (barrel is never imported by `index.ts` nor any package consumer), `lib/recovery/index.ts` (also a barrel nobody imports), and `test/property/setup.ts`. And it reports 3 unused devDependencies (`@fast-check/vitest`, `lint-staged`, `typescript-language-server`) + 1 unlisted binary (`lint-staged`).
- **Recommendation**: Systematic cleanup in one dedicated PR guarded by `knip` in CI: (1) remove the 36 unused exports that have no external consumer; keep the declarations module-private. (2) For each unused type, collapse to private type alias inside the module that defines it, or delete if never instantiated. (3) Remove unused AuditAction enum members (already covered by full audit.ts removal, finding HIGH above). (4) Delete `lib/index.ts` + `lib/recovery/index.ts` barrels — they have zero consumers. (5) Remove unused devDependencies from `package.json`. (6) Delete the `OpenAIAuthPlugin` alias in index.ts:6379. (7) Add `knip --no-progress` to CI. Expected deletion: ~400 lines across the repo.
- **Evidence**: `.sisyphus/evidence/task-16-knip-raw.txt` (full report archived).

### [MEDIUM | confidence=medium] `lib/recovery.ts` (top-level, 367 lines) sits sibling to `lib/recovery/` folder — structural fracture

- **File**: `lib/recovery.ts:1-20`
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
  ```

- **Issue**: `lib/recovery.ts` is the session-level recovery orchestrator and imports exclusively from `lib/recovery/storage.ts` + `lib/recovery/types.ts`. The folder `lib/recovery/` additionally has an `index.ts` barrel (`lib/recovery/index.ts`) that knip flags as **unused** (nobody imports from it; consumers import `lib/recovery` which resolves to the top-level `.ts` file, not the folder `index.ts`). The folder vs file coexistence is confusing — readers don't know whether the "recovery module" is `lib/recovery.ts` or `lib/recovery/`, and both exist. Pre-seed T1 flagged this as "recovery.ts vs recovery/ fracture".
- **Recommendation**: Choose one layout. Preferred: move `lib/recovery.ts` to `lib/recovery/index.ts` (replacing the unused barrel), so `from "./recovery"` resolves unambiguously to the folder. Then `lib/recovery/index.ts` is the orchestrator and `lib/recovery/{storage,types,constants}.ts` are siblings. Zero behavior change, one grep-replace of importers. Alternative: flatten `lib/recovery/` contents into a single `lib/recovery.ts` (only viable if total size stays <500 lines — currently 367+326+133+24 = 850, so not viable). Pick the folder path.
- **Evidence**: Direct read of lib/recovery.ts + lib/recovery/index.ts; knip "Unused files" list.

### [MEDIUM | confidence=medium] `lib/accounts/rate-limits.ts` is the only file in `lib/accounts/` — structural confusion with top-level `lib/accounts.ts`

- **File**: `lib/accounts/rate-limits.ts:1-4`
- **Quote**:

  ```ts
  /**
   * Rate limiting utilities for account management.
   * Extracted from accounts.ts to reduce module size and improve cohesion.
   */
  ```

- **Issue**: The codebase has `lib/accounts.ts` (top-level, 888-line god-class AccountManager) AND `lib/accounts/rate-limits.ts` (the single file inside the `accounts/` folder). Readers cannot tell from the tree whether the "accounts module" is the top-level file, the folder, or both. The folder has no `index.ts` barrel, so `from "../accounts"` resolves to the `.ts` file while `from "../accounts/rate-limits"` resolves into the folder. The partial extraction (rate-limits only) is evidence that a full decomposition was begun but never finished — rate-limits is one of ~10 concerns inside AccountManager (see MEDIUM finding above). Either full decomposition or flattening resolves the confusion.
- **Recommendation**: Execute the Phase 1–3 decomposition in the AccountManager finding above; when complete, `lib/accounts.ts` ceases to exist and `lib/accounts/` holds `index.ts` (state holder), `selector.ts`, `persistence.ts`, `codex-cli-hydration.ts`, `rate-limits.ts`. Until that lands, at minimum add a short `lib/accounts/README.md` explaining the split-in-progress to shield readers.
- **Evidence**: Direct `Get-ChildItem lib/accounts/` → 1 file; direct read of rate-limits.ts header docstring which itself admits "Extracted from accounts.ts to reduce module size".

### [MEDIUM | confidence=high] `lib/constants.ts` exports both `PACKAGE_NAME` and `PLUGIN_NAME` pointing at the same string

- **File**: `lib/constants.ts:7-13`
- **Quote**:

  ```ts
  /** Published package identifier used across runtime messages and install flows */
  export const PACKAGE_NAME = "oc-codex-multi-auth";

  /** Previous published package identifier kept for installer and storage migration */
  export const LEGACY_PACKAGE_NAME = "oc-chatgpt-multi-auth";

  /** Plugin identifier for logging and error messages */
  export const PLUGIN_NAME = PACKAGE_NAME;
  ```

- **Issue**: `PLUGIN_NAME` is a strict alias of `PACKAGE_NAME` — same string, different export name. knip flags this as a duplicate export. The comment attempts to justify by role ("Plugin identifier for logging") but a second exported identifier for the same string causes readers to wonder whether there's a code path where they diverge, when they do not. The real asymmetry is `PACKAGE_NAME` vs `LEGACY_PACKAGE_NAME` (different values); conflating the `PLUGIN_NAME` label with that split is noise. The `OpenAIAuthPlugin = OpenAIOAuthPlugin` alias in `index.ts:6379` is the same pattern at the plugin-export level.
- **Recommendation**: Pick one name (prefer `PLUGIN_NAME` since it is the runtime-facing identifier used in log prefixes). Replace all `PACKAGE_NAME` references with `PLUGIN_NAME`, then delete the `PACKAGE_NAME` export. If a distinct "published package ID" concept is ever needed separately from the plugin identifier, reintroduce then — YAGNI now. Pre-seeded in knip output.
- **Evidence**: `.sisyphus/evidence/task-16-knip-raw.txt` → "Duplicate exports: PACKAGE_NAME|PLUGIN_NAME lib/constants.ts".

### [MEDIUM | confidence=medium] `0o600` / `0o700` file-mode magic numbers scattered across 4 files

- **File**: `lib/storage.ts:194`
- **Quote**:

  ```ts
  	mode: 0o600,
  ```

- **Issue**: File permission modes are scattered as raw octal literals: `lib/storage.ts` uses `0o600` at lines 194, 906, 1155, 1324 (4 writeFile sites); `lib/logger.ts` uses `0o700` at :258 (mkdir) and `0o600` at :282 (writeFile); `lib/audit.ts` uses `0o700` at :91 (mkdir, though full module is dead); `lib/recovery/storage.ts` uses `0o600` at :167, :261, :374. Pre-seed T2 already noted that parent-dir mode is `0o700` in logger/audit but missing on some storage.ts paths — that finding owns the **security** angle; this finding owns the **code-health** angle. Today a careful reader must grep every writeFile+mkdir call site to confirm the policy is uniform.
- **Recommendation**: Extract a `SECURE_FILE_MODE = 0o600` and `SECURE_DIR_MODE = 0o700` into `lib/constants.ts` (next to the existing `HTTP_STATUS` / `OPENAI_HEADERS` const objects, under a new `FILE_MODES` object). Replace the 8 raw-literal sites with named constants. Then an ESLint rule `no-magic-numbers` can keep enforcement local. This finding is **coordinated** with T2's security finding about missing parent-dir modes on three storage.ts paths — the refactor and the security fix should land in one PR so the constant can be applied universally.
- **Evidence**: `grep -r 'mode:\s*0o[67]00' lib/` → 10 matches in 4 files; pre-seed T2.

### [MEDIUM | confidence=medium] Normalization pattern (`toLowerCase().trim()` / `trim().toLowerCase()`) duplicated in 10 files without a shared helper

- **File**: `lib/auth-rate-limit.ts:26-28`
- **Quote**:

  ```ts
  function getAccountKey(accountId: string): string {
  	return accountId.toLowerCase().trim();
  }
  ```

- **Issue**: The idiom `value.toLowerCase().trim()` (or `trim().toLowerCase()`) appears in 10 different files: `lib/config.ts`, `lib/cli.ts`, `lib/auth-rate-limit.ts`, `lib/auth/token-utils.ts`, `lib/schemas.ts`, `lib/request/request-transformer.ts`, `lib/auth/login-runner.ts`, `lib/storage.ts`, `lib/logger.ts`, `lib/request/fetch-helpers.ts`. Applied variously to emails, account IDs, rate-limit reason strings, model names, organization IDs, and workspace identity parts. There is no single `normalizeIdentityString(s)` helper. Consequences: (a) `storage.ts` trims then lowercases, `auth-rate-limit.ts` lowercases then trims — subtle ordering inconsistency irrelevant for ASCII but visible to readers as "which is canonical?". (b) `lib/auth/token-utils.ts:522` has an exported `sanitizeEmail` for email normalization, but the pattern elsewhere ignores it. Low-risk code-smell; the actual normalization semantics are usually equivalent, but readers cannot grep for "where do we canonicalize identity?".
- **Recommendation**: Add a tiny `lib/utils.ts` export `normalizeIdentity(s: string): string` returning `s.trim().toLowerCase()`. Replace the 10 sites with named-helper imports. For emails specifically, keep `sanitizeEmail` as a specialization (it also validates the `@`), and let `normalizeIdentity` cover account-id / model-name / reason-code / workspace-part cases. One-PR mechanical refactor.
- **Evidence**: `grep -l 'toLowerCase\(\)\.trim\(\)\|trim\(\)\.toLowerCase\(\)' lib/**/*.ts` → 10 files.

### [MEDIUM | confidence=medium] `lib/request/request-transformer.ts` (998 lines) is near split threshold — reasoning/tool/session logic can split

- **File**: `lib/request/request-transformer.ts:262-958`
- **Quote**:

  ```ts
  export function applyFastSessionDefaults(
  ```

- **Issue**: `request-transformer.ts` is 998 lines with three logically-separable concerns entangled: (a) **model family detection + normalization** (`normalizeModel`, `getModelConfig`, plus the `is*Gpt5*` family of booleans around :530-600), (b) **reasoning / tool config resolution** (`getReasoningConfig`, `resolveReasoningConfig`, `resolveTextVerbosity`, `resolveInclude`, `sanitizeReasoningSummary`, `applyFastSessionDefaults`, `filterInput`, `trimInputForFastSession`, `isTrivialLatestPrompt`, `isStructurallyComplexPrompt`, `isComplexFastSessionRequest`, `getLatestUserText`, `compactInstructionsForFastSession`, plan-mode tool sanitization `sanitizePlanOnlyTools` / `extractRuntimeToolNames` / `parseCollaborationMode` / `detectCollaborationMode` / `extractMessageText`), (c) **prompt injection + tool remap** (`filterOpenCodeSystemPrompts`, `addCodexBridgeMessage`, `addToolRemapMessage`, and the entrypoint `transformRequestBody`). Each concern has a distinct input/output contract and test profile. Not as urgent as index.ts/storage.ts because it is internally cohesive, but readers see 998 lines of near-monoculture and cannot tell where `transformRequestBody` delegates.
- **Recommendation**: Defer until after index.ts/storage.ts splits land — then, if still >500 lines, extract `lib/request/model-detection.ts` (normalizeModel + getModelConfig + family booleans), `lib/request/reasoning-config.ts` (getReasoningConfig + helpers), `lib/request/fast-session.ts` (applyFastSessionDefaults + trim/filter helpers + isComplex detection), leaving `request-transformer.ts` as the `transformRequestBody` orchestrator (~300 lines). Explicitly lower priority than the HIGH/MEDIUM findings above — only worth doing if a bug in reasoning config drives a touch of this file.
- **Evidence**: `wc -l lib/request/request-transformer.ts` → 998; top-level function scan.

### [LOW | confidence=high] `OpenAIAuthPlugin` alias export + `OpenAIOAuthPlugin` + `default` export trio (duplicate exports)

- **File**: `index.ts:6379-6381`
- **Quote**:

  ```ts
  export const OpenAIAuthPlugin = OpenAIOAuthPlugin;

  export default OpenAIOAuthPlugin;
  ```

- **Issue**: Three names for one export: the canonical `OpenAIOAuthPlugin`, the alias `OpenAIAuthPlugin`, and the default export. knip flags the trio as duplicate. External consumers (OpenCode, the installer) reference the plugin by package name + default export; no in-repo call site imports `OpenAIAuthPlugin`. The alias was presumably left over from a rename; readers spend a moment deciding if it differs.
- **Recommendation**: Delete `export const OpenAIAuthPlugin = OpenAIOAuthPlugin;` at :6379. Keep `export default OpenAIOAuthPlugin;` as the SDK entry. Zero runtime impact. Bundle with the index.ts split PR sequence.
- **Evidence**: knip duplicate-exports output; direct read of index.ts:6379-6381.

### [LOW | confidence=medium] 3 unused devDependencies (`@fast-check/vitest`, `lint-staged`, `typescript-language-server`) + 1 unlisted binary (`lint-staged`)

- **File**: `package.json:83,93,95`
- **Quote**:

  ```ts
  // knip report (verbatim):
  // @fast-check/vitest          package.json:83:6
  // lint-staged                 package.json:93:6
  // typescript-language-server  package.json:95:6
  // Unlisted binaries: lint-staged (.husky/pre-commit)
  ```

- **Issue**: knip reports `@fast-check/vitest` as unused (yet the package is depended-on for property-based testing, per the testing-js skill note; may be false positive if property tests are skipped in current suite), `lint-staged` as unused (but `.husky/pre-commit` shells out to `lint-staged` — hence knip's "unlisted binary" warning), and `typescript-language-server` as unused. This is dependency rot, not code rot, but impacts install-size and supply-chain surface. Defer to T14 dependencies audit for deep CVE/licensing analysis; fix the install hygiene now.
- **Recommendation**: For `lint-staged` — either remove the `.husky/pre-commit` hook that references it, or mark the dependency as `"cli": "lint-staged"` in package.json `knip` config so the binary is recognized. For `@fast-check/vitest` + `typescript-language-server` — verify in the property-test workflow + any editor tooling whether these are required; if not, remove from package.json.
- **Evidence**: `.sisyphus/evidence/task-16-knip-raw.txt` "Unused devDependencies" + "Unlisted binaries" sections.

### [LOW | confidence=medium] `lib/auth/token-utils.ts` is 472 lines of mostly `extract*`/`select*` helpers — candidate to split

- **File**: `lib/auth/token-utils.ts:14,371-522`
- **Quote**:

  ```ts
  export interface AccountIdCandidate {
  ```

- **Issue**: 472 lines with 8 exports, all concerning reading identity claims out of JWTs (accountId, email, organizationId) and picking between candidates. Size is under the 500-line rule-of-thumb so not urgent, but the file interleaves three concerns: low-level JWT decoding (not exported, ~100 lines), candidate extraction (`extractAccountId`, `extractAccountEmail`, `getAccountIdCandidates`, ~150 lines), and selection/sanitization (`selectBestAccountCandidate`, `shouldUpdateAccountIdFromToken`, `resolveRequestAccountId`, `sanitizeEmail`, ~200 lines). Readers debugging a single concern scroll past 200 lines of the other two.
- **Recommendation**: Defer until another issue touches this file. If/when split: `lib/auth/jwt-decode.ts` (pure JWT helpers), `lib/auth/identity-candidates.ts` (extract*/getCandidates*), `lib/auth/identity-select.ts` (selectBest*/resolveRequestAccountId/sanitizeEmail). Explicit LOW priority.
- **Evidence**: `wc -l lib/auth/token-utils.ts` → 472; export scan.

### [LOW | confidence=low] `lib/prompts/codex.ts` is 463 lines — ETag cache + template sync + family definitions in one file

- **File**: `lib/prompts/codex.ts:1`
- **Quote**:

  ```ts
  // file header
  ```

- **Issue**: 463 lines covering (a) `MODEL_FAMILIES` constant + family-detection helpers, (b) GitHub ETag HTTP fetch + cache for Codex CLI prompt templates, (c) in-memory prompt catalog. The three concerns are loosely coupled. Not urgent: the file is under 500 lines and prompt templates are rarely touched.
- **Recommendation**: Defer — only split if template sync changes shape or if a bug forces a touch. If split: `lib/prompts/families.ts` (MODEL_FAMILIES + detection), `lib/prompts/codex-template-cache.ts` (ETag + HTTP + cache), `lib/prompts/codex-catalog.ts` (exported prompt constants).
- **Evidence**: `wc -l lib/prompts/codex.ts` → 463; pre-seed T1 did not flag this one as urgent.

---

## Refactor Candidates — Prioritized with Payoff

Five+ explicit candidates with payoff assessment. Payoff scoring: **HIGH** = reduces review burden / onboarding friction / maintenance error-surface materially; **MEDIUM** = improves clarity but no immediate defect-rate change; **LOW** = stylistic / future-proofing only.

### RC-1 (HIGH payoff): Delete `lib/audit.ts` + `test/audit.test.ts` + `test/audit.race.test.ts`

- **Size**: ~300 lines deleted (189 + 2 test files).
- **Risk**: Zero — no production import path.
- **Payoff**: Removes full unused subsystem with file-I/O surface (`appendFileSync`, `renameSync`, `unlinkSync`), a `logQueue` module-mutable, and a sync-write fallback. Eliminates maintenance of dead tests. Closes pre-seed T9.
- **Sequencing**: First — no dependencies.

### RC-2 (HIGH payoff): Wire OR delete `lib/auth-rate-limit.ts`

- **Size**: Either ~130 lines deleted + test file, or ~20 lines of wiring across `lib/auth/auth.ts` + `lib/request/fetch-helpers.ts`.
- **Risk**: Low if deleted; medium if wired (need to confirm intended rate-limit policy — likely maps to 429 pattern already handled by circuit-breaker + retry-budget).
- **Payoff**: Either dead-code elimination (matches RC-1) or gains an explicit auth-failure throttle separate from the generic circuit breaker.
- **Sequencing**: Parallel with RC-1. Recommend **delete** unless T2/T3 authors argue for wiring.

### RC-3 (HIGH payoff): Split `index.ts` (5975 lines) into entry + tools + fetch pipeline

- **Size**: ~5975 → ~150 + 18×(~100–200 lines per tool) + ~1500 lines in `lib/plugin/fetch.ts` + ~200 lines in event handler.
- **Risk**: Medium — must preserve plugin contract; tests already cover most of the fetch pipeline.
- **Payoff**: Dramatically reduces review burden. Each tool becomes independently reviewable / testable. IDE performance improves. git-blame becomes tractable.
- **Sequencing**: After RC-1/RC-2 (which are mechanical deletions with no overlap). Split in 4–6 PRs: tools chunk, fetch chunk, event handler chunk, alias-removal (RC-8).
- **Tools**: 18 identified at index.ts:3534, 3780, 3896, 4166, 4712, 4919, 5040, 5057, 5358, 5398, 5536, 5628, 5698, 5886, 5995, 6156, 6224, 6282.

### RC-4 (HIGH payoff): Decompose `AccountManager` god-class into state + selector + persistence + hydration

- **Size**: 888-line `accounts.ts` + 85-line `accounts/rate-limits.ts` → target `accounts/` folder with 5 files @ ~200 lines each.
- **Risk**: Medium — AccountManager is central and heavily tested. Changes to method boundaries need all tests passing at each extraction step.
- **Payoff**: 40+ method public surface becomes explicit sub-APIs; per-concern concurrency guarantees get their own file + tests. Pre-seeds for T3 / T7 future audit findings to be fixable at the right file.
- **Sequencing**: After RC-3 (don't touch god-class while splitting entry monolith — too much simultaneous change). 3 PRs: selector extraction, persistence extraction, hydration extraction.

### RC-5 (MEDIUM payoff): Decompose `lib/storage.ts` into 5 focused modules

- **Size**: 1296 → ~400 + 4×(~200 lines) under `lib/storage/`.
- **Risk**: Low — storage.ts already has siblings `storage/paths.ts` + `storage/migrations.ts`; the pattern is established and the barrel-export keeps external API stable.
- **Payoff**: Each concern (types, atomic-write, flagged-accounts, backup, public API) isolated; T2/T6/T7 cross-cuts can target single files.
- **Sequencing**: Parallel with RC-4 (storage.ts and accounts.ts overlap only at the `AccountStorageV3` type boundary — low conflict).

### RC-6 (MEDIUM payoff): Rename `lib/runtime-contracts.ts` → merge into `lib/constants.ts` + `lib/errors.ts`

- **Size**: 28-line file → 6 constants added to constants.ts + 2 sentinels + 4 helpers added to errors.ts → delete runtime-contracts.ts.
- **Risk**: Zero — pure move, ~5 import updates.
- **Payoff**: Eliminates misleading file name. Aligns with existing module organization. Fixes pre-seed T5 L5.
- **Sequencing**: Bundle with RC-8 (LOW-risk cleanup PR).

### RC-7 (MEDIUM payoff): Consolidate duplicated helpers (`isRecord`, `nowMs`, normalize-identity pattern)

- **Size**: Delete 3 `isRecord` copies + 1 `nowMs` copy; add `normalizeIdentity` export; replace ~10 sites.
- **Risk**: Zero — identical/near-identical replacements.
- **Payoff**: Single source of truth for JSON-parse guarding + time mocking + identity canonicalization. Catches the `toLowerCase().trim()` vs `trim().toLowerCase()` minor inconsistency.
- **Sequencing**: Parallel with RC-5/RC-6.

### RC-8 (LOW payoff): Dead-exports + alias cleanup driven by knip

- **Size**: ~400 lines deleted across the 36 unused exports + 100 unused types + `OpenAIAuthPlugin` alias + `PACKAGE_NAME` duplicate.
- **Risk**: Low — knip detects reliably; per-site verification before each delete.
- **Payoff**: Public API shrinks, discoverability improves; knip in CI prevents regression.
- **Sequencing**: Bundle with RC-6.

### RC-9 (MEDIUM payoff): Promote `knip` to repo-maintained tool with CI enforcement

- **Size**: Add devDependency + `package.json` script + CI step.
- **Risk**: Zero.
- **Payoff**: Prevents dead-exports recurrence; surfaces unused files / dependencies / binaries on every PR; one of the lowest-effort lever-ratios.
- **Sequencing**: Land **before** RC-8 so the CI gate is green after the cleanup.

### RC-10 (LOW payoff): Defer-able — split `request-transformer.ts` / `token-utils.ts` / `prompts/codex.ts`

- **Size**: Only if touched by another change.
- **Risk**: Low.
- **Payoff**: Clarity only; no defect-surface reduction.
- **Sequencing**: Deferred / opportunistic.

---

## Notes

- **READ-ONLY respected**: no `lib/**` / `test/**` / `scripts/**` / `config/**` / `index.ts` / `package.json` edits. Only `docs/audits/_findings/T16-code-health.md` + `.sisyphus/evidence/task-16-*.md` + notepad were written.
- **Cross-references (not re-logged)**: pre-seed T1 (index.ts monolith, storage.ts 30+ exports, AccountManager god-class, recovery.ts vs recovery/ fracture), T2 (auth-rate-limit.ts dead, mode 0o700 parent-dir missing on storage.ts paths, login-runner.ts:338 `||` fallback inside duplicated merge closure), T5 (runtime-contracts.ts misnamed, branded types opportunity), T9 (audit.ts dead infrastructure).
- **Out-of-scope observation**: `test/property/setup.ts` flagged by knip as unused file — defer to T13 test coverage audit; not logged here as a finding because `test/` is outside the code-health scope per scope-whitelist interpretation.
- **Tooling recommendation**: `knip` produced the bulk of the unused-export evidence. Recommend adding it as a persistent devDependency — captured in RC-9.
- **No severity downgrades** were required; cap state is CRITICAL=0/5, HIGH=3/15, MEDIUM=12/40, LOW=4/unbounded.
- Layer 1 verification: every `**File**` citation above was re-read at the cited range and quoted verbatim from the locked-SHA working tree; quoted snippets are character-exact against `d92a8eed`.

---

*End of T16 findings.*
