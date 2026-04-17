> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# 06 — Low-Priority Findings

**Count**: 93 (unbounded). Most are demotions from MEDIUM by T17 after cap enforcement. Use this file as a backlog; nothing here is urgent, but high-impact cleanup batches can reference multiple entries for a single PR.

**Format**: compact table; full narrative in ``docs/audits/_findings/<task>.md``.

| id | task | file:line | conf | title |
|---:|---|---|---|---|
| 301 | T15 (ci-release) | `.coderabbit.yaml:1-10` | high | .coderabbit.yaml is minimal â€” no path filters, no review profile |
| 299 | T15 (ci-release) | `.github/ISSUE_TEMPLATE/config.yml:1-11` | high | Issue-template contact_links reference stale oc-chatgpt-multi-auth repo URL |
| 298 | T15 (ci-release) | `.husky/pre-commit:1-4` | high | Husky only wires pre-commit; no commit-msg or pre-push hook |
| 287 | T14 (dependencies) | `.npmignore:1-14` | high | .npmignore coexists with files field; .npmignore is dead |
| 296 | T15 (ci-release) | `CODEOWNERS:1-14` | high | CODEOWNERS is a single-person catch-all without per-domain reviewers |
| 216 | T11 (config-installer) | `config/minimal-opencode.json:1-13` | high | minimal-opencode.json omits reasoning.encrypted_content â€” breaks multi-turn sessions if used as-is |
| 300 | T15 (ci-release) | `CONTRIBUTING.md:59-72` | high | CONTRIBUTING.md lacks local-development setup commands |
| 12 | T01 (architecture) | `docs/development/ARCHITECTURE.md:408` | medium | docs/development/ARCHITECTURE.md describes v4.4.0+/v4.5.0+ features without mentioning v6.0.0 rebrand or per-project storage namespacing |
| 241 | T12 (cli-ui) | `docs/development/TUI_PARITY_CHECKLIST.md:28` | medium | TUI parity doc omits [cooldown] and [error] badges that the code emits |
| 92 | T05 (type-safety) | `eslint.config.js:21-27` | high | @typescript-eslint/no-non-null-assertion is warn-only, not error |
| 1 | T01 (architecture) | `index.ts:250-5975` | high | index.ts is a 5975-line monolith housing plugin entry + 18 inline tool definitions + beginner UX + runtime metrics |
| 145 | T08 (performance) | `index.ts:763-830` | medium | hydrateEmails serializes chunks of 3 with implicit round trips |
| 164 | T09 (observability) | `index.ts:1684-1690` | medium | Correlation ID format is threadId+Date.now() â€” not globally unique |
| 70 | T04 (request-pipeline) | `index.ts:2184-2250` | medium | Model-family drift on mid-session fallback updates modelFamily but not the transformation body's include / reasoning |
| 165 | T09 (observability) | `index.ts:2485-2500` | medium | No aggregated "rotation exhausted" log at error level |
| 244 | T12 (cli-ui) | `index.ts:3722-3728` | medium | codex-list legacy-mode suffix table header width is fixed at 42 and loses long workspace names |
| 317 | T16 (code-health) | `index.ts:6379-6381` | high | OpenAIAuthPlugin alias export + OpenAIOAuthPlugin + default export trio (duplicate exports) |
| 15 | T02 (security) | `lib/accounts.ts:104-155` | high | Codex CLI cross-process token injection via unsigned JSON with zero schema validation |
| 6 | T01 (architecture) | `lib/accounts.ts:209-1010` | high | lib/accounts.ts is 1010 lines with a single AccountManager class holding â‰¥38 async methods â€” responsibility overrun |
| 129 | T07 (concurrency) | `lib/accounts.ts:219-276` | medium | Startup race: hydrateFromCodexCli runs async; user auth login during hydration overwrites in-memory state |
| 3 | T01 (architecture) | `lib/auth/auth.ts:12` | high | REDIRECT_URI uses localhost while OAuth server binds on 127.0.0.1 â€” docs/code drift against ARCHITECTURE.md |
| 22 | T02 (security) | `lib/auth/auth.ts:89-99` | medium | OAuth token-endpoint error bodies pass through template-literal interpolation; opaque tokens bypass TOKEN_PATTERNS |
| 18 | T02 (security) | `lib/auth/auth.ts:115-130` | medium | Unverified JWT signatures drive account-identity derivation â€” decoded payload fields trusted for accountId / organizationId |
| 172 | T09 (observability) | `lib/auth/browser.ts:92-96` | medium | browser.ts auto-open failure silent |
| 26 | T02 (security) | `lib/auth/device-code.ts:119-139` | medium | Device-code flow accepts server-supplied PKCE code_verifier â€” violates RFC 7636 intent |
| 38 | T02 (security) | `lib/auth/device-code.ts:247-256` | medium | device-code.ts passes rawJson object into logError on validation failure; code_verifier / authorization_code keys are not in SENSITIVE_KEYS |
| 16 | T02 (security) | `lib/auth/login-runner.ts:331-348` | high | Account merge resurrects invalidated credentials via \|\| fallback on refreshToken / accessToken |
| 35 | T02 (security) | `lib/auth/login-runner.ts:670-690` | medium | pruneRefreshTokenCollisions keys in-memory dedup Map with raw refresh-token strings |
| 24 | T02 (security) | `lib/auth/server.ts:38-77` | high | OAuth callback server stores _lastCode on the HTTP server instance; never cleared after read |
| 158 | T09 (observability) | `lib/auto-update-checker.ts:25-33` | medium | getCurrentVersion returns "0.0.0" on read failure |
| 199 | T10 (error-handling) | `lib/circuit-breaker.ts:17-22` | high | CircuitOpenError has no code, no cause, no accountKey context |
| 131 | T07 (concurrency) | `lib/circuit-breaker.ts:35-55` | medium | CircuitBreaker.canExecute increments halfOpenAttempts before the caller has actually executed |
| 52 | T03 (rotation) | `lib/circuit-breaker.ts:128-143` | medium | Circuit-breaker eviction during half-open destroys failure history for the in-flight request |
| 242 | T12 (cli-ui) | `lib/cli.ts:17` | high | FORCE_INTERACTIVE_MODE env override is undocumented |
| 243 | T12 (cli-ui) | `lib/cli.ts:32-34` | medium | promptAddAnotherAccount prints tip via console.log, not UI formatter |
| 232 | T12 (cli-ui) | `lib/cli.ts:131-141` | medium | Dead code path: promptLoginModeFallback unreachable in common host configs |
| 185 | T10 (error-handling) | `lib/context-overflow.ts:55-112` | medium | Context-overflow synthetic response drops upstream diagnostics |
| 162 | T09 (observability) | `lib/health.ts:96-107` | medium | Health formatter hides "all closed" state |
| 9 | T01 (architecture) | `lib/index.ts:1-19` | medium | index.ts imports 35 modules directly but lib/index.ts barrel exports only 19 â€” two incompatible public surfaces |
| 151 | T09 (observability) | `lib/logger.ts:29-34` | medium | TOKEN_PATTERNS does not mask opaque refresh tokens |
| 166 | T09 (observability) | `lib/logger.ts:316-320` | high | logError silenced on stderr by default |
| 147 | T08 (performance) | `lib/logger.ts:331-391` | medium | Scoped logger timers leak on unclosed time() calls |
| 39 | T02 (security) | `lib/oauth-success.ts:1-10` | medium | oauth-success.ts CSP default-src 'self'; script-src 'none' blocks the inline preconnect to fonts.googleapis.com â€” page renders without fonts, indicating dead-markup policy drift |
| 14 | T02 (security) | `lib/proactive-refresh.ts:200-215` | high | Silent token loss â€” applyRefreshResult mutates in-memory account without persisting; disk write sits in 500 ms debounce window |
| 79 | T04 (request-pipeline) | `lib/prompts/codex.ts:259-287` | medium | Stale-while-revalidate bumps memory timestamp to now, serving potentially very stale content |
| 77 | T04 (request-pipeline) | `lib/prompts/codex.ts:309-316` | medium | Bundled fallback codex-instructions.md may not resolve in dist build |
| 78 | T04 (request-pipeline) | `lib/prompts/codex-opencode-bridge.ts:80-91` | medium | MAX_MANIFEST_TOOLS = 32 silently truncates tool manifest |
| 73 | T04 (request-pipeline) | `lib/prompts/opencode-codex.ts:130-149` | medium | opencode-codex.ts fallback-source fetch has no per-source timeout |
| 5 | T01 (architecture) | `lib/recovery.ts:1-21` | high | Recovery domain fractured across lib/recovery.ts (431 lines) AND lib/recovery/ directory â€” boundary is non-obvious |
| 182 | T10 (error-handling) | `lib/recovery.ts:63-85` | medium | Recovery classifier routes on error-message substrings; brittle to upstream wording changes |
| 197 | T10 (error-handling) | `lib/recovery.ts:281-289` | high | Recovery failure toast text is generic; no code or remediation |
| 190 | T10 (error-handling) | `lib/recovery.ts:346` | medium | Session-abort error silently swallowed before recovery |
| 114 | T06 (filesystem) | `lib/recovery/storage.ts:24-28` | high | generatePartId combines Date.now().toString(16) and Math.random().toString(36).substring(2,10) for a total â‰ˆ 40 bits of entropy â€” collision risk is negligible but pattern is inconsistent with the cryptographic entropy used elsewhere |
| 168 | T09 (observability) | `lib/refresh-queue.ts:224-225` | medium | Refresh-queue lastFailureReason not masked |
| 7 | T01 (architecture) | `lib/request/fetch-helpers.ts:1-80` | medium | lib/request/fetch-helpers.ts (870 lines) duplicates error-classification responsibility with lib/request/request-transformer.ts |
| 80 | T04 (request-pipeline) | `lib/request/fetch-helpers.ts:233-238` | medium | isEntitlementError regex does not cover all current Codex entitlement codes |
| 143 | T08 (performance) | `lib/request/fetch-helpers.ts:366-395` | high | URL parsed twice per request (once in extract, once in rewrite) |
| 90 | T05 (type-safety) | `lib/request/helpers/input-utils.ts:251-256` | high | as unknown as InputItem in injectMissingToolOutputs hides missing role |
| 72 | T04 (request-pipeline) | `lib/request/helpers/model-map.ts:182-197` | medium | getNormalizedModel case-insensitive fallback scans entire model map linearly per call |
| 75 | T04 (request-pipeline) | `lib/request/helpers/tool-utils.ts:30-46` | medium | cleanupToolDefinitions uses JSON round-trip for deep clone on every request |
| 69 | T04 (request-pipeline) | `lib/request/rate-limit-backoff.ts:29-93` | medium | Rate-limit-backoff state persists across rotation; thrash-back incurs up to MAX_BACKOFF_MS |
| 8 | T01 (architecture) | `lib/request/request-transformer.ts:26` | medium | lib/request/request-transformer.ts is 998 lines and mixes model normalization, prompt injection, orphan-tool recovery, and fast-session truncation |
| 144 | T08 (performance) | `lib/request/request-transformer.ts:40-165` | high | Normalize model runs 16 string probes per request with no memoisation |
| 316 | T16 (code-health) | `lib/request/request-transformer.ts:262-958` | medium | lib/request/request-transformer.ts (998 lines) is near split threshold â€” reasoning/tool/session logic can split |
| 74 | T04 (request-pipeline) | `lib/request/response-handler.ts:7-8` | high | DEFAULT_STREAM_STALL_TIMEOUT_MS and MAX_SSE_SIZE are module-private constants |
| 133 | T08 (performance) | `lib/request/response-handler.ts:162-176` | medium | Quadratic string concatenation of full SSE stream body |
| 68 | T04 (request-pipeline) | `lib/request/response-handler.ts:298-318` | medium | isEmptyResponse flags reasoning-only responses as empty, triggering retries on valid completions |
| 56 | T03 (rotation) | `lib/rotation.ts:63-68` | medium | Passive health recovery is time-based with Date.now() â€” susceptible to clock skew/suspend |
| 122 | T07 (concurrency) | `lib/rotation.ts:186-208` | medium | TokenBucketTracker.tryConsume is a non-atomic read-modify-write; concurrent consumers interleave |
| 60 | T03 (rotation) | `lib/rotation.ts:278-286` | high | Docstring contradicts default freshnessWeight |
| 4 | T01 (architecture) | `lib/runtime-contracts.ts:1-28` | high | lib/runtime-contracts.ts is a misleadingly-named 28-line OAuth-constants file, not the "runtime invariants" module advertised in AGENTS.md |
| 87 | T05 (type-safety) | `lib/schemas.ts:108-126` | medium | No branded types for credential-bearing strings |
| 2 | T01 (architecture) | `lib/storage.ts:1-1461` | high | lib/storage.ts is a 1296-line god module mixing atomic I/O, migration dispatch, import/export, flagged-account store, and schema normalization |
| 195 | T10 (error-handling) | `lib/storage.ts:99-111` | high | StorageError.code ERRNO strings blur with ErrorCode.CODEX_* in downstream logs |
| 13 | T02 (security) | `lib/storage.ts:188-209` | high | Plaintext refresh & access tokens persisted with mode 0o600 only (no at-rest encryption) |
| 19 | T02 (security) | `lib/storage.ts:243-272` | high | ensureGitignore only runs when .git already exists â€” skips fresh clones, bare repos, and per-project configs without VCS marker |
| 118 | T06 (filesystem) | `lib/storage.ts:980-992` | medium | clearAccounts silently swallows all non-ENOENT unlink errors, losing visibility into permission issues on the account file |
| 17 | T02 (security) | `lib/storage.ts:1335-1394` | high | importAccounts default backupMode: "none" silently overwrites existing account pool on any import |
| 99 | T06 (filesystem) | `lib/storage/paths.ts:37-45` | medium | Project key uses first 12 hex chars (48 bits) of SHA-256, with measurable collision probability for very large project counts and zero collision-resolution |
| 233 | T12 (cli-ui) | `lib/ui/auth-menu.ts:60-101` | medium | Status badges swallow "unknown" without indication |
| 240 | T12 (cli-ui) | `lib/ui/auth-menu.ts:144` | medium | Doc drift: TUI_PARITY_CHECKLIST "Deep probe" vs code "Deep check" |
| 231 | T12 (cli-ui) | `lib/ui/beginner.ts:134-172` | medium | Beginner checklist hardcodes index=2, misleading single-account users |
| 297 | T15 (ci-release) | `README.md:3-5` | high | No CI/build-status or Scorecard badge in README |
| 219 | T11 (config-installer) | `scripts/audit-dev-allowlist.js:30-53` | high | audit-dev-allowlist.js uses execSync and exits with no timeout |
| 220 | T11 (config-installer) | `scripts/copy-oauth-success.js:8-11` | medium | copy-oauth-success.js case-folds only on win32, not covering UNC paths |
| 288 | T14 (dependencies) | `scripts/install-oc-codex-multi-auth.js:1-15` | medium | bin script lacks README note that install is side-effect-free |
| 215 | T11 (config-installer) | `scripts/install-oc-codex-multi-auth-core.js:9-10` | high | Installer magic numbers for Windows retry lack rationale |
| 203 | T11 (config-installer) | `scripts/install-oc-codex-multi-auth-core.js:56-73` | medium | Home-dir resolver drift: installer vs runtime can target different directories |
| 217 | T11 (config-installer) | `scripts/test-all-models.sh:1-17` | high | test-all-models.sh is bash-only; no Windows parity |
| 218 | T11 (config-installer) | `scripts/validate-model-map.sh:1-15` | high | validate-model-map.sh is bash-only; same Windows-parity gap |
| 295 | T15 (ci-release) | `SECURITY.md:32-44` | medium | SECURITY.md disclosure channel is not a dedicated email address |
| 89 | T05 (type-safety) | `tsconfig.json:1-25` | medium | exactOptionalPropertyTypes disabled allows undefined to masquerade as "absent" |
| 267 | T13 (test-coverage) | `vitest.config.ts:18-28` | medium | Documented 80% coverage threshold is a weak proxy; no per-file minimum enforced |

---

## Batching suggestions

- **Logging polish batch** (~8 items): timestamp prefix, structured event discriminator, correlation-id format, stderr-silenced default. Ship as one T09 follow-up PR.
- **Storage-mode/perm batch** (~6 items): explicit 0o700 on mkdir, Math.random → crypto randomness, UTC timestamps in backup prefixes.
- **CLI cosmetic batch** (~7 items): undocumented ``FORCE_INTERACTIVE_MODE``, long-workspace-name truncation, beginner-checklist hardcoded index, doc-drift on badges.
- **Type-safety polish batch** (~5 items): ``as unknown as`` seams, ``!`` warn-only rule, ``exactOptionalPropertyTypes`` disabled, ``noUnusedLocals`` off, branded types for credentials.

Suggest grouping by owner in the phased roadmap (§13). See also [§12-quick-wins.md](12-quick-wins.md) for the subset that is strictly < 2 hours each.

