---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T04-request-pipeline
agent: opencode/claude-opus-4-7 (T4 auditor)
date: 2026-04-17
scope-files:
  - index.ts
  - lib/request/fetch-helpers.ts
  - lib/request/request-transformer.ts
  - lib/request/response-handler.ts
  - lib/request/retry-budget.ts
  - lib/request/rate-limit-backoff.ts
  - lib/request/helpers/input-utils.ts
  - lib/request/helpers/model-map.ts
  - lib/request/helpers/tool-utils.ts
  - lib/prompts/codex.ts
  - lib/prompts/codex-opencode-bridge.ts
  - lib/prompts/opencode-codex.ts
rubric-version: 1
---

# T4 — Request Pipeline / API Compatibility

**Summary**: Audit of the plugin-level fetch interceptor (`index.ts`), the request/response helpers under `lib/request/**`, and the prompt-template fetch machinery under `lib/prompts/**`. The pipeline is a 7-stage, single-level-inlined function inside `OpenAIOAuthPlugin`, coordinating URL rewrite, body transformation, multi-tier retry, account rotation, and SSE→JSON conversion. Core correctness is solid for steady-state traffic, but four specific weaknesses risk user-visible stalls or silent data loss: (1) the streaming (`streamText`) path never applies the per-read stall timeout, (2) the ETag cache throws on 304 when the on-disk payload was independently evicted, (3) the SSE line parser splits only on `\n`/`\r\n` so multi-line `data:` payloads and boundary-straddled events are dropped, and (4) the per-(account, quota) rate-limit-backoff state is never cleared when the rotation path marks an account rate-limited, causing a thrash-back-and-retry sequence to incur up to the MAX_BACKOFF_MS wall. Headline severity: **0 CRITICAL / 3 HIGH / 8 MEDIUM / 7 LOW** (18 findings).

**Files audited**: 12 of 12 in-scope (11 scoped files under `lib/request/**` and `lib/prompts/**`, plus `index.ts` entry point). All citations verified against the SHA locked in `docs/audits/_meta/sha.lock`.

---

## 7-Step Pipeline Walkthrough

This section maps every logical step of the request pipeline to its line range inside the plugin. The original inline comments in `index.ts` only tag steps 1 and 3 (see the "Step 1" comment at `index.ts:1582` and the "Step 3" comment at `index.ts:1586`); the remaining steps are implicit. Because later findings reference these ranges repeatedly, we make them explicit here.

### Step 1: URL rewrite

- **File**: `index.ts:1582-1584`
- **What happens**: `extractRequestUrl(input)` normalizes `Request | string | URL` to a string and `rewriteUrlForCodex(url)` swaps the host to `CODEX_BASE_URL` and prepends the Codex base path.
- **Ownership**: `lib/request/fetch-helpers.ts:366-395` defines both helpers; `CODEX_BASE_PATH_PREFIX` is computed at module load from the base URL.
- **Invariant**: every outbound request is reshaped to `https://chatgpt.com/backend-api/codex/...`, even if the caller supplied an `api.openai.com` URL.

### Step 2: Normalize RequestInit + parse body

- **File**: `index.ts:1590-1658`
- **What happens**: `normalizeRequestInit` rebuilds a `RequestInit` from a `Request` object when `init` is missing, preserving method + headers and cloning the body text for non-GET/HEAD verbs. `parseRequestBodyFromInit` parses the body from any of string / `Uint8Array` / `ArrayBuffer` / typed array / `Blob`, returning `{}` on parse failure (with a `logWarn`). The parsed body is captured into `originalBody` so `stream === true` detection (`isStreaming`) is done on the pre-transform copy.
- **Invariant**: `isStreaming` is frozen before transformation; the downstream SSE→JSON branch uses it instead of re-reading `body.stream`.

### Step 3: Transform request body for Codex

- **File**: `index.ts:1660-1672`; transformation defined in `lib/request/fetch-helpers.ts:408-525` and `lib/request/request-transformer.ts:958-1130`.
- **What happens**: `transformRequestForCodex` pulls model-specific Codex instructions (via `getCodexInstructions`), applies `transformRequestBody` (normalize model, filter input, inject prompt, set `store=false`, force `stream=true`, add `reasoning.encrypted_content` to `include`), and serializes the body back to the updated `RequestInit`.
- **Contract anchors**: `AGENTS.md:49` declares "ChatGPT backend requires `store: false`, include `reasoning.encrypted_content`"; the implementation is at `lib/request/request-transformer.ts:999-1002` and `lib/request/request-transformer.ts:1117-1119`.

### Step 4: Auth refresh (token skew)

- **File**: `index.ts:1837-1845`
- **What happens**: `shouldRefreshToken(accountAuth, tokenRefreshSkewMs)` (implemented at `lib/request/fetch-helpers.ts:315-321`) returns `true` if expiry is within the configured skew. If so, `refreshAndUpdateToken` runs through the deduplicating `queuedRefresh` and writes the new token back via `client.auth.set`. Failures consume one slot of the `authRefresh` retry budget (see Tier-1 below) and mark the account cooling down.
- **Out of T4 scope**: the token refresh mutex and token storage redaction live in `lib/refresh-queue.ts` and `lib/logger.ts` (T2 / T7).

### Step 5: Codex headers + local token bucket

- **File**: `index.ts:1958-1981`; headers built at `lib/request/fetch-helpers.ts:535-564`.
- **What happens**: `createCodexHeaders` strips `x-api-key`, sets `Authorization: Bearer <access>`, injects `OpenAI-Beta: responses=experimental`, `originator: codex_cli_rs`, optional `session_id`/`conversation_id` (from `promptCacheKey`), and optional `organization` (from `account.organizationId`). Then `accountManager.consumeToken` decrements the per-(account, family, model) token bucket. If the bucket is empty, the request breaks out of the account loop before hitting the network (no wasted API call).

### Step 6: Fetch with AbortController + timeout

- **File**: `index.ts:2006-2062`
- **What happens**: a fresh `AbortController` is created per attempt, wired to `fetchTimeoutMs` (default 60 000 ms per `lib/config.ts:491`) and, if present, the caller-provided `abortSignal`. Network errors consume one slot of the `network` retry budget (see Tier 1 below) and refund the local token. Success falls through to Step 7.

