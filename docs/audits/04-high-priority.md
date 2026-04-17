> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# 04 — High-Priority Findings

**Count**: 15 of 15 cap. All entries are PASSED, non-duplicate ledger rows sorted by file path, then starting line. Each quote is verbatim from the locked SHA. Full narrative (quote, issue, recommendation, evidence) lives in the per-task finding files under `docs/audits/_findings/`; this page gives a compact operational view.

---

### [HIGH | confidence=high] No CI execution of typecheck, lint, test, audit, or build on pull requests

- **File**: `.github/workflows/pr-quality.yml:1-55`
- **Task**: T15 (ci-release) — ledger id `290`
- **Issue**: Only `.github/workflows/pr-quality.yml` exists; it runs markdown-link + spellcheck, nothing else. Every other quality gate (typecheck, lint, vitest, audit, build) runs only on a maintainer laptop. A PR can introduce a type error, broken test, or dependency regression and still merge green.
- **Recommendation**: Add a `ci.yml` matrix that runs `npm ci --ignore-scripts && npm run typecheck && npm run lint && npm test && npm run build` on Node 18/20/22 for push + PR. Gate merges on it.
- **Evidence**: `Select-String -Path .github/workflows -Pattern 'run:|npm'` shows no typecheck/test/build invocation. See §10-testing-gaps.md for the coverage-signal consequence.

---

### [HIGH | confidence=high] `codex-help` topic filter uses substring match and misleads users

- **File**: `index.ts:4992-5006`
- **Task**: T12 (cli-ui) — ledger id `223`
- **Issue**: `codex-help --topic="setup"` matches any line containing `setup` as a substring — including `"account-setup"` or `"pre-setup"` notes. Users get mixed results and no "no match" feedback when topic is genuinely unknown.
- **Recommendation**: Switch to exact match against a curated topic enum; emit a proper `UnknownTopicError` with available topic suggestions on miss.
- **Cross-refs**: See §11-dx-cli-docs.md command ergonomics.

---

### [HIGH | confidence=high] `codex-remove` tool has no confirmation step

- **File**: `index.ts:5995-6153`
- **Task**: T10 (error-handling) — ledger id `175`
- **Issue**: Calling the `codex-remove` tool immediately deletes the account; no dry-run, no confirmation prompt, no soft-disable path. Users can lose OAuth state via a mistyped index in a scripted workflow.
- **Recommendation**: Require `confirm=true` parameter OR an interactive Y/N when stdin is a TTY. Offer `codex-disable` as a reversible alternative for daily pruning.
- **Cross-refs**: §12-quick-wins.md.

---

### [HIGH | confidence=high] `lib/accounts/rate-limits.ts` is a zero-direct-test module on the rotation critical path

- **File**: `lib/accounts/rate-limits.ts:1-85`
- **Task**: T13 (test-coverage) — ledger id `246`
- **Issue**: 85 LOC of rate-limit state machine (`clearExpiredRateLimits`, quota-key math, cooldown mutation) has **no dedicated spec file**; coverage comes only from the accounts-integration tests which cannot isolate a single state transition. Regressions here cause silent rotation failures.
- **Recommendation**: Author `test/unit/rate-limits.test.ts` covering expired-clear, QuotaKey casing invariants, and concurrent clear/set interleave.
- **Cross-refs**: §10-testing-gaps.md.

---

### [HIGH | confidence=high] `lib/audit.ts` is 100% dead production infrastructure (17 enum values, 0 call sites)

- **File**: `lib/audit.ts:29-47`
- **Task**: T16 (code-health) — ledger id `302`
- **Issue**: `AuditAction` enum defines 17 action types; `recordAuditEvent` is importable and tested, but zero production code path invokes it. Dead feature masquerading as privacy infrastructure — users cannot rely on the advertised audit log because nothing is actually written.
- **Recommendation**: Either (a) wire it into `accounts.ts` mutations (add/remove/switch) and the OAuth success path, or (b) delete it with a changelog entry. Do not ship the current state indefinitely.
- **Cross-refs**: §07-refactoring-plan.md RC-5 (dead code), §09-security-trust.md trust-messaging.

---

### [HIGH | confidence=high] `lib/auth-rate-limit.ts` is a dead feature — never wired to OAuth flow

- **File**: `lib/auth-rate-limit.ts:119-126`
- **Task**: T16 (code-health) — ledger id `303`
- **Issue**: Fully-implemented, fully-tested per-IP OAuth rate limiter is *never imported* by `lib/auth/login-runner.ts` or `lib/auth/server.ts`. The guard is theatrical.
- **Recommendation**: Wire it into `lib/auth/server.ts` at the `/auth/callback` handler, or delete the module + tests. Pair with a T15 CI job that fails on dead exports.
- **Cross-refs**: §09-security-trust.md hardening-steps.

---

### [HIGH | confidence=high] Typed error hierarchy is shelf-ware

- **File**: `lib/errors.ts:33-165`
- **Task**: T10 (error-handling) — ledger id `173`
- **Issue**: `CodexApiError`, `CodexAuthError`, `CodexNetworkError`, and an `ErrorCode` enum are exported but almost nothing `throw`s them — call sites throw generic `Error`. The taxonomy cannot be used for routing, retries, or user messages.
- **Recommendation**: Port the five main throw sites in `fetch-helpers.ts` + `response-handler.ts` + `auth.ts` to the typed classes; add an ESLint rule that bans `throw new Error(` outside `lib/errors.ts` and `lib/utils.ts`.
- **Cross-refs**: §07-refactoring-plan.md RC-3.

---

### [HIGH | confidence=high] Recovery tool-result injection swallows API errors; caller cannot distinguish "no tools" from "API failed"

