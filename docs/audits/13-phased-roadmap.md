> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# 13 — Phased Roadmap

**Scope**: sequences findings from §03–§12 into four phases. Each phase names scope, tasks, benefits, dependencies, and a rollback posture. Phases are additive — the end-state of phase N is the entry condition for phase N+1.

---

## Phase 1 — Safety (ship first)

**Scope**: close the one CRITICAL, the highest-payoff HIGHs, and the correctness quick wins. No structural changes; purely defect + default fixes.

**Tasks**

| # | Task | Anchor | Effort |
|---|---|---|---|
| 1.1 | Serialize `incrementAuthFailures` via per-token promise chain | CRITICAL `47` | Short |
| 1.2 | Flush debounced save on SIGINT/SIGTERM (RC-10) | HIGH `95`, `130` | Short |
| 1.3 | Align OAuth `REDIRECT_URI` with `OAUTH_CALLBACK_LOOPBACK_HOST` | HIGH `3`, `23` | Quick |
| 1.4 | `importAccounts` default `backupMode: "timestamped"`; `exportAccounts` default `force: false`; `codex-remove` default `confirm: true` | HIGH `17`, `175`, `176`, `177` | Quick |
| 1.5 | Extend `TOKEN_PATTERNS` for OpenAI opaque refresh + regression test | HIGH `37`, `151`, `271` | Quick |
| 1.6 | V4+ forward-compat detection (throw instead of discard) | HIGH `200` | Short |
| 1.7 | V2 migrator or explicit rejection | HIGH `201` | Medium |
| 1.8 | Installer deep-merge for `provider.openai` + dry-run preview (F6) | HIGH `202` | Short |
| 1.9 | Wire `lib/auth-rate-limit.ts` into OAuth callback (F10) OR delete (RC-5) | HIGH `303` | Quick |
| 1.10 | Wire `lib/audit.ts` into mutation points (F1) OR delete (RC-5) | HIGH `302` | Short |

**Benefits**: closes the single CRITICAL and 10 HIGH items; eliminates three classes of silent data loss; restores trust in the user-facing audit & rate-limit promises.

**Dependencies**: none. Phase 1 is self-contained.

**Rollback**: every item is a small, isolated PR; revert individually. The audit/rate-limit decision in RC-5 is the one that benefits from a pre-phase RFC.

**Exit condition**: CRITICAL count = 0; HIGH count ≤ 5; no new regressions in CI (which phase 3 ships).

---

## Phase 2 — Architecture / Refactor

**Scope**: ship the structural splits that unblock the remaining MEDIUM backlog and the feature work.

**Tasks**

| # | Refactor | Effort | Prerequisite |
|---|---|---|---|
| 2.1 | RC-1 `index.ts` extraction to `lib/tools/*` + `lib/runtime.ts` | Large | — |
| 2.2 | RC-2 `lib/storage.ts` split (in parallel with 2.1) | Large | — |
| 2.3 | RC-3 typed error hierarchy port | Medium | 2.1, 2.2 |
| 2.4 | RC-7 `AccountManager` split | Large | 2.3 |
| 2.5 | RC-9 process-boundary validation | Short | 2.2 |
| 2.6 | RC-8 circuit-breaker wiring | Medium | 2.3, 2.4 |
| 2.7 | RC-4 recovery consolidation | Short | 2.1 (in progress) |
| 2.8 | RC-6 rename `runtime-contracts` + `utils` | Quick | — |
| 2.9 | RC-10 is already in Phase 1 (1.2); keep the paired flush-on-shutdown here for completeness | — | — |

**Benefits**: eliminates the two god-files identified in T01/T16 (ledger `1`, `2`, `304`, `308`); file-bound findings become diff-reviewable; error handling + validation become a single idiom.

**Dependencies**: Phase 1 shipped (safety fixes land first to avoid clobbering on rebase).

**Rollback**: each refactor lands behind a façade; re-export shims keep external callers working. If RC-1 or RC-2 misfires, revert the one PR; sibling refactors continue.

**Exit condition**: `index.ts` ≤ 1500 lines; no file in `lib/storage/` > 400 lines; `lib/errors.ts` is the only source of thrown error classes; RC-8 half-open gate is exercised by a test from §10.

---

