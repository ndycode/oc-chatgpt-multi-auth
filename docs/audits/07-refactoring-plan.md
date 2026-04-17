> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# 07 — Refactoring Plan

**Scope**: structural refactors distilled from T01 architecture boundaries and T16 code-health ledger entries RC-1..RC-10. These are **not bug fixes** — they are shape changes that unblock safer bug fixes and reduce the blast radius of the findings catalogued in §03–§06.

**How to use this file**: each refactor has a title, a "why now", the files in scope, the current problem, the target pattern, migration risk, implementation order within the refactor, and an estimated payoff tag. Pair this with §13 phased roadmap for calendar sequencing.

---

## RC-1 — Extract `index.ts` into `lib/tools/*` + `lib/runtime.ts`

- **Why now**: `index.ts` is 5975 lines (ledger id `1`, `304`). Every new tool or fetch-pipeline tweak touches it, and code review rejects diffs >500 lines on principle. Without this split, every other refactor below collides with it. See [§04-high-priority.md](04-high-priority.md).
- **Area/files**: `index.ts:250-5975` (source), `lib/` (destination).
- **Current problem**: 18 inline `codex-*` tool handlers + 7-step fetch pipeline + runtime-metrics renderer + beginner UX + OAuth menu glue + event handler, all sharing a single closure over >30 private helpers.
- **Target pattern**:
  - `lib/tools/accounts.ts` — `codex-list`, `codex-switch`, `codex-label`, `codex-tag`, `codex-note`, `codex-remove`.
  - `lib/tools/diagnostics.ts` — `codex-status`, `codex-limits`, `codex-metrics`, `codex-health`, `codex-doctor`, `codex-next`, `codex-dashboard`.
  - `lib/tools/backup.ts` — `codex-export`, `codex-import`, `codex-refresh`.
  - `lib/tools/onboarding.ts` — `codex-help`, `codex-setup`.
  - `lib/runtime.ts` — fetch pipeline + event handler.
  - `index.ts` ≤ 1500 lines, pure orchestration.
- **Migration risk**: **medium**. Closure dependencies (`cachedAccountManager`, `client`, `logger`) must be threaded as arguments; single-file diff is large but mechanical. Existing tests hit tool surfaces and continue to work.
- **Implementation order**: (1) lift pure helpers (renderers, formatters) first, (2) extract diagnostics tools (lowest coupling), (3) extract accounts tools, (4) extract backup + onboarding, (5) extract fetch pipeline into `lib/runtime.ts` last.
- **Payoff**: **Large** — unblocks RC-2/RC-3; every future tool addition drops from "touch god file" to "add one file".

---

## RC-2 — Split `lib/storage.ts` into `lib/storage/{atomic,accounts,flagged,import-export,normalize}.ts`

- **Why now**: `storage.ts` is 1296 lines with ~30 exports spanning six responsibilities (ledger ids `2`, `308`). The silent-V4-overwrite HIGH (`200`) and the V2-migrator gap HIGH (`201`) both live here; splitting first makes those fixes atomic and testable.
- **Area/files**: `lib/storage.ts` (1461 lines including imports/types).
- **Current problem**: atomic-write + mutex, flagged-account store, import/export/backup, workspace identity, path routing, and schema normalization all mix in one file. Existing `lib/storage/paths.ts` + `lib/storage/migrations.ts` show the desired slicing is partially in motion.
- **Target pattern**:
  - `lib/storage/atomic.ts` — `withAccountStorageTransaction`, atomic writer, mutex.
  - `lib/storage/accounts.ts` — `loadAccounts`, `saveAccounts`, `clearAccounts`.
  - `lib/storage/flagged.ts` — flagged-account persistence.
  - `lib/storage/import-export.ts` — `importAccounts`, `exportAccounts`, `previewImportAccounts`, `createTimestampedBackupPath`.
  - `lib/storage/normalize.ts` — `normalizeAccountStorage`, `deduplicateAccounts*`.
  - `lib/storage/index.ts` — façade preserving the public surface.
  - `StorageError` moves to `lib/errors.ts`.
- **Migration risk**: **medium**. ~30 import sites need path updates; keep the re-export shim in `lib/storage/index.ts` for one release to avoid a flag-day.
- **Implementation order**: paths → normalize → flagged → accounts → atomic → import-export, each in a discrete commit with its own test file promotion.
- **Payoff**: **Large** — every storage-related ledger finding (28+ items) gets a focused review surface; unblocks RC-4 error-hierarchy consolidation.

---

## RC-3 — Unify error handling on typed hierarchy (`lib/errors.ts`)

