# T17 - Dedup Clusters

> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17 | **Task**: T17 Synthesis | **Source**: `docs/audits/_meta/findings-ledger.csv`

- Total PASSED rows: 257
- Clusters with >=2 members: 54
- Rows marked duplicate: 108

## Cluster key

Two findings are treated as duplicates when ALL of the following hold:

1. Same normalized file path (lowercased, forward-slash)
2. Line-range gap <= 10 lines (overlap or within 10 lines of each other)
3. Both ranges are "specific" (span <= 300 lines) OR both are "whole-file" (span > 300 lines). This prevents a whole-file architectural finding (e.g. `index.ts:250-5975`) from absorbing unrelated point findings that happen to sit inside that range.

The issue-class dimension is omitted because auditor-authored titles for the same defect diverge enough (different angle / severity framing) that a class-hash rarely survives; the underlying code citation + proximity is the conservative canonical key.

## Canonical selection rule

Within each cluster, the canonical row is chosen by: highest severity -> highest confidence -> lowest id.

## Clusters

| Canonical id | Task | File | Lines | Severity | Duplicate ids | Size |
|---|---|---|---|---|---|---|
| 274 | T14 | `package.json` | 99-99 | HIGH | 291,282,283,277,278,289,286,279,285,284,275,281,276 | 14 |
| 96 | T06 | `lib/storage.ts` | 810-888 | HIGH | 110,211,154,40,20,97 | 7 |
| 13 | T02 | `lib/storage.ts` | 188-209 | HIGH | 45,148,109,108,314,107 | 7 |
| 173 | T10 | `lib/errors.ts` | 33-165 | HIGH | 186,192,198,193,179 | 6 |
| 223 | T12 | `index.ts` | 4992-5006 | HIGH | 236,229,181,224 | 5 |
| 17 | T02 | `lib/storage.ts` | 1335-1394 | HIGH | 34,176,113,177 | 5 |
| 81 | T05 | `lib/storage.ts` | 1231-1256 | HIGH | 116,117,42,21 | 5 |
| 246 | T13 | `lib/accounts/rate-limits.ts` | 1-85 | HIGH | 312,88,57 | 4 |
| 175 | T10 | `index.ts` | 5995-6153 | HIGH | 234,230 | 3 |
| 47 | T03 | `lib/accounts.ts` | 728-733 | CRITICAL | 127,36 | 3 |
| 51 | T03 | `lib/accounts.ts` | 598-613 | HIGH | 58,140 | 3 |
| 120 | T07 | `lib/accounts.ts` | 945-966 | HIGH | 31,135 | 3 |
| 302 | T16 | `lib/audit.ts` | 29-47 | HIGH | 10,160 | 3 |
| 18 | T02 | `lib/auth/auth.ts` | 115-130 | HIGH | 82,171 | 3 |
| 16 | T02 | `lib/auth/login-runner.ts` | 331-348 | HIGH | 309,86 | 3 |
| 24 | T02 | `lib/auth/server.ts` | 38-77 | MEDIUM | 46,25 | 3 |
| 303 | T16 | `lib/auth-rate-limit.ts` | 119-126 | HIGH | 315,32 | 3 |
| 152 | T09 | `lib/logger.ts` | 127-140 | HIGH | 170,169 | 3 |
| 5 | T01 | `lib/recovery.ts` | 1-21 | MEDIUM | 311,194 | 3 |
| 29 | T02 | `lib/refresh-queue.ts` | 85-200 | MEDIUM | 128,43 | 3 |
| 4 | T01 | `lib/runtime-contracts.ts` | 1-28 | MEDIUM | 305,94 | 3 |
| 95 | T06 | `lib/shutdown.ts` | 35-45 | HIGH | 130,119 | 3 |
| 99 | T06 | `lib/storage/paths.ts` | 37-45 | HIGH | 41,103 | 3 |
| 213 | T11 | `scripts/install-oc-codex-multi-auth-core.js` | 112-134 | MEDIUM | 209,214 | 3 |
| 202 | T11 | `scripts/install-oc-codex-multi-auth-core.js` | 321-338 | HIGH | 205,206 | 3 |
| 1 | T01 | `index.ts` | 250-5975 | HIGH | 304 | 2 |
| 228 | T12 | `index.ts` | 388-392 | MEDIUM | 235 | 2 |
| 310 | T16 | `lib/accounts.ts` | 38-42 | MEDIUM | 11 | 2 |
| 15 | T02 | `lib/accounts.ts` | 104-155 | HIGH | 155 | 2 |
| 54 | T03 | `lib/accounts.ts` | 483-498 | MEDIUM | 62 | 2 |
| 6 | T01 | `lib/accounts.ts` | 209-1010 | MEDIUM | 307 | 2 |
| 49 | T03 | `lib/accounts.ts` | 880-896 | HIGH | 33 | 2 |
| 149 | T09 | `lib/audit.ts` | 145-176 | HIGH | 150 | 2 |
| 3 | T01 | `lib/auth/auth.ts` | 12-12 | HIGH | 23 | 2 |
| 52 | T03 | `lib/circuit-breaker.ts` | 128-143 | HIGH | 126 | 2 |
| 83 | T05 | `lib/config.ts` | 66-107 | HIGH | 204 | 2 |
| 162 | T09 | `lib/health.ts` | 96-107 | MEDIUM | 167 | 2 |
| 151 | T09 | `lib/logger.ts` | 29-34 | HIGH | 37 | 2 |
| 39 | T02 | `lib/oauth-success.ts` | 1-10 | MEDIUM | 237 | 2 |
| 14 | T02 | `lib/proactive-refresh.ts` | 200-215 | HIGH | 121 | 2 |
| 178 | T10 | `lib/recovery.ts` | 119-154 | HIGH | 156 | 2 |
| 30 | T02 | `lib/refresh-queue.ts` | 254-279 | MEDIUM | 124 | 2 |
| 7 | T01 | `lib/request/fetch-helpers.ts` | 1-80 | MEDIUM | 76 | 2 |
| 63 | T04 | `lib/request/fetch-helpers.ts` | 624-648 | HIGH | 157 | 2 |
| 71 | T04 | `lib/request/response-handler.ts` | 107-122 | MEDIUM | 66 | 2 |
| 133 | T08 | `lib/request/response-handler.ts` | 162-176 | HIGH | 134 | 2 |
| 122 | T07 | `lib/rotation.ts` | 186-208 | HIGH | 141 | 2 |
| 19 | T02 | `lib/storage.ts` | 243-272 | MEDIUM | 106 | 2 |
| 2 | T01 | `lib/storage.ts` | 1-1461 | HIGH | 308 | 2 |
| 200 | T11 | `lib/storage.ts` | 624-635 | HIGH | 191 | 2 |
| 201 | T11 | `lib/storage/migrations.ts` | 1-112 | HIGH | 210 | 2 |
| 104 | T06 | `lib/storage/paths.ts` | 90-109 | MEDIUM | 44 | 2 |
| 221 | T12 | `lib/ui/ansi.ts` | 5-22 | HIGH | 245 | 2 |
| 203 | T11 | `scripts/install-oc-codex-multi-auth-core.js` | 56-73 | HIGH | 212 | 2 |