## Phase 3 — DX, Docs, Testing

**Scope**: contributor and user experience. Everything here was deferred from Phases 1-2 because it is not correctness-critical but compounds over time.

**Tasks**

| # | Task | Anchor | Effort |
|---|---|---|---|
| 3.1 | CI workflow (F9): typecheck / lint / test / build matrix on PR | HIGH `290` | Short |
| 3.2 | Dependabot + Scorecard workflows | MEDIUM `292`, `293` | Quick each |
| 3.3 | Release automation (tag → `npm publish`) | MEDIUM `291` | Short |
| 3.4 | Keep-a-Changelog migration | MEDIUM `294` | Short |
| 3.5 | `NO_COLOR` / `FORCE_COLOR` support (F2) | HIGH `221` | Quick |
| 3.6 | Universal `--format=json` + `--confirm` for destructive commands (F3) | MEDIUM `225` | Short |
| 3.7 | Diagnostics snapshot export (F4) | MEDIUM `181` | Short |
| 3.8 | `codex-disable` soft-delete (F8) | HIGH `175` | Quick |
| 3.9 | Chaos test suite with real fault injection (F7) | HIGH `248` | Medium |
| 3.10 | Race-window + contract tests (§10 #1-5) | 10 ledger refs | Medium |
| 3.11 | Per-file vitest coverage floor 70% | LOW `267` | Quick |
| 3.12 | Doc-drift cleanup batch | LOW `12`, `240`, `241`, `242`, `299` | Short |
| 3.13 | README badges + CI status | LOW `297` | Quick |
| 3.14 | CONTRIBUTING local-dev section | LOW `300` | Quick |
| 3.15 | Extend Husky hooks (commit-msg + pre-push) | LOW `298` | Quick |

**Benefits**: green-PR guarantee; contributor on-ramp drops from hours to minutes; supply-chain posture joins OpenSSF-aligned projects.

**Dependencies**: Phase 2 preferred (typed errors + split files make tests easier to author) but 3.1-3.4 can land earlier to unblock CI signal for Phase 2 reviewers.

**Rollback**: CI workflows are additive; remove to revert. Doc changes are text-only.

**Exit condition**: CI green on three Node majors; Dependabot PRs land weekly; Scorecard reports ≥ 7/10; every HIGH and MEDIUM from §04-§05 has a test asserting its absence.

---

## Phase 4 — New Features

**Scope**: new capability only after safety + architecture + DX are stable.

**Tasks**

| # | Feature | Anchor | Effort |
|---|---|---|---|
| 4.1 | Audit log surface in `docs/privacy.md` + CLI (F1) — lands if RC-5 chose "wire in" | HIGH `302` | Short |
| 4.2 | OS-keychain integration for refresh tokens (opt-in) | §09 hardening step 8 | Medium |
| 4.3 | Multi-worktree collision detection for project-key hash | HIGH `41`, `99` | Short |
| 4.4 | `codex-diff` command (config preview between installs) | F6 extension | Short |
| 4.5 | Response-envelope contract tests framework (future-proofing for upstream API changes) | HIGH `247` pre-verification | Medium |
| 4.6 | (Optional) GUI-free interactive setup wizard — deferred; `codex-setup` already covers this. | — | — |

**Benefits**: fulfills promises made in `docs/privacy.md`; optional hardening; future-proofs the test harness against upstream changes.

**Dependencies**: Phases 1-3 shipped.

**Rollback**: each feature ships behind a flag (env var or explicit opt-in); turn off the flag to revert.

**Exit condition**: no HIGH findings open; MEDIUM count ≤ 10; audit + Scorecard both green.

---

## Calendar sketch (for a single maintainer)

- **Phase 1**: 3-5 days (clustering around the CRITICAL fix).
- **Phase 2**: 2-3 weeks (parallel structural refactors + review).
- **Phase 3**: 1 week (mostly YAML + test authoring).
- **Phase 4**: opportunistic; 1-2 features per quarter.

---

## Stop conditions

- If any Phase 1 item forces Phase 2 to start before it lands, pause Phase 2.
- If Phase 3 CI reveals a new HIGH finding, add it to Phase 1 of the next minor.
- If Phase 4 introduces a new dependency, RFC first (per `AGENTS.md` anti-pattern list).
