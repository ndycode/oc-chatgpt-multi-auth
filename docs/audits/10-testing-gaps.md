> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# 10 — Testing Gaps

**Scope**: derived from T13 (test-coverage) findings — 29 ledger entries including 4 HIGH (1 surviving after cap). Complements [§04-high-priority.md](04-high-priority.md), [§09-security-trust.md](09-security-trust.md), and [§12-quick-wins.md](12-quick-wins.md).

---

## Well-covered

- **OAuth handshake happy path** — `test/auth.test.ts`, `test/auth-browser.test.ts`, `test/auth-login-runner.test.ts`. Branching for `server._lastCode` single-slot is partially covered.
- **Account storage V1/V3 migration** — `test/storage.test.ts`, `test/storage-async.test.ts`.
- **Hybrid rotation selection** — `test/rotation.test.ts` covers scoring, token-bucket math, cooldown entry/exit for the enabled path.
- **SSE happy-path parsing** — `test/response-handler.test.ts` exercises typical events.
- **Installer template merge (happy path)** — `test/install-core.test.ts`.
- **Logger TOKEN_PATTERNS for `sk-*` family** — `test/logger.test.ts`.

Overall: the 80% coverage-threshold (`vitest.config.ts:18-28`, LOW `267`) is met by line count but masks the gaps below.

---

## Under-tested

### Race-window coverage

- **500 ms `saveToDiskDebounced` + process exit** — no test asserts that a pending debounced save is flushed on SIGINT/SIGTERM (ledger `254` pre-verification). Intersects CRITICAL `47` + HIGH `121`. See [§07-refactoring-plan.md#rc-10](07-refactoring-plan.md).
- **`incrementAuthFailures` cross-variant race** — no test; this is the test gap that enables the CRITICAL finding to slip through review.
- **`_lastCode` concurrent-login collision** — ledger HIGH `123` (pre-verification) and T13 `266` — no test simulates two overlapping logins.
- **Refresh-queue stale-eviction race** — ledger `124` — "evicted entry still resolves later" has no property test.

### Chaos / fault injection

- **`chaos/fault-injection.test.ts` performs no fault injection** (HIGH `248`). File does not exercise any probabilistic rejection, partial-write, or clock-drift scenario.
- **Recovery crash-mid-write** — ledger `102` (pre-verification) + `257`. No test simulates a crash between `writeFileSync` and rename in `lib/recovery/storage.ts`.
- **Circuit-breaker half-open eviction** — ledger `126` — no test confirms failure history is preserved across eviction during half-open.

### Contract tests

- **No external-API shape pinning** — T13 HIGH `247` (pre-verification). The Codex response envelope, OAuth token-endpoint payload, and ChatGPT SSE shape have no snapshot/contract guard. Any upstream change lands as a runtime surprise.
- **JWT payload with missing or wrong-type fields** — ledger `270`. No test asserts we reject malformed tokens rather than inventing identity.
- **V2 / V4 storage formats** — ledger `253`. No migrator test covers them.

### Property-based

- **Account state machine invariants** — ledger `252`. Missing properties include: "rotation never picks a disabled account", "cursor is always within `[0, count)`", "cooldown accounts are never selected while `coolingDownUntil > now`".
- **Rate-limit quota-key casing invariants** — no test for the normalized-key contract in `lib/accounts/rate-limits.ts` (ledger `246`).

### Environment / runtime

- **Git worktree project-root detection** — ledger `258`. The Windows/worktree case (`.git` as file, not dir) is untested.
- **Byte-exact refresh-token compare** — ledger `259`. Whitespace-drift survivability is untested.
- **`recovery/constants.ts` import-time path cache** — ledger `112`. Changing `XDG_DATA_HOME` mid-test has no effect; test isolation weakness.

### SSE / streaming

- **Chunk-boundary partial SSE events** — ledger `67` pre-verification + `255`. The trailing partial-event drop has no test.
- **`response.incomplete` with null response body** — ledger `263`.

### Fixtures

- **Every fixture is inlined** — ledger `251`. Production shapes drift invisibly between tests; promote to `test/fixtures/*.json` with a single-source-of-truth lint rule.
- **Coverage threshold is aggregate only** — `vitest.config.ts:18-28` (LOW `267`). No per-file floor; a single well-tested helper can mask a 0%-covered critical module.

---

## Exact test cases to add (priority-ordered)

1. **race: `incrementAuthFailures` cross-variant increment** — use `vi.useFakeTimers` + two promise races; assert counter reflects both increments. Pairs with the CRITICAL fix.
2. **race: `saveToDiskDebounced` flush on SIGINT** — spawn a child process, trigger a rotation, send `SIGINT` within 200 ms, verify disk state on re-read.
3. **chaos: recovery crash-mid-write** — mock `fs.renameSync` to throw after the write; verify `readParts` neither corrupts nor silently drops.
4. **contract: Codex response envelope snapshot** — record-and-replay against a canonical payload; guard with a schema.
5. **contract: V2 storage file detection** — produce a V2 fixture; assert loader either migrates or throws `StorageError`.
6. **property: rotation never selects disabled account** — fast-check generator across 1k runs.
7. **property: hybrid selection respects cooldown** — fast-check.
8. **unit: `lib/accounts/rate-limits.ts` state transitions** — new file, 100% coverage.
9. **unit: `NO_COLOR` support** — regression pin the 10-line patch.
10. **unit: `TOKEN_PATTERNS` masks OpenAI opaque refresh format** — ledger `271`.

---

## Best sequence

1. Land #1 + #2 with the CRITICAL hotfix (§03) — these are the forcing functions that verify the fix works.
2. Land #6, #7 as part of RC-7 policy extraction; they double as acceptance tests.
3. Land #4, #5 as part of RC-2 storage split.
4. Land #3, #8, #10 as standalone cleanup PRs before RC-8 circuit-breaker wiring.
5. Land #9 as a Quick Win alongside the F2 feature.

---

## Coverage-threshold upgrade

- Switch `vitest.config.ts` from aggregate 80% to per-file 70% minimum with explicit `except:` for generated files (ledger `267`). A per-file floor surfaces the exact modules (e.g., `lib/accounts/rate-limits.ts`) that hide behind repo-wide numbers.

See also: [§13-phased-roadmap.md#phase-3](13-phased-roadmap.md) for calendar alignment.
