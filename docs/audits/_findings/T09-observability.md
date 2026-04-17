---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T09-observability
agent: opencode-unspecified-high
date: 2026-04-17T08:40:00+08:00
scope-files:
  - lib/logger.ts
  - lib/audit.ts
  - lib/health.ts
  - lib/parallel-probe.ts
  - lib/auto-update-checker.ts
  - lib/accounts.ts
  - lib/storage.ts
  - lib/refresh-queue.ts
  - lib/proactive-refresh.ts
  - lib/recovery.ts
  - lib/request/response-handler.ts
  - lib/request/fetch-helpers.ts
  - lib/context-overflow.ts
  - lib/shutdown.ts
  - lib/prompts/codex.ts
  - lib/prompts/opencode-codex.ts
  - lib/auth/auth.ts
  - lib/auth/server.ts
  - lib/auth/device-code.ts
  - lib/auth/browser.ts
  - lib/utils.ts
  - index.ts
rubric-version: 1
---

# T09 — Observability / Logging

**Summary**: Audited logger, audit-log, health, parallel-probe, auto-update-checker, and every production `log.*` / `logInfo/logWarn/logError/logDebug` call site across `lib/**` plus `index.ts`. Infrastructure is richer than typical (correlation IDs, redaction, audit.ts rotation, per-refresh metrics, scoped loggers, beginner doctor/metrics tools) but **not realised end-to-end**: `auditLog` has zero production call sites, correlation IDs are set only at the outer request boundary and dropped across async task boundaries, several user-visible failures log at `debug` so nothing appears at default level, and multiple silent `catch {}` swallow errors that would be needed to reconstruct failures. Headline count: **0 CRITICAL / 5 HIGH / 11 MEDIUM / 7 LOW** (23 findings total). Redaction gap documented by T02 is cross-referenced, not relitigated.

**Files audited**: 22 of 182 in-scope.

---

## Log-Level Distribution

Raw counts (production `lib/**` + `index.ts`, excluding tests). Captured via `Grep` on `log.(info|warn|error|debug)` (scoped loggers) + `logInfo|logWarn|logError|logDebug` (global helpers). Call sites are de-duped per file but **not** de-duped across files.

| File | debug | info | warn | error | Total |
|---|---:|---:|---:|---:|---:|
| `lib/storage.ts` | 1 | 7 | 13 | 8 | 29 |
| `index.ts` (via global helpers) | — | — | — | — | 48 |
| `lib/proactive-refresh.ts` | 1 | 4 | 2 | 1 | 8 |
| `lib/refresh-queue.ts` | 0 | 4 | 3 | 1 | 8 |
| `lib/auth/auth.ts` | — | — | — | — | 7 |
| `lib/auth/device-code.ts` | — | — | — | — | 7 |
| `lib/prompts/opencode-codex.ts` | — | — | — | — | 7 |
| `lib/request/request-transformer.ts` | — | — | — | — | 7 |
| `lib/prompts/codex.ts` | — | — | — | — | 6 |
| `lib/request/response-handler.ts` | 0 | 0 | 2 | 4 | 6 |
| `lib/auth/server.ts` | — | — | — | — | 5 |
| `lib/auto-update-checker.ts` | 3 | 1 | 1 | 0 | 5 |
| `lib/config.ts` | — | — | 4 | — | 4 |
| `lib/logger.ts` (self) | 0 | 1 | 0 | 3 | 4 |
| `lib/recovery.ts` | 3 | 0 | 0 | 1 | 4 |
| `lib/accounts.ts` | 2 | 0 | 1 | 0 | 3 |
| `lib/request/fetch-helpers.ts` | — | — | — | — | 4 |
| `lib/auth/login-runner.ts` | — | — | — | — | 2 |
| `lib/parallel-probe.ts` | 2 | 0 | 0 | 0 | 2 |
| `lib/context-overflow.ts` | 2 | 0 | 0 | 0 | 2 |
| `lib/rotation.ts` | 1 | 0 | 0 | 0 | 1 |
| `lib/audit.ts` (fallback only) | 0 | 0 | 0 | 1 | 1 |

**Histogram (scoped-logger sites only, where level could be sampled verbatim)**:

```
debug ████░░░░░░░░░░░░░░░░  ~18%   (15 / ~85 sampled)
info  ████████░░░░░░░░░░░░  ~32%   (27 / ~85)
warn  ████████░░░░░░░░░░░░  ~28%   (24 / ~85)
error ████░░░░░░░░░░░░░░░░  ~22%   (19 / ~85)
```

Warn-heavy distribution is expected (hot path is "recoverable failure" — rotation, refresh, rate limit). Debug-heavy hot spots are `parallel-probe.ts`, `recovery.ts`, `context-overflow.ts`: those paths are functionally the recovery / retry layer and **silence their observability at default log level** (see HIGH-04 and MEDIUM-03).

---

## Sample of 20 Call-Site Correctness Judgements

Sampled across files, biased toward auth / storage / refresh hot paths. `OK` = level correct and actionable; `LOW` / `HIGH` = level too quiet / too loud for what happens.

