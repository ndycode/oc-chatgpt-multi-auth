> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# 08 — Feature Recommendations

**Scope**: at most 10 features. Every entry below cites **real user pain** from a closed GitHub issue, a documented limitation, or an audit ledger row. No wishlist without a citation.

**Method**: closed-issue titles were retrieved via `gh issue list --state closed`; docs/limitations were read from `README.md`, `docs/troubleshooting.md`, `docs/faq.md`, and `docs/privacy.md`. Ledger anchors reference `docs/audits/_meta/findings-ledger.csv`.

**Exclusion rule**: features that would *introduce* new dependencies (additional services, new storage backends) were rejected unless directly required to close an open defect class — see `AGENTS.md` anti-pattern list.

---

## F1 — Dedicated audit log for account mutations

- **User pain cited**: `docs/privacy.md` promises "local-only audit trail" language; `lib/audit.ts` enum + API exists but is 100% dead (ledger HIGH `302`). Users who believe their mutations are logged are wrong.
- **Problem solved**: restores parity with documented privacy posture; enables post-incident account-forensics ("when did the plugin switch accounts and why").
- **Why it fits**: the module, types, and test scaffolding are already shipped; only call-site integration is missing.
- **Complexity**: **Short (1-4h)**. Identify the ~6 mutation points in `lib/accounts.ts` and `lib/auth/login-runner.ts`; invoke `recordAuditEvent`. No new dependencies.
- **Dependencies**: RC-7 persistence extraction is ideal but not required.
- **Priority**: Medium.
- **Risk**: Low. Audit queue already retains items on write failure; see MEDIUM ledger `160`.

---

## F2 — `NO_COLOR` + `FORCE_COLOR` support across all CLI output

- **User pain cited**: T12 HIGH ledger `221` — "Missing NO_COLOR environment variable support". This is an accessibility and CI-ergonomics concern; `https://no-color.org` is a widely-adopted convention.
- **Problem solved**: CI logs stop including ANSI escapes; screen-readers and pager output work correctly.
- **Why it fits**: existing ANSI helpers in `lib/ui/ansi.ts` all gate on `isTTY`; adding one `NO_COLOR` check + one `FORCE_COLOR` override is a 10-line patch.
- **Complexity**: **Quick (<1h)**.
- **Dependencies**: none.
- **Priority**: Medium-high.
- **Risk**: None.

---

## F3 — Scripting surface for destructive commands (`--confirm`, `--json`)

- **User pain cited**: T12 MEDIUM ledger `225` — "10 of 18 commands lack format=json support, blocking scripting". HIGH ledger `175` — "codex-remove tool has no confirmation step". Plus closed issue context around installer/account management use in workflow automation.
- **Problem solved**: (a) users can script account onboarding, (b) destructive commands fail loud on mistyped arguments.
- **Why it fits**: `tool()` wrappers already have schema support; add `confirm: boolean` and `format: 'text'|'json'` universally. Internal Zod validation catches missing `--confirm` before any side effect.
- **Complexity**: **Short (1-4h)**. Mostly schema + renderer plumbing.
- **Dependencies**: RC-1 makes this cleaner; not required.
- **Priority**: High.
- **Risk**: Low. Opt-in via new flag.

---

## F4 — Diagnostics snapshot export for bug reports

- **User pain cited**: T10 MEDIUM ledger `181` — "No diagnostics-snapshot export for bug reports; codex-doctor prints to console only". Also, `docs/troubleshooting.md` instructs users to copy-paste output manually.
- **Problem solved**: one-shot `codex-doctor --snapshot > diag.json` yielding redacted account/health/version state that users paste into GitHub issue templates.
- **Why it fits**: `codex-doctor` already assembles the payload; it just needs a serializer + redactor that re-uses `lib/logger.ts:TOKEN_PATTERNS`.
- **Complexity**: **Short (1-4h)**.
- **Dependencies**: ideally lands after the T09 logging-redaction LOW batch.
- **Priority**: Medium.
- **Risk**: Leakage risk if redactor is incomplete — pair with a new test: "diagnostic snapshot contains no TOKEN_PATTERNS substring".

---

## F5 — V2 storage-format detector + migration

- **User pain cited**: T11 HIGH ledger `201` — "V2 format has neither schema nor migrator". Closed issue #18 ("Accounts not persisted on Windows after successful login") and #19 ("Still can not log in 2 accounts although it show the success in terminal") both describe symptoms consistent with silent storage-format drops.
- **Problem solved**: users who upgraded through the 4.x line do not silently lose accounts on load.
- **Why it fits**: `lib/storage/migrations.ts` already has a V1→V3 migrator; add V2 detection + migrator.
- **Complexity**: **Medium (1-2d)** including tests for both forward and backward compatibility.
- **Dependencies**: RC-2 storage split would give this a cleaner home but is not required.
- **Priority**: High.
- **Risk**: Medium — need fixtures for V2 files; closed-issue reporters can provide anonymised samples.

