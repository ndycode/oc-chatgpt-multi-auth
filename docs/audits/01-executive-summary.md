> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# 01 — Executive Summary

**Repository**: `oc-codex-multi-auth` — OpenCode plugin intercepting OpenAI SDK calls and routing through a ChatGPT Codex OAuth backend with multi-account rotation. Version: `v6.0.0` (per `CHANGELOG.md`). Languages: TypeScript (strict), ESM-only Node ≥ 18.

**Audit effort**: 16 task audits (T01–T16) producing 10,841 lines across `docs/audits/_findings/`. Verification layer T17 extracted 320 findings; after Layer-2 citation check and Layer-3 dedup/severity reclassification, **149 unique PASSED findings** survive: 1 CRITICAL, 15 HIGH, 40 MEDIUM, 93 LOW. See `_meta/verification-report.md`, `_meta/dedup-report.md`, `_meta/severity-reclassifications.md` for the trail.

---

## Maturity assessment

**Overall**: **mid-to-late maturity for a single-maintainer plugin**, early for commercial/enterprise use.

- The codebase shows TypeScript-senior hygiene: strict mode, `noImplicitAny`, discriminated unions, Zod schema source-of-truth in `lib/schemas.ts`. Anti-pattern surface in production code is near-zero (`no-explicit-any` enforced; `as any` banned).
- Package hygiene is deliberate: aggressive dependency overrides, per-project + global storage, `files:` allowlist, `.npmignore` present.
- Documentation and public-policy surface exist: `README.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue templates, `docs/` with architecture/getting-started/configuration/faq/privacy/troubleshooting.
- Test coverage claims 80% at the line level (`vitest.config.ts`). 60+ test files exist covering the common auth + rotation + storage paths.

**Counter-signals**:
- No CI runs typecheck, lint, test, audit, or build on pull requests (`pr-quality.yml` is markdown-only) — HIGH `290`.
- Two advertised features (`lib/audit.ts`, `lib/auth-rate-limit.ts`) are 100% dead production code (HIGH `302`, `303`).
- 5975-line `index.ts` and 1296-line `lib/storage.ts` block safe incremental change.
- One package in the credential path (`@openauthjs/openauth@0.4.3`) ships without a declared license.

---

## Biggest strengths

- **Strict TypeScript + schema source-of-truth**. Zod schemas drive `lib/types.ts` and most boundary parsing; discriminated unions (e.g., `TokenResult`) are a first-class pattern. Type-safety findings ([§05-medium.md](05-medium.md)) are *polish*, not *risk*.
- **Zero `as any`, zero `@ts-ignore`, zero `@ts-expect-error`** in production code.
- **Dependency discipline**: aggressive overrides block known-bad transitives (ledger id `276`); Node engines constrained; ESM-only.
- **SECURITY.md present with triage channel** (LOW `295` only asks for a dedicated email).
- **Prompt-template ETag caching** (`lib/prompts/codex.ts`) is a model of cache-correctness: SWR + If-None-Match + bundled fallback.
- **Proactive-refresh + refresh-queue** is well-structured — the defects in it are persistence races (HIGH `14`), not architectural mistakes.

---

## Biggest risks

1. **Credential handling has five latent defects** that are defensible-in-depth but one accident away from CRITICAL (plaintext persistence, unsigned cross-process injection, credential resurrection on merge, unverified JWT identity, silent token loss on refresh). See [§09-security-trust.md](09-security-trust.md).
2. **One active CRITICAL race** in `lib/accounts.ts:728-733` (auth-failure counter across org-variant accounts). See [§03-critical-issues.md](03-critical-issues.md).
3. **Silent-failure chains** across storage, recovery, and logger — swallowed errors, `warn`-level on session-breaking conditions, unbounded log files. See [§05-medium.md](05-medium.md), [§09-security-trust.md](09-security-trust.md).
4. **Two monolithic modules** (`index.ts`, `lib/storage.ts`) prevent safe incremental change and concentrate blast radius. See [§04-high-priority.md](04-high-priority.md), [§07-refactoring-plan.md](07-refactoring-plan.md).
5. **Dead code shipping as if live** — `lib/audit.ts` and `lib/auth-rate-limit.ts`. See [§04-high-priority.md](04-high-priority.md).
6. **No CI validation on PRs** — regressions reach main; coverage, type, and lint signals are maintainer-local only. See [§11-dx-cli-docs.md](11-dx-cli-docs.md).
7. **Destructive defaults** — `importAccounts(backupMode:"none")`, `exportAccounts(force:true)`, `codex-remove` without confirmation. See [§06-low-priority.md](06-low-priority.md) and [§12-quick-wins.md](12-quick-wins.md).
8. **Storage-format forward-compat gap** — V4+ is silently discarded; V2 has no migrator. See [§04-high-priority.md](04-high-priority.md).
9. **Testing**: documented 80% coverage masks zero direct tests for `lib/accounts/rate-limits.ts`, no fault-injection despite a 537-line "chaos" file, and no contract tests for external API shapes. See [§10-testing-gaps.md](10-testing-gaps.md).
10. **Supply chain**: `@openauthjs/openauth@0.4.3` ships with no declared license. See [§04-high-priority.md](04-high-priority.md), [§09-security-trust.md](09-security-trust.md).

---

## Top 5 priorities (next 3-5 days)

1. **Ship the CRITICAL fix** — per-refresh-token promise chain in `lib/accounts.ts:728-733` + paired test (§10 #1, §03 entry). Effort: Short.
2. **Flush debounced save on shutdown** — RC-10 closes a correlated defect class. Effort: Short. See [§07-refactoring-plan.md](07-refactoring-plan.md).
3. **Turn on CI (typecheck/lint/test/build) on PRs** — F9 unblocks everything else. Effort: Short. See [§11-dx-cli-docs.md](11-dx-cli-docs.md).
4. **Swap destructive defaults** — `importAccounts(backupMode:"timestamped")`, `exportAccounts(force:false)`, `codex-remove(confirm:true)`. Effort: Quick. See [§12-quick-wins.md](12-quick-wins.md).
5. **Decide `lib/audit.ts` + `lib/auth-rate-limit.ts`** via a single RFC — either wire in (F1/F10) or retire (RC-5). Effort: Short. See [§07-refactoring-plan.md](07-refactoring-plan.md), [§08-feature-recommendations.md](08-feature-recommendations.md).

The full 20-item prioritised list lives in [§14-top20.md](14-top20.md); adversarial verification outcomes in [`_meta/oracle-review.md`](_meta/oracle-review.md). For calendar sequencing see [§13-phased-roadmap.md](13-phased-roadmap.md).

---

## Per-chapter anchor pointers

Every domain chapter contributes to this summary:

- **[§02-system-map.md](02-system-map.md)** — architecture + trust boundaries backing the "biggest risks" list.
- **[§03-critical-issues.md](03-critical-issues.md)** — the single CRITICAL race.
- **[§04-high-priority.md](04-high-priority.md)** — 15 HIGHs spanning security, reliability, storage, CLI, CI.
- **[§05-medium.md](05-medium.md)** — 40 MEDIUMs including the silent-failure cluster.
- **[§06-low-priority.md](06-low-priority.md)** — 93 LOW items as a batched backlog.
- **[§07-refactoring-plan.md](07-refactoring-plan.md)** — RC-1..RC-10 unblocking the HIGH/MEDIUM backlog.
- **[§08-feature-recommendations.md](08-feature-recommendations.md)** — 10 user-pain-anchored features.
- **[§09-security-trust.md](09-security-trust.md)** — credential lifecycle + hardening steps.
- **[§10-testing-gaps.md](10-testing-gaps.md)** — race-window + contract + property tests to add.
- **[§11-dx-cli-docs.md](11-dx-cli-docs.md)** — OSS-readiness scorecard.
- **[§12-quick-wins.md](12-quick-wins.md)** — 20 ≤ 2-hour changes, high ROI.
- **[§13-phased-roadmap.md](13-phased-roadmap.md)** — four phases with rollback posture.
- **[§14-top20.md](14-top20.md)** — final ranked action list.
- **[§15-file-by-file.md](15-file-by-file.md)** — disposition per module.
- **[§16-verdict.md](16-verdict.md)** — scorecard + ship/don't-ship.

---

## Bottom line

The project is **structurally healthy** — mature TS/Node posture, explicit schemas, decent docs — but **operationally exposed** through one active race, destructive defaults, dead-code promises in privacy features, and no CI gating. The remediation cost is modest: **Phase 1 (safety + CI) is 3-5 days for a single maintainer**, after which the HIGH backlog halves and every subsequent change lands under test + type + lint protection.