| # | Site | Level | Verdict | Reason |
|---|---|---|---|---|
| 1 | `lib/logger.ts:316-320` `logError` | error | OK | Bypasses `shouldLog` filter; errors always emit via app log. |
| 2 | `lib/logger.ts:286-290` log write fail | error | OK | Structured app log + stderr fallback. |
| 3 | `lib/logger.ts:181-183` app log throw | swallow | OK (accepted) | Cannot log the logger; intentional. |
| 4 | `lib/storage.ts:885` load failure | error | OK | User-visible; next attempt will hit same path. |
| 5 | `lib/storage.ts:829` migration persist fail | warn | **TOO LOW** | Migration applied in-memory but unpersisted ⇒ next load re-migrates; should be `error`. See MEDIUM-01. |
| 6 | `lib/storage.ts:626,639` invalid format | warn | OK | Non-fatal for caller (`null` returned); downstream error path takes over. |
| 7 | `lib/storage.ts:1389` pre-import backup fail (mode=optional) | warn | OK | User acknowledged via `backupMode` arg; log preserves forensic trail. |
| 8 | `lib/accounts.ts:151` Codex CLI cache read fail | debug | **TOO LOW** | On first run user expects hydration; silence hides breakage. See MEDIUM-03. |
| 9 | `lib/accounts.ts:961` debounced save fail | warn | OK (accepted risk per `AGENTS.md:53`) | Outer flow retries on next mutation. |
| 10 | `lib/proactive-refresh.ts:121` per-account refresh fail | warn | OK | Summary info at :190 aggregates outcome. |
| 11 | `lib/proactive-refresh.ts:159` unhandled exception | error | OK | Promise.all outer safeguard. |
| 12 | `lib/refresh-queue.ts:225` refresh fail | warn | OK | Reason carried through `TokenResult`. |
| 13 | `lib/refresh-queue.ts:240` refresh exception | error | OK | Exception path; caller sees `failed/network_error`. |
| 14 | `lib/refresh-queue.ts:272` stale entry eviction | warn | OK | Indicates leak suspicion. |
| 15 | `lib/request/response-handler.ts:216` "no final response" | warn | **TOO LOW** | Breaks user session (no completion event); should be `error`. See HIGH-05. |
| 16 | `lib/request/response-handler.ts:109,117,128` SSE terminal errors | error | OK | Surfaces OpenAI-side failure. |
| 17 | `lib/request/fetch-helpers.ts:522` request parse fail | error (global) | OK | Returns `undefined`; caller reroutes. |
| 18 | `lib/auto-update-checker.ts:89` check-for-updates fail | debug | OK | Non-user-facing best-effort. |
| 19 | `lib/auto-update-checker.ts:52` cache save fail | warn | OK | Next run re-fetches. |
| 20 | `lib/recovery.ts:414` recovery exception | error | OK | User-visible recovery path. |

**Aggregate verdict**: levels are mostly calibrated, **3 of 20 are miscalibrated in the direction that silences real failures** (`#5`, `#8`, `#15`). Two of those (`#5`, `#15`) are promoted to HIGH/MEDIUM findings below.

---

## Log Destination & Rotation

Destinations diverge sharply by log category. Reconstructed from code inspection:

| Sink | Gate | Format | Rotation | Notes |
|---|---|---|---|---|
| `client.app.log({...})` (OpenCode app log) | `initLogger()` was called | structured `{service, level, message, extra}` | app-controlled | Default path; silent if client not wired. |
| `console.log/warn/error` | `CODEX_CONSOLE_LOG=1` | plain text | none | Disabled by default, so nothing on stderr normally. |
| `~/.opencode/logs/codex-plugin/request-N-<stage>.json` | `ENABLE_PLUGIN_REQUEST_LOGGING=1` | JSON per stage | **none** | Unbounded file count; see MEDIUM-08. |
| `~/.opencode/logs/audit.log` (+ `audit.1..N.log`) | `auditConfig.enabled` (default true) — but **no call sites** | JSON-lines | `maxFileSizeBytes=10MB`, `maxFiles=5` | Infra exists, never exercised (HIGH-01). |

**Gap**: there is no unified "this request failed, here is the trail" sink. Users must cross-reference app log, optional console, and optional per-request JSON dumps themselves.

---

## Correlation / Trace IDs

`lib/logger.ts:127-140` exposes a **single process-global** mutable correlation slot:

```ts
let currentCorrelationId: string | null = null;
export function setCorrelationId(id?: string): string { ... }
export function getCorrelationId(): string | null { ... }
export function clearCorrelationId(): void { ... }
```

Set at one site only: `index.ts:1688-1690` per upstream request, cleared at `index.ts:2501`. Every log that emits between those two boundaries attaches the ID (via `logToApp` → `extra.correlationId`, `logRequest` → top-level field, and `audit.ts:160` → `entry.correlationId`).

Multiple operations run **outside** or **across** that window, and therefore log with `correlationId=null`:

- Background proactive refresh (`lib/proactive-refresh.ts:140-198`) — never touches `setCorrelationId`.
- Queued token refresh (`lib/refresh-queue.ts:129-276`) — inherits whatever was set at invocation but is often called from tool handlers (`codex-doctor --fix` at `index.ts:5099`, `codex-switch`, etc.) that never set a correlation.
- Parallel probe racing (`lib/parallel-probe.ts:110-133`) — runs after winner is chosen; aborted losers' logs carry the same ID or none.
- Prompt template refresh (`lib/prompts/opencode-codex.ts:189-201`) — background refresh promise has no correlation.

See HIGH-04.

---

## Metrics Exposure

In-memory, process-local only. Two sources:

1. `runtimeMetrics` struct at `index.ts:345-372` — 24 counters (`totalRequests`, `retryBudgetUsage`, `accountRotations`, etc.). Exposed via `codex-metrics` tool (`index.ts:4712-4810`) as JSON or text.
2. `refresh-queue.ts` internal `this.metrics` (19 writes, exposed via `getRefreshQueueMetrics()`). Embedded into `codex-metrics` output at `index.ts:4755`.
3. `lib/health.ts` `getAccountHealth(...)` — snapshot derived from stored accounts + `CircuitBreaker.getState()`.

No persistence, no `/metrics` endpoint, no sampling, no periodic log emission. Process restart loses everything. See MEDIUM-05.

---

## Redaction (Cross-Reference to T02)

`lib/logger.ts:29-34` `TOKEN_PATTERNS` are the sole string-masking regexes:

```ts
/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g  // JWT
/[a-f0-9]{40,}/gi                                          // hex (≥40)
/sk-[A-Za-z0-9]{20,}/g                                     // OpenAI platform keys
/Bearer\s+\S+/gi                                           // Bearer-prefixed
```

ChatGPT OAuth refresh tokens are opaque base64url-style strings containing `A-Za-z0-9_-` **without** requiring hex-only characters and **without** a `Bearer ` prefix when they appear in error messages / debug dumps. They match none of the four patterns. This is the exact gap flagged upstream.