- **Why now**: `lib/errors.ts` defines `CodexApiError`, `CodexAuthError`, `CodexNetworkError`, `StorageError`, `CircuitOpenError` + an `ErrorCode` enum. Almost nothing throws them (HIGH ledger id `173`). Until this is fixed, error routing, user messaging, and retry policy keep diverging across call sites.
- **Area/files**: `lib/request/fetch-helpers.ts`, `lib/request/response-handler.ts`, `lib/auth/auth.ts`, `lib/recovery.ts`, `lib/storage.ts`.
- **Current problem**: ~35 `throw new Error(...)` sites in production code; typed classes are exported, tested in isolation, but unused.
- **Target pattern**:
  - Port each throw site to the typed class with `{ cause, code, context }`.
  - Add ESLint rule `no-plain-error-throw` with `allow: ['test/**', 'scripts/**']`.
  - Add `isCodexError(e): e is CodexError` helper and use it in the 5 top-level catches.
- **Migration risk**: **low**. Mechanical; tests assert on messages, not classes, so behaviour is preserved.
- **Implementation order**: (1) extend `lib/errors.ts` with missing codes from T10, (2) port fetch-helpers + response-handler (highest-traffic), (3) port auth/login-runner, (4) port storage + recovery, (5) enable ESLint rule.
- **Payoff**: **Medium** — error-first logging (RC-7 adjacent) and circuit-breaker wiring (RC-8) become straightforward.

---

## RC-4 — Consolidate `lib/recovery.ts` vs `lib/recovery/`

- **Why now**: Recovery is split between a 367-line top-level file and a `lib/recovery/` directory (ledger id `5`, `311`). The boundary is non-obvious and auditors repeatedly mis-routed finding blame.
- **Area/files**: `lib/recovery.ts`, `lib/recovery/{index,storage,types,constants}.ts`.
- **Current problem**: Thinking-part helpers, session-resume, and toast orchestration sit at the top level; storage + types sit in the subfolder. Imports cross the boundary both ways.
- **Target pattern**: Move all recovery code under `lib/recovery/`; promote `lib/recovery/index.ts` to the façade. `lib/recovery.ts` becomes a deprecation re-export for one release, then is deleted.
- **Migration risk**: **low**. ~12 imports, all internal.
- **Implementation order**: (1) split `lib/recovery.ts` into `lib/recovery/resume.ts` + `lib/recovery/thinking.ts` + `lib/recovery/toast.ts`, (2) update imports, (3) delete top-level file in the next minor.
- **Payoff**: **Small-to-medium** — cognitive load drop; opens the path for RC-6 rename.

---

## RC-5 — Retire dead code (`lib/audit.ts`, `lib/auth-rate-limit.ts`) or wire them in

- **Why now**: Both modules are 100% dead production code with live tests (HIGH ledger ids `302`, `303`). They mislead reviewers and eat CI time.
- **Area/files**: `lib/audit.ts`, `lib/auth-rate-limit.ts`, associated test files.
- **Target pattern** — two options, ship only one:
  - **Option A (wire in)**: invoke `recordAuditEvent` in accounts mutations + OAuth success; wire `auth-rate-limit` into `lib/auth/server.ts` at the `/auth/callback` handler. Ship as one feature PR.
  - **Option B (delete)**: remove both modules + tests; add a CHANGELOG entry explaining the rollback. Simpler; preferred unless there is user demand for the audit log.
- **Migration risk**: **low** either way.
- **Implementation order**: decide via a single RFC in `docs/rfc/audit-log.md`; then execute.
- **Payoff**: **Small** — less rot, fewer surprises in reviews, honest dependency graph.

---

## RC-6 — Rename `lib/runtime-contracts.ts` and `lib/utils.ts`

- **Why now**: Both files violate their advertised purpose (ledger ids `4`, `94`, `305`, `306`). `runtime-contracts.ts` is OAuth constants. `lib/utils.ts` is 56 lines of `isRecord` + `nowMs` duplicated in four modules.
- **Area/files**: `lib/runtime-contracts.ts` → `lib/auth/constants.ts`. `lib/utils.ts` → absorb its helpers and delete.
- **Migration risk**: **low**.
- **Payoff**: **Small** — honest module names, fewer duplicated utilities.

---

## RC-7 — Extract `AccountManager` god-class into state + policy + persistence

- **Why now**: `lib/accounts.ts` hosts a 40-method god-class (ledger id `6`, `307`). Every rotation finding (T03 + T07) anchors here.
- **Area/files**: `lib/accounts.ts:209-1010` (AccountManager class).
- **Current problem**: State holders + rotation policy + quota bookkeeping + cooldown state + persistence debounce + CLI-bridge adapters all share one class.
- **Target pattern**:
  - `lib/accounts/state.ts` — `AccountState` value object.
  - `lib/accounts/policy.ts` — hybrid scoring, selection (delegates to `rotation.ts`).
  - `lib/accounts/persistence.ts` — debounced save, flush-on-shutdown, `authFailures` per-refresh-token map with per-token promise chain (fixes CRITICAL `47`).
  - `lib/accounts/bridge.ts` — Codex-CLI cross-process hydration.
  - `lib/accounts.ts` — thin façade combining them.
