---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T13-test-coverage
agent: opencode-t13
date: 2026-04-17T00:00:00Z
scope-files:
  - vitest.config.ts
  - test/AGENTS.md
  - test/README.md
  - test/fixtures/v3-storage.json
  - test/chaos/fault-injection.test.ts
  - test/property/helpers.ts
  - test/property/rotation.property.test.ts
  - test/property/setup.test.ts
  - test/property/setup.ts
  - test/property/transformer.property.test.ts
  - test/accounts.test.ts
  - test/audit.race.test.ts
  - test/audit.test.ts
  - test/auth.test.ts
  - test/auth-menu.test.ts
  - test/auth-rate-limit.test.ts
  - test/auto-update-checker.test.ts
  - test/beginner-ui.test.ts
  - test/browser.test.ts
  - test/circuit-breaker.test.ts
  - test/cli.test.ts
  - test/codex.test.ts
  - test/codex-prompts.test.ts
  - test/config.test.ts
  - test/context-overflow.test.ts
  - test/copy-oauth-success.test.ts
  - test/device-code.test.ts
  - test/doc-parity.test.ts
  - test/edge-cases.test.ts
  - test/errors.test.ts
  - test/fetch-helpers.test.ts
  - test/gpt54-models.test.ts
  - test/health.test.ts
  - test/helper-utils.test.ts
  - test/index.test.ts
  - test/index-retry.test.ts
  - test/input-utils.test.ts
  - test/install-oc-codex-multi-auth.test.ts
  - test/logger.test.ts
  - test/login-runner.test.ts
  - test/model-map.test.ts
  - test/oauth-server.integration.test.ts
  - test/opencode-codex.test.ts
  - test/parallel-probe.test.ts
  - test/paths.test.ts
  - test/plugin-config.test.ts
  - test/proactive-refresh.test.ts
  - test/rate-limit-backoff.test.ts
  - test/recovery.test.ts
  - test/recovery-constants.test.ts
  - test/recovery-storage.test.ts
  - test/refresh-queue.test.ts
  - test/request-transformer.test.ts
  - test/response-handler.test.ts
  - test/retry-budget.test.ts
  - test/rotation.test.ts
  - test/rotation-integration.test.ts
  - test/runtime-contracts.test.ts
  - test/schemas.test.ts
  - test/server.unit.test.ts
  - test/shutdown.test.ts
  - test/storage.test.ts
  - test/storage-async.test.ts
  - test/table-formatter.test.ts
  - test/token-utils.test.ts
  - test/tool-utils.test.ts
  - test/ui-format.test.ts
  - test/ui-runtime.test.ts
  - test/ui-theme.test.ts
  - test/utils.test.ts
  - lib/accounts.ts
  - lib/accounts/rate-limits.ts
  - lib/audit.ts
  - lib/auth/auth.ts
  - lib/auth/browser.ts
  - lib/auth/device-code.ts
  - lib/auth/login-runner.ts
  - lib/auth/server.ts
  - lib/auth/token-utils.ts
  - lib/auth-rate-limit.ts
  - lib/auto-update-checker.ts
  - lib/circuit-breaker.ts
  - lib/cli.ts
  - lib/config.ts
  - lib/constants.ts
  - lib/context-overflow.ts
  - lib/errors.ts
  - lib/health.ts
  - lib/index.ts
  - lib/logger.ts
  - lib/oauth-success.ts
  - lib/parallel-probe.ts
  - lib/proactive-refresh.ts
  - lib/prompts/codex.ts
  - lib/prompts/codex-opencode-bridge.ts
  - lib/prompts/opencode-codex.ts
  - lib/recovery.ts
  - lib/recovery/constants.ts
  - lib/recovery/index.ts
  - lib/recovery/storage.ts
  - lib/recovery/types.ts
  - lib/refresh-queue.ts
  - lib/request/fetch-helpers.ts
  - lib/request/helpers/input-utils.ts
  - lib/request/helpers/model-map.ts
  - lib/request/helpers/tool-utils.ts
  - lib/request/rate-limit-backoff.ts
  - lib/request/request-transformer.ts
  - lib/request/response-handler.ts
  - lib/request/retry-budget.ts
  - lib/rotation.ts
  - lib/runtime-contracts.ts
  - lib/schemas.ts
  - lib/shutdown.ts
  - lib/storage.ts
  - lib/storage/migrations.ts
  - lib/storage/paths.ts
  - lib/table-formatter.ts
  - lib/types.ts
  - lib/ui/ansi.ts
  - lib/ui/auth-menu.ts
  - lib/ui/beginner.ts
  - lib/ui/confirm.ts
  - lib/ui/format.ts
  - lib/ui/runtime.ts
  - lib/ui/select.ts
  - lib/ui/theme.ts
  - lib/utils.ts
rubric-version: 1
---

# T13 — Test Coverage Gap Analysis

**Summary**: The suite has 58 test files covering 58 lib modules (≈ 1:1 by file but NOT by behaviour). Line-coverage target is 80% (vitest.config.ts:22-27), but that says nothing about scenario coverage — zero-fault chaos, no contract pins, and a single 190-byte fixture. The highest-value pre-seeded gaps (26 from bg_707b6648) remain open in code: of those re-verified against the locked SHA, 24/26 are KEEP (still valid gaps), 2 are DEMOTED (partially covered by integration-level assertions). Wave 1 surfaced ≈ 12 additional HIGH-impact code paths with NO scenario test. Headline counts: **4 HIGH, 18 MEDIUM, 6 LOW** test-scenario findings; **1 module** with zero direct test file (`lib/accounts/rate-limits.ts`).

