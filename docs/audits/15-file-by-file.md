> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# 15 — File-by-File Review

**Inclusion criteria**: a file appears here iff it has ≥ 1 finding of severity ≥ MEDIUM OR is flagged as a complexity hotspot in T16 code-health (lines >500, ≥30 exports, or named in the T01 dependency graph as a fan-in/fan-out concentration).

**Cap**: ≤ 30 files (enforced). The list below is **exactly 28** files; two slots reserved for emergent concerns.

**Disposition legend**: `preserve` · `refactor` · `split` · `rename` · `harden` · `retire`.

---

## lib/accounts.ts

- **Severity mix**: 1 CRITICAL + 7 MEDIUM.
- **Purpose**: AccountManager god-class (40+ methods): account CRUD, rotation pointers, cooldown, quota, CLI bridge, debounced persistence.
- **Concerns**: CRITICAL auth-failure race (`47`); persistence debounce loses writes (`120`); active-index reset to `-1` leaves non-codex family clawless (`48`); identity normalization asymmetry (`49`); hybrid selection bypasses eligibility (`51`); `setActiveIndex` bypasses rate-limit/cooldown (`54`); `getActiveIndexForFamily` silently rewrites `-1` → `0` (`55`); Codex-CLI bridge accepts unvalidated JSON (`15`).
- **Opportunities**: RC-7 extraction; type-safe state machine; persistence boundary isolation.
- **Disposition**: **split** (RC-7) + **harden** (CRITICAL fix first).

## index.ts

- **Severity mix**: 2 HIGH + 2 MEDIUM.
- **Purpose**: plugin entry, 18 inline `codex-*` tools, fetch pipeline, runtime metrics, beginner UX.
- **Concerns**: 5975-line monolith (`1`, `304`); `codex-remove` no confirmation (`175`); `codex-help` substring filter (`223`); metrics are process-local (`161`); `toolOutputFormatSchema` throws opaque error (`228`).
- **Opportunities**: RC-1 split into `lib/tools/*` + `lib/runtime.ts`.
- **Disposition**: **split** (RC-1) + **harden** tools.

## lib/storage.ts

- **Severity mix**: 2 HIGH + 3 MEDIUM (+ numerous LOW demotions).
- **Purpose**: atomic write, mutex, load/save/clear, flagged-account store, import/export/backup, normalization — 1296 lines, ~30 exports.
- **Concerns**: V4+ silently discarded (`200`); forward-compat hazard; silent-null on parse failure (`96`); import schema unvalidated (`81`); unsafe defaults on import/export (`17`); unchecked `as unknown as` union (`84`).
- **Opportunities**: RC-2 split.
- **Disposition**: **split** (RC-2) + **harden** defaults.

## scripts/install-oc-codex-multi-auth-core.js

- **Severity mix**: 1 HIGH + 3 MEDIUM (+ LOW).
- **Purpose**: installer — writes `~/.config/opencode/opencode.json`, merges template, clears caches.
- **Concerns**: `provider.openai` wholesale overwrite (`202`); no rollback on partial write (`205`); corrupt config silently replaced (`206`); non-crypto randomness in atomic temp (`207`); ms-collision backup timestamp (`208`); home-dir resolver drift (`203`); `mergeFullTemplate` throws without hint (`213`).
- **Opportunities**: dry-run diff preview; shared resolver with runtime.
- **Disposition**: **harden** (safe defaults + dry-run).

## lib/recovery.ts

- **Severity mix**: 1 HIGH + 2 MEDIUM.
- **Purpose**: top-level recovery orchestrator (367 lines) sitting sibling to `lib/recovery/` subfolder.
- **Concerns**: tool-result injection swallows API errors (`178`); `resumeSession` swallows prompt error (`184`); toast failure silently swallowed (`187`); structural fracture with subfolder (`5`, `311`).
- **Opportunities**: RC-4 consolidation into `lib/recovery/`.
- **Disposition**: **refactor** (RC-4).

## lib/recovery/storage.ts

- **Severity mix**: 2 MEDIUM (+ LOW).
- **Purpose**: filesystem I/O for session recovery.
- **Concerns**: `prependThinkingPart` fixed file id overwrite (`101`); readers silently discard corruption (`183`).
- **Opportunities**: fsync + temp-file pattern; idempotency key based on content hash.
- **Disposition**: **harden**.

## lib/auth/login-runner.ts

- **Severity mix**: 1 HIGH (demoted) + 2 MEDIUM.
- **Purpose**: OAuth login orchestration + account resolution.
- **Concerns**: `||` vs `??` in credential merge (`16`); cause-chain leaks token paths (`28`); `CODEX_AUTH_ACCOUNT_ID` trusted verbatim (`27`).
- **Opportunities**: align merge semantics; scrub cause chains in log adapters.
- **Disposition**: **harden**.

## lib/logger.ts

