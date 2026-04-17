# T17 - Severity Reclassifications

> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17 | **Task**: T17 Synthesis | **Source**: `docs/audits/_meta/findings-ledger.csv`

**Caps**: CRITICAL <=5, HIGH <=15, MEDIUM <=40. LOW unbounded.

## Distribution (unique PASSED, non-duplicate)

| Severity | Pre-cap | Post-cap | Cap |
|---|---:|---:|---:|
| CRITICAL | 1 | 1 | 5 |
| HIGH | 43 | 15 | 15 |
| MEDIUM | 62 | 40 | 40 |
| LOW | 43 | 93 | - |

## Demotion Log

Total demotions: 78. Applied in order CRITICAL->HIGH, HIGH->MEDIUM, MEDIUM->LOW until each tier is within its cap. Within a tier, the lowest-confidence (then lowest-id) row is selected for demotion.

| id | task | file:lines | from | to | confidence |
|---|---|---|---|---|---|
| 18 | T02 | `lib/auth/auth.ts:115-130` | HIGH | MEDIUM | medium |
| 52 | T03 | `lib/circuit-breaker.ts:128-143` | HIGH | MEDIUM | medium |
| 99 | T06 | `lib/storage/paths.ts:37-45` | HIGH | MEDIUM | medium |
| 122 | T07 | `lib/rotation.ts:186-208` | HIGH | MEDIUM | medium |
| 133 | T08 | `lib/request/response-handler.ts:162-176` | HIGH | MEDIUM | medium |
| 151 | T09 | `lib/logger.ts:29-34` | HIGH | MEDIUM | medium |
| 203 | T11 | `scripts/install-oc-codex-multi-auth-core.js:56-73` | HIGH | MEDIUM | medium |
| 1 | T01 | `index.ts:250-5975` | HIGH | MEDIUM | high |
| 2 | T01 | `lib/storage.ts:1-1461` | HIGH | MEDIUM | high |
| 3 | T01 | `lib/auth/auth.ts:12-12` | HIGH | MEDIUM | high |
| 13 | T02 | `lib/storage.ts:188-209` | HIGH | MEDIUM | high |
| 14 | T02 | `lib/proactive-refresh.ts:200-215` | HIGH | MEDIUM | high |
| 15 | T02 | `lib/accounts.ts:104-155` | HIGH | MEDIUM | high |
| 16 | T02 | `lib/auth/login-runner.ts:331-348` | HIGH | MEDIUM | high |
| 17 | T02 | `lib/storage.ts:1335-1394` | HIGH | MEDIUM | high |
| 48 | T03 | `lib/accounts.ts:851-862` | HIGH | MEDIUM | high |
| 49 | T03 | `lib/accounts.ts:880-896` | HIGH | MEDIUM | high |
| 51 | T03 | `lib/accounts.ts:598-613` | HIGH | MEDIUM | high |
| 63 | T04 | `lib/request/fetch-helpers.ts:624-648` | HIGH | MEDIUM | high |
| 64 | T04 | `lib/prompts/codex.ts:340-364` | HIGH | MEDIUM | high |
| 81 | T05 | `lib/storage.ts:1231-1256` | HIGH | MEDIUM | high |
| 83 | T05 | `lib/config.ts:66-107` | HIGH | MEDIUM | high |
| 95 | T06 | `lib/shutdown.ts:35-45` | HIGH | MEDIUM | high |
| 96 | T06 | `lib/storage.ts:810-888` | HIGH | MEDIUM | high |
| 101 | T06 | `lib/recovery/storage.ts:243-266` | HIGH | MEDIUM | high |
| 120 | T07 | `lib/accounts.ts:945-966` | HIGH | MEDIUM | high |
| 149 | T09 | `lib/audit.ts:145-176` | HIGH | MEDIUM | high |
| 152 | T09 | `lib/logger.ts:127-140` | HIGH | MEDIUM | high |
| 7 | T01 | `lib/request/fetch-helpers.ts:1-80` | MEDIUM | LOW | medium |
| 8 | T01 | `lib/request/request-transformer.ts:26-26` | MEDIUM | LOW | medium |
| 9 | T01 | `lib/index.ts:1-19` | MEDIUM | LOW | medium |
| 18 | T02 | `lib/auth/auth.ts:115-130` | MEDIUM | LOW | medium |
| 22 | T02 | `lib/auth/auth.ts:89-99` | MEDIUM | LOW | medium |
| 26 | T02 | `lib/auth/device-code.ts:119-139` | MEDIUM | LOW | medium |
| 35 | T02 | `lib/auth/login-runner.ts:670-690` | MEDIUM | LOW | medium |
| 38 | T02 | `lib/auth/device-code.ts:247-256` | MEDIUM | LOW | medium |
| 39 | T02 | `lib/oauth-success.ts:1-10` | MEDIUM | LOW | medium |
| 52 | T03 | `lib/circuit-breaker.ts:128-143` | MEDIUM | LOW | medium |
| 56 | T03 | `lib/rotation.ts:63-68` | MEDIUM | LOW | medium |
| 68 | T04 | `lib/request/response-handler.ts:298-318` | MEDIUM | LOW | medium |
| 69 | T04 | `lib/request/rate-limit-backoff.ts:29-93` | MEDIUM | LOW | medium |
| 70 | T04 | `index.ts:2184-2250` | MEDIUM | LOW | medium |
| 72 | T04 | `lib/request/helpers/model-map.ts:182-197` | MEDIUM | LOW | medium |
| 73 | T04 | `lib/prompts/opencode-codex.ts:130-149` | MEDIUM | LOW | medium |
| 87 | T05 | `lib/schemas.ts:108-126` | MEDIUM | LOW | medium |
| 89 | T05 | `tsconfig.json:1-25` | MEDIUM | LOW | medium |
| 99 | T06 | `lib/storage/paths.ts:37-45` | MEDIUM | LOW | medium |
| 122 | T07 | `lib/rotation.ts:186-208` | MEDIUM | LOW | medium |
| 129 | T07 | `lib/accounts.ts:219-276` | MEDIUM | LOW | medium |
| 133 | T08 | `lib/request/response-handler.ts:162-176` | MEDIUM | LOW | medium |
| 151 | T09 | `lib/logger.ts:29-34` | MEDIUM | LOW | medium |
| 158 | T09 | `lib/auto-update-checker.ts:25-33` | MEDIUM | LOW | medium |
| 162 | T09 | `lib/health.ts:96-107` | MEDIUM | LOW | medium |
| 164 | T09 | `index.ts:1684-1690` | MEDIUM | LOW | medium |
| 165 | T09 | `index.ts:2485-2500` | MEDIUM | LOW | medium |
| 182 | T10 | `lib/recovery.ts:63-85` | MEDIUM | LOW | medium |
| 185 | T10 | `lib/context-overflow.ts:55-112` | MEDIUM | LOW | medium |
| 190 | T10 | `lib/recovery.ts:346-346` | MEDIUM | LOW | medium |
| 203 | T11 | `scripts/install-oc-codex-multi-auth-core.js:56-73` | MEDIUM | LOW | medium |
| 231 | T12 | `lib/ui/beginner.ts:134-172` | MEDIUM | LOW | medium |
| 232 | T12 | `lib/cli.ts:131-141` | MEDIUM | LOW | medium |
| 233 | T12 | `lib/ui/auth-menu.ts:60-101` | MEDIUM | LOW | medium |
| 267 | T13 | `vitest.config.ts:18-28` | MEDIUM | LOW | medium |
| 295 | T15 | `SECURITY.md:32-44` | MEDIUM | LOW | medium |
| 316 | T16 | `lib/request/request-transformer.ts:262-958` | MEDIUM | LOW | medium |
| 1 | T01 | `index.ts:250-5975` | MEDIUM | LOW | high |
| 2 | T01 | `lib/storage.ts:1-1461` | MEDIUM | LOW | high |
| 3 | T01 | `lib/auth/auth.ts:12-12` | MEDIUM | LOW | high |
| 4 | T01 | `lib/runtime-contracts.ts:1-28` | MEDIUM | LOW | high |
| 5 | T01 | `lib/recovery.ts:1-21` | MEDIUM | LOW | high |
| 6 | T01 | `lib/accounts.ts:209-1010` | MEDIUM | LOW | high |
| 13 | T02 | `lib/storage.ts:188-209` | MEDIUM | LOW | high |
| 14 | T02 | `lib/proactive-refresh.ts:200-215` | MEDIUM | LOW | high |
| 15 | T02 | `lib/accounts.ts:104-155` | MEDIUM | LOW | high |
| 16 | T02 | `lib/auth/login-runner.ts:331-348` | MEDIUM | LOW | high |
| 17 | T02 | `lib/storage.ts:1335-1394` | MEDIUM | LOW | high |
| 19 | T02 | `lib/storage.ts:243-272` | MEDIUM | LOW | high |
| 24 | T02 | `lib/auth/server.ts:38-77` | MEDIUM | LOW | high |