---

## F6 — `codex-diff` config preview before installer writes

- **User pain cited**: T11 HIGH ledger `202` — "Installer overwrites provider.openai wholesale — user customisations silently lost". T11 MEDIUM `206` — "Corrupt opencode.json triggers silent replacement with template". Closed issues frequently mention "installer destroyed my config".
- **Problem solved**: dry-run mode shows the exact JSON diff that `npx -y oc-codex-multi-auth` would apply; users opt-in with `--yes` or interactive confirmation.
- **Why it fits**: installer already builds the merge plan internally; surfacing it requires no new merge logic.
- **Complexity**: **Short (1-4h)**.
- **Dependencies**: none.
- **Priority**: High.
- **Risk**: Low.

---

## F7 — Chaos test suite that actually injects faults

- **User pain cited**: T13 HIGH ledger `248` — "chaos/fault-injection.test.ts performs no fault injection". The filename sets user expectations that the test suite does not meet; contributors trust names.
- **Problem solved**: real coverage for the 500 ms debounce/crash window, SSE chunk-boundary defects (MEDIUM `67`, `71`), correlated rate-limit thrash (HIGH `50` pre-verification), and `_lastCode` concurrent-login collision (HIGH `123` pre-verification).
- **Why it fits**: vitest + `vi.useFakeTimers` + `vi.mock` already power the test base; only new scenario authoring is needed.
- **Complexity**: **Medium (1-2d)** for a first pass covering 4-6 scenarios.
- **Dependencies**: RC-8 (circuit-breaker wiring) gives these tests a target.
- **Priority**: Medium.
- **Risk**: Low.

---

## F8 — `codex-disable` (soft-delete) command

- **User pain cited**: T10 HIGH ledger `175` — "codex-remove tool has no confirmation step". Recurring theme across closed bug reports: users delete accounts during triage and regret it. `ARCHITECTURE.md:402` already describes "enabled" flag semantics.
- **Problem solved**: reversible version of `codex-remove`; toggles `account.enabled=false` and hides from rotation without deleting credentials.
- **Why it fits**: `AccountManager.setAccountEnabled(idx, false)` already exists and is tested.
- **Complexity**: **Quick (<1h)** — one new tool handler.
- **Dependencies**: none.
- **Priority**: Medium.
- **Risk**: None.

---

## F9 — CI pipeline (typecheck, lint, test, build) on PR

- **User pain cited**: T15 HIGH ledger `290` — "No CI execution of typecheck, lint, test, audit, or build on pull requests". Contributing guide (`CONTRIBUTING.md`) expects reviewers to do this locally; closed PRs show repeated "typecheck fails on my machine" comments.
- **Problem solved**: green-PR guarantee; CHANGELOG drift stops.
- **Why it fits**: npm scripts already exist (`typecheck`, `lint`, `test`, `build`); adding a GitHub Actions matrix is pure YAML.
- **Complexity**: **Short (1-4h)**.
- **Dependencies**: none.
- **Priority**: High.
- **Risk**: Low. Gate on success, not presence, to avoid flaky tests blocking emergency fixes.

---

## F10 — Integrated `lib/auth-rate-limit.ts` guard on OAuth callback

- **User pain cited**: T16 HIGH ledger `303` — "lib/auth-rate-limit.ts is a dead feature — never wired to OAuth flow". Closed issue #21 (Business account routing) shows confused auth-state after rapid login retries; an on-path rate limiter would return a clear 429 instead of a zombie state.
- **Problem solved**: per-IP limiter for the `/auth/callback` handler rejects rapid retry storms; users see a clear "slow down" message instead of silently corrupted OAuth state.
- **Why it fits**: module is fully implemented, tested, and exported.
- **Complexity**: **Quick (<1h)**.
- **Dependencies**: decision in RC-5.
- **Priority**: Medium.
- **Risk**: Low — defaults are generous.

---

## Notes

- **No new dependencies** introduced by any feature above; all reuse existing modules.
- **Pain-to-feature ratio**: each feature addresses ≥1 ledger entry or ≥1 historical user issue.
- **Rejected candidates**: multi-tenant account pools, GUI, remote telemetry. All expand scope beyond the "personal-use" charter in `README.md`.
