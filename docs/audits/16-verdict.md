> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# 16 — Verdict

**Structural health**: **YES** — ship path exists and is cheap.

**Main bottleneck**: one live CRITICAL race + no CI gating. Every other defect is latent or cosmetic.

**What to do first**: the five-item safety sprint named in [§01-executive-summary.md#top-5-priorities](01-executive-summary.md). Three to five days, one maintainer.

**What never to break**: the OAuth PKCE flow, the 127.0.0.1 loopback binding contract, the `reasoning.encrypted_content` passthrough, atomic `writeFileWithTimeout` + `renameWithWindowsRetry`, Zod as the source of truth for `lib/schemas.ts` types, the mutex in `withAccountStorageTransaction`, and the `store: false` default on outbound Codex requests.

---

## Scorecard

| Dimension | Rating | Evidence / primary chapter |
|---|---|---|
| Correctness | **B** | 1 CRITICAL + 15 HIGH, most with mechanical fixes | [§03](03-critical-issues.md), [§04](04-high-priority.md) |
| Security posture | **B–** | Defensible credential handling; 5 hardening steps queued | [§09](09-security-trust.md) |
| Architecture | **B–** | 2 god-files; RC-1 + RC-2 unblock the backlog | [§07](07-refactoring-plan.md) |
| Reliability | **B** | Circuit breaker is theatre; persistence races present | [§07 RC-8, RC-10](07-refactoring-plan.md) |
| Observability | **C+** | TOKEN_PATTERNS incomplete; session-break mis-logged; unbounded per-req dumps | [§04](04-high-priority.md), [§05](05-medium.md) |
| Error handling | **C+** | Typed hierarchy exists but unused | [§07 RC-3](07-refactoring-plan.md) |
| Testing | **B–** | 80% aggregate coverage; chaos suite theatrical; no contract tests | [§10](10-testing-gaps.md) |
| DX / CLI | **B** | Mostly great; no NO_COLOR, destructive defaults, no `--format=json` universal | [§11](11-dx-cli-docs.md) |
| Docs | **B** | Exists and consistent; v6 rebrand under-documented | [§11](11-dx-cli-docs.md) |
| Supply chain | **B–** | One license-missing dep; concentration risk | [§09](09-security-trust.md) |
| CI / OSS readiness | **C** | No full CI on PRs; no Dependabot; no Scorecard | [§11](11-dx-cli-docs.md), [§13 phase 3](13-phased-roadmap.md) |
| Type safety | **A–** | Strict mode, no `any`, Zod-first | [§05](05-medium.md) |

**Aggregate**: **B-**, trending B+ once Phase 1 + Phase 3.1 (CI) land. A- is plausible within one quarter post-Phase-2.

---

## Ship / hold matrix

| Release gate | Status | Action |
|---|---|---|
| Ship current `main` to users? | **HOLD** minor release until CRITICAL `47` fix lands. | Phase 1 item 1.1. |
| Ship to new enterprise users? | **HOLD** pending supply-chain (HIGH `274`) + hardening steps. | Phase 1 + §09 hardening. |
| Ship incremental improvements? | **YES** under Phase 1 scope. | Five-item sprint. |
| Open external contributions? | **YES** once F9 CI is in place. | Phase 3.1. |

---

## Never break these invariants

1. **OAuth PKCE flow** — every login must generate a fresh `code_verifier` and validate `state` in constant time. Do not accept server-provided verifiers (ledger `26`).
2. **127.0.0.1 loopback binding** — OAuth callback server binds the literal loopback IP (RFC 8252 §7.3). Align `REDIRECT_URI` to match.
3. **`reasoning.encrypted_content` passthrough** — stateless multi-turn sessions depend on this; see `lib/request/request-transformer.ts` and `docs/development/ARCHITECTURE.md`.
4. **Atomic write + rename** — keep `writeFileWithTimeout` + `renameWithWindowsRetry`; do not replace with raw `fs.writeFile` on the account path.
5. **Account storage mutex** — `withAccountStorageTransaction` is the only gate against concurrent mutation; refactors must preserve the contract.
6. **Zod is the source of truth for boundary parsing** — `lib/schemas.ts` drives types; boundary JSON must go through `parseValidated<T>` (RC-9).
7. **`store: false` on Codex requests** — non-negotiable for the Codex backend; never switch to platform-API semantics.
8. **Per-project isolation** — `~/.opencode/projects/<project-key>/` boundary must not leak global account state into project stores.
9. **Read-only audit docs** — nothing under `docs/audits/` should be consumed by runtime code.

---

## Decision log (for future auditors)

- **Severity caps respected**: CRITICAL ≤5 (actual 1), HIGH ≤15 (actual 15), MEDIUM ≤40 (actual 40), LOW unbounded (actual 93).
- **Dedup applied**: 54 clusters, 108 duplicate rows removed; canonical row kept per cluster.
- **Adversarial review**: 20/20 top-20 items CONFIRMED, 0 QUESTIONABLE, 0 REJECTED (see `_meta/oracle-review.md`).
- **Placeholders**: zero. Cross-scope citations: zero.

---

## Final recommendation

Execute [§13-phased-roadmap.md](13-phased-roadmap.md) **Phase 1 this sprint** (3-5 days). Defer Phase 2 structural refactors until Phase 3.1 CI is green so that every refactor ships under type + test protection. Phase 4 features only after HIGH count reaches zero and Scorecard ≥ 7.

**Line count**: this file is intentionally concise; the rest of the audit explains the evidence.