- **Severity mix**: 2 MEDIUM + LOW cluster.
- **Purpose**: log infrastructure, redaction (`TOKEN_PATTERNS`), per-request file dumps.
- **Concerns**: opaque refresh-token format not masked (`37`, `151`); correlation-id not propagated across async (`152`); per-request dumps unbounded (`159`); no timestamp in console (`169`).
- **Opportunities**: structured events; AsyncLocalStorage correlation; size-capped log files.
- **Disposition**: **harden**.

## lib/refresh-queue.ts

- **Severity mix**: 2 MEDIUM.
- **Purpose**: deduplicates concurrent token-refresh calls keyed by refresh token.
- **Concerns**: `tokenRotationMap` keyed by raw token (`29`); stale eviction abandons in-flight promise (`30`); key-only deletion on cleanup (`125` pre-verification).
- **Opportunities**: key by hash; robust eviction with `Promise.race` settlement detection.
- **Disposition**: **harden**.

## lib/request/response-handler.ts

- **Severity mix**: 1 HIGH + 2 MEDIUM.
- **Purpose**: SSE parser + response finalizer.
- **Concerns**: "no final response" logged at warn (`153`); quadratic concat (`133`); MAX_SSE_SIZE enforcement after concat (`134`); SSE chunk-boundary edge-cases.
- **Opportunities**: streaming concat with size gate up-front; typed-error propagation for session-breaking conditions.
- **Disposition**: **harden**.

## lib/audit.ts

- **Severity mix**: 1 HIGH + 1 MEDIUM.
- **Purpose**: *advertised* privacy audit log; 100% dead.
- **Concerns**: dead module (`302`); queue retains items on write failure unbounded (`160`); unused `AuditAction` enum members (`310`).
- **Opportunities**: wire into mutation points (F1) or retire (RC-5).
- **Disposition**: **decide** (wire-in or retire) — RC-5 RFC.

## lib/auth-rate-limit.ts

- **Severity mix**: 1 HIGH + 1 MEDIUM.
- **Purpose**: per-IP OAuth rate limiter; never imported.
- **Concerns**: dead feature (`303`); duplicated normalization pattern (`315`).
- **Opportunities**: wire into `/auth/callback` (F10) or retire.
- **Disposition**: **decide** — RC-5 RFC.

## lib/errors.ts

- **Severity mix**: 1 HIGH + 3 MEDIUM (demoted into MEDIUM/LOW).
- **Purpose**: typed error hierarchy — `CodexApiError`, `CodexAuthError`, `CodexNetworkError`, `ErrorCode`.
- **Concerns**: hierarchy is shelf-ware (`173`); `.retryable` unused (`179`); ErrorCode enum missing codes (`186`); `ErrorCode` accepts any string (`192`).
- **Opportunities**: RC-3 port throw sites.
- **Disposition**: **refactor** (RC-3) + absorb `StorageError` from `lib/storage.ts`.

## lib/circuit-breaker.ts

- **Severity mix**: 1 HIGH pre-verification + 1 MEDIUM.
- **Purpose**: CircuitBreaker class with closed/open/half-open states.
- **Concerns**: breaker never gates requests (`174` pre-verification); `CircuitOpenError` lacks code/context (`199`); half-open eviction destroys failure history (`126`).
- **Opportunities**: RC-8 wire into fetch pipeline.
- **Disposition**: **wire-in** (RC-8).

## lib/shutdown.ts

- **Severity mix**: 1 MEDIUM (shutdown-race).
- **Purpose**: graceful shutdown / cleanup registry.
- **Concerns**: never flushes debounced saves (`95`, `130`); all errors silently caught (`119`).
- **Opportunities**: RC-10 flush-on-shutdown.
- **Disposition**: **harden** (RC-10).

## lib/proactive-refresh.ts

- **Severity mix**: 1 HIGH demoted.
- **Purpose**: background token-refresh pump.
- **Concerns**: `applyRefreshResult` mutates in-memory without persist (`14`, `121`).
- **Opportunities**: call `flushPendingSave` on refresh success.
- **Disposition**: **harden**.

## lib/rotation.ts

- **Severity mix**: 1 MEDIUM.
- **Purpose**: hybrid scoring, token bucket, jitter helpers.
- **Concerns**: `addJitter` symmetric + clamp to 0 (`59`); `TokenBucketTracker.tryConsume` non-atomic (`122`); docstring contradicts default weight (`60`).
- **Opportunities**: integer math with monotonic timer; clearer jitter formula.
- **Disposition**: **harden**.

## lib/accounts/rate-limits.ts

- **Severity mix**: 1 HIGH + 1 MEDIUM.
- **Purpose**: quota-keyed rate-limit state.
- **Concerns**: zero direct tests (`246`); clear-during-iteration (`57`); structural confusion with `lib/accounts.ts` (`312`); index signature drops `QuotaKey` invariant (`88`).
- **Opportunities**: promote to `lib/rate-limits/` or keep; add tests.
- **Disposition**: **harden** + **test**.

## lib/storage/paths.ts

- **Severity mix**: 1 MEDIUM + LOW cluster.
- **Purpose**: storage-path resolution, project-root detection.
- **Concerns**: `resolvePath` cwd+tmp allowlist (`104`); project-key 48-bit truncation (`99`); case-fold only on win32 (`103`); `findProjectRoot` inconsistent worktree semantics (`98` pre-verification).
- **Opportunities**: widen key to 72-bit; explicit worktree detection.
- **Disposition**: **harden**.