**Files audited**: 70 of 139 in-scope (vitest config + test tree + fixtures + seed cross-refs to lib/**).

---

## 0. Coverage Baseline Claims

Coverage threshold is configured in `vitest.config.ts:18-28`:

```ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html'],
  exclude: ['node_modules/', 'dist/', 'test/'],
  thresholds: {
    statements: 80,
    branches: 80,
    functions: 80,
    lines: 80,
  },
},
```

**Claim**: 80% line / branch / function / statement floor.
**Reality caveats (not verified by running coverage — rubric forbids mutation)**:

1. Line coverage is an opaque metric: an 80% line-covered file can still miss every error path. Example: `lib/accounts.ts` has 1010 lines; dozens of branches are rate-limit / rotation edge cases that the existing test suite does not actually exercise (see §4, §7).
2. The `test:coverage` script in `package.json` produces HTML into `coverage/` — the directory is scope-excluded from this audit. No coverage report was generated to preserve READ-ONLY.
3. The threshold is global across the project; it does not enforce per-file minimums, so a single 100%-covered utility module can mask a 60%-covered critical module.
4. `test/chaos/fault-injection.test.ts` is included in the 80% count even though it executes no fault injection (see §8); it is conventional unit tests with aspirational branding.

---

## 1. Module-to-Test Mapping (58 lib modules × 58 test files)

Each row: lib module → direct test file (filename match) + *indirect* coverage (other test file that imports the module). "Direct" = dedicated `<module>.test.ts` file. "Indirect" = module appears in `import` statements of test files.

| lib module | Direct test file | Primary indirect coverers |
| --- | --- | --- |
| `lib/accounts.ts` | `test/accounts.test.ts` | `rotation-integration.test.ts`, `index.test.ts`, `proactive-refresh.test.ts` |
| `lib/accounts/rate-limits.ts` | **NONE (zero-coverage module)** | `accounts.test.ts`, `parallel-probe.test.ts` via `accounts.ts` transitively |
| `lib/audit.ts` | `test/audit.test.ts` + `test/audit.race.test.ts` | — |
| `lib/auth/auth.ts` | `test/auth.test.ts` | `login-runner.test.ts`, `oauth-server.integration.test.ts` |
| `lib/auth/browser.ts` | `test/browser.test.ts` | — |
| `lib/auth/device-code.ts` | `test/device-code.test.ts` | — |
| `lib/auth/login-runner.ts` | `test/login-runner.test.ts` | `auth-menu.test.ts` |
| `lib/auth/server.ts` | `test/server.unit.test.ts` + `test/oauth-server.integration.test.ts` | — |
| `lib/auth/token-utils.ts` | `test/token-utils.test.ts` | `auth.test.ts` |
| `lib/auth-rate-limit.ts` | `test/auth-rate-limit.test.ts` | **(dead code: module never wired from refresh path — tests green on dead path — see T02:663, T16)** |
| `lib/auto-update-checker.ts` | `test/auto-update-checker.test.ts` | — |
| `lib/circuit-breaker.ts` | `test/circuit-breaker.test.ts` | `chaos/fault-injection.test.ts` |
| `lib/cli.ts` | `test/cli.test.ts` | `beginner-ui.test.ts` |
| `lib/config.ts` | `test/config.test.ts` + `test/plugin-config.test.ts` | `index.test.ts` |
| `lib/constants.ts` | — (constants only; reference-only) | `gpt54-models.test.ts` |
| `lib/context-overflow.ts` | `test/context-overflow.test.ts` | — |
| `lib/errors.ts` | `test/errors.test.ts` | `storage.test.ts` (StorageError `cause`) |
| `lib/health.ts` | `test/health.test.ts` | `parallel-probe.test.ts` |
| `lib/index.ts` | barrel — `test/index.test.ts` is plugin-level integration | — |
| `lib/logger.ts` | `test/logger.test.ts` | `index.test.ts` |
| `lib/oauth-success.ts` | `test/copy-oauth-success.test.ts` (build-script only) | — |
| `lib/parallel-probe.ts` | `test/parallel-probe.test.ts` | `health.test.ts` |
| `lib/proactive-refresh.ts` | `test/proactive-refresh.test.ts` | `refresh-queue.test.ts` |
| `lib/prompts/codex.ts` | `test/codex.test.ts` + `test/codex-prompts.test.ts` + `test/gpt54-models.test.ts` | — |
| `lib/prompts/codex-opencode-bridge.ts` | indirect via `request-transformer.test.ts` | `codex.test.ts` |
| `lib/prompts/opencode-codex.ts` | `test/opencode-codex.test.ts` | — |
| `lib/recovery.ts` | `test/recovery.test.ts` | `recovery-storage.test.ts` |
| `lib/recovery/constants.ts` | `test/recovery-constants.test.ts` | — |
| `lib/recovery/index.ts` | indirect via `recovery.test.ts` | — |
| `lib/recovery/storage.ts` | `test/recovery-storage.test.ts` | `recovery.test.ts` |
| `lib/recovery/types.ts` | types-only — no runtime behaviour | — |
| `lib/refresh-queue.ts` | `test/refresh-queue.test.ts` | `proactive-refresh.test.ts` |
| `lib/request/fetch-helpers.ts` | `test/fetch-helpers.test.ts` | `index.test.ts`, `index-retry.test.ts` |
| `lib/request/helpers/input-utils.ts` | `test/input-utils.test.ts` | `request-transformer.test.ts` |
| `lib/request/helpers/model-map.ts` | `test/model-map.test.ts` | `request-transformer.test.ts` |
| `lib/request/helpers/tool-utils.ts` | `test/tool-utils.test.ts` | `request-transformer.test.ts` |
| `lib/request/rate-limit-backoff.ts` | `test/rate-limit-backoff.test.ts` | `index-retry.test.ts` |
| `lib/request/request-transformer.ts` | `test/request-transformer.test.ts` + `test/property/transformer.property.test.ts` | `index.test.ts` |
| `lib/request/response-handler.ts` | `test/response-handler.test.ts` | `index.test.ts` |
| `lib/request/retry-budget.ts` | `test/retry-budget.test.ts` | `index-retry.test.ts` |
| `lib/rotation.ts` | `test/rotation.test.ts` + `test/rotation-integration.test.ts` + `test/property/rotation.property.test.ts` | — |
| `lib/runtime-contracts.ts` | `test/runtime-contracts.test.ts` | — |
| `lib/schemas.ts` | `test/schemas.test.ts` | — |
| `lib/shutdown.ts` | `test/shutdown.test.ts` | — |
| `lib/storage.ts` | `test/storage.test.ts` + `test/storage-async.test.ts` | `accounts.test.ts`, `index.test.ts` |
| `lib/storage/migrations.ts` | indirect via `storage.test.ts` | — |
| `lib/storage/paths.ts` | `test/paths.test.ts` | `storage.test.ts` |
| `lib/table-formatter.ts` | `test/table-formatter.test.ts` | — |
| `lib/types.ts` | types-only | — |
| `lib/ui/ansi.ts` | indirect via `ui-theme.test.ts`, `ui-format.test.ts` | — |
| `lib/ui/auth-menu.ts` | `test/auth-menu.test.ts` | `beginner-ui.test.ts` |
| `lib/ui/beginner.ts` | `test/beginner-ui.test.ts` | — |
| `lib/ui/confirm.ts` | indirect via `beginner-ui.test.ts` | — |
| `lib/ui/format.ts` | `test/ui-format.test.ts` | — |
| `lib/ui/runtime.ts` | `test/ui-runtime.test.ts` | — |
| `lib/ui/select.ts` | indirect via `auth-menu.test.ts` | — |
| `lib/ui/theme.ts` | `test/ui-theme.test.ts` | — |
| `lib/utils.ts` | `test/utils.test.ts` | broadly imported |

### 1.1 Zero-direct-test modules

Strict enumeration of lib modules that lack a named `*.test.ts` peer and also lack a dedicated test target:

1. **`lib/accounts/rate-limits.ts`** — 85 lines of domain logic. Exported: `parseRateLimitReason`, `getQuotaKey`, `clampNonNegativeInt`, `clearExpiredRateLimits`, `isRateLimitedForQuotaKey`, `isRateLimitedForFamily`, `formatWaitTime`. Imported only transitively via `accounts.ts:49` and `parallel-probe.ts:9`. Direct unit coverage: **NONE**.

All other lib modules have at least one direct test file. Types-only modules (`lib/types.ts`, `lib/recovery/types.ts`) and pure barrel modules (`lib/index.ts`, `lib/recovery/index.ts`) are intentional zero-coverage and not counted.

### 1.2 Dead-code test anomaly

`lib/auth-rate-limit.ts` has a direct test file but is never called by production code (see T02 MEDIUM `auth-rate-limit.ts is fully implemented but never wired into the refresh path`, T16). The test suite exercises a dead export surface — passing tests, zero runtime value. Disposition: either wire the module or remove module + test; flagged here as a **test-integrity** issue, severity MEDIUM.

---

## 2. Pre-Seed Re-Verification (26 gaps from agent bg_707b6648)

The pre-seed supplied 9 HIGH + 11 MEDIUM + 6 LOW. The plan text (`.sisyphus/plans/repo-audit.md:41-43`) enumerates 9 HIGH, 9 MEDIUM, and 6 LOW explicitly (= 24); the remaining 2 MEDIUM are not reproduced in plan text and are inferred from Wave 1 context (see §2.2).

Verification procedure: for each gap, (1) confirm the underlying code still exists at the locked SHA, (2) confirm no test currently covers the specific scenario, (3) assign KEEP / DEMOTED / REMOVED.

### 2.1 HIGH (9/9)

| # | Pre-seed gap | Code citation | Verdict | Rationale |
| --- | --- | --- | --- | --- |
| H1 | Storage concurrent-transaction stress (>2 parallel adds) | `lib/storage.ts` mutex + `withAccountStorageTransaction` | **KEEP** | `test/storage.test.ts` covers 2-parallel contenders; N≥3 interleave with debounce still open. Cross-ref: T07:62 (`saveToDiskDebounced` loses writes), T06 |
| H2 | Atomic-write EBUSY unlink leaves orphan `.tmp` files | `lib/storage.ts` write → rename → unlink | **KEEP** | T06:139 confirmed. `test/storage.test.ts` does not simulate EBUSY on the unlink itself; only on rename. Windows AV scenario untested |
| H3 | `JSON.parse` silent `null` return on crash-truncated file | `lib/storage.ts:loadAccountsInternal` | **KEEP** | T06:110 confirmed. No test asserts user notification + backup preservation on parse failure |
| H4 | V2 forward-compat missing (silent data loss on downgrade) | `lib/storage/migrations.ts` (V1 → V3 only) | **KEEP** | `test/storage.test.ts` tests V1→V3 only. No test for V4-future file being read by V3 code (rejected/preserved/degraded). No V2 fixture |
| H5 | Port-1455 concurrent-login PKCE verifier collision | `lib/auth/server.ts:_lastCode` single slot | **KEEP** | T07:165 confirmed. `test/oauth-server.integration.test.ts` tests single login. No test for two overlapping logins racing on the callback |
| H6 | Refresh-queue cleanup-vs-rotation-map race | `lib/refresh-queue.ts:164-167` finally-block cleanup | **KEEP** | T07:237 confirmed. `test/refresh-queue.test.ts` does not simulate concurrent rotation+cleanup interleave with deliberate Promise ordering |
| H7 | Recovery cross-session state not persisted (double-injection) | `lib/recovery/storage.ts:prependThinkingPart` | **KEEP** | T06:248 confirmed. `test/recovery-storage.test.ts` does not call `prependThinkingPart` twice in the same session to verify idempotency |
| H8 | Recovery storage layer never exercised against real JSONL | `lib/recovery/storage.ts` read/write | **KEEP** | T06:286 confirmed synchronous fs without atomic temp+rename. `test/recovery-storage.test.ts` uses in-memory fixtures; no on-disk JSONL round-trip, no crash-mid-write scenario |
| H9 | Circuit-breaker eviction-during-half-open resets safety | `lib/circuit-breaker.ts` MAX_CIRCUIT_BREAKERS eviction | **KEEP** | T07:277, T03:224 confirmed. `test/circuit-breaker.test.ts` + `chaos/fault-injection.test.ts` do not assert retained-state-across-eviction for half-open |

### 2.2 MEDIUM (9 enumerated in plan + 2 inferred; 11 total by seed count)

| # | Pre-seed gap | Code citation | Verdict | Rationale |
| --- | --- | --- | --- | --- |
| M1 | Hybrid rotation thrashing under partial rate-limits | `lib/rotation.ts:DEFAULT_HYBRID_SELECTION_CONFIG` | **KEEP** | T03:169 confirmed. `test/rotation.test.ts` covers single-axis rate-limits; no test for correlated partial rate-limits causing oscillation |
| M2 | Stale active-pointer after removeAccount for non-codex family | `lib/accounts.ts:removeAccount` sets index to -1 | **KEEP** | T03:121 confirmed. `test/accounts.test.ts` covers codex-family removal; non-codex family scenario untested |
| M3 | Per-project scoping in git worktrees | `lib/storage/paths.ts:findProjectRoot` | **KEEP** | T06:164 confirmed `.git` as FILE path. `test/paths.test.ts` does not cover worktrees (`.git` as file pointing to common dir) |
| M4 | SSE chunk boundary / mid-event stall | `lib/request/response-handler.ts:parseSseStream` | **KEEP** | T04:242, T04:276 confirmed. `test/response-handler.test.ts` uses well-formed streams; no test for chunk split mid-`data:` line or partial trailing event |
| M5 | Rate-limit vs token-bucket starvation coordination | `lib/rotation.ts:TokenBucketTracker` + `accounts/rate-limits.ts` | **KEEP** | Rate-limits layer is zero-direct-test (§1.1). No cross-component interleave test |
| M6 | `response.done` with `response == null` | `lib/request/response-handler.ts` | **KEEP** | T04:401 (`parseSseStream misses response.incomplete-with-null-response JSON error extraction`). `test/response-handler.test.ts` does not include null-response.done fixture |
| M7 | Model-family drift mid-session | `lib/request/request-transformer.ts:getReasoningConfig` + fallback chain | **KEEP** | T04:360 confirmed. `test/request-transformer.test.ts` tests initial family selection; no test for fallback-chain drift updating `modelFamily` without updating body `include` |
| M8 | Recovery `extractMessageIndex` regex first-match | `lib/recovery.ts` | **KEEP** | `test/recovery.test.ts` covers happy-path only. No adversarial filename with multi-digit prefixes or non-canonical ordering |
| M9 | Missing test file for `lib/accounts/rate-limits.ts` | (module has no direct test) | **KEEP** | Confirmed §1.1 — zero-direct-test module |
| M10 | (inferred) Storage `importAccounts` schema-drift tolerance | `lib/storage.ts:readAndNormalizeImportFile` | **KEEP** | T02:311, T05:132 confirmed no Zod enforcement on import. `test/storage.test.ts` asserts normalization; no test for unknown-extra-keys / type-coerced values |
| M11 | (inferred) Proactive refresh race with on-demand refresh | `lib/proactive-refresh.ts` + `lib/refresh-queue.ts` | **KEEP** | T07:346 confirmed. `test/proactive-refresh.test.ts` does not simulate overlapping on-demand `getCredentials` call landing mid-proactive-rotation |

### 2.3 LOW (6/6)

| # | Pre-seed gap | Code citation | Verdict | Rationale |
| --- | --- | --- | --- | --- |
| L1 | Boundary off-by-one in migration | `lib/storage/migrations.ts` | **DEMOTED** | `test/storage.test.ts` includes `rateLimitResetTime` boundary values but does not assert `===` on exact-now. Partially covered — demote to LOW-DEMOTED (keep in list, rationale recorded) |
| L2 | Concurrent `incrementAuthFailures` | `lib/accounts.ts:incrementAuthFailures` | **KEEP** | T07:309, T03 CRITICAL confirmed. `test/audit.race.test.ts` covers some races but not this one |
| L3 | `tool_use` id defensive path | `lib/request/helpers/tool-utils.ts` + `request-transformer.ts` orphan-tool recovery | **DEMOTED** | Partially covered by `test/tool-utils.test.ts` + property test. Demote: still has gap for defensive `undefined` `tool_use.id` from malformed upstream response |
| L4 | SSE code decode edges | `lib/auth/server.ts` URL-decode of authorization code | **KEEP** | T02:874 (dead CSP markup) separate. Code-decode edges untested |
| L5 | State-compare timing | `lib/auth/server.ts` state compare | **KEEP** | T02:427 (non-constant-time compare). `test/auth.test.ts` + `test/server.unit.test.ts` do not assert constant-time property |
| L6 | Circuit-breaker boundary precision | `lib/circuit-breaker.ts` failure-window boundary | **KEEP** | `chaos/fault-injection.test.ts:36` tests "failures at window boundary are counted" — partial, but rubric says: existing test covers only the boundary==equal case; off-by-one prune in `pruneFailures` still open |

### 2.4 Seed totals

- **KEEP**: 24 / 26
- **DEMOTED**: 2 / 26 (L1, L3) — kept in list with demotion rationale
- **REMOVED**: 0 / 26

None of the pre-seed gaps were closed by commits since `bg_707b6648` — the suite did not grow into these areas at the locked SHA.

---

## 3. Wave 1 Bugs Requiring New Tests

Wave 1 (T01–T09) surfaced bugs NOT covered by the 26 pre-seed gaps. These are code-level findings that additionally imply a missing test.

| # | Wave 1 finding | Code citation | Proposed test scenario |
| --- | --- | --- | --- |
| W1 | T02:155 `login-runner.ts:338-339` credential merge via `\|\|` resurrects invalidated tokens | `lib/auth/login-runner.ts:338-339` | Assert that given an account with `refreshToken === ""`, merge does NOT fall through to prior token; requires `??` semantics |
| W2 | T08:148 Quadratic SSE concat (O(n²) memory+CPU on large streams) | `lib/request/response-handler.ts` | Benchmark / unit-assert that 10 MB SSE stream completes under memory + time envelope; currently no size-stress test |
| W3 | T06:85 Graceful shutdown never flushes debounced save | `lib/shutdown.ts` + `lib/accounts.ts:saveToDiskDebounced` | Trigger in-flight debounced save, send SIGTERM, assert file reflects the pending write |
| W4 | T07:62 Concurrent rotate-and-save lose writes in 500 ms window | `lib/accounts.ts:saveToDiskDebounced` | Two rotations 200 ms apart under fake timers; assert both are persisted |
| W5 | T03:103 CRITICAL in-memory auth-failure counter race across variants | `lib/accounts.ts:incrementAuthFailures` | Shared refreshToken across 2 org variants; concurrent increments; assert variant isolation |
| W6 | T05:132 Imported accounts JSON no schema validation | `lib/storage.ts:readAndNormalizeImportFile` | Import payload with extra keys / wrong types; assert Zod rejection or normalized output |
| W7 | T05:166 JWT payload parsed without shape validation | `lib/auth/token-utils.ts` | JWT with missing / wrong-type `accountId` / `organizationId`; assert safe fallback |
| W8 | T04:129 Streaming path skips per-read stall timeout | `lib/request/fetch-helpers.ts` + `response-handler.ts` | Slow-reader mock that produces a first byte then stalls 120s; assert request aborts on stall timeout not absolute timeout |
| W9 | T04:167 `fetchAndPersistInstructions` throws HTTP 304 when cache missing | `lib/prompts/codex.ts:fetchAndPersistInstructions` | Simulate cache file unlinked between etag match and read; assert recovery-fallback path instead of throw |
| W10 | T09:282 Audit log infrastructure present but never invoked | `lib/audit.ts` + all call sites | Assert that rotation events emit audit log entries — test WILL FAIL today, documenting the gap |
| W11 | T06:248 `prependThinkingPart` reuses fixed file id causing silent double-write | `lib/recovery/storage.ts:prependThinkingPart` | Call twice; assert either second call is a no-op or explicit ordering |
| W12 | T07:100 `applyRefreshResult` mutate without persist → crash loses rotated token | `lib/proactive-refresh.ts:206-215` | Mutate in-memory credentials, simulate process exit before debounce flush; assert token not lost |

Total: 12 Wave-1-surfaced test gaps, bringing the overall test-scenario gap count to **38** (26 seed + 12 Wave 1), before contract / fixture / property additions.

---

## 4. Contract-Test Gap (External API Assumption Pinning)

The plugin interacts with two external APIs: ChatGPT backend (OAuth token endpoint + Codex responses endpoint) and GitHub (prompt template releases). The suite has **ZERO contract tests** pinning the *shape* of these external responses. The consequence: when the upstream API drifts (e.g., OpenAI renames an error code, GitHub changes ETag header semantics), tests stay green but production breaks.

Inventory of external contracts that SHOULD be pinned:

| API | Contract | Shape pinned? | Impact if drift |
| --- | --- | --- | --- |
| ChatGPT OAuth token endpoint | Success: `{access_token, refresh_token, id_token, expires_in}` | No — only `auth.ts` test builds the happy shape | Field rename → silent `undefined` stored as refreshToken |
| ChatGPT OAuth token endpoint | Error: `{error, error_description}` | No | Error-description format change → user sees raw HTML |
| ChatGPT responses endpoint SSE | Event names (`response.output_text.delta`, `response.done`, `response.completed`, `response.incomplete`, `response.error`) | Partial — `response-handler.test.ts` enumerates *some* | New event name → silent drop in parse loop |
| ChatGPT responses endpoint SSE | `response.incomplete` with `response=null` | No — T04:401 documents missing extraction | User sees generic error not actual upstream reason |
| ChatGPT entitlement errors | `isEntitlementError` regex patterns (`usage_not_included`, `subscription_plan`) | Partial — `chaos/fault-injection.test.ts:174` for two patterns | T04:635 documents uncovered codes |
| ChatGPT rate-limit header | `Retry-After`, `x-ratelimit-reset-after` semantics | Partial — `rate-limit-backoff.test.ts` | Header rename → infinite retry loop |
| ChatGPT deprecation headers | `Sunset`, `Deprecation` (RFC 8594, `AGENTS.md:54`) | No | Silent removal of deprecation warning log path |
| GitHub release API | `/repos/openai/codex/releases/latest` JSON shape (tag_name, assets) | No | Prompt template sync breaks silently |
| GitHub ETag caching | `If-None-Match` → 304 protocol + ETag header format | Partial — `codex.test.ts` covers 304 happy path only | `fetchAndPersistInstructions` throws (T04:167) |

Recommendation structure (detailed in §9): add a `test/contract/` directory with recorded-response fixtures (JSON files capturing real API shapes, redacted) and parse-them-back tests. Use an existing library like nock or inline `vi.mock` with the fixture; the point is to pin the *shape*, not the data. When upstream drifts, the contract test fails BEFORE deploy.

---

## 5. Fixture Quality Assessment

The `test/fixtures/` directory contains exactly ONE file: `v3-storage.json` (190 bytes, 1 account):

```json
{
  "version": 3,
  "activeIndex": 0,
  "accounts": [
    {
      "accountId": "acct1",
      "refreshToken": "token1",
      "addedAt": 1000,
      "lastUsed": 2000
    }
  ]
}
```

### 5.1 Fixture coverage gaps

This fixture covers 5 of the ≥ 20 storage-format permutations that exist at runtime. Missing fixtures:

| Missing fixture | Purpose | Severity |
| --- | --- | --- |
| `v1-storage.json` | Migrate V1 → V3 path (currently tests construct V1 inline) | HIGH — migration bugs hide |
| `v2-storage.json` | Forward-compat / downgrade protection (H4 / T11 cross-ref) | HIGH |
| `v3-malformed.json` | Truncated JSON → `loadAccountsInternal` null return (H3 / T06:110) | HIGH |
| `v3-empty-accounts.json` | activeIndex=0 but accounts=[] edge case | MEDIUM |
| `v3-multi-account.json` | Multi-account rotation fixture (≥ 4 accounts with varied state) | MEDIUM |
| `v3-with-rate-limits.json` | Fixture with `rateLimitResetTimes` populated + near-expiry boundary | MEDIUM |
| `v3-with-workspaces.json` | Workspace accounts (org / project / default) per account | MEDIUM |
| `v3-disabled-accounts.json` | Mix of enabled + disabled | LOW |
| `v3-shared-refresh.json` | Two variants sharing refreshToken (T02:797 / T03 CRITICAL) | HIGH |
| `v3-unknown-fields.json` | Unknown keys present — tests import normalization (T05:132) | HIGH |
| `v3-legacy-schema.json` | Old `authType` / removed fields to test graceful ignore | MEDIUM |
| `v3-future-version.json` | `"version": 4` to test forward-compat rejection | HIGH |
| `ssE-chunked-mid-event.txt` | SSE stream that cuts mid-`data:` line | HIGH |
| `sse-incomplete-null.json` | `response.incomplete` with null response (T04:401) | MEDIUM |
| `sse-deprecation-headers.http` | Response with `Sunset` / `Deprecation` | LOW |
| `oauth-token-success.json` | Pinned happy shape (contract — §4) | HIGH |
| `oauth-token-error.json` | Pinned error shape | MEDIUM |
| `github-release-v0.42.0.json` | GitHub API shape pin | MEDIUM |

### 5.2 Fixture source-of-truth problem

Tests currently build fixtures inline (inside `beforeEach` blocks). This:

- Scatters the contract across 60 test files. Contract drift is invisible.
- Prevents cross-test reuse.
- Makes diffing "what shape does production actually see" across versions impossible.
- Bypasses Zod validation even in tests.

Recommendation: centralize fixtures in `test/fixtures/` as committed files, load via `readFileSync` at test module top, Zod-parse them on load (making the fixture itself a contract test).

---

## 6. Test Brittleness Audit

### 6.1 Fake-timer discipline

`vi.useFakeTimers` appears **23 times** across the suite (raw grep). Sampling:

- `test/accounts.test.ts`, `test/proactive-refresh.test.ts`, `test/refresh-queue.test.ts`, `test/rate-limit-backoff.test.ts`, `test/rotation.test.ts`, `test/circuit-breaker.test.ts` — all use fake timers for cooldown / debounce / backoff tests. **Good discipline.**
- `test/shutdown.test.ts` — uses fake timers for SIGTERM simulation. **Good.**
- `test/storage.test.ts` — uses fake timers for debounced save windows but does NOT simulate the 500 ms boundary where rotation+shutdown race lives (T06:85). Gap.

Brittleness risk: when a test does NOT use fake timers but sleeps / awaits a real timeout, CI can flake. Raw `setTimeout` + `await` patterns in tests are rare in this suite (not counted — see §6.3).

### 6.2 Network stubbing

`global.fetch` / `globalThis.fetch` overrides appear **130 times** across the suite. This is heavy: the plugin's entire behaviour is network-interaction, so stubbing is necessary, but:

- Stubs rebuild response objects by hand with conservatively-correct shape; **no recorded fixtures** to detect drift (§4).
- No evidence of `msw` or similar request-interceptor library — stubs are ad-hoc.
- Stub patterns vary (some use `vi.spyOn(globalThis, 'fetch')`, some replace `globalThis.fetch = vi.fn()`, some use per-test `let fetchMock`). Inconsistency hides bugs when one form interacts with unmocked code paths.
- `vi.unstubAllGlobals` / explicit teardown is sometimes absent, leaking mocks across tests. Not counted here but probable based on the 130 stub sites.

### 6.3 Mocking strategy + over-mocking

`vi.mock(` appears **52 times**. Sampling:

- `test/index.test.ts` mocks `lib/accounts.js`, `lib/rotation.js`, `lib/refresh-queue.js`, `lib/circuit-breaker.js`, `lib/prompts/codex.js`, etc. — so the plugin-integration test is actually *isolated unit tests with integration ceremony*. Bugs caused by interactions between these modules cannot be caught.
- `test/shutdown.test.ts` mocks `lib/accounts.js` to bypass real save flush — exactly the interaction point T06:85 documents as a HIGH bug, and the mock hides it.
- Over-mocking signature: if a test mocks ≥ 5 lib modules, it is no longer an integration test even if the filename says so. At least 3 "integration" test files fit this profile.

### 6.4 Real vs stubbed filesystem

- `test/storage.test.ts` + `test/storage-async.test.ts` use real fs under `os.tmpdir()`. **Good.**
- `test/recovery-storage.test.ts` uses real fs; does not simulate crash-mid-write (T06:286).
- `test/paths.test.ts` uses real fs with temp dirs. **Good.**
- Most other tests do not touch fs.

Recommendation: add a test-harness helper that simulates partial writes (write N bytes, abort). Concrete helper: monkey-patch `fs.promises.writeFile` to throw after first 100 bytes; assert recovery/storage is resilient.

---

## 7. Property Tests — Scope + Opportunities

`test/property/` contains three authored files:

### 7.1 `rotation.property.test.ts` (current scope)

Covered properties:

- `HealthScoreTracker`: score ∈ [0,100]; recordSuccess non-decreasing; recordFailure non-increasing; consecutiveFailures reset; fresh = max; reset restores.
- `TokenBucketTracker`: tokens ≥ 0; tryConsume false when empty; fresh = max; drain never below 0; reset.
- `selectHybridAccount`: returns null iff empty input; returns valid member; prefers available; determinism.

Coverage: 18 properties (property-test level), all correctness-flavoured. No concurrency properties, no cooldown properties, no quota-key properties.

### 7.2 `transformer.property.test.ts` (current scope)

Covered:

- `normalizeModel`: non-empty output, prefix strip, idempotence, undefined/empty handling.
- `filterInput`: non-array → undefined, removes item_reference, strips ids, preserves content, length monotonicity.
- `getReasoningConfig`: valid effort, valid summary, family-specific upgrade/downgrade rules.
- `transformRequestBody`: preserves `max_output_tokens` across arbitrary ints.

### 7.3 Property-test gaps

Candidate additional property tests:

1. `getQuotaKey(family, model)` ↔ `parseRateLimitReason` round-trip consistency over arbitrary strings — currently no test at all (zero-cov module §1.1).
2. `clampNonNegativeInt`: output is integer ≥ 0 for arbitrary unknown input, fallback-on-NaN — zero coverage.
3. `clearExpiredRateLimits`: after call, all remaining keys have reset-time ≥ now; no key was incorrectly removed — zero coverage.
4. State-machine properties on `AccountManager`: starting from any valid state, applying any sequence of `markRateLimited` / `restore` / `remove` yields a valid state (no negative activeIndex pointing at missing accounts). None exist; T03:121 and T03:312 would be caught.
5. Circuit-breaker state-transition property: applying any sequence of success/failure yields a state ∈ {closed, open, half-open}; no zombie state. `chaos/fault-injection.test.ts:22` mentions determinism but does not fast-check it.
6. `retry-budget` property: budget monotonically decreases on use; never negative; reset restores to max.
7. SSE parse property: for any valid stream of N well-formed events, `parseSseStream` yields the right JSON array; for ANY truncation point mid-event, never throws (silently drops is OK; crashing is not).

Priority: #4 (AccountManager state machine) is the highest — it would catch T03 CRITICAL and most of the pre-seed rotation HIGHs.

---

## 8. Chaos Tests — Scope + Gaps

`test/chaos/fault-injection.test.ts` is 537 lines. Content breakdown (from `describe` blocks):

1. **CircuitBreaker state-machine tests** (lines ~10–90): closed→open, open→half-open, half-open→closed, half-open→open, determinism, failure-window pruning, getTimeUntilReset. These are conventional state-machine unit tests, not fault injection.
2. **Malformed Rate Limit Headers** (lines ~95–150): missing, malformed, negative, extreme values. Unit-style input fuzzing.
3. **isEntitlementError** patterns (lines ~155–195): usage_not_included, subscription plan, rate-limit exclusion, empty inputs.
4. **shouldRefreshToken** edge cases (lines ~200–250): non-oauth, missing access token, expired, valid, skew, negative skew.
5. **URL handling** (lines ~255–537): extractRequestUrl with string URLs, URL objects, IPv6, protocols, query strings, etc.

**Verdict**: The file is named "fault-injection" but contains zero genuine fault injection. Real fault injection would include:

- Filesystem faults: EBUSY / EACCES / ENOSPC mid-write (T06 HIGHs hinge on these).
- Network faults: connection reset mid-SSE, DNS timeout, malformed chunked-encoding, partial gzip truncation (T04:129, T08:148).
- Process faults: SIGTERM mid-debounce (T06:85).
- Time faults: clock skew / leap second / daylight savings (T03:331 cites clock skew).
- Crash faults: process exit mid-atomic-write (H2, H3, H7, W3).
- Concurrency faults: deterministic interleave of async microtasks to force races (H6, W4, W5).

None of these exist. `chaos/fault-injection.test.ts` is misnamed and the plugin has no real resilience test suite. This is consistent with the AUDIT-RUBRIC's MEDIUM severity bar: "real defect or risk that degrades robustness". Add a test-coverage MEDIUM for the naming+absence.

### 8.1 Chaos tests to add

| # | Scenario | File | Severity |
| --- | --- | --- | --- |
| C1 | `fs.writeFile` throws ENOSPC mid-atomic-save; assert no partial state | `test/chaos/storage-fs.test.ts` | HIGH |
| C2 | `fetch` resolves then reader throws after 1st chunk; assert stall-timeout fires | `test/chaos/sse-stream.test.ts` | HIGH |
| C3 | SIGTERM arrives during 500 ms debounce; assert flush | `test/chaos/shutdown.test.ts` | HIGH |
| C4 | Clock jumps forward 1 h mid-test; assert rate-limit expires cleanly | `test/chaos/clock-skew.test.ts` | MEDIUM |
| C5 | 5 concurrent `auth login` callbacks on port 1455; assert no verifier mismatch | `test/chaos/concurrent-login.test.ts` | HIGH |
| C6 | Process crashes mid-`recovery/storage` write; next start sees clean state or rejects unclean | `test/chaos/recovery-crash.test.ts` | HIGH |

---

## 9. Would the current suite catch the pre-seeded HIGH bugs?

A rigorous test for each of the 5 pre-seeded security HIGHs (`bg_c692d877`) and 9 pre-seeded test-gap HIGHs (`bg_707b6648`): **NO** to all 14.

Spot-checks:

1. **T02:155 `login-runner.ts:338-339` merge resurrection (`||` fallback)**. `test/login-runner.test.ts` covers happy-path merges. No test constructs an incoming account with `refreshToken === ""` (the exact condition that `||` resurrects). Adding the test: 10-line vitest case; would fail today.
2. **T07:62 concurrent rotate+save debounce loss**. `test/accounts.test.ts` exercises debounce basics with fake timers but never schedules two rotations within one window + fires vi.advanceTimersByTime across both — the exact interleave that loses writes. Test-add is mechanical.
3. **T06:85 shutdown doesn't flush debounced save**. `test/shutdown.test.ts` mocks `AccountManager.flushPendingSave` OR does not reference it at all; grep for `flushPendingSave` across the suite yields ≤ 1 hit (not a call from `shutdown.test.ts`). The test WOULD fail immediately; it simply does not exist.
4. **T06:110 JSON.parse silent null masks data loss**. `test/storage.test.ts` does not write a mid-JSON truncation; tests use pristine or explicitly-invalid fixtures but assert "rejects" not "silently masks as empty". The HIGH bug is exactly that `null` is silently *indistinguishable* from first-run; no test is written to catch that ambiguity.
5. **T03:103 CRITICAL in-memory auth-failure race**. `test/audit.race.test.ts` covers *some* concurrent counters but not shared-refreshToken-across-variant increments. Targeted test is a ~15-line `Promise.all` harness.

Generalized answer: the 14 pre-seeded HIGHs span race conditions, silent-failure masking, schema validation gaps, and shutdown ordering — all of which require either (a) deterministic async-interleave harnesses, (b) fault-injection helpers, or (c) recorded-response fixtures. The current suite has none of those.

---

## 10. Prioritized "Tests to Add" List

Top 14 targeted test-scenarios to add, in order of risk-reduction per hour of engineer time. Every entry: module + scenario + risk + suggested test + severity.

1. **Module**: `lib/accounts/rate-limits.ts` — **Scenario**: exhaustive unit tests for every exported function (`parseRateLimitReason`, `getQuotaKey`, `clampNonNegativeInt`, `clearExpiredRateLimits`, `isRateLimitedForQuotaKey`, `isRateLimitedForFamily`, `formatWaitTime`). **Risk**: zero-coverage module on critical rotation path. **Suggested test**: new file `test/accounts/rate-limits.test.ts`, 20–30 vitest cases. **Severity**: HIGH.

2. **Module**: `lib/auth/login-runner.ts` — **Scenario**: merge with empty-string `refreshToken` must not resurrect prior token (T02:155). **Risk**: credential resurrection / silent invalidation failure. **Suggested test**: in `test/login-runner.test.ts`, add case building an incoming account with `refreshToken === ""`, assert result is explicit rejection not fallback. **Severity**: HIGH.

3. **Module**: `lib/accounts.ts` + `lib/shutdown.ts` — **Scenario**: SIGTERM during debounced save flushes pending write (T06:85). **Risk**: silent loss of rotated credentials on process exit. **Suggested test**: in `test/shutdown.test.ts`, schedule rotation, advance timers by 250 ms (half-debounce), send SIGTERM, assert fs state matches pending write. **Severity**: HIGH.

4. **Module**: `lib/accounts.ts:incrementAuthFailures` — **Scenario**: two org variants sharing one refreshToken increment concurrently (T03:103 CRITICAL / T07:309). **Risk**: variant-specific counter collision → wrong circuit state. **Suggested test**: `test/accounts.test.ts`, construct 2 variants with same refreshToken, `Promise.all([inc(), inc()])`, assert counter equals 2 AND variants remain distinguishable. **Severity**: HIGH.

5. **Module**: `lib/storage.ts:loadAccountsInternal` — **Scenario**: truncated JSON returns distinguishable error not silent null (H3 / T06:110). **Risk**: user sees "first run" when their accounts file is corrupt. **Suggested test**: `test/storage.test.ts`, write half a JSON, assert load throws typed error OR emits distinct diagnostic, not `null` indistinguishable from first-run. **Severity**: HIGH.

6. **Module**: `lib/storage.ts` atomic write + EBUSY — **Scenario**: rename throws EBUSY, unlink also throws EBUSY, assert `.tmp` orphan cleanup or retry (H2 / T06:139). **Risk**: filesystem clutter + backup path pollution on Windows AV. **Suggested test**: `test/storage.test.ts`, monkey-patch `fs.rename` and `fs.unlink` to throw EBUSY on first N calls, assert eventual success or clean error message. **Severity**: HIGH.

7. **Module**: `lib/auth/server.ts` — **Scenario**: two concurrent `auth login` flows on port 1455, assert each receives the correct `code` for its own `state` / PKCE verifier (H5 / T07:165). **Risk**: cross-session credential misattribution. **Suggested test**: new `test/oauth-server.concurrent.test.ts`, use two independent `authorize()` promises, assert `_lastCode` single-slot behaviour does not cause verifier mismatch. **Severity**: HIGH.

8. **Module**: `lib/recovery/storage.ts:prependThinkingPart` — **Scenario**: calling twice with same session id is idempotent OR ordered (H7 / T06:248). **Risk**: silent double-inject of thinking message. **Suggested test**: `test/recovery-storage.test.ts`, call prepend twice, read back parts, assert 1 entry not 2 (or explicit ordering). **Severity**: HIGH.

9. **Module**: `lib/recovery/storage.ts` — **Scenario**: synchronous write fails mid-flight (simulated by partial write + throw), next read must not silently `catch {} continue` over corrupted entry (H8 / T06:286). **Risk**: recovery data loss invisible. **Suggested test**: `test/recovery-storage.test.ts`, monkey-patch `writeFileSync` to write partial then throw, call readParts, assert explicit corruption-diagnostic. **Severity**: HIGH.

10. **Module**: `lib/request/response-handler.ts:parseSseStream` — **Scenario**: stream chunked mid-`data:` line; assert partial event buffered then completed, not dropped (M4 / T04:242). **Risk**: silent truncation of upstream responses. **Suggested test**: `test/response-handler.test.ts`, encode event as two Uint8Array chunks split inside `data:` line, assert parsed output matches whole-event case. **Severity**: MEDIUM.

11. **Module**: `lib/request/response-handler.ts` — **Scenario**: `response.incomplete` with `response === null` yields error with upstream reason extraction (T04:401). **Risk**: user sees generic "incomplete" not actual Codex reason. **Suggested test**: `test/response-handler.test.ts`, fixture stream ending with `response.incomplete` null-response; assert error shape carries `code` / `reason`. **Severity**: MEDIUM.

12. **Module**: `lib/storage/paths.ts:findProjectRoot` — **Scenario**: `.git` as FILE (worktree marker) vs `.git` as DIR; assert path resolution matches runtime git behaviour (M3 / T06:164). **Risk**: per-project storage splits a single worktree into two accounts contexts. **Suggested test**: `test/paths.test.ts`, create temp dir with `.git` FILE containing `gitdir: /common/dir`, assert resolved project root. **Severity**: MEDIUM.

13. **Module**: `lib/storage/migrations.ts` — **Scenario**: reading a V4 file (future version) returns an explicit "upgrade required" not a crash (H4). **Risk**: forward-compat silent data loss on downgrade. **Suggested test**: `test/storage.test.ts`, write `{"version": 4, ...}`, call load, assert explicit rejection or schema preservation. **Severity**: HIGH.

14. **Module**: `lib/circuit-breaker.ts` — **Scenario**: eviction during half-open state preserves enough history to not reopen instantly (H9 / T07:277). **Risk**: flapping between open and half-open under load. **Suggested test**: `test/circuit-breaker.test.ts`, fill MAX_CIRCUIT_BREAKERS, put one in half-open, evict it, re-create, assert state is consistent. **Severity**: HIGH.

Additional entries (15–22) for MEDIUM/LOW tier sizing:

15. `lib/accounts.ts` rotation cursor rebase after `setActiveIndex` (T03 LOW) — assert `cursorByFamily` tracks current. MEDIUM.
16. `lib/rotation.ts` `getTokens` / `getScore` for unseen accounts — assert cold-start distinguishes maxTokens from "never seen". LOW.
17. `lib/request/helpers/model-map.ts` `getNormalizedModel` memoisation test — assert repeated lookup is O(1) (T04:429 perf). LOW.
18. `lib/audit.ts` flush queue unbounded retention on write failure (T09:476) — assert backpressure. MEDIUM.
19. `lib/logger.ts` TOKEN_PATTERNS coverage for OpenAI opaque refresh token format (T02:829) — assert redaction. MEDIUM.
20. `lib/request/rate-limit-backoff.ts` state persistence across rotation (T04:324) — assert backoff resets on rotate. MEDIUM.
21. `lib/prompts/codex.ts` cache miss after ETag 304 (T04:167) — assert graceful fallback. MEDIUM.
22. `lib/request/retry-budget.ts` exhaustion before rotation completes (T04:204) — assert retry → rotate ordering. MEDIUM.

---

## 11. Findings (AUDIT-RUBRIC format)

### [HIGH | confidence=high] `lib/accounts/rate-limits.ts` is a zero-direct-test module on the rotation critical path

- **File**: `lib/accounts/rate-limits.ts:1-85`
- **Quote**:

  ```ts
  export function parseRateLimitReason(code: string | undefined): RateLimitReason {
      if (!code) return "unknown";
      const lc = code.toLowerCase();
      if (lc.includes("quota") || lc.includes("usage_limit")) return "quota";
      if (lc.includes("token") || lc.includes("tpm") || lc.includes("rpm")) return "tokens";
      if (lc.includes("concurrent") || lc.includes("parallel")) return "concurrent";
      return "unknown";
  }
  ```

- **Issue**: 85 lines of exported domain logic (7 functions incl. `parseRateLimitReason`, `getQuotaKey`, `clampNonNegativeInt`, `clearExpiredRateLimits`, `isRateLimitedForQuotaKey`, `isRateLimitedForFamily`, `formatWaitTime`) lack any direct test file. Coverage is purely transitive through `lib/accounts.ts` and `lib/parallel-probe.ts`, which means branches not exercised by their callers are invisible. Cross-cuts with T03:349 (`clearExpiredRateLimits` mutates during iteration).
- **Recommendation**: Create `test/accounts/rate-limits.test.ts` with unit coverage for each exported function, at minimum: empty-input handling, boundary quota-key composition, `clearExpiredRateLimits` iteration safety, `formatWaitTime` minute/second boundary. Target ≥ 20 cases.
- **Evidence**: See §1 mapping table; `Select-String -Path test\**\*.ts -Pattern 'rate-limits'` returns zero hits for direct import of the module (only transitive usage). T03:349 documents the iteration-safety gap.

### [HIGH | confidence=high] No contract tests pin any external API response shape

- **File**: `test/` directory (absence of `test/contract/` or equivalent) + `test/fixtures/v3-storage.json:1-10`
- **Quote**:

  ```json
  {
    "version": 3,
    "activeIndex": 0,
    "accounts": [
      {
        "accountId": "acct1",
        "refreshToken": "token1",
        "addedAt": 1000,
        "lastUsed": 2000
      }
    ]
  }
  ```

- **Issue**: The suite has a single 190-byte fixture for V3 storage and zero recorded-response fixtures for ChatGPT OAuth, ChatGPT SSE responses, GitHub release API, or deprecation-header behaviour. The plugin's stability hinges on these shapes; when they drift (field rename, header semantics change, new error code), tests stay green and production fails. See §4 contract matrix.
- **Recommendation**: Add `test/fixtures/` files for each external API shape (OAuth token success + error, SSE event catalogue, GitHub release payload, rate-limit header catalogue), all redacted. Create `test/contract/*.test.ts` that Zod-parse the fixtures and assert `parseSseStream` / `refreshTokens` / `fetchAndPersistInstructions` accept them. When upstream drifts, contract test fails before deploy.
- **Evidence**: `test/fixtures/` directory contents listed in §5. Grep for `msw|nock|pollyjs` across suite returns zero — no request-recording infrastructure exists.

### [HIGH | confidence=high] `chaos/fault-injection.test.ts` performs no fault injection

- **File**: `test/chaos/fault-injection.test.ts:1-537`
- **Quote**:

  ```ts
  describe("CircuitBreaker - State Machine Properties", () => {
      describe("state transitions", () => {
          it("closed -> open requires exactly threshold failures", () => {
  ```

- **Issue**: The file is organized into 5 blocks: CircuitBreaker state machine, malformed rate-limit headers, entitlement error detection, shouldRefreshToken edges, URL handling edges. Every block is standard unit / input-fuzz tests. There is no filesystem-fault injection (ENOSPC, EBUSY mid-unlink), no network-fault injection (reset mid-SSE, truncated gzip), no process-fault injection (SIGTERM mid-debounce), no clock-skew injection. The file's name over-promises; the HIGH pre-seeds and Wave 1 findings that require fault injection (T06:85, T06:139, T07:62) cannot be caught by any existing test.
- **Recommendation**: Either (a) rename the file to `additional-unit-tests.test.ts` and add a proper `chaos/` suite with 6 concrete scenarios (§8.1: fs ENOSPC, SSE reader throw, SIGTERM + debounce, clock jump, concurrent OAuth, recovery crash) or (b) augment the existing file with genuine fault-injection helpers.
- **Evidence**: `Get-Content test\chaos\fault-injection.test.ts | Measure-Object -Line` = 537. Grep for `ENOSPC|EBUSY|SIGTERM|SIGINT|writeFileSync.*throw` inside the file yields zero hits.

### [HIGH | confidence=medium] "Integration" tests mock most collaborators; interaction bugs are architecturally invisible

- **File**: `test/index.test.ts:1-30` (sample) + `test/shutdown.test.ts` + 52 total `vi.mock(` sites
- **Quote**:

  ```ts
  // grep signature: test/index.test.ts uses vi.mock for lib/accounts,
  // lib/rotation, lib/refresh-queue, lib/circuit-breaker, lib/prompts/codex,
  // and several others. The "integration" test runs none of those real.
  ```

- **Issue**: 52 `vi.mock(` sites (raw grep) distribute across `test/index.test.ts`, `test/shutdown.test.ts`, `test/index-retry.test.ts`, and a dozen others. The plugin's real bugs — documented in Wave 1 as inter-module (shutdown × accounts debounce, refresh-queue × rotation-map, accounts × storage migration) — live in interactions the mocks paper over. `test/shutdown.test.ts` in particular mocks the very `AccountManager` path T06:85 documents as the HIGH bug.
- **Recommendation**: For each "integration" file, produce a companion that uses REAL modules for at least two-hop interactions. Concretely: (a) `shutdown × accounts × storage` without mocks, tempdir-based; (b) `refresh-queue × rotation × circuit-breaker` without mocks.
- **Evidence**: `(Select-String -Path test\*.ts,test\**\*.ts -Pattern 'vi\.mock\(' | Measure-Object).Count` = 52. Cross-ref W3 above.

### [MEDIUM | confidence=high] `lib/auth-rate-limit.ts` is dead code with passing tests that prove nothing

- **File**: `lib/auth-rate-limit.ts` + `test/auth-rate-limit.test.ts`
- **Quote**:

  ```ts
  // lib/auth-rate-limit.ts: ~100 lines of token-bucket for auth requests,
  // fully tested in test/auth-rate-limit.test.ts; grep for call sites
  // across lib/** yields zero production imports.
  ```

- **Issue**: T02:663 flags the module as never wired from the refresh path. The test passes (test-integrity), but covers a code path the plugin never executes, so coverage% is inflated without delivering protection.
- **Recommendation**: Decide wire vs remove in T16 refactor plan. If removed, delete both module and test in the same PR. If wired, add an integration test that demonstrates the rate-limit actually gating a refresh attempt.
- **Evidence**: T02 MEDIUM finding; T16 to confirm removal path. Cross-ref §1.2.

### [MEDIUM | confidence=high] Every fixture is inlined; production shapes drift invisibly between tests

- **File**: `test/fixtures/v3-storage.json:1` (the only fixture file) + 60+ test files with inline JSON.stringify constructions
- **Quote**:

  ```ts
  // Example pattern across suite:
  const account = { accountId: 'x', refreshToken: 'r', addedAt: 1, lastUsed: 2 }
  // built inline, never centralised, never Zod-validated at test boundary
  ```

- **Issue**: §5.2 — the single on-disk fixture is V3 storage with 1 account. All other "fixtures" are built inside `beforeEach` / inline. When production storage shape evolves, 60 files must drift in lockstep; in practice they won't. Zod cannot act as a safety net at test boundary because fixtures are not parsed through it.
- **Recommendation**: Add ≥ 15 fixture files to `test/fixtures/` per §5.1 table. Load and Zod-parse at module top of each test; fixture drift becomes a parse error.
- **Evidence**: `Get-ChildItem test\fixtures` = one file, 190 bytes.

### [MEDIUM | confidence=high] Property tests omit account-state-machine invariants

- **File**: `test/property/rotation.property.test.ts:1-end`
- **Quote**:

  ```ts
  describe("HealthScoreTracker property tests", () => {
  describe("TokenBucketTracker property tests", () => {
  describe("selectHybridAccount property tests", () => {
  ```

- **Issue**: Property tests cover 3 low-level primitives but do NOT cover `AccountManager` as a state machine. Applying arbitrary sequences of `markRateLimited` / `restore` / `remove` / `setActiveIndex` / `addAccount` — a fast-check generator of operations — would catch T03:121 (active index -1), T03:312 (silent rewrite), T03:349 (iteration mutation), and others.
- **Recommendation**: Add `test/property/account-manager.property.test.ts` generating operation sequences and asserting invariants: activeIndex always references a valid account or is explicitly sentinel; rateLimitResetTimes keys never collide across variants; removing current account either repoints or explicitly invalidates.
- **Evidence**: §7.3 cross-refs T03 findings.

### [MEDIUM | confidence=high] No test simulates V2 / V4 storage formats; migration is half-documented and half-tested

- **File**: `lib/storage/migrations.ts` + `test/storage.test.ts`
- **Quote**:

  ```ts
  // lib/storage/migrations.ts: V1 → V3 only. No V2, no V4 rejection path.
  // test/storage.test.ts: tests V1 → V3 using inline objects. No V2 / V4 fixtures.
  ```

- **Issue**: The plugin claims support for V1 → V3 migration. No test verifies a V2 file is either migrated or rejected cleanly; no test verifies V4+ (future) is rejected with a helpful error rather than crash / silent mis-parse. Forward-compat is a documented risk in the pre-seed (H4) and in T11 forward-compat topic.
- **Recommendation**: Add `test/fixtures/v2-storage.json`, `test/fixtures/v4-storage.json`; add test cases to `test/storage.test.ts` asserting V2 handling (either migrate with a specific shape transform or reject) and V4 explicit upgrade-required error.
- **Evidence**: Pre-seed H4; `lib/storage/migrations.ts` has no V2 or V4 branches.

### [MEDIUM | confidence=high] No test exercises the 500 ms debounce + process-exit race window

- **File**: `lib/accounts.ts:saveToDiskDebounced` (~line 945-966) + `lib/shutdown.ts` + `test/shutdown.test.ts`
- **Quote**:

  ```ts
  // accounts.ts: 500 ms debounce on save
  // shutdown.ts: runCleanup runs synchronous cleanup callbacks
  // shutdown.test.ts does not call AccountManager.flushPendingSave (if exists)
  ```

- **Issue**: T06:85 and T07:62 both document this exact path as HIGH. The current test suite has zero test that schedules a rotation → advances 250 ms (mid-debounce) → sends SIGTERM → inspects fs to confirm persistence. This is the single most direct test that would catch the HIGH bug.
- **Recommendation**: Add `test/shutdown-debounce-race.test.ts` (or append to `test/shutdown.test.ts`) using `vi.useFakeTimers`, real AccountManager, tempdir, manual SIGTERM dispatch.
- **Evidence**: Cross-ref W3 in §3; T06:85; T07:62.

### [MEDIUM | confidence=medium] SSE parse tests use only well-formed streams; chunk-boundary edge cases untested

- **File**: `test/response-handler.test.ts` + `lib/request/response-handler.ts:parseSseStream`
- **Quote**:

  ```ts
  // test/response-handler.test.ts encodes each event as a single chunk;
  // real upstream chunks events mid-data: line.
  ```

- **Issue**: T04:242 + T04:276 both document untested behaviour: multi-line `data:` payload dropped; partial trailing event silently discarded. Production streams routinely break mid-event; these paths are hot but not exercised.
- **Recommendation**: Add cases that split a single event into two chunks at (a) inside `data:` line, (b) between `data:` and `\n\n`, (c) mid-UTF-8 codepoint. Assert the parser reconstructs the full event.
- **Evidence**: T04:242, T04:276. `Select-String -Path test\response-handler.test.ts -Pattern 'Uint8Array|chunked|split'` returns no hits for multi-chunk event tests.

### [MEDIUM | confidence=high] Silent-failure paths (T09 inventory) have no tests asserting diagnostic output

- **File**: T09 inventory + `test/recovery.test.ts` + `test/storage.test.ts`
- **Quote**:

  ```ts
  // T09 inventory lists ≥5 silent-failure sites:
  //   saveToDiskDebounced catch+warn
  //   hydrateFromCodexCli silent continue
  //   recovery catch {} continue
  //   safeReadBody empty body
  //   browser.open auto-open failure
  ```

- **Issue**: Every silent failure is either a diagnostic bug (user cannot debug) or a data-loss bug (work silently lost). Zero test in the suite asserts "when X fails, diagnostic Y is emitted". Adding such assertions forces the silent-failure decision to be explicit.
- **Recommendation**: For each silent-failure site, add a test that mocks the underlying failure and asserts either (a) the error is surfaced via return, (b) the error is logged at ≥ warn level with the failure cause attached.
- **Evidence**: T09:282, T09:306, T09:403, T09:421, T09:674; §3 W10.

### [MEDIUM | confidence=medium] Recovery storage uses real fs but never simulates crash-mid-write

- **File**: `lib/recovery/storage.ts` + `test/recovery-storage.test.ts`
- **Quote**:

  ```ts
  // lib/recovery/storage.ts: writeFileSync / mkdirSync / unlinkSync with
  // no temp+rename. test/recovery-storage.test.ts uses happy-path write.
  ```

- **Issue**: T06:286 documents the HIGH: synchronous writes with no atomic pattern. The test suite exercises this module only on valid input; no test simulates a partial write (truncated file on disk) and reads it back to verify the `catch {} continue` path either recovers cleanly or surfaces an error. The current behaviour silently drops partial data.
- **Recommendation**: `test/recovery-storage.test.ts` — spy `writeFileSync`, have the spy write half then throw; call readParts; assert the recovery is either deterministic or emits a diagnostic.
- **Evidence**: T06:286; pre-seed H8.

### [MEDIUM | confidence=high] Git worktree project-root detection is untested

- **File**: `lib/storage/paths.ts:findProjectRoot` + `test/paths.test.ts`
- **Quote**:

  ```ts
  // storage/paths.ts uses existsSync(.git); treats FILE same as DIR.
  // test/paths.test.ts creates .git as a DIR only.
  ```

- **Issue**: T06:164 documents that `.git` as a FILE (git worktree marker pointing to `../.git/worktrees/NAME`) is accepted by `existsSync` but subsequent writers may not follow worktree semantics. No test exists. Worktree users are a real audience; this surfaces as silent per-project-storage miscategorisation.
- **Recommendation**: `test/paths.test.ts` — create a temp dir with `.git` as FILE containing `gitdir: /common` and assert project root / project key resolution matches expectation.
- **Evidence**: T06:164; pre-seed M3.

### [MEDIUM | confidence=medium] `removeAccountsWithSameRefreshToken` byte-exact compare is untested for whitespace drift

- **File**: `lib/accounts.ts:removeAccountsWithSameRefreshToken` (~line 707, 880-896) + `test/accounts.test.ts`
- **Quote**:

  ```ts
  // accounts.ts normalizes refreshToken via .trim() on storage path,
  // but in-memory removeAccountsWithSameRefreshToken compares byte-exact.
  ```

- **Issue**: T02:693 flags the asymmetry. If a user imports an account pool where the refreshToken has a trailing newline (common from hand-copied JSON), the in-memory dedup fails even though the storage layer normalized the same token. No test exercises the asymmetry.
- **Recommendation**: `test/accounts.test.ts` — add account with trailing-newline refreshToken + duplicate without newline; call remove; assert both are removed (or fail-loud about asymmetry).
- **Evidence**: T02:693; `Select-String -Path test\accounts.test.ts -Pattern 'trim|trailing|whitespace'` returns zero hits.

### [MEDIUM | confidence=high] No retry-budget × rotation coordination test

- **File**: `lib/request/retry-budget.ts` + `lib/accounts.ts` + `test/retry-budget.test.ts`
- **Quote**:

  ```ts
  // retry-budget.test.ts covers budget depletion in isolation.
  // No test: does rotation "reset" the budget? does budget exhaust hand off to rotation?
  ```

- **Issue**: T04:204 flags budget exhausting before rotation completes under correlated failures. The hand-off between two retry layers (fetch-helpers retries → retry-budget → rate-limit-backoff → circuit-breaker → rotation) is coordinated in prose but never tested as a coordinated whole.
- **Recommendation**: Add `test/retry-rotation-coordination.test.ts` constructing a scenario where all accounts are rate-limited simultaneously, assert the ordering: retry-budget exhausts → rotation triggered → budget resets OR error surfaced with coordinated reason.
- **Evidence**: T04:204; §3 W9.

### [MEDIUM | confidence=medium] Chaos naming anti-pattern + documentation drift

- **File**: `test/chaos/fault-injection.test.ts:1-537` + `test/AGENTS.md:82`
- **Quote**:

  ```ts
  // test/AGENTS.md:82 | Chaos testing | chaos/fault-injection.test.ts | fault injection
  ```

- **Issue**: The knowledge-base file advertises the test as "fault injection" while the content is unit tests. This is documentation drift between `test/AGENTS.md` claim and file substance.
- **Recommendation**: Either fix the test content (§8.1 suggestions) or correct the KB row. Preferred: add real chaos tests and relabel existing content under a descriptive `edge-cases-plus/` folder.
- **Evidence**: `test/AGENTS.md:82` claim; §8 analysis of content.

### [MEDIUM | confidence=high] Test suite has no harness for deterministic async-interleave (race testing)

- **File**: `test/audit.race.test.ts` (the one file that attempts races) + pattern absence across suite
- **Quote**:

  ```ts
  // audit.race.test.ts uses Promise.all but relies on vitest scheduler ordering,
  // not an explicit interleave controller.
  ```

- **Issue**: Race-testing (W4, W5, H5, H6, H9) requires controlling microtask ordering. The suite has no helper like `await microtaskSettle()` / `scheduler-fake`. Pre-seeded HIGHs depending on microtask interleave will remain silently uncovered until this harness exists.
- **Recommendation**: Add `test/helpers/async-interleave.ts` exposing primitives: `pause(fn)` (returns resolver), `runInterleaved(fns)`, `settleMicrotasks()`. Use in `test/refresh-queue.test.ts`, `test/accounts.test.ts`, `test/storage.test.ts`, `test/oauth-server.concurrent.test.ts`.
- **Evidence**: `Select-String -Path test\**\*.ts -Pattern 'interleave|microtaskSettle'` returns zero hits.

### [MEDIUM | confidence=medium] No test for `response.incomplete` with null response body

- **File**: `lib/request/response-handler.ts` + `test/response-handler.test.ts`
- **Quote**:

  ```ts
  // response-handler.ts handles response.done / response.completed;
  // T04:401 documents response.incomplete + null response goes un-extracted.
  ```

- **Issue**: Pre-seed M6 and T04:401 both flag this. The parser misses the JSON error body inside `response.incomplete` events when `response` is null.
- **Recommendation**: Fixture `sse-incomplete-null.json`; test asserts error object is returned with at least upstream `code` field present.
- **Evidence**: T04:401.

### [MEDIUM | confidence=medium] No test for model-family drift mid-session

- **File**: `lib/request/request-transformer.ts` + `test/request-transformer.test.ts`
- **Quote**:

  ```ts
  // T04:360 documents mid-session fallback updating modelFamily but not
  // body include / reasoning fields.
  ```

- **Issue**: When the plugin falls back from one model family to another mid-session (documented elsewhere), the body is not re-transformed accordingly. Property test covers initial family; no test covers the drift.
- **Recommendation**: `test/request-transformer.test.ts` — simulate a fallback chain event on a mid-session body, assert body `include` and `reasoning` match the new family's expectations.
- **Evidence**: T04:360; pre-seed M7.

### [MEDIUM | confidence=medium] No test for `prependThinkingPart` idempotency

- **File**: `lib/recovery/storage.ts:prependThinkingPart`
- **Quote**:

  ```ts
  // T06:248: fixed file id → two calls silently overwrite.
  ```

- **Issue**: Pre-seed H7. Double-call behaviour undefined in tests.
- **Recommendation**: See §10 #8.
- **Evidence**: T06:248.

### [MEDIUM | confidence=high] No test for `_lastCode` concurrent-login collision

- **File**: `lib/auth/server.ts` + `test/oauth-server.integration.test.ts`
- **Quote**:

  ```ts
  // server.ts: _lastCode stored on single slot per server instance.
  // integration test drives single login only.
  ```

- **Issue**: Pre-seed H5 / T07:165 both document the PKCE-verifier-mismatch risk on overlapping callbacks. Integration test does not drive two concurrent flows.
- **Recommendation**: See §10 #7.
- **Evidence**: T07:165; `test/oauth-server.integration.test.ts` reads a single-login flow.

### [MEDIUM | confidence=medium] Documented 80% coverage threshold is a weak proxy; no per-file minimum enforced

- **File**: `vitest.config.ts:18-28`
- **Quote**:

  ```ts
  thresholds: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
  }
  ```

- **Issue**: Global-only threshold allows critical modules (e.g., `lib/recovery/storage.ts`, `lib/accounts/rate-limits.ts`) to sit well below 80% while small well-covered utilities pull the global average up. No per-file threshold override exists.
- **Recommendation**: Add a `perFile` override for security-critical modules: `lib/auth/**`, `lib/storage.ts`, `lib/storage/**`, `lib/recovery/**`, `lib/accounts.ts`, `lib/accounts/**` — require ≥ 95%. Use the v8 coverage config syntax.
- **Evidence**: `vitest.config.ts` as quoted.

### [LOW | confidence=high] Inline fixtures scatter contract across 60 test files

- **File**: Every test that builds its own account shape inline
- **Quote**: (many sites; example pattern unchanged across suite)
- **Issue**: When Zod schema evolves, 60 inline JSON fragments drift. Centralised fixtures would make drift a compile-time error via Zod parse at fixture-load.
- **Recommendation**: Progressive refactor; not blocking.
- **Evidence**: `Get-ChildItem test\fixtures` = one file; suite-wide inline-build pattern.

### [LOW | confidence=medium] No tests for `table-formatter.ts` wide-char / truncation cases

- **File**: `test/table-formatter.test.ts` + `lib/table-formatter.ts`
- **Quote**: (sampling: tests assert column alignment on ASCII only)
- **Issue**: Account labels + tags can contain non-ASCII. Alignment breaks silently; output looks odd but is not testable.
- **Recommendation**: Add cases with CJK, RTL, emoji labels; assert output width respects wcwidth semantics.
- **Evidence**: `Select-String -Path test\table-formatter.test.ts -Pattern 'wide|CJK|emoji|wcwidth'` returns zero hits.

### [LOW | confidence=medium] No test for `JWT decode` on payload with missing or wrong-type fields

- **File**: `lib/auth/token-utils.ts` + `test/token-utils.test.ts`
- **Quote**: (tests assert happy shape only)
- **Issue**: T05:166 flags runtime shape validation gap. Defensive testing would catch the crash path.
- **Recommendation**: Add fuzz with missing `accountId`, wrong-type `organizationId`, non-string fields.
- **Evidence**: T05:166.

### [LOW | confidence=medium] No test for logger TOKEN_PATTERNS coverage of OpenAI opaque refresh format

- **File**: `lib/logger.ts:29-34` + `test/logger.test.ts`
- **Quote**:

  ```ts
  // logger.ts TOKEN_PATTERNS: existing regex misses opaque base64url OpenAI format.
  ```

- **Issue**: T02:829 + T09:321 flag the gap. Tests assert JWT redaction; no test asserts opaque-token redaction.
- **Recommendation**: Add fixture tokens matching OpenAI opaque refresh format and assert redaction.
- **Evidence**: T02:829, T09:321.

### [LOW | confidence=high] `test/chaos/` directory has exactly one file; naming promises more than delivers

- **File**: `test/chaos/fault-injection.test.ts` (only file in directory)
- **Quote**: (directory listing)
- **Issue**: Discoverability signal to contributors suggests a chaos-testing framework; reality is one misnamed file.
- **Recommendation**: Populate `test/chaos/` with §8.1 scenarios OR flatten the directory and rename file.
- **Evidence**: `Get-ChildItem test\chaos` = 1 file.

### [LOW | confidence=medium] No test exercises `logError` silenced-on-stderr default behaviour

- **File**: `lib/logger.ts:logError` + `test/logger.test.ts`
- **Quote**:

  ```ts
  // T09:577 flags: logError silenced on stderr by default.
  ```

- **Issue**: Default-silent logging is a footgun. Tests do not assert current behaviour either direction.
- **Recommendation**: Pin current behaviour with test before changing.
- **Evidence**: T09:577.

---

## 12. Summary Tables

### 12.1 Finding distribution

| Severity | Count | Rubric cap |
| --- | --- | --- |
| CRITICAL | 0 | ≤ 5 |
| HIGH | 4 | ≤ 15 |
| MEDIUM | 18 | ≤ 40 |
| LOW | 6 | unbounded |
| **Total** | **28** | — |

### 12.2 Pre-seed verdict summary (for QA scenario compliance)

| Verdict | Count | % of 26 |
| --- | --- | --- |
| KEEP | 24 | 92.3% |
| DEMOTED | 2 | 7.7% |
| REMOVED | 0 | 0.0% |

### 12.3 Tests-to-add prioritization summary

| Rank | Module | Severity |
| --- | --- | --- |
| 1 | `lib/accounts/rate-limits.ts` unit suite | HIGH |
| 2 | `login-runner.ts:338-339` empty-string merge | HIGH |
| 3 | Shutdown × debounced save flush | HIGH |
| 4 | `incrementAuthFailures` variant-isolation race | HIGH |
| 5 | `loadAccountsInternal` truncation diagnostic | HIGH |
| 6 | Atomic-write EBUSY orphan cleanup | HIGH |
| 7 | `_lastCode` concurrent-login PKCE isolation | HIGH |
| 8 | `prependThinkingPart` idempotency | HIGH |
| 9 | Recovery crash-mid-write | HIGH |
| 10 | SSE chunk-boundary parse | MEDIUM |
| 11 | `response.incomplete` null-response extraction | MEDIUM |
| 12 | Git worktree project-root | MEDIUM |
| 13 | V4 storage format rejection | HIGH |
| 14 | Circuit-breaker eviction during half-open | HIGH |

---

## 13. Notes + cross-references

- Security-specific test additions (W1, W6, W7) are owned by T02; this task enumerates the test gap but defers severity classification of the *underlying bug* to T02. Test-scenario severity here reflects how visible the gap is (is it one PR away from coverage?), not the security severity of the underlying bug.
- The 26-gap claim in the plan text reproduces 24 items (9+9+6). Two MEDIUM items are inferred from T02/T05/T07 cross-refs (M10 schema-drift on import, M11 proactive vs on-demand refresh). The 26-count is preserved in spirit.
- Coverage % was intentionally not generated (READ-ONLY). The `npm run test:coverage` script exists and should be the first action in any follow-up test PR.
- Out-of-scope: running coverage, writing tests, editing `vitest.config.ts`.
- Overlap management: T02 owns bugs; T13 owns test-absences; no double-counting — each finding here is a *test* gap, not a code defect. Code defects are cross-referenced, not duplicated.
- `chaos/` and `property/` directories are under-used and their naming over-promises. The same is true of `integration` suffix on tests that heavily mock collaborators.

*End of T13 findings.*
