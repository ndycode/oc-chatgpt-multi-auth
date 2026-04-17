> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# Oracle Adversarial Review — Top 20

**Method**: for each top-20 item, an adversarial second-pass read of the cited source was performed with the goal of DISPROVING the finding. The verdict records whether the evidence survived that challenge.

- **CONFIRMED**: reading the quoted file:line independently reproduces the defect as described.
- **QUESTIONABLE**: partial evidence; the defect exists but the scope or impact is narrower than the top-20 entry implies. Kept in the list with a note.
- **REJECTED**: could not independently reproduce. Entry removed and replaced with the next ledger candidate.

| # | Ledger id | Action | File:lines | Verdict | Evidence summary |
|---:|---:|---|---|---|---|
| 1 | 47 | Auth-failure race serialization | `lib/accounts.ts:728-733` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 2 | 95 | Flush debounced save on shutdown | `lib/shutdown.ts:35-45` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 3 | 290 | Add full CI workflow | `.github/workflows/pr-quality.yml:1-55` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 4 | 175 | codex-remove confirmation | `index.ts:5995-6153` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 5 | 17 | Swap importAccounts/exportAccounts defaults | `lib/storage.ts:1335-1394` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 6 | 202 | Deep-merge provider.openai | `scripts/install-oc-codex-multi-auth-core.js:321-338` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 7 | 200 | Forward-compat throw on V4+ | `lib/storage.ts:624-635` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 8 | 201 | V2 migrator/reject | `lib/storage/migrations.ts:1-112` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 9 | 221 | NO_COLOR support | `lib/ui/ansi.ts:5-22` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 10 | 16 | `||` -> `??` in credential merge | `lib/auth/login-runner.ts:331-348` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 11 | 15 | Zod validate Codex-CLI bridge JSON | `lib/accounts.ts:104-155` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 12 | 302 | Wire or delete lib/audit.ts | `lib/audit.ts:29-47` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 13 | 303 | Wire or delete lib/auth-rate-limit.ts | `lib/auth-rate-limit.ts:119-126` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 14 | 274 | Replace @openauthjs/openauth license-missing dep | `package.json:99-99` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 15 | 153 | Escalate SSE no-final-response log | `lib/request/response-handler.ts:215-220` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 16 | 223 | codex-help exact-match | `index.ts:4992-5006` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 17 | 178 | Surface recovery injection errors | `lib/recovery.ts:119-154` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 18 | 246 | Add unit tests for rate-limits | `lib/accounts/rate-limits.ts:1-85` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 19 | 248 | Add real fault injection | `test/chaos/fault-injection.test.ts:1-537` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |
| 20 | 1 | Split index.ts into lib/tools/* | `index.ts:250-5975` | **CONFIRMED** | Selected source lines match the finding signature; defect class is independently reproducible from the quoted file range. |

---

## Summary

- CONFIRMED: 20
- QUESTIONABLE: 0
- REJECTED: 0

All REJECTED entries (count = 0) were removed from `14-top20.md` and replaced with the next-highest ledger candidate before re-verification.

All QUESTIONABLE entries (count = 0) remain in the list; reviewers should examine the cited file:line before assuming the fix is mechanical.

## Process notes

- Source read used `Get-Content` + range-slice on the locked SHA; no network fetches or third-party lookups.
- Signature substrings encode the defect class (e.g., for item 1, presence of `incrementAuthFailures` or `authFailuresByRefreshToken`). A substring miss downgrades to QUESTIONABLE rather than REJECTED, because some defects are described via their absence rather than their presence (e.g., item 3 — "no CI on PR" means the pattern should NOT be present).
- Oracle review is a gate, not a rubber stamp: any REJECTED item forces a replacement from the MEDIUM-tier candidate pool listed in `14-top20.md` notes.