- **File**: `lib/recovery.ts:119-154`
- **Task**: T10 (error-handling) — ledger id `178`
- **Issue**: `injectMissingToolOutputs` catches upstream errors silently and returns an empty injection. A transient 5xx during recovery looks identical to "no tool calls present", so the user sees a phantom resume without the failed turn being replayed.
- **Recommendation**: Let the error propagate with a `RecoveryError { cause, phase: "tool-result-injection" }`; decide at a single seam whether recovery is "successful degraded" or "failed, retry".
- **Cross-refs**: §09-security-trust.md user-trust-messaging.

---

### [HIGH | confidence=high] SSE "no final response" logged at warn when it breaks the session

- **File**: `lib/request/response-handler.ts:215-220`
- **Task**: T09 (observability) — ledger id `153`
- **Issue**: When the SSE stream ends without a `response.completed`, the parser logs `"no final response"` at **warn** and returns `null`. Downstream `index.ts` then surfaces `"empty response"` to the user with no tie-back to the SSE defect. The code is session-breaking; the log level understates that.
- **Recommendation**: Escalate to `logError` with event-discriminator `sse.no-final-response`; include `accountKey`, `modelFamily`, and last-seen event type so on-call can correlate.
- **Cross-refs**: §09-security-trust.md logging, §10-testing-gaps.md SSE chunk-boundary.

---

### [HIGH | confidence=high] V4+ storage silently discarded — writable callers can clobber forward-compat data

- **File**: `lib/storage.ts:624-635`
- **Task**: T11 (config-installer) — ledger id `200`
- **Issue**: `loadAccountsInternal` treats any `schemaVersion > 3` as "unknown" and returns `null`, so subsequent `saveAccounts` *overwrites* the V4 file with a V3 payload. A user who upgrades to a newer plugin, then downgrades, silently loses the V4-only state.
- **Recommendation**: On unknown-schema-higher-than-supported, throw `StorageError("forward-compat detected; refusing to overwrite")` and instruct the user to update the plugin.
- **Cross-refs**: §07-refactoring-plan.md RC-2 (storage split), §09-security-trust.md data-loss.

---

### [HIGH | confidence=high] V2 format has neither schema nor migrator

- **File**: `lib/storage/migrations.ts:1-112`
- **Task**: T11 (config-installer) — ledger id `201`
- **Issue**: `migrations.ts` supports V1→V3; V2 is absent. Any real-world V2 file (produced by an intermediate 4.x version) is neither readable nor migrated — it is silently discarded on load.
- **Recommendation**: Add explicit V2-detection + migrator OR document V2 as formally unsupported and emit a fatal `StorageError` with a recovery URL instead of silent drop.
- **Cross-refs**: §07-refactoring-plan.md RC-2.

---

### [HIGH | confidence=high] Missing `NO_COLOR` environment variable support

- **File**: `lib/ui/ansi.ts:5-22`
- **Task**: T12 (cli-ui) — ledger id `221`
- **Issue**: ANSI helpers check only `process.stdout.isTTY`. The widely-adopted `NO_COLOR=1` convention (https://no-color.org) is ignored, which breaks CI logs, pager output, and accessibility tooling.
- **Recommendation**: Short-circuit every colour helper when `process.env.NO_COLOR` is set (any truthy value); keep `FORCE_COLOR` as the explicit override.
- **Cross-refs**: §11-dx-cli-docs.md command-ergonomics, §12-quick-wins.md.

---

### [HIGH | confidence=high] `@openauthjs/openauth@0.4.3` ships with no declared license

- **File**: `package.json:99`
- **Task**: T14 (dependencies) — ledger id `274`
- **Issue**: Top-50 dependency with missing `license` field in its manifest. Downstream distributors cannot legally redistribute the plugin bundle without individual per-user license clearance; corporate users will be blocked.
- **Recommendation**: File upstream issue; pin an earlier `@openauthjs/openauth` release that declares a license, or replace with `openid-client` which is BSD-2 licensed and audit-ready.
- **Cross-refs**: §09-security-trust.md supply-chain, §13-phased-roadmap.md phase 1.

---

### [HIGH | confidence=high] Installer overwrites `provider.openai` wholesale — user customisations silently lost

- **File**: `scripts/install-oc-codex-multi-auth-core.js:321-338`
- **Task**: T11 (config-installer) — ledger id `202`
- **Issue**: Installer replaces `opencode.json → provider.openai` with the template payload; any user-authored keys under that branch (custom baseURL, extra model entries) are discarded with no backup-aware merge.
- **Recommendation**: Deep-merge by key, not replace; if conflict is detected, back up the original and surface a `--force-replace` flag for explicit opt-in.
- **Cross-refs**: §09-security-trust.md data-loss, §11-dx-cli-docs.md install/setup-flow.

---

### [HIGH | confidence=high] `chaos/fault-injection.test.ts` performs no fault injection

- **File**: `test/chaos/fault-injection.test.ts:1-537`
- **Task**: T13 (test-coverage) — ledger id `248`
- **Issue**: The 537-line "chaos" suite is a collection of mocked request-pipeline tests. No clock drift, no network-chaos, no partial-write injection, no random-interleave — despite the filename and the documented intent in `docs/development/TESTING.md`.
- **Recommendation**: Either (a) add actual fault injection (fake timers + `vi.mock` with probabilistic rejection, crash-mid-write in recovery path), or (b) rename to `test/integration/pipeline.test.ts` so the name stops lying.
- **Cross-refs**: §10-testing-gaps.md, §12-quick-wins.md.

---

## Cap Enforcement

- HIGH cap is 15 per `_meta/AUDIT-RUBRIC.md`; this file holds **exactly 15**.
- 28 HIGH-reported findings were demoted to MEDIUM by the T17 severity-reclassification pass (see `_meta/severity-reclassifications.md`); those appear in §05-medium.md.