- **Migration risk**: **medium-high**. Public surface is used by tools; migrate in parallel via a façade.
- **Implementation order**: (1) extract persistence (fixes CRITICAL in passing), (2) extract state, (3) extract policy, (4) extract bridge, (5) collapse façade.
- **Payoff**: **Large** — dominant T03/T07 findings gain test-isolation.

---

## RC-8 — Wire circuit breaker into the fetch pipeline

- **Why now**: `CircuitBreaker` exists but never gates requests (ledger `174`, `199`). It is failure-suppression theatre today.
- **Area/files**: `lib/circuit-breaker.ts`, `lib/request/fetch-helpers.ts`, `lib/runtime.ts` (post RC-1).
- **Target pattern**: In the pre-request hook, call `canExecute(accountKey)`; on `false`, reject with `CircuitOpenError` and force rotation to the next candidate. On `recordSuccess`/`recordFailure`, feed the rotation cooldown timer.
- **Migration risk**: **low-to-medium**. Test coverage is in place for the breaker; integration tests need chaos scenarios.
- **Payoff**: **Medium** — closes a credibility gap.

---

## RC-9 — Configuration validation at process boundary

- **Why now**: `loadPluginConfig` spreads user config unvalidated (`83`, `204`). Imported-JSON findings (`81`), JWT parsing (`82`), and the Codex-CLI bridge (`15`) all share the "accept unknown, cast to type" antipattern.
- **Area/files**: `lib/config.ts`, `lib/storage.ts`, `lib/auth/auth.ts`, `lib/accounts.ts`.
- **Target pattern**: Every process-boundary JSON read goes through `parseValidated<T>(schema, raw, source)` that throws a descriptive `ValidationError`. Document "trust boundaries = Zod boundaries" in `AGENTS.md`.
- **Migration risk**: **low**. Schemas already exist in `lib/schemas.ts`.
- **Payoff**: **Medium** — collapses 5 type-safety findings into a single contract.

---

## RC-10 — Flush-on-shutdown for debounced saves

- **Why now**: Shutdown race (`95`, `130`) is the common denominator for every "lost the last rotate" user report — intersects with the CRITICAL race via shared state.
- **Area/files**: `lib/shutdown.ts`, `lib/accounts.ts`, `lib/proactive-refresh.ts`.
- **Target pattern**: Add `flushPendingSave(timeout=1500ms)` to `AccountManager`; register it in `shutdown.runCleanup` before exit. Log failure via `logError` with event `shutdown.flush-failed`.
- **Migration risk**: **low**.
- **Payoff**: **Medium** — pairs with RC-7; closes a recurring user-visible defect class.

---

## Summary table

| Refactor | Unblocks | Ledger anchors | Risk | Effort |
|---|---|---|---|---|
| RC-1 `index.ts` split | RC-3, RC-5, RC-8 | `1`, `304` | medium | Large |
| RC-2 `storage.ts` split | RC-3, RC-9 | `2`, `200`, `201`, `308` | medium | Large |
| RC-3 typed error hierarchy | RC-7, RC-8 | `173`, `179`, `186`, `199` | low | Medium |
| RC-4 recovery consolidation | fewer mis-routed reviews | `5`, `311` | low | Short |
| RC-5 dead-code decision | honest CI | `302`, `303` | low | Short |
| RC-6 rename `runtime-contracts`/`utils` | clarity | `4`, `305`, `306` | low | Quick |
| RC-7 `AccountManager` split | fixes CRITICAL `47` | `6`, `307`, `47` | medium-high | Large |
| RC-8 wire circuit breaker | reliability | `174`, `199`, `52` | low-medium | Medium |
| RC-9 config validation boundary | schema integrity | `83`, `81`, `82`, `15`, `204` | low | Short |
| RC-10 flush-on-shutdown | paired with RC-7 | `95`, `130`, `120` | low | Short |

---

## Sequencing guidance

1. **Safety first** — RC-10 + the targeted CRITICAL fix ship before any structural refactor.
2. **Split files** — RC-1 and RC-2 in parallel; they do not overlap.
3. **Types + errors** — RC-3 and RC-9 once files are split.
4. **Rotation** — RC-7 lands after RC-3.
5. **Wiring** — RC-8 lands last; depends on RC-3 error types and RC-7 seams.
6. RC-4, RC-5, RC-6 are "opportunistic cleanup" — slot between the above as time permits.

For calendar sequencing per phase, see [§13-phased-roadmap.md](13-phased-roadmap.md).