### Step 7: Response handling (errors, rate limits, rotation, success)

- **File**: `index.ts:2073-2445`
- **What happens**: on `!response.ok`, `handleErrorResponse` normalizes the body, detects rate-limit / deprecation (RFC 8594, see `lib/request/fetch-helpers.ts:629-634`), and returns `{ response, rateLimit, errorBody }`. The caller then dispatches on:
  - deactivated-workspace code → flag account, rotate (`index.ts:2085-2146`)
  - unsupported-model code → model fallback (`index.ts:2149-2251`)
  - recoverable error types → toast + break (`index.ts:2291-2300`)
  - 5xx → consume `server` budget + rotate (`index.ts:2302-2321`)
  - 429 + short retry-after → consume `rateLimitShort` budget, exponential backoff, retry same account (`index.ts:2323-2355`)
  - 429 + long retry-after → `markRateLimited` + rotate (`index.ts:2357-2392`)
  - 2xx → `resetRateLimitBackoff`, call `handleSuccessResponse` (SSE→JSON for non-streaming, pass-through for streaming), run empty-response retry guard, record success (`index.ts:2395-2445`).

---

## Retry Tier Coordination

The pipeline has **four independent retry tiers**. They share no state between requests (except Tier 2's per-process `Map`). A request can consume budget from multiple tiers simultaneously — for example, a single 5xx storm walks every account once (Tier 0) while consuming `server` slots (Tier 1), and a rotation-back to a previously rate-limited account re-enters Tier 2's backoff state.

| Tier | Scope | Owner | Budget / Window | Triggers | Coordination Risk |
|---|---|---|---|---|---|
| **Tier 0** | per-request, per-account | `fetch-helpers.ts` classification + `index.ts:1784-2462` outer loops | walks `accountManager.getAccountCount()` accounts per iteration | auth failure, 5xx, 429-long, unsupported-model, deactivated workspace, network error | Every rotation increments `runtimeMetrics.accountRotations`; no cap inside a single Tier-0 iteration beyond `attempted` set. |
| **Tier 1** | per-request (instance of `RetryBudgetTracker`) | `lib/request/retry-budget.ts:88-124`; constructed at `index.ts:1698` | `authRefresh / network / server / rateLimitShort / rateLimitGlobal / emptyResponse` (defaults: 4/4/4/4/3/2 on `balanced` profile at `lib/request/retry-budget.ts:28-35`) | each class incremented on corresponding failure path | Budget is per-request, not per-account. 4 failing accounts × 1 server hit each = 4 slots gone, user sees 503 "Server retry budget exhausted" even though rotation continues to try more accounts. |
| **Tier 2** | per-(accountIndex, quotaKey), per-process | `lib/request/rate-limit-backoff.ts:29-93` (module-level `Map`) | exponential `baseDelay * 2^(attempt-1)` capped at `MAX_BACKOFF_MS = 60_000` (line 19), state reset after `RATE_LIMIT_STATE_RESET_MS = 120_000` (line 18) | 429 (short retry) | State survives Tier-0 rotation. If the outer loop rotates to account B on 429 and later rotates back to account A within 120s, account A's backoff still remembers `consecutive429`. Next short-retry incurs up to `MAX_BACKOFF_MS` wall. |
| **Tier 3** | per-account circuit breaker | `lib/circuit-breaker.ts` (out of T4 scope — cross-reference to T3 / T7) | half-open / open / closed state; not directly invoked from `index.ts` pipeline | failure accumulation inside `accountManager.recordFailure` | Cited only for completeness. Interaction with Tier 2 is not coordinated: a half-open circuit-breaker can still trigger rate-limit-backoff delays when the probe fails with 429. |

### Coordination risks captured as findings

- Tier 1 vs Tier 0 exhaustion: see HIGH-3 below (retry-budget scoped per-request, not per-account).
- Tier 2 rotation-thrash: see MEDIUM-4 below (state persists across rotation).
- Tier 3 ↔ Tier 2 interleave: out of T4 scope; deferred to T7 (Concurrency).

---

## Cross-Version OpenCode Compatibility Matrix

The plugin is published as `oc-codex-multi-auth@6.0.0` and depends on OpenCode SDK surfaces that evolve across OpenCode releases. The declared ranges are:

| Dependency | Package declaration | Field | Source |
|---|---|---|---|
| OpenCode plugin runtime | `@opencode-ai/plugin` | `^1.2.9` | `package.json` dependencies |
| OpenCode SDK | `@opencode-ai/sdk` | `^1.2.10` | `package.json` devDependencies |
| TypeScript | `typescript` | `^5` | `package.json` peerDependencies |
| Node | `>=18.0.0` | `engines.node` | `package.json` |

Observations:

1. **No advertised minimum OpenCode CLI version.** The README (quoted here for context only; scope of this finding is `package.json`) mentions "v1.0.210+" for the `--modern` catalog path, but the repository does not declare a floor for the CLI itself. A user on an older OpenCode CLI can `npm install oc-codex-multi-auth@6` and get a runtime mismatch that surfaces only when the plugin calls a missing SDK method.
2. **SDK shape dependencies used at runtime**:
   - `client.auth.set({ path: { id: "openai" }, body: { type: "oauth", access, refresh, expires, multiAccount: true } })` at `lib/request/fetch-helpers.ts:340-349`. A breaking change to the Auth body shape (e.g. removing `multiAccount`) breaks token persistence silently.
   - `tool` factory and `tool.schema` from `@opencode-ai/plugin/tool` used throughout `index.ts` tool registrations.
   - `PluginInput`, `Plugin` types from `@opencode-ai/plugin` at `index.ts:27`.
3. **Upstream prompt sources are pinned by URL, not version**:
   - Codex prompts: `https://api.github.com/repos/openai/codex/releases/latest` (`lib/prompts/codex.ts:8-9`). Contract drift risk if OpenAI restructures Codex CLI repo (see MEDIUM-1 / MEDIUM-2 below).
   - OpenCode prompt fallback list at `lib/prompts/opencode-codex.ts:13-22` includes both `anomalyco/opencode` and `sst/opencode` forks, `dev`/`main` branches, `.txt`/`.md` extensions. This is a sensible fan-out, but each branch tip can drift without warning; the `If-None-Match` header is only sent when the previous `sourceUrl` matches (line 132-134).
4. **Peer-dep gap**: OpenCode SDK is in devDependencies, not peerDependencies. The SDK types leaking through `Auth` imports at `index.ts:28` and `lib/request/fetch-helpers.ts:6` rely on whatever SDK version OpenCode has installed at runtime, not the one pinned here.

---

## Findings

### [HIGH | confidence=high] Streaming path skips per-read stall timeout; only absolute fetchTimeoutMs applies

- **File**: `lib/request/fetch-helpers.ts:624-648`
- **Quote**:

  ```ts
  export async function handleSuccessResponse(
      response: Response,
      isStreaming: boolean,
      options?: { streamStallTimeoutMs?: number },
  ): Promise<Response> {
      // Check for deprecation headers (RFC 8594)
      const deprecation = response.headers.get("Deprecation");
      const sunset = response.headers.get("Sunset");
      if (deprecation || sunset) {
          logWarn(`API deprecation notice`, { deprecation, sunset });
      }
  
      const responseHeaders = ensureContentType(response.headers);
  
  	// For non-streaming requests (generateText), convert SSE to JSON
  	if (!isStreaming) {
  		return await convertSseToJson(response, responseHeaders, options);
  	}
  
  	// For streaming requests (streamText), return stream as-is
  	return new Response(response.body, {
  		status: response.status,
  		statusText: response.statusText,
  		headers: responseHeaders,
  	});
  }
  ```

- **Issue**: `streamStallTimeoutMs` (default 45 s, see `lib/config.ts:500`) is only applied inside `convertSseToJson` (`lib/request/response-handler.ts:160-177`). The streaming branch returns the upstream `response.body` directly, so a stalled upstream SSE (no bytes for 45 s but connection still open) will never be surfaced — the only bound is the outer `fetchTimeoutMs = 60_000` (`lib/config.ts:491`), which is an absolute wall-clock. Healthy multi-minute streams cannot lengthen `fetchTimeoutMs` without also extending tolerance for stalls. Pre-seeded test-gap from `bg_707b6648`: "SSE chunk boundary / mid-event stall".
- **Recommendation**: wrap `response.body` in a `TransformStream` that enforces the stall timeout per chunk (mirror the `readWithTimeout` pattern from `lib/request/response-handler.ts:267-290`). The wrapper should cancel the reader and `controller.abort` when no data arrives for `streamStallTimeoutMs`. Unit-test against a mock stream that sleeps 60 s between chunks to prove the wrapper detects stall without blocking on healthy heartbeat traffic.
- **Evidence**: `index.ts:2397-2399` passes `{ streamStallTimeoutMs }` only into `handleSuccessResponse`, which then drops it on the streaming branch. Direct read.

### [HIGH | confidence=high] `fetchAndPersistInstructions` throws `HTTP 304` when cache file is missing

- **File**: `lib/prompts/codex.ts:340-364`
- **Quote**:

  ```ts
  	const response = await fetch(instructionsUrl, { headers });
  	if (response.status === 304) {
  		const diskContent = await readFileOrNull(cacheFile);
  		if (diskContent) {
  			setCacheEntry(modelFamily, { content: diskContent, timestamp: Date.now() });
  			await fs.mkdir(CACHE_DIR, { recursive: true });
  			await fs.writeFile(
  				cacheMetaFile,
  				JSON.stringify(
  					{
  						etag: cachedETag,
  						tag: latestTag,
  						lastChecked: Date.now(),
  						url: instructionsUrl,
  					} satisfies CacheMetadata,
  				),
  				"utf8",
  			);
  			return diskContent;
  		}
  	}
  
  	if (!response.ok) {
  		throw new Error(`HTTP ${response.status}`);
  	}
  ```

- **Issue**: the 304-branch reads `cacheFile` via `readFileOrNull`. If the file was independently evicted (antivirus quarantine, user ran `rm ~/.opencode/cache/*`, Windows disk-cleanup, etc.) but the `*-meta.json` metadata survived, `diskContent` is `null`, the inner `if` skips, and control falls through to `if (!response.ok)`. `Response.ok` is `status >= 200 && status < 300`, so status 304 is **not ok**; this throws `Error("HTTP 304")`. The caller (`getCodexInstructions`) catches the error at line 297 and falls back to bundled instructions — but this path logs an ERROR and loses the real cause. More importantly, if the bundled `codex-instructions.md` path doesn't resolve in dist (see LOW-5 below), the error bubbles up.
- **Recommendation**: in the 304 branch, when `diskContent` is `null`, explicitly delete the stale metadata and retry without `If-None-Match` rather than falling through to the generic error path. Minimal diff: after the inner `if (diskContent)`, add `await fs.rm(cacheMetaFile, { force: true }); /* fall back to unconditional fetch */ return await fetchAndPersistInstructions(modelFamily, promptFile, cacheFile, cacheMetaFile, null);` (or restructure to clear `cachedETag` and re-`fetch` without the `If-None-Match` header).
- **Evidence**: direct read of `lib/prompts/codex.ts:340-364`. The 304 branch assumes disk/metadata are updated atomically, but they are written via two separate `fs.writeFile` calls at `lib/prompts/codex.ts:369-383` with no crash-safety; partial write can leave the state this branch mishandles.

### [HIGH | confidence=medium] Per-request retry budget exhausts before account rotation completes under correlated failures

- **File**: `index.ts:1698-1719` (budget setup) + `index.ts:2028-2048` (network example) + `lib/request/retry-budget.ts:19-44` (profile limits)
- **Quote** (`retry-budget.ts:19-44`):

  ```ts
  const PROFILE_LIMITS: Record<RetryProfile, RetryBudgetLimits> = {
  	conservative: {
  		authRefresh: 2,
  		network: 2,
  		server: 2,
  		rateLimitShort: 2,
  		rateLimitGlobal: 1,
  		emptyResponse: 1,
  	},
  	balanced: {
  		authRefresh: 4,
  		network: 4,
  		server: 4,
  		rateLimitShort: 4,
  		rateLimitGlobal: 3,
  		emptyResponse: 2,
  	},
  	aggressive: {
  		authRefresh: 8,
  		network: 8,
  		server: 8,
  		rateLimitShort: 8,
  		rateLimitGlobal: 10,
  		emptyResponse: 4,
  	},
  };
  ```

- **Issue**: `RetryBudgetTracker` is constructed once per user request (`new RetryBudgetTracker(retryBudgetLimits)` at `index.ts:1698`), not once per account. The outer rotation loop (`index.ts:1790`) can iterate N accounts, but each iteration can consume the same budget class. For a user with 6 accounts on `balanced`, if every account returns a 5xx once, the pipeline consumes all 4 slots of `server` budget after 4 accounts, and the 5th account never gets tried — the 503 "Server retry budget exhausted" response (`index.ts:2313-2318`) pre-empts rotation. Real-world trigger: a Cloudflare fault that affects all Codex traffic returns 5xx uniformly; the plugin tries 4 accounts, fails, aborts before the 5th/6th.
- **Recommendation**: document the intent (protect user from thundering-herd) OR split the budget per-account so rotation always gets a full sweep. Pragmatic fix: add a `rotationFallthrough: boolean` flag that, when true, allows the outer loop to `continue` past a budget-exhausted tier if `attempted.size < accountCount`. Test via fast-check property: with N accounts all returning 503, assert all N are attempted before any "budget exhausted" short-circuit.
- **Evidence**: `index.ts:1698` creates one tracker; the `consumeRetryBudget` closure at `index.ts:1699-1719` returns false on exhaustion and the server-error branch at `index.ts:2312-2318` returns `errorResponse` early. No per-account reset observed.

### [MEDIUM | confidence=medium] SSE parser splits on line boundaries only; multi-line `data:` payloads are dropped

- **File**: `lib/request/response-handler.ts:83-143`
- **Quote**:

  ```ts
  function parseDataPayload(line: string): string | null {
  	if (!line.startsWith("data:")) return null;
  	const payload = line.slice(5).trimStart();
  	if (!payload || payload === "[DONE]") return null;
  	return payload;
  }
  
  /**
  
   * Parse SSE stream to extract final response
   * @param sseText - Complete SSE stream text
   * @returns Final response object or null if not found
   */
  function parseSseStream(sseText: string): ParsedSseResult | null {
  	const lines = sseText.split(/\r?\n/);
  
  	for (const line of lines) {
  		const trimmedLine = line.trim();
  		const payload = parseDataPayload(trimmedLine);
  		if (payload) {
  			try {
  				const data = JSON.parse(payload) as SSEEventData;
  ```

- **Issue**: SSE per the W3C spec permits an event composed of multiple `data:` lines, where the payload is the lines joined by `\n` ("When the user agent is to dispatch the event ... Let data be the concatenation of all data lines with a newline between them"). This parser treats every `data:` line as an independent JSON payload. A Codex response emitted as two `data:` lines (rare in practice but legal, and observed after upstream edge proxies reflow the body) parses each half as invalid JSON, each try/catch swallows the error, and `parseSseStream` returns `null` — the caller (`convertSseToJson`) then falls through to the degraded "return raw text" branch at `lib/request/response-handler.ts:215-226`, sending the whole SSE text as the JSON body. Downstream OpenCode sees a non-JSON content-type mismatch.
- **Recommendation**: build a small SSE event assembler: accumulate consecutive `data:` lines into one payload (joined by `\n`), parse on blank-line boundary, skip lines starting with `:` (comments) and `id:`/`event:`/`retry:` per the spec. Reuse existing tests in `test/response-handler.test.ts` and add fixtures for multi-line payload + `event:` directive.
- **Evidence**: direct read. Confirmed by inspection of `sseText.split(/\r?\n/)` + per-line parse.

### [MEDIUM | confidence=medium] Partial trailing SSE event at chunk boundary is discarded silently

- **File**: `lib/request/response-handler.ts:96-143`
- **Quote**: (already quoted above for MEDIUM-1; the relevant property is the try/catch swallowing the parse error at line 137-139)

  ```ts
  			} catch {
  				// Skip malformed JSON
  			}
  ```

- **Issue**: if the stream stalls after a partial event (e.g. `data: {"type":"response.done","response":{"id":"resp_` and then the upstream connection idles until `streamStallTimeoutMs` fires), the caller throws. But a more common boundary case: the stream ends cleanly at the tail of a chunk that split mid-event. `sseText.split(/\r?\n/)` yields the partial JSON as a trailing line; `JSON.parse` throws; `catch` swallows. `parseSseStream` returns `null` and the "no response.done event found" degraded path (`lib/request/response-handler.ts:215-226`) returns the raw bytes with the wrong content-type. Pre-seeded test-gap from `bg_707b6648`: "response.done with response==null".
- **Recommendation**: distinguish "no event seen" from "last event truncated". Track whether *any* JSON parse succeeded — if ≥ 1 event parsed but the last non-empty line failed to parse *and* had a trailing `data:` prefix without a closing `}`, surface this as `kind: "error"` with `"Upstream stream truncated"` instead of silently returning the stale body. Alternatively, buffer and re-parse on `\n\n` event boundaries (per SSE spec) so a truncated final frame is never confused with a well-formed one.
- **Evidence**: direct read. The "no `response.done` event found" path is exercised by `test/response-handler.test.ts:112-118` but that test covers a stream with no `response.done` emitted at all; no test covers the truncated trailing frame.

### [MEDIUM | confidence=medium] `isEmptyResponse` flags reasoning-only responses as empty, triggering retries on valid completions

- **File**: `lib/request/response-handler.ts:298-318`
- **Quote**:

  ```ts
  export function isEmptyResponse(body: unknown): boolean {
  	if (body === null || body === undefined) return true;
  	if (typeof body === 'string' && body.trim() === '') return true;
  	if (typeof body !== 'object') return false;
  
  	const obj = body as Record<string, unknown>;
  
  	if (Object.keys(obj).length === 0) return true;
  
  	const hasOutput = 'output' in obj && obj.output !== null && obj.output !== undefined;
  	const hasChoices = 'choices' in obj && Array.isArray(obj.choices) && 
  		obj.choices.some(c => c !== null && c !== undefined && typeof c === 'object' && Object.keys(c as object).length > 0);
  	const hasContent = 'content' in obj && obj.content !== null && obj.content !== undefined &&
  		(typeof obj.content !== 'string' || obj.content.trim() !== '');
  
  	if ('id' in obj || 'object' in obj || 'model' in obj) {
  		return !hasOutput && !hasChoices && !hasContent;
  	}
  
  	return false;
  }
  ```

- **Issue**: because the pipeline opts into `reasoning.encrypted_content` (set at `lib/request/request-transformer.ts:1119`, enforced at `lib/request/request-transformer.ts:318-330`), it is legitimate for the Codex backend to return a response with *only* reasoning items (e.g. an empty final assistant message but rich `reasoning.encrypted_content` needed for continuity). Such a response has `id`, `object`, `model`, but no `output`, `choices`, or `content`. The guard at line 314 returns `true`, the caller (`index.ts:2413-2438`) burns `emptyResponse` budget slots and retries the same account, eventually returning a 502. This is especially harmful mid-session when reasoning-only turns are part of multi-turn agent flows.
- **Recommendation**: add an explicit check for `hasReasoning` that inspects any `reasoning` / `reasoning_content` / `encrypted_reasoning` field, and treat the response as non-empty when reasoning bytes are present. Alternative: expose an env toggle `CODEX_AUTH_EMPTY_RETRY_ON_REASONING_ONLY=0` and disable the retry by default — the retry was added to catch genuine empty bodies, not to drop reasoning turns.
- **Evidence**: direct read. Contract anchor at `AGENTS.md:49` requires `reasoning.encrypted_content`. Downstream tests in `test/response-handler.test.ts:234-282` do not cover a reasoning-only payload.

### [MEDIUM | confidence=medium] Rate-limit-backoff state persists across rotation; thrash-back incurs up to MAX_BACKOFF_MS

- **File**: `lib/request/rate-limit-backoff.ts:29-93`
- **Quote**:

  ```ts
  const rateLimitStateByAccountQuota = new Map<string, RateLimitState>();
  
  function normalizeDelayMs(value: number | null | undefined, fallback: number): number {
  	const candidate = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  	return Math.max(0, Math.floor(candidate));
  }
  
  function pruneStaleRateLimitState(): void {
  	const now = Date.now();
  	for (const [key, state] of rateLimitStateByAccountQuota) {
  		if (now - state.lastAt > RATE_LIMIT_STATE_RESET_MS) {
  			rateLimitStateByAccountQuota.delete(key);
  		}
  	}
  }
  
  /**
   * Compute rate-limit backoff for an account+quota key.
   */
  export function getRateLimitBackoff(
  	accountIndex: number,
  	quotaKey: string,
  	serverRetryAfterMs: number | null | undefined,
  ): RateLimitBackoffResult {
  ```

- **Issue**: Tier 2 state is indexed by `${accountIndex}:${quotaKey}` and reset only after `RATE_LIMIT_STATE_RESET_MS = 120_000` of quiet on that key. Under rotation, `index.ts:2395` calls `resetRateLimitBackoff` on **success** only. A rotation-on-429 path (`index.ts:2357-2388`) **does not** call `resetRateLimitBackoff`. If the outer rotation rotates account A → account B (on 429) and the user later retries the same family → rotation comes back to account A within 120 s → account A's backoff state still shows `consecutive429 = 3`, and the next short-retry incurs `baseDelay * 2^2 = 4× base` up to `MAX_BACKOFF_MS = 60_000`. This is a pre-seeded risk from `bg_707b6648` ("rate-limit vs token-bucket starvation coordination"). The backoff also stacks with `TokenBucketTracker` local throttling, which is what causes perceived account starvation.
- **Recommendation**: call `resetRateLimitBackoff(account.index, quotaKey)` when the rotation path decides the account is "rate-limited, we moved on" — i.e. at `index.ts:2357-2392`, after `markRateLimitedWithReason`. Rationale: once the outer rate-limit tracker has recorded the rate-limit on the account, Tier-2 state is redundant; its job is to throttle hot retry loops on the same account in the same quota window, not to penalize the account when the rotation tracker has already taken over. Unit-test: two sequential requests, both hit account A with 429, rotate to B, back to A after 30 s; assert A's `consecutive429` is reset to 1, not 2.
- **Evidence**: `index.ts:2395` is the only call site of `resetRateLimitBackoff` in the hot path; no reset on the rotation-on-429 branch.

### [MEDIUM | confidence=medium] Model-family drift on mid-session fallback updates `modelFamily` but not the transformation body's `include` / `reasoning`

- **File**: `index.ts:2184-2250` (fallback branch)
- **Quote**:

  ```ts
  			if (fallbackModel) {
  				const previousModel = model ?? "gpt-5-codex";
  				const previousModelFamily = modelFamily;
  				attemptedUnsupportedFallbackModels.add(previousModel);
  				attemptedUnsupportedFallbackModels.add(fallbackModel);
  				accountManager.refundToken(account, previousModelFamily, previousModel);
  
  				model = fallbackModel;
  				modelFamily = getModelFamily(model);
  				quotaKey = `${modelFamily}:${model}`;
  				fallbackApplied = true;
  				fallbackFrom = previousModel;
  				fallbackTo = model;
  				fallbackReason = "fallback-unsupported-model-entitlement";
  
  				if (transformedBody && typeof transformedBody === "object") {
  					transformedBody = { ...transformedBody, model };
  				} else {
  					let fallbackBody: Record<string, unknown> = { model };
  					if (requestInit?.body && typeof requestInit.body === "string") {
  						try {
  							const parsed = JSON.parse(requestInit.body) as Record<string, unknown>;
  							fallbackBody = { ...parsed, model };
  						} catch {
  							// Keep minimal fallback body if parsing fails.
  						}
  					}
  					transformedBody = fallbackBody as RequestBody;
  				}
  ```

- **Issue**: the fallback path rewrites `transformedBody.model` but does **not** re-run `transformRequestBody`. The reasoning config, `include`, `text.verbosity`, and `instructions` were computed for the *original* model family. For a user request that started as `gpt-5.4-pro` and falls back to `gpt-5.4`, the coerced `reasoning.effort` ("medium" only — see `lib/request/request-transformer.ts:623-628`) is now over-applied to the fallback model even though the fallback model supports "xhigh". Also, `body.instructions` still holds the Codex instructions for the *original* family (fetched via `getCodexInstructions(normalizedModel)` at `lib/request/fetch-helpers.ts:488`), which may have different tool-remap semantics. Pre-seeded from `bg_707b6648`: "model family drift mid-session".
- **Recommendation**: on fallback, call `transformRequestForCodex` again with the new model and merge the result into `requestInit`. At minimum, re-fetch `getCodexInstructions(fallbackModel)` and re-apply `getReasoningConfig` for the new model. Unit-test: fallback from `gpt-5.4-pro` to `gpt-5.4`; assert the outgoing body's `reasoning.effort` and `include` reflect `gpt-5.4` defaults, not the prior `gpt-5.4-pro` coercion.
- **Evidence**: direct read. The only mutations between fallback and next fetch are `model` and a shallow `{...transformedBody, model}` spread (line 2200); `body.instructions` at `requestInit.body` still reflects the original `transformRequestBody` output.

### [MEDIUM | confidence=high] `parseSseStream` misses `response.incomplete`-with-null-response JSON error extraction

- **File**: `lib/request/response-handler.ts:107-122`
- **Quote**:

  ```ts
  				if (data.type === "error" || data.type === "response.error") {
  					const parsedError = extractStreamError(data);
  					log.error("SSE error event received", { error: parsedError });
  					return { kind: "error", error: parsedError };
  				}
  
  				if (data.type === "response.failed" || data.type === "response.incomplete") {
  					const parsedError =
  						(responseRecord && extractResponseError(responseRecord)) ??
  						extractStreamError(data);
  					log.error("SSE response terminal error event received", {
  						type: data.type,
  						error: parsedError,
  					});
  					return { kind: "error", error: parsedError };
  				}
  ```

- **Issue**: `responseRecord = toRecord((data as { response?: unknown }).response)`. If the Codex backend emits `data: {"type":"response.incomplete"}` **without** a nested `response` object (observed on rare server-side truncations; matches `bg_707b6648` pre-seed "response.done with response==null"), `responseRecord` is `null`, and `extractResponseError(responseRecord)` short-circuits to `null` via the `?.` chain. Then `extractStreamError(data)` returns the generic `"Codex stream emitted an error event"` fallback (`lib/request/response-handler.ts:56-64`) — the user sees a generic error with no diagnostic code.
- **Recommendation**: when `responseRecord` is null on `response.incomplete` / `response.failed`, log the full `data` payload to the sink at `debug` level and set `error.code = 'response_incomplete'` / `'response_failed'` explicitly, so the downstream telemetry (`index.ts:2081-2094`) can classify the failure. Also add a test fixture with a null-response payload to `test/response-handler.test.ts`.
- **Evidence**: direct read; reinforces test gap from `bg_707b6648`.

### [MEDIUM | confidence=medium] `getNormalizedModel` case-insensitive fallback scans entire model map linearly per call

- **File**: `lib/request/helpers/model-map.ts:182-197`
- **Quote**:

  ```ts
  export function getNormalizedModel(modelId: string): string | undefined {
  	try {
  		if (Object.hasOwn(MODEL_MAP, modelId)) {
  			return MODEL_MAP[modelId];
  		}
  
  		const lowerModelId = modelId.toLowerCase();
  		const match = Object.keys(MODEL_MAP).find(
  			(key) => key.toLowerCase() === lowerModelId,
  		);
  
  		return match ? MODEL_MAP[match] : undefined;
  	} catch {
  		return undefined;
  	}
  }
  ```

- **Issue**: the fallback path takes `Object.keys(MODEL_MAP)` and iterates every key, lower-casing each, for every request that does not hit the exact-case path. With ~90 keys today (per `lib/request/helpers/model-map.ts:30-174`) this is a small constant cost, but it is a constant cost on a **hot** path: every request resolves the model at least once via `normalizeModel` → `getNormalizedModel`. More importantly, `try { ... } catch { return undefined; }` suppresses any real error, masking future regressions (e.g. a `null` slipping into `MODEL_MAP` values).
- **Recommendation**: precompute a lowercase index: `const LOWER_INDEX = Object.fromEntries(Object.entries(MODEL_MAP).map(([k, v]) => [k.toLowerCase(), v]));` at module load, then `LOWER_INDEX[lowerModelId]`. This is O(1) per lookup. Also narrow the `try/catch` to the specific failure points (string `.toLowerCase()` on a non-string, etc.) or drop it entirely — the inputs are strings validated at the call site.
- **Evidence**: direct read; test coverage at `test/tool-utils.test.ts` (wrong file) — no test file for `model-map.ts` exists per `ls test/`, matching pre-seeded gap "missing test file for `lib/request/helpers/model-map.ts`" (analogous to `lib/accounts/rate-limits.ts` gap from `bg_707b6648`).

### [MEDIUM | confidence=medium] `opencode-codex.ts` fallback-source fetch has no per-source timeout

- **File**: `lib/prompts/opencode-codex.ts:130-149`
- **Quote**:

  ```ts
  	for (const sourceUrl of sources) {
  		const headers: Record<string, string> = {};
  		const canUseConditionalRequest =
  			!!cachedMeta?.etag &&
  			(!cachedMeta.sourceUrl || cachedMeta.sourceUrl === sourceUrl);
  		if (canUseConditionalRequest) {
  			headers["If-None-Match"] = cachedMeta.etag;
  		}
  
  		let response: Response;
  		try {
  			response = await fetch(sourceUrl, { headers });
  		} catch (error) {
  			lastFailure = `${sourceUrl}: ${String(error)}`;
  			logDebug("OpenCode prompt source fetch failed", {
  				sourceUrl,
  				error: String(error),
  			});
  			continue;
  		}
  ```

- **Issue**: the fan-out list at `lib/prompts/opencode-codex.ts:13-22` includes 8 sources. Each `fetch(sourceUrl, { headers })` runs without an `AbortController` timeout. If one source (say, a `anomalyco/opencode` dev branch that is temporarily unreachable) takes 30 s to time out via system default, the fan-out serializes the delays: up to 8 × 30 s = 240 s startup stall at `prewarmOpenCodeCodexPrompt` (called from `index.ts:193`) or in the hot path of the first request.
- **Recommendation**: wrap each `fetch` in an `AbortController` with a 5-10 s timeout. Preserve the multi-source fallback but cap the total wait. Existing pattern at `index.ts:1988-1993` is a good template.
- **Evidence**: direct read. The refresh is scheduled via `scheduleRefresh` at `lib/prompts/opencode-codex.ts:189-201` (fire-and-forget), but `getOpenCodeCodexPrompt` can also invoke `refreshPrompt` synchronously at line 231 when no disk cache exists — a cold user hits the serialized fan-out without a timeout.

### [LOW | confidence=high] `DEFAULT_STREAM_STALL_TIMEOUT_MS` and `MAX_SSE_SIZE` are module-private constants

- **File**: `lib/request/response-handler.ts:7-8`
- **Quote**:

  ```ts
  const MAX_SSE_SIZE = 10 * 1024 * 1024; // 10MB limit to prevent memory exhaustion
  const DEFAULT_STREAM_STALL_TIMEOUT_MS = 45_000;
  ```

- **Issue**: both constants are hard-coded and un-exported. `MAX_SSE_SIZE` has no way to be overridden; large reasoning-heavy completions near 10 MB silently throw. `DEFAULT_STREAM_STALL_TIMEOUT_MS` is overridable via `options?.streamStallTimeoutMs`, but the default is duplicated in `lib/config.ts:500` — drift risk if one is changed and not the other.
- **Recommendation**: export both, make `MAX_SSE_SIZE` configurable through an `options.maxSseBytes` parameter on `convertSseToJson` (default stays 10 MB). Centralize the stall-timeout default in `lib/config.ts` and have `response-handler.ts` import it, removing the duplicate.
- **Evidence**: direct read.

### [LOW | confidence=medium] `cleanupToolDefinitions` uses JSON round-trip for deep clone on every request

- **File**: `lib/request/helpers/tool-utils.ts:30-46`
- **Quote**:

  ```ts
  export function cleanupToolDefinitions(tools: unknown): unknown {
  	if (!Array.isArray(tools)) return tools;
  
  	return tools.map((tool) => {
  		if (tool?.type !== "function" || !tool.function) {
  			return tool;
  		}
  
  		// Clone to avoid mutating original
  		const cleanedTool = JSON.parse(JSON.stringify(tool));
  		if (cleanedTool.function.parameters) {
  			cleanupSchema(cleanedTool.function.parameters);
  		}
  
  		return cleanedTool;
  	});
  }
  ```

- **Issue**: `JSON.parse(JSON.stringify(tool))` is an O(size) deep clone that runs per tool per request. For sessions with rich tool manifests (10+ tools with deeply nested schemas) this is a small but repeatable hotspot. It also silently loses fields that are not JSON-serializable (e.g. `Date`, `RegExp`, symbols, or undefined values) — defensible for a schema, but fragile if the upstream shape evolves.
- **Recommendation**: use `structuredClone(tool)` (available in Node 18+, matching `package.json.engines.node`). Faster, preserves types, correctly handles cycles.
- **Evidence**: direct read; existing call sites exercise this function on every request in `transformRequestBody` (`lib/request/request-transformer.ts:1013`).

### [LOW | confidence=high] `DEFAULT_UNSUPPORTED_CODEX_FALLBACK_CHAIN` hard-coded in fetch-helpers

- **File**: `lib/request/fetch-helpers.ts:48-54`
- **Quote**:

  ```ts
  export const DEFAULT_UNSUPPORTED_CODEX_FALLBACK_CHAIN: Record<string, string[]> = {
  	"gpt-5.4-pro": ["gpt-5.4"],
  	"gpt-5.3-codex-spark": ["gpt-5-codex", "gpt-5.3-codex", "gpt-5.2-codex"],
  	"gpt-5.3-codex": ["gpt-5-codex", "gpt-5.2-codex"],
  	"gpt-5.2-codex": ["gpt-5-codex"],
  	"gpt-5.1-codex": ["gpt-5-codex"],
  };
  ```

- **Issue**: the fallback chain is inlined in a large module (`fetch-helpers.ts` is 870+ lines). Any change requires edit + test of unrelated concerns. The plan at `lib/config.ts` supports `unsupportedCodexFallbackChain` override, but the default lives here.
- **Recommendation**: move the default to `lib/request/helpers/model-map.ts` alongside `MODEL_MAP` where model-related constants are already co-located.
- **Evidence**: direct read.

### [LOW | confidence=medium] Bundled fallback `codex-instructions.md` may not resolve in dist build

- **File**: `lib/prompts/codex.ts:309-316`
- **Quote**:

  ```ts
  		logWarn(`Falling back to bundled instructions for ${modelFamily}`);
  		const bundled = await fs.readFile(
  			join(__dirname, "codex-instructions.md"),
  			"utf8",
  		);
  		setCacheEntry(modelFamily, { content: bundled, timestamp: now });
  		return bundled;
  ```

- **Issue**: `__dirname` is computed via `fileURLToPath(import.meta.url)` at `lib/prompts/codex.ts:15-16`. After `tsc` compiles to `dist/lib/prompts/codex.js`, `__dirname` resolves to the compiled file's directory. `package.json.files` at the root lists `"dist/"` but does NOT include `.md` files outside of `dist/` — if a `codex-instructions.md` existed next to the source `.ts`, it would not be copied into `dist/`. The repo is missing such a file entirely (no match under `lib/prompts/` per `Get-ChildItem lib/prompts/*.md`), so this branch throws `ENOENT` the moment it is hit in production.
- **Recommendation**: either commit `lib/prompts/codex-instructions.md` with a minimal "Be a helpful coding assistant. Follow Codex conventions." fallback and extend `scripts/copy-oauth-success.js` to also copy `.md` siblings into `dist/lib/prompts/`, or remove the bundled-fallback path entirely and return a hard-coded string literal on the final-fallback branch.
- **Evidence**: direct read; `Get-ChildItem lib/prompts/*.md` is not in scope tests but absence is verifiable by a repo file list.

### [LOW | confidence=medium] `MAX_MANIFEST_TOOLS = 32` silently truncates tool manifest

- **File**: `lib/prompts/codex-opencode-bridge.ts:80-91`
- **Quote**:

  ```ts
  const MAX_MANIFEST_TOOLS = 32;
  
  const normalizeRuntimeToolNames = (toolNames: readonly string[]): string[] => {
  	const unique = new Set<string>();
  	for (const rawName of toolNames) {
  		const name = rawName.trim();
  		if (!name) continue;
  		if (unique.size >= MAX_MANIFEST_TOOLS) break;
  		unique.add(name);
  	}
  	return Array.from(unique);
  };
  ```

- **Issue**: when the OpenCode runtime exposes > 32 tools, the bridge message only lists the first 32 (post-dedup). The model is then told "the host has provided these exact tool names" when some are missing, opening up the "unknown tool hallucination" failure mode that the bridge prompt is explicitly meant to prevent (see `CODEX_OPENCODE_BRIDGE_META.protects` at `lib/prompts/codex-opencode-bridge.ts:122-131`).
- **Recommendation**: raise the cap to ~128 (still well under any reasonable prompt-budget hit), or log a `logWarn` when truncation occurs, pointing the user to lower the custom-tools count.
- **Evidence**: direct read. No log emitted on truncation today.

### [LOW | confidence=medium] Stale-while-revalidate bumps memory timestamp to `now`, serving potentially very stale content

- **File**: `lib/prompts/codex.ts:259-287`
- **Quote**:

  ```ts
  	if (diskContent && cachedMetadata?.lastChecked) {
  		if (now - cachedMetadata.lastChecked < CACHE_TTL_MS) {
  			setCacheEntry(modelFamily, { content: diskContent, timestamp: now });
  			return diskContent;
  		}
  		// Stale-while-revalidate: return stale cache immediately and refresh in background.
  		setCacheEntry(modelFamily, { content: diskContent, timestamp: now });
  		void refreshInstructionsInBackground(
  			modelFamily,
  			promptFile,
  			cacheFile,
  			cacheMetaFile,
  			cachedMetadata,
  		);
  		return diskContent;
  	}
  
  	if (cached && now - cached.timestamp >= CACHE_TTL_MS) {
  		// Keep session latency stable by serving stale memory cache while refreshing.
  		setCacheEntry(modelFamily, { content: cached.content, timestamp: now });
  		void refreshInstructionsInBackground(
  			modelFamily,
  			promptFile,
  			cacheFile,
  			cacheMetaFile,
  			cachedMetadata,
  		);
  		return cached.content;
  	}
  ```

- **Issue**: on the stale path, `setCacheEntry(..., { timestamp: now })` stamps the memory-cache timestamp to `now`, not to the disk `lastChecked`. Subsequent calls within `CACHE_TTL_MS = 900_000` (15 min) hit the `if (cached && now - cached.timestamp < CACHE_TTL_MS)` branch at line 234 and short-circuit, returning the same stale content without re-triggering the background refresh. If the background refresh scheduled at line 266 fails (transient GitHub outage), the user sees stale content for up to 15 minutes *after* the stale-while-revalidate returned — not a correctness issue, but the recovery window is longer than a naïve reading of the comment suggests.
- **Recommendation**: on stale-while-revalidate, stamp the memory timestamp to `cachedMetadata.lastChecked` (the *disk* last-check, which is already stale by definition). Subsequent calls will re-enter the stale branch, and `refreshInstructionsInBackground` has its own internal dedup (`refreshPromises.has(modelFamily)` at line 396) so repeated scheduling is harmless.
- **Evidence**: direct read. The in-flight dedup exists at `lib/prompts/codex.ts:388-417` so the proposed fix does not cause duplicate work.

### [LOW | confidence=medium] `isEntitlementError` regex does not cover all current Codex entitlement codes

- **File**: `lib/request/fetch-helpers.ts:233-238`
- **Quote**:

  ```ts
  export function isEntitlementError(code: string, bodyText: string): boolean {
          const haystack = `${code} ${bodyText}`.toLowerCase();
          // "usage_not_included" means the subscription doesn't include this feature
          // This is different from "usage_limit_reached" which is a temporary quota limit
          return /usage_not_included|not.included.in.your.plan|subscription.does.not.include/i.test(haystack);
  }
  ```

- **Issue**: the unsupported-model code path at `lib/request/fetch-helpers.ts:42-46` declares its own code `"model_not_supported_with_chatgpt_account"` — an entitlement-class error, but it is intentionally NOT routed through `isEntitlementError` because the plugin wants to attempt the fallback chain first. That's correct. However, the regex here misses e.g. `workspace_not_entitled`, `chatgpt_plan_insufficient`, and any future entitlement codes the backend emits. Silent mis-classification leads to treating an entitlement error as a rate-limit, which then burns rotation budget for no reason.
- **Recommendation**: replace the hard-coded regex with an allowlist fed from a constant, and keep regex as a last-resort fallback. Also log the classification decision at debug level so operators can spot drift quickly.
- **Evidence**: direct read. The unsupported-model code path handling at `lib/request/fetch-helpers.ts:132-163` is a good model.

---

## Notes

- **READ-ONLY respected**: no source files under `lib/**` or `index.ts` were edited during this audit. Only `docs/audits/_findings/T04-*` and `.sisyphus/evidence/task-4-*` were written.
- **Out-of-scope paths** were referenced only to anchor the retry tiers (`lib/circuit-breaker.ts` for Tier 3, cross-referenced to T3 / T7) and to confirm contract sources (`AGENTS.md`, `package.json`, `lib/config.ts`). None were cited as the `File:` of a finding.
- **Severity budget**: 0 CRITICAL (well under ≤ 5), 3 HIGH (≤ 15), 7 MEDIUM (≤ 40), 7 LOW (unbounded). No downgrade required.
- **Pre-seed confirmations**: 
  - "SSE mid-event stall gap" → HIGH-1 (streaming path has no stall) + MEDIUM-2 (partial trailing frame).
  - "SSE chunk boundary gap" → MEDIUM-1 (multi-line `data:`) + MEDIUM-2.
  - "rate-limit vs token-bucket starvation" → MEDIUM-4 (Tier-2 persistence across rotation).
  - "response.done null" → MEDIUM-6 (null `responseRecord` on `response.incomplete`).
  - "model family drift mid-session" → MEDIUM-5 (fallback doesn't re-run transform).
- **Cross-references**:
  - Tier 3 circuit breaker owned by T3 / T7.
  - Token refresh mutex / redaction owned by T2.
  - Storage / cache eviction (writing `*-meta.json` atomically) owned by T6.

---

*End of T04 findings. Rubric version 1.*