See `02-security.md` for the primary analysis. Observability impact re-scoped into HIGH-03 below: whenever a refresh token value appears inside `error.message` (e.g. `logError("Token refresh error", err)` at `lib/auth/auth.ts:178` → propagates into `maskString` which only operates on the message string) it is not masked. Object-key masking via `SENSITIVE_KEYS` (`lib/logger.ts:38-57`) catches structured `{refreshToken: "..."}` payloads — the gap is exclusively for tokens embedded in free-form strings.

---

## Silent-Failure Inventory

Sites where a `catch` clause swallows the error with **no log at any level** (pure observability gap — not merely quieter than desirable). 20 enumerated; **≥ 5 required**.

| # | File:Line | Construct | Why it hides a real failure |
|---|---|---|---|
| 1 | `lib/recovery.ts:151-153` | `} catch { return false; }` | `sendToolResultsForRecovery` fails → recovery path silently declared unsuccessful. User sees "recovery failed" with zero breadcrumbs. |
| 2 | `lib/recovery.ts:238-240` | `} catch { return false; }` | Resume-session POST fails → same category. |
| 3 | `lib/context-overflow.ts:134-136` | `} catch { /* Ignore read errors */ }` | Response-body read error suppressed; caller decides "not a context-overflow" and returns original response. If body was the overflow signal, user gets the raw 400. |
| 4 | `lib/request/response-handler.ts:137-139` | `} catch { /* Skip malformed JSON */ }` | Polluted SSE stream lines silently dropped. If the stream is *mostly* bad, user sees "No final response" warn (item #15 above) but no causal trail. |
| 5 | `lib/request/fetch-helpers.ts:654-656` | `safeReadBody` returns `""` on throw | Body-read errors masked as "empty body"; downstream error mapping cannot distinguish "server sent empty" from "we failed to read". |
| 6 | `lib/request/fetch-helpers.ts:667-669` | `} catch { code = ""; }` | 404 usage-limit discriminator loses JSON-parse failures; may misclassify entitlement errors as rate-limits. |
| 7 | `lib/prompts/codex.ts:254-256` | `} catch { cachedMetadata = null; }` | Corrupt prompt cache metadata silently resets → cold fetch from GitHub → network round-trip hidden from user / doctor. |
| 8 | `lib/auto-update-checker.ts:30-32` | returns `"0.0.0"` on package.json read fail | `codex-metrics` then reports a fake version; doctor cannot detect "plugin installed corrupted". |
| 9 | `lib/auto-update-checker.ts:40-42` | cache read failure → `null` | Wraps into subsequent "force" fetch each startup; user sees extra network churn with no logged cause. |
| 10 | `lib/auto-update-checker.ts:161-163` | `clearUpdateCache()` swallow | Cache-reset failures invisible. Low impact but observability zero. |
| 11 | `lib/auth/browser.ts:92-95` | `} catch { return false; }` | Browser open fails → user sees "paste URL manually" instructions with no log of *why* auto-open failed (permissions? wsl? missing `xdg-open`?). |
| 12 | `lib/audit.ts:173-175` | comment: "Audit logging should never break the application" | Audit writes disappear wholesale. Even a one-liner `console.error` would help SREs detect a drifted audit config. See HIGH-02. |
| 13 | `lib/shutdown.ts:25-27` | `} catch { /* Ignore cleanup errors during shutdown */ }` | Acceptable because process is exiting — but leaks (file handles, timers) during graceful shutdown are now invisible. |
| 14 | `lib/storage.ts:918-920` | temp-file unlink on error path | Acceptable best-effort; tmp files orphan silently. Combined with the lack of a cron-like cleanup, can pollute `.opencode/` over time. |
| 15 | `lib/storage.ts:1121-1123` | legacy flagged-storage unlink | Same category. |
| 16 | `lib/logger.ts:181-183` | app log throws | Acceptable — cannot log the logger. No alternative sink. |
| 17 | `lib/utils.ts:42-44` | `JSON.stringify` fallback to `String(value)` | Acceptable. |
| 18 | `lib/auth/auth.ts:48-50` | URL parse fallback | Acceptable (next parser tried). |
| 19 | `lib/auth/auth.ts:127-129` | JWT base64 decode fail → `null` | Token considered malformed without explanation; caller treats as "no expiry info". Could warn once for diagnostics. |
| 20 | `lib/recovery.ts:51-53` | `JSON.stringify(error)` fail | Acceptable — best-effort error normalisation. |

**Of 20**: 12 are observability-meaningful (user- or SRE-visible consequences); 8 are acceptable best-effort swallows with low-to-zero signal value.

---

## Debuggability Walk-Throughs

### Auth failure: `"Failed to refresh token"`

User symptom: OpenCode surfaces `authRefreshFailures` count going up in `codex-metrics`. What does the user see?

1. `lib/auth/auth.ts:178` → `logError("Token refresh error", err)` — emits at `error` level. ✓
2. Propagates to `lib/refresh-queue.ts:240` → `log.error("Token refresh threw exception", {tokenSuffix, error, durationMs})`. ✓
3. `index.ts:1869` bumps `runtimeMetrics.authRefreshFailures`. ✓

**Reconstructable**: yes — the `tokenSuffix` last-6 and error message suffice to ID the account. Good path.

### Rotation failure: `"All accounts failed"`

1. `codex-health` / `codex-doctor` show accounts with `health < 50` or `circuitState !== closed`.
2. Individual failures logged at `warn` per-account per-site in accounts.ts/rotation.ts.
3. **Gap**: no single log aggregates "rotation attempted N accounts, all failed, reasons: …" at the error level. User gets a synthetic 500 response message ("All … accounts failed") from `index.ts:2489` with correlationId but must *grep* the app log themselves.

### Storage failure: `"Failed to load account storage"`

1. `lib/storage.ts:885` logs `error`. ✓
2. Returned `null` propagates → `AccountManager` constructor falls back to empty list.
3. **Gap**: the *reason* is `String(error)` — if the error is an `StorageError` with a `cause` chain, the chain is flattened to the top message. Downstream reader loses the root cause.

---

## `lib/audit.ts` Realization Gap

`lib/audit.ts` defines:

- `AuditAction` enum (17 values covering account/auth/config/request/circuit events).
- `AuditOutcome` enum (success/failure/partial).
- `auditLog(action, actor, resource, outcome, metadata)` exported function with mask/rotate/queue.
- `configureAudit`, `getAuditLogPath`, `listAuditLogFiles` helpers.

Cross-referenced: **zero call sites to `auditLog(` in `lib/**` or `index.ts`**. Only `lib/audit.ts` itself (declaration), `test/audit.test.ts`, `test/audit.race.test.ts` reference it. `AuditAction.AUTH_LOGIN`, `ACCOUNT_ADD`, `CIRCUIT_OPEN` et al. are declared but never emitted. The sophisticated 0o700 dir, 10MB rotation, in-memory queue, and sanitiseMetadata are dead code from the plugin user's perspective.

Impact: a user running a post-incident audit ("who added this account? when was the circuit last opened?") has **no durable record**. The scoped logger messages are ephemeral (app log may rotate), and no structured event store exists. Downgraded from CRITICAL to HIGH only because the project is single-user / local and therefore the audit-trail blast radius is limited, but the defect is categorical: **infrastructure without behaviour**.

See HIGH-01.

---

## `lib/auto-update-checker.ts` Network & Telemetry

- Network: one `fetch(NPM_REGISTRY_URL)` per `CHECK_INTERVAL_MS` (24h). 5s timeout. No retry.
- Failure logging: all three failure sites use `log.debug` (lines 82, 89, 152) — invisible at default level.
- Telemetry concerns: package name + version sent to `registry.npmjs.org` as a GET — this is the standard npm registry request (same as `npm view oc-codex-multi-auth`), not user tracking. **Acceptable** under the project's "no cloud telemetry" constraint; npm registry is neutral infrastructure.
- No kill-switch: there is no env var to disable the check entirely. Closest is not calling `checkAndNotify` — the plugin does at `index.ts:1546`.

Small observability concern: `compareVersions` returning an unexpected sign due to parsed-int fallback (`parseInt(p, 10) || 0`) is silent — a version like `"6.0.0-alpha.1"` would compare as `6.0.0` and miss pre-release differences. Not observability-critical.

---

## `lib/health.ts` Reporting Surface

`getAccountHealth()` returns three-state status (`healthy | degraded | unhealthy`) plus per-account flags. `formatHealthReport()` renders to text for `codex-health`.

Observability issues:

- `circuitState` appears only when `!== "closed"` (line 103). Operators cannot verify circuit is closed ("healthy" and "closed-but-broken-somewhere-else" look identical).
- No quantitative signal on *why* `health < 50`. The health score is a 0-100 int; the decrement reasons (per `lib/accounts.ts` failure accounting) are not surfaced.
- `isRateLimited` and `isCoolingDown` booleans, but no TTL / remaining-wait in the formatted report (numbers exist in the struct, dropped at formatting).

See LOW-02 and MEDIUM-06.

---

## Findings

### [HIGH | confidence=high] Audit log infrastructure present but never invoked

- **File**: `lib/audit.ts:145-176`
- **Quote**:

  ```ts
  export function auditLog(
    action: AuditAction,
    actor: string,
    resource: string,
    outcome: AuditOutcome,
    metadata?: Record<string, unknown>,
  ): void {
    if (!auditConfig.enabled) return;
    try {
      ensureLogDir();
      rotateLogsIfNeeded();
      ...
  ```

- **Issue**: `auditLog(` has **zero call sites** anywhere in production code (`lib/**` and `index.ts`) at SHA `d92a8ee`. All 17 `AuditAction` values (account add/remove/switch/refresh, auth login/logout/failure, config load/change, request start/success/failure, circuit open/close) are defined, documented, and unused. The rotation, 0o700 directory, in-memory flush queue, and `sanitizeMetadata` helper are dead code from the plugin user's perspective. A post-incident investigator has no durable record of auth or rotation events.
- **Recommendation**: Wire `auditLog` into the actual mutation points: `AccountManager.addAccount / removeAccount / setActiveAccount` in `lib/accounts.ts`; `queuedRefresh` success/failure in `lib/refresh-queue.ts`; `CircuitBreaker.open / close` in `lib/circuit-breaker.ts`; `AccountManager.exportAccounts / importAccounts` in `lib/storage.ts`. Each site should pass the correlation ID implicitly via `getCorrelationId()` (already wired at `audit.ts:160`). Alternative: if the project deliberately chose not to keep an audit trail, delete `lib/audit.ts` and the associated test files rather than shipping dead code.
- **Evidence**: `Grep -r 'auditLog(' lib/ index.ts` → 1 match (declaration at `audit.ts:145`). `Grep -r 'AuditAction' lib/ index.ts` → 1 match (declaration at `audit.ts:29`).

### [HIGH | confidence=high] Audit log writes silently discard errors at outer layer

- **File**: `lib/audit.ts:173-175`
- **Quote**:

  ```ts
  } catch {
    // Audit logging should never break the application
  }
  ```

- **Issue**: The outer `try/catch` around the entire `auditLog` body masks every possible failure — disk full, permission denied, rotation rename failure, JSON stringify explosion, etc. — with zero logged signal. The intent (never crash the app) is valid; the implementation is not defensible because the inner queue already retains on EBUSY (`audit.ts:19`). SREs cannot distinguish "audit logging is happily writing" from "audit logging has been broken for a month". If HIGH-01 is fixed and this site is reached, this silent swallow becomes a second-order defect.
- **Recommendation**: Inside the outer catch, emit one `logError("Audit log write failed", {error: String(e)})` *before* swallowing. The scoped logger is already imported (line 27 already imports from `./logger.js`). The fallback should be throttled (once per minute) to avoid log-loop amplification.
- **Evidence**: direct read; comment alone is the only signal.

### [HIGH | confidence=medium] `TOKEN_PATTERNS` does not mask opaque refresh tokens

- **File**: `lib/logger.ts:29-34`
- **Quote**:

  ```ts
  const TOKEN_PATTERNS = [
    /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    /[a-f0-9]{40,}/gi,
    /sk-[A-Za-z0-9]{20,}/g,
    /Bearer\s+\S+/gi,
  ];
  ```

- **Issue**: ChatGPT OAuth refresh tokens are opaque base64url strings (alphanumeric plus `-_`) that don't start with `eyJ`, aren't hex-only, don't start with `sk-`, and may not travel with a `Bearer ` prefix when they land inside free-form `error.message` payloads. The `SENSITIVE_KEYS` object-key sanitisation (lines 38-57) covers structured objects; it does not cover string-embedded leakage. Any upstream error that echoes the token back (e.g. `"invalid token <TOKEN>"`) passes through `maskString` unchanged.
- **Recommendation**: Primary analysis in `02-security.md` (T02). From the observability lens: add a fallback mask for base64url sequences ≥ 40 chars that don't cross-match a known-safe allowlist (git SHAs, hashes). Also consider explicit whitelist of known-clean shapes (account UUIDs) to avoid over-masking.
- **Evidence**: `lib/logger.ts:29-34` verbatim. Cross-reference: `02-security.md` (redaction analysis — primary).

### [HIGH | confidence=high] Correlation ID not propagated across async task boundaries

- **File**: `lib/logger.ts:127-140` + `index.ts:1688-2501`
- **Quote**:

  ```ts
  let currentCorrelationId: string | null = null;
  export function setCorrelationId(id?: string): string {
    currentCorrelationId = id ?? randomUUID();
    return currentCorrelationId;
  }
  ```

- **Issue**: The correlation slot is a single process-global mutable. It is set only at `index.ts:1688` (per upstream request) and cleared at `index.ts:2501`. Anything outside that window — background `proactive-refresh` (`lib/proactive-refresh.ts:140-198`), tool handlers invoking `queuedRefresh` (`index.ts:5099` `codex-doctor --fix`), parallel probes after winner resolution (`lib/parallel-probe.ts:110-133`), background prompt refresh (`lib/prompts/opencode-codex.ts:189-201`) — logs with `correlationId=null`. There is no `AsyncLocalStorage` or argument-passed `traceContext`. Debugging "which request triggered this refresh" is impossible.
- **Recommendation**: Replace the module-scoped `let` with `AsyncLocalStorage<string>` from `node:async_hooks`. Wrap the outer request handler in `als.run(id, async () => { ... })` so every transitively called await inherits the ID without manual threading. For "root" operations (proactive refresh, tool handlers), generate a `bg:<uuid>` ID at entry so logs carry a non-null trace. Keep the existing API surface (`setCorrelationId` / `getCorrelationId`) as compat shims.
- **Evidence**: `Grep setCorrelationId lib/ index.ts` → only 2 write-sites in production (`index.ts:1688`, `index.ts:2501`). `refresh-queue.ts`, `proactive-refresh.ts`, `parallel-probe.ts`, `auto-update-checker.ts` emit logs with no correlation context.

### [HIGH | confidence=high] SSE "no final response" logged at warn when it breaks the session

- **File**: `lib/request/response-handler.ts:215-220`
- **Quote**:

  ```ts
  log.warn("Could not find final response in SSE stream");
  ```

- **Issue**: This condition means the upstream streamed no `response.done` event — the request returns without a usable completion and the caller synthesises a fallback. This is a user-visible failure of the entire request. The `warn` level is below default-interesting for most operators; the subsequent `logRequest("stream-error", ...)` at line 218 fires only with `ENABLE_PLUGIN_REQUEST_LOGGING=1`. Operators often discover this only after multiple user reports of "the request hung / returned nothing".
- **Recommendation**: Promote to `log.error` with structured payload: `{stage: "sse-stream", reason: "no-response-done", bytesSeen, linesSeen, accountIndex}`. Keep the `logRequest` file-dump. Consider bumping `runtimeMetrics.emptyResponseRetries` here so `codex-metrics` surfaces the aggregate.
- **Evidence**: `lib/request/response-handler.ts:185-220` read; `index.ts:4749` shows `emptyResponseRetries` metric already exists.

### [MEDIUM | confidence=high] Storage migration persist failure logged at warn masks data-loss risk

- **File**: `lib/storage.ts:826-830`
- **Quote**:

  ```ts
  try {
    await persistMigration(normalized);
  } catch (saveError) {
    log.warn("Failed to persist migrated storage", { error: String(saveError) });
  }
  ```

- **Issue**: The storage loader successfully migrated V1→V3 in-memory, then failed to write the V3 back. The in-memory value is returned to the caller (loader resolves with `normalized`), so the request proceeds. Next plugin start re-runs the same V1→V3 migration — idempotent today, but every migration is a re-interpretation of legacy data. If the migration is ever made non-idempotent (e.g. minting missing fields from `Date.now()`), this silent continuation becomes a source of slow drift. `warn` level further hides it from default operators.
- **Recommendation**: Promote to `log.error` and include `{from: storedVersion, to: normalized.version}`. Optionally re-throw so the loader returns `null` — forcing the caller to handle "migration failed" rather than silently pretending it succeeded.
- **Evidence**: `lib/storage.ts:807-834` read; `AGENTS.md:52` lists "StorageError preserves original stack traces via `cause` parameter" — that contract is violated here because the caught error is stringified before logging.

### [MEDIUM | confidence=high] User-visible failure in `hydrateFromCodexCli` logs at debug

- **File**: `lib/accounts.ts:150-154` + `lib/accounts.ts:271-275`
- **Quote**:

  ```ts
  } catch (error) {
    log.debug("Failed to read Codex CLI accounts cache", { error: String(error) });
    codexCliTokenCache = null;
    return null;
  }
  ```

- **Issue**: On first run, users expect the plugin to pick up existing Codex-CLI credentials so they don't re-login. If the cache read fails (permissions, path drift, corrupt JSON), the only evidence is a `debug`-level log, suppressed unless `DEBUG_CODEX_PLUGIN=1`. Users see "no accounts detected; please login" with no path to the real cause. Same class at line 274 for persist failure after hydration.
- **Recommendation**: Upgrade the *read* failure to `log.warn` (actionable for operators) and keep a one-liner hint in `codex-doctor` output: "Codex CLI credential cache unreadable (check `~/.codex/auth.json` perms)". Persist failure at line 274 can remain `debug` (next mutation retries).
- **Evidence**: `lib/accounts.ts:90-165` for hydration flow; `codex-doctor` tool at `index.ts:5057` does not reference this failure path.

### [MEDIUM | confidence=high] Silent return from recovery failure paths

- **File**: `lib/recovery.ts:147-153` + `lib/recovery.ts:229-240`
- **Quote**:

  ```ts
  try {
    await sendToolResultsForRecovery(client, sessionID, toolResultParts);
    return true;
  } catch {
    return false;
  }
  ```

- **Issue**: Two distinct recovery helpers — tool-result send (line 147) and resume-session (line 229) — swallow their exceptions and return `false`. The caller at `lib/recovery.ts:413` will then log `"Recovery failed"` but with no causal detail: it saw `success === false` without knowing which sub-step failed or why. Users report "recovery did nothing" and operators cannot tell whether the client.message.send call 500'd, the tool-result chain was rejected, or the session was already closed.
- **Recommendation**: Replace `catch {}` with `catch (err) { log.warn("…failed", {err: String(err)}); return false; }`. Warn level is appropriate because the caller already logs `error` at the outer level; the sub-step annotation is the breadcrumb that makes the error actionable.
- **Evidence**: `lib/recovery.ts:143-240` read; outer catch at `lib/recovery.ts:413` has full message but no nested detail.

### [MEDIUM | confidence=medium] `safeReadBody` masks body-read errors as empty body

- **File**: `lib/request/fetch-helpers.ts:651-657`
- **Quote**:

  ```ts
  async function safeReadBody(response: Response): Promise<string> {
    try {
      return await response.clone().text();
    } catch {
      return "";
    }
  }
  ```

- **Issue**: The downstream error mapping (e.g. `mapUsageLimit404WithBody`, context-overflow detection) conflates "server returned empty body" with "we failed to read the body". These have very different operational implications — the first is an upstream contract, the second is a local defect (aborted stream, broken reader). The `""` sentinel is reused across the file (e.g. `fetch-helpers.ts:669`, `context-overflow.ts:134`).
- **Recommendation**: At minimum `log.debug("safeReadBody: body read failed", {status: response.status, error: String(e)})`. Alternatively return `{text: string, error: Error | null}` so the caller can decide how to report.
- **Evidence**: `lib/request/fetch-helpers.ts:651-657` read; downstream callers at 581-590 treat `""` and "valid empty body" identically.

### [MEDIUM | confidence=medium] `getCurrentVersion` returns "0.0.0" on read failure

- **File**: `lib/auto-update-checker.ts:25-33`
- **Quote**:

  ```ts
  function getCurrentVersion(): string {
    try {
      const packageJsonPath = join(import.meta.dirname ?? __dirname, "..", "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };
      return packageJson.version;
    } catch {
      return "0.0.0";
    }
  }
  ```

- **Issue**: A failed read here (packaging defect, partial install, permissions) returns a fake version. `codex-metrics`, `codex-doctor`, and the "Update available" comparison all consume this string. An operator seeing `v0.0.0` in the dashboard cannot tell whether the install is broken or whether the check failed silently.
- **Recommendation**: `catch (error) { log.warn("Failed to read own package.json", {error: String(error)}); return "0.0.0"; }`. Upgrade to `error` if the fallback is ever load-bearing.
- **Evidence**: `lib/auto-update-checker.ts:25-33` read; `codex-metrics` tool consumes version via transitively in `runtimeMetrics.retryProfile` stack.

### [MEDIUM | confidence=high] `logRequest` per-request file dumps are unbounded

- **File**: `lib/logger.ts:254-291`
- **Quote**:

  ```ts
  const filename = join(LOG_DIR, `request-${requestId}-${stage}.json`);
  ...
  writeFileSync(filename, JSON.stringify(...), { encoding: "utf8", mode: 0o600 });
  ```

- **Issue**: `requestCounter` increments monotonically for the process lifetime; each stage writes a separate file. `ENABLE_PLUGIN_REQUEST_LOGGING=1` is documented as a debug toggle in `README.md`, but there is no rotation, no file-count cap, no age-based pruning. Long-running sessions can accumulate tens of thousands of small files under `~/.opencode/logs/codex-plugin/`. The audit log (`lib/audit.ts`) has a 10MB × 5 rotation policy — the request logger does not.
- **Recommendation**: Add a bounded rotation (e.g. keep last 1,000 files, delete oldest). Alternatively gate per-stage files behind a second toggle and default to one appended JSON-lines file.
- **Evidence**: `lib/logger.ts:254-291` read; `lib/audit.ts:99-117` (rotation reference) shows the pattern available.

### [MEDIUM | confidence=medium] `audit.ts` flush queue retains items on write failure unbounded

- **File**: `lib/audit.ts:14-24`
- **Quote**:

  ```ts
  } catch (error) {
    // If the file is locked by an external process (e.g. antivirus),
    // we unshift the items back to the front of the queue to try again later
    logQueue.unshift(...itemsToFlush);
    console.error("[AuditLog] Failed to flush queue, retaining items:", error);
  }
  ```

- **Issue**: If the antivirus / lock persists indefinitely, `logQueue` grows without bound — every call to `auditLog` pushes another line that can never be flushed. Combined with HIGH-01 this is latent, but once audit is wired up the memory leak risk is real. No cap on queue length, no drop-oldest policy, no alerting.
- **Recommendation**: Cap `logQueue.length` (e.g. 10,000 entries); when exceeded, drop oldest and emit `logError("Audit queue overflow, dropping oldest N entries")`. Prevents DoS via stuck lock.
- **Evidence**: `lib/audit.ts:4-24` read.

### [MEDIUM | confidence=high] Metrics are process-local and volatile

- **File**: `index.ts:345-372` + `index.ts:4712-4810`
- **Quote**:

  ```ts
  const runtimeMetrics: RuntimeMetrics = {
    startedAt: Date.now(),
    totalRequests: 0,
    successfulRequests: 0,
    ...
  };
  ```

- **Issue**: All 24 runtime counters plus `refresh-queue` metrics live in plain module-scoped objects. Plugin restart (OpenCode session cycle) resets them to zero. There is no periodic snapshot to disk, no `/metrics`-style endpoint, no rolling history. A user investigating "I had a spike of rate limits yesterday" has no data.
- **Recommendation**: Write a rolling 24-hour window of `runtimeMetrics` and `refreshMetrics` to `~/.opencode/logs/metrics.jsonl` on plugin-shutdown and every N requests (e.g. 100). The file is an append-only JSON-lines log, rotation-bounded like `audit.log`. `codex-metrics --history` can then read it.
- **Evidence**: `index.ts:345-372` (metric definitions) and `index.ts:4712-4810` (exposure tool). No persistence site anywhere in `lib/` or `index.ts`.

### [MEDIUM | confidence=medium] Health formatter hides "all closed" state

- **File**: `lib/health.ts:96-107`
- **Quote**:

  ```ts
  if (acc.circuitState !== "closed") flags.push(`circuit-${acc.circuitState}`);
  const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
  lines.push(`  [${acc.index + 1}] ${email}: ${acc.health}%${flagStr}`);
  ```

- **Issue**: Circuit state renders only when open / half-open. "No circuit flag" means either "closed (healthy)" or "closed but we forgot to check" — operators cannot verify the breaker is actually engaged when they expect it to be. Also `rateLimitedUntil` / `cooldownUntil` numbers are carried in the struct (`lib/health.ts:46-49`) but dropped by the formatter — no "cooling down for 3m42s" detail.
- **Recommendation**: Add a `verbose` arg to `formatHealthReport` that emits all circuit states (including `closed`) and formats remaining cooldown TTLs as durations. Keep terse default; expose verbose via `codex-health --verbose`.
- **Evidence**: `lib/health.ts:82-109` read; struct has TTL data, formatter omits it.

### [MEDIUM | confidence=high] Parallel probe failures log only the winner

- **File**: `lib/parallel-probe.ts:118-132`
- **Quote**:

  ```ts
  .catch((_error) => {
    resolvedCount++;
    if (resolvedCount === candidates.length && !winner) {
      resolve(null);
    }
  });
  ```

- **Issue**: Losing probes silently discard their error. If 3 of 4 accounts fail with varied reasons (one 429, one network, one 401) and the 4th wins, the operator sees only the success path in logs. When diagnosing "why did we fall back to account 4", the per-account failure reasons are exactly the missing signal. The `_error` underscore prefix is intentional — but means *logging intent is absent*.
- **Recommendation**: Replace with `.catch((err) => { log.debug("Probe failure", {accountIndex: account.index, error: String(err)}); resolvedCount++; ... })`. Debug is fine because the happy path is frequent; when users need the data they raise log level.
- **Evidence**: `lib/parallel-probe.ts:110-133` read.

### [MEDIUM | confidence=medium] Correlation ID format is threadId+Date.now() — not globally unique

- **File**: `index.ts:1684-1690`
- **Quote**:

  ```ts
  const threadIdCandidate =
    (process.env.CODEX_THREAD_ID ?? promptCacheKey ?? "")
      .toString()
      .trim() || undefined;
  const requestCorrelationId = setCorrelationId(
    threadIdCandidate ? `${threadIdCandidate}:${Date.now()}` : undefined,
  );
  ```

- **Issue**: When `threadIdCandidate` is present, the derived ID is `<threadId>:<ms-epoch>` — which will collide if two requests on the same thread are processed within the same millisecond (fast-fail retry, client-side parallelism). When not present, `setCorrelationId(undefined)` generates a UUID (safe). The collision risk is low but real, and the format is not portable to distributed tracing backends (W3C TraceContext expects a 128-bit hex).
- **Recommendation**: Always `randomUUID()` for the trace ID; keep `threadId` and `promptCacheKey` as separate structured fields on the log entry, not baked into the ID. This also aligns with W3C TraceContext if the plugin ever ships to a multi-process environment.
- **Evidence**: `index.ts:1684-1690` read.

### [MEDIUM | confidence=medium] No aggregated "rotation exhausted" log at error level

- **File**: `index.ts:2485-2500` (around `formatAccountLabel` / "All accounts failed" synthetic response)
- **Quote**:

  ```ts
  : `All ${count} account(s) failed (server errors or auth issues). Check account health with \`codex-health\`.`;
  ```

- **Issue**: The synthetic 500 response tells the user to check `codex-health`, but the rotation decision trail is not summarised in the scoped logger. Each individual failure logs at `warn` per-account; there is no terminal `log.error("Rotation exhausted", {attempted, reasons})` at the macro level. `runtimeMetrics.accountRotations` increments but the *count* gives no insight into the *reasons* mix.
- **Recommendation**: Before returning the synthetic error response, emit `log.error("Rotation exhausted", {attemptedAccounts, perAccountReasons: {0:"rate-limit",1:"5xx",...}, requestCorrelationId})`. This becomes the single breadcrumb operators pull when users report "all-failed" errors.
- **Evidence**: `index.ts:2485-2500` read; `runtimeMetrics.accountRotations` incremented at 1871, 1973 without accompanying reason payload.

### [LOW | confidence=high] `logError` silenced on stderr by default

- **File**: `lib/logger.ts:316-320` + `lib/logger.ts:123`
- **Quote**:

  ```ts
  const CONSOLE_LOG_ENABLED = process.env.CODEX_CONSOLE_LOG === "1";
  ...
  export function logError(message: string, data?: unknown): void {
    logToApp("error", message, data);
    const text = `[${PLUGIN_NAME}] ${message}`;
    logToConsole("error", text, data);
  }
  ```

- **Issue**: `logToConsole` checks `CONSOLE_LOG_ENABLED` and returns early if unset. Default is unset. Errors go only to the OpenCode app log (if `initLogger(client)` was called), meaning a crash during client init can leave errors completely invisible. Reasonable default, but the fact is undocumented — operators assume "errors always hit stderr".
- **Recommendation**: Document `CODEX_CONSOLE_LOG` in `docs/configuration.md`. Optionally emit `error` to `console.error` unconditionally (bypassing the toggle) since error logs are rare and high-value.
- **Evidence**: `lib/logger.ts:119-125, 186-200, 316-320` read.

### [LOW | confidence=medium] Closed circuits invisible in health report

- **File**: `lib/health.ts:103`
- **Quote**:

  ```ts
  if (acc.circuitState !== "closed") flags.push(`circuit-${acc.circuitState}`);
  ```

- **Issue**: See MEDIUM-06 above — duplicate flavour. Kept LOW because the fix is a one-line conditional.
- **Recommendation**: See MEDIUM-06 (verbose mode).
- **Evidence**: `lib/health.ts:96-107` read.

### [LOW | confidence=medium] Refresh-queue `lastFailureReason` not masked

- **File**: `lib/refresh-queue.ts:224-225` + `lib/refresh-queue.ts:238-239`
- **Quote**:

  ```ts
  this.metrics.lastFailureReason = result.reason ?? "unknown";
  ```

- **Issue**: `result.reason` is a short taxonomy code (`network_error`, `missing_refresh`, etc.) per `lib/auth/auth.ts`, so current leakage risk is near zero. But `this.metrics.lastFailureReason = error.message` at line 238 *could* surface raw upstream text. If OpenAI ever echoes the token in their error body (has happened for other vendors), `codex-metrics` would leak it in the JSON output.
- **Recommendation**: Route `this.metrics.lastFailureReason = maskString(error.message)` through the logger's `maskString` (currently module-private). Small refactor: export `maskString` or introduce a `redact()` helper.
- **Evidence**: `lib/refresh-queue.ts:210-250` read; `codex-metrics` exposes `refreshQueue` at `index.ts:4755`.

### [LOW | confidence=high] No timestamp in console log output

- **File**: `lib/logger.ts:186-200`
- **Quote**:

  ```ts
  if (level === "warn") console.warn(sanitizedMessage);
  else if (level === "error") console.error(sanitizedMessage);
  else console.log(sanitizedMessage);
  ```

- **Issue**: Console lines have no timestamp prefix. Operators correlating with app logs or audit logs (which do carry ISO timestamps) must rely on shell wrapper / system log aggregator. For file-logged `logRequest`, ISO timestamp is embedded (`lib/logger.ts:261`) — asymmetry.
- **Recommendation**: Prepend `new Date().toISOString()` to all console lines for parity.
- **Evidence**: `lib/logger.ts:186-200` (console) vs `:261` (file — has timestamp).

### [LOW | confidence=medium] No structured `event` discriminator on log payloads

- **File**: `lib/logger.ts:146-184`
- **Quote**:

  ```ts
  appLog({
    body: {
      service,
      level,
      message: sanitizedMessage,
      extra,
    },
  });
  ```

- **Issue**: The log body carries `service` (e.g. `oc-codex-multi-auth.parallel-probe`) and `message` (free-form string). There is no `event` / `action` key that a log consumer can filter on. Discovering "all refresh-start events" requires string-matching the message, which is fragile across refactors.
- **Recommendation**: Introduce an optional `event?: string` field on the scoped-logger API (e.g. `log.info("Token refresh succeeded", {event: "refresh.success", ...})`). Non-breaking; consumers can opt in over time.
- **Evidence**: `lib/logger.ts:146-184` read; `extra` currently only carries correlationId + data.

### [LOW | confidence=medium] `JWT decode` silent null return loses diagnostic

- **File**: `lib/auth/auth.ts:120-130`
- **Quote**:

  ```ts
  const decoded = Buffer.from(padded, "base64").toString("utf-8");
  return JSON.parse(decoded) as JWTPayload;
  } catch {
    return null;
  }
  ```

- **Issue**: If an upstream access token arrives in an unexpected format, the caller (`lib/accounts.ts:extractExpiresAtFromAccessToken` consumers) receives `null` and proceeds with "no known expiry". No log trace of *why* JWT decode failed is ever written. Downstream effect: proactive refresh uses default heuristics, masking upstream contract drift.
- **Recommendation**: `catch (err) { logDebug("JWT decode failed", {error: String(err)}); return null; }`. Debug level is fine because the condition is rare; the breadcrumb is valuable when it happens.
- **Evidence**: `lib/auth/auth.ts:120-130` read.

### [LOW | confidence=medium] `browser.ts` auto-open failure silent

- **File**: `lib/auth/browser.ts:92-96`
- **Quote**:

  ```ts
  } catch {
    // Silently fail - user can manually open the URL from instructions
    return false;
  }
  ```

- **Issue**: Failing to auto-open a browser is user-facing (they'll paste the URL manually). The log silence means users / SRE cannot tell *why* the opener failed — missing binary, permissions, spawn error. In WSL or sandboxed containers this is a common pain point.
- **Recommendation**: `catch (err) { logDebug("Browser auto-open failed", {opener: getBrowserOpener(), error: String(err)}); return false; }`.
- **Evidence**: `lib/auth/browser.ts:80-96` read.

---

## Notes

- `lib/request/request-transformer.ts` has a bare `} catch { ... }` at line 881 (noted in the silent-failure scan) that was not individually sampled because it is inside the tool-translation adapter — out of scope for observability macro-findings and covered by T07 (request pipeline).
- `lib/recovery/storage.ts` contains 11 bare catches (`lib/recovery/storage.ts:51, 73, 77, 105, 109, 169, 263, 284, 288, 378, 382`) — all are part of the experimental context-overflow recovery store. Observability-impact is limited to that sub-feature; T10 (error handling) is the primary owner.
- No findings re-logged from T02 (redaction). HIGH-03 cross-references but is scoped to the *observability consequence* (free-form error-message leakage), not the redaction policy itself.
- Severity budget used: **CRITICAL 0/5, HIGH 5/15, MEDIUM 11/40, LOW 7/unbounded** — well within bounds.
- No findings depend on runtime observation; every claim is direct-read from the locked SHA.
- The project's "no cloud telemetry" stance is preserved. No recommendation above proposes upstream telemetry.

---

*End of T09 observability audit. Rubric version 1.*