## lib/storage/migrations.ts

- **Severity mix**: 1 HIGH + 1 MEDIUM (dedup behind 201).
- **Purpose**: V1 → V3 storage migrator.
- **Concerns**: V2 has neither schema nor migrator (`201`); rateLimitResetTime boundary drops (`210`).
- **Opportunities**: add V2 handler; explicit "unknown version" error.
- **Disposition**: **refactor** + **harden**.

## lib/config.ts

- **Severity mix**: 1 MEDIUM (dedup).
- **Purpose**: plugin-config loader.
- **Concerns**: unvalidated `userConfig` spread (`83`, `204`).
- **Opportunities**: RC-9.
- **Disposition**: **harden** (RC-9).

## lib/prompts/codex.ts

- **Severity mix**: 1 MEDIUM.
- **Purpose**: prompt template sync + GitHub ETag cache.
- **Concerns**: 304 thrown when cache file missing (`64`); SWR bumps memory timestamp (`79`); bundled fallback path may not resolve in dist (`77`).
- **Opportunities**: explicit cache-miss path; deterministic dist resolution.
- **Disposition**: **harden**.

## lib/request/fetch-helpers.ts

- **Severity mix**: 1 MEDIUM (demoted).
- **Purpose**: Codex header building, fetch execution, error mapping (870 lines).
- **Concerns**: no per-read stall timeout on streaming (`63`); `safeReadBody` masks errors (`157`); URL parsed twice per request (`143`).
- **Opportunities**: RC-3 port throw sites; share URL parse.
- **Disposition**: **refactor**.

## lib/request/request-transformer.ts

- **Severity mix**: LOW (demoted) + near-split threshold.
- **Purpose**: model normalization, prompt injection, orphan-tool recovery (998 lines).
- **Concerns**: near-split threshold (`316`); normalize runs 16 probes per request (`144`).
- **Opportunities**: split into `model-normalize.ts` + `prompt-inject.ts` + `orphan-tool.ts`.
- **Disposition**: **split** (post-RC-1).

## lib/runtime-contracts.ts

- **Severity mix**: LOW (demoted).
- **Purpose**: misnamed 28-line OAuth-constants file.
- **Opportunities**: RC-6 rename to `lib/auth/constants.ts`.
- **Disposition**: **rename** (RC-6).

## lib/utils.ts

- **Severity mix**: 1 MEDIUM.
- **Purpose**: generic helpers (`isRecord`, `nowMs`) — underused.
- **Concerns**: duplicates in 4 modules (`306`).
- **Opportunities**: RC-6 absorb duplicates.
- **Disposition**: **refactor** (RC-6).

## package.json

- **Severity mix**: 1 HIGH + 9 MEDIUM (cluster).
- **Purpose**: manifest — deps, overrides, engines, scripts, files.
- **Concerns**: `@openauthjs/openauth` no license (`274`); plugin SDK 2 minors behind; ESLint 10 requires Node ≥ 20; zod duplicated; pre-1.0 deps in credential path; husky breaks `npm install` in non-git env; dev-script ships in publish surface.
- **Opportunities**: `peerDependencies`; pin license-declared alternative; tighten engines.
- **Disposition**: **harden**.

## .github/workflows/pr-quality.yml

- **Severity mix**: 1 HIGH.
- **Purpose**: PR quality checks — currently markdown + spellcheck only.
- **Concerns**: no typecheck/lint/test/build on PR (`290`).
- **Opportunities**: extend to full matrix (F9).
- **Disposition**: **harden** (F9).

## test/chaos/fault-injection.test.ts

- **Severity mix**: 1 HIGH + 1 MEDIUM.
- **Purpose**: file is named "chaos" but performs no fault injection (537 lines).
- **Concerns**: naming anti-pattern + doc drift (`248`, `261`).
- **Opportunities**: F7 add real fault scenarios OR rename.
- **Disposition**: **decide** (F7 vs rename).

---

### Not listed but worth watching (addendum)

- `lib/auth/auth.ts` — 1 HIGH demoted (JWT signature unverified, REDIRECT_URI drift). Fold into `lib/auth/constants.ts` rename.
- `lib/health.ts` — 2 MEDIUM + LOW (closed-circuit invisibility, formatter hides "all closed"). Small file; harden in place.
- `lib/oauth-success.ts` — 629 lines of inline HTML (`237`). Candidate for asset extraction (not critical).
- `lib/table-formatter.ts` + `lib/ui/select.ts` — grapheme-width bugs. Batch fix under [§11-dx-cli-docs.md](11-dx-cli-docs.md).

---

### Disposition summary

| Disposition | Count |
|---|---:|
| harden | 14 |
| refactor | 5 |
| split | 3 |
| rename | 1 |
| decide | 3 |
| watch | 4 (not in cap) |

**Total files in cap**: 28 (≤ 30 per spec).

