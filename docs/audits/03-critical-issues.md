> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv
# 03 — Critical Issues

**Count**: 1 (cap ≤ 5). All CRITICAL findings in this report are surviving verified, non-duplicate rows from the ledger.

**How to read**: Each entry below is lifted verbatim from the underlying audit task (T03). Severity and confidence are unchanged. Anchors are stable for cross-reference from other chapters.

---

### [CRITICAL | confidence=high] In-memory auth-failure increment race across shared refresh tokens

- **File**: `lib/accounts.ts:728-733`
- **Task**: T03 (rotation) — ledger id `47`
- **Quote**:

  ```ts
  incrementAuthFailures(account: ManagedAccount): number {
      const currentFailures = this.authFailuresByRefreshToken.get(account.refreshToken) ?? 0;
      const newFailures = currentFailures + 1;
      this.authFailuresByRefreshToken.set(account.refreshToken, newFailures);
      return newFailures;
  }
  ```

- **Issue**: Two concurrent requests against different org-variant accounts that share `refreshToken` both read `currentFailures`, both compute `+1`, and both `set()` the same result — one increment is lost. Because auth-failure thresholds are the trigger for `removeAccountsWithSameRefreshToken` (`lib/accounts.ts:893`), losing an increment can **mask a hard-auth-failure across org variants**, causing the manager to keep hammering a dead token and produce stuck-login/loop-429 symptoms.
- **Recommendation**: Serialize increment-and-decision via a per-refresh-token promise chain — `Map<refreshToken, Promise<number>>` — so the "threshold reached" decision is always made against a stable counter. The lightest fix is an inline lock around the read-modify-write; the better fix also persists the counter to disk before the decision fires (see [§04-high-priority.md](04-high-priority.md) HIGH `applyRefreshResult` for the paired persistence race).
- **Evidence**: Direct source read at the locked SHA. Pre-seeded T13 test gap (`bg_707b6648`) independently flagged this as a high-priority untested path.
- **Cross-refs**: [§07-refactoring-plan.md#rc-1-multi-account-state-machine](07-refactoring-plan.md), [§10-testing-gaps.md#race-window-coverage](10-testing-gaps.md), [§14-top20.md](14-top20.md) top-priority item.

---

## Notes on Critical-Tier Coverage

- **Why only 1 CRITICAL**: T17 severity reclassification (see `docs/audits/_meta/severity-reclassifications.md`) demoted 28 HIGH findings to MEDIUM and 50 MEDIUM findings to LOW after applying the severity caps (CRITICAL ≤5, HIGH ≤15, MEDIUM ≤40). Even under the more permissive pre-cap severity distribution, only one finding met the CRITICAL bar: "active security vulnerability, data-loss bug, credential exposure, RCE surface, or production-breaking defect with high likelihood of exploit/occurrence" (`_meta/AUDIT-RUBRIC.md`).
- **What almost qualified**: three HIGH findings describe credential-handling defects that would reach CRITICAL if exploitation were demonstrated (T02 plaintext token persistence, T02 Codex-CLI cross-process token injection, T02 account-merge credential resurrection). They remain HIGH because each requires local-filesystem read access, a malicious Codex-CLI host, or a prior compromised account respectively — meaningful preconditions that the rubric weighs below "open CRITICAL".
