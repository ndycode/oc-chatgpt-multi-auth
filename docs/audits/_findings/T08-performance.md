---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T08-performance
agent: opencode-claude-opus-4-7
date: 2026-04-17T00:00:00Z
scope-files:
  - index.ts
  - lib/accounts.ts
  - lib/circuit-breaker.ts
  - lib/logger.ts
  - lib/prompts/codex.ts
  - lib/refresh-queue.ts
  - lib/request/fetch-helpers.ts
  - lib/request/request-transformer.ts
  - lib/request/response-handler.ts
  - lib/rotation.ts
  - lib/storage.ts
rubric-version: 1
---

# T08 — Performance Hot Paths

**Summary**: Audited the plugin activation path, the 7-step per-request pipeline, prompt-template cache, rotation scoring, storage persistence, SSE parsing, logger redaction, and circuit-breaker bookkeeping at locked SHA `d92a8eed`. No benchmarks were executed; findings are code-read only and every recommendation names the measurement tool to use. Headline: SSE response body is quadratically concatenated before parsing (HIGH); `saveToDiskDebounced` can starve under sustained writes (MEDIUM); `pruneFailures` allocates a new array on every success and every failure (MEDIUM); the request body is parsed twice in the default path (MEDIUM); prompt-template lookup is per-request but the hit path is O(1) (LOW). Counts: 0 CRITICAL, 2 HIGH, 8 MEDIUM, 6 LOW (16 total).

**Files audited**: 11 of 87 in-scope source files (plus `lib/AGENTS.md` read as meta context).

---

## Scope and Method

Read-only inspection at locked SHA. For each candidate hot path the auditor (1) located the function in the codebase, (2) enumerated allocations and syscalls per invocation, (3) classified the call-site as per-request / per-selection / per-save / startup, (4) recorded verbatim quotes with file and line range, (5) assigned severity and confidence per `docs/audits/_meta/AUDIT-RUBRIC.md`. No code was executed; no profiler was attached. Every recommendation names the tool and the exact measurement to capture under realistic workloads.

Out of scope for this audit (owned by T7 / T4 / T2): token-refresh concurrency correctness, SSE chunk-boundary event semantics, credential redaction gaps. Those findings are cross-referenced by domain, not re-logged.

---

## Startup Cost — Synchronous vs Asynchronous

The plugin factory `OpenAIOAuthPlugin` is invoked when OpenCode loads the plugin; the `loader(getAuth, provider)` function is invoked on the first provider request of each session. Cost is split into three layers.

### Layer A — Module-Level (import time)

Runs once when `index.ts` is imported. Observed module-level work:

- `index.ts:251` `initLogger(client)` — synchronous assignment to module-level `client`.
- `lib/request/fetch-helpers.ts:37-40` `new URL(CODEX_BASE_URL)` and path-prefix computation — one-time parse.
- `lib/logger.ts:119-124` env-var reads (`ENABLE_PLUGIN_REQUEST_LOGGING`, `CODEX_PLUGIN_LOG_BODIES`, `DEBUG_CODEX_PLUGIN`, `CODEX_PLUGIN_LOG_LEVEL`, `CODEX_CONSOLE_LOG`) + `join(homedir(), ".opencode", "logs", "codex-plugin")`.
- `lib/logger.ts:202-215` conditional `console.log` branch when `LOGGING_ENABLED`.
- `lib/prompts/codex.ts:19-22` Map allocations for `memoryCache`, `refreshPromises`, and `latestReleaseTagCache = null`.
- `lib/rotation.ts:419-420` singleton slots for `healthTrackerInstance` and `tokenTrackerInstance` (lazy — do not allocate yet).
- `lib/circuit-breaker.ts:128-129` `MAX_CIRCUIT_BREAKERS = 100` and empty `circuitBreakers` Map.

Startup module cost is therefore bounded by a single `new URL()` parse, ~7 env reads, one `path.join`, a handful of empty-Map allocations, and the static imports of every transitive module. No synchronous filesystem reads. No network I/O at import time.

### Layer B — Plugin Factory (once per session)

`OpenAIOAuthPlugin` at `index.ts:250` is invoked by OpenCode with `client`. It allocates closures, metric objects, and helper functions — no I/O. `resolveUiRuntime()` at `index.ts:1377` is called at factory time and calls `loadPluginConfig()` which reads env vars and user config.

### Layer C — First `loader()` Call (first provider request)

Significantly heavier. In order:

1. `loadPluginConfig()` (re-evaluated).
2. `setStoragePath(...)` — per-project path resolution.
3. Mutex acquire via `while (loaderMutex) { await loaderMutex; }` (`index.ts:1422-1429`).
4. `AccountManager.loadFromDisk(authFallback)` (`lib/accounts.ts:219-224`):
   - `loadAccounts()` — async JSON read of the accounts file.
   - `manager.hydrateFromCodexCli()` — opens Codex CLI token cache file and merges tokens.
5. `accountManager.saveToDisk()` if new auth state must be persisted.
6. `prewarmCodexInstructions(configuredModels)` (`index.ts:1530-1537` → `lib/prompts/codex.ts:422-432`) — fires **unbounded parallel** `getCodexInstructions(model)` promises (one per configured model OR six default families).
7. `checkAndNotify(...)` (`index.ts:1546-1550`) — async npm version check (network).
8. `runStartupPreflight()` (`index.ts:1551`) — `loadAccounts()` + `showToast(...)` + `logInfo(...)`.

Every item 4–8 is properly `await`-ed or `void`-fired. Items 6–8 are fire-and-forget; 4 and 5 block the loader. `hydrateEmails` is NOT called in the main loader path but is invoked by tool commands (`index.ts:2814`, `index.ts:3196`).

### Layer D — Delayed Initialization

- `hydrateEmails` (`index.ts:763-830`) runs in chunks of 3 with `await Promise.all(chunk.map(...))` serially — for N missing-email accounts, cost is ⌈N/3⌉ serial rounds each doing one `queuedRefresh` (network). Only triggered by commands that request email hydration, not the main loader.
- `prewarmCodexInstructions` (`lib/prompts/codex.ts:422-432`) iterates a candidate list (configured OR default 6) and fires `getCodexInstructions(model)` promises without concurrency limit.

### Startup Cost Recommendations

- Measure loader latency with `performance.now()` bookends around the loader body and log with `createLogger('loader').time()` (already present in the codebase — see `lib/logger.ts:362-382`).
- Profile first-call startup using `node --inspect` + Chrome DevTools Performance tab; capture a 3-second sample during first `loader()` invocation.
- Profile startup allocations with `node --cpu-prof --heap-prof` for a 5-second window.
- Use `clinic doctor -- node ./start.js` (or a script that triggers `loader()`) to identify event-loop stalls and async wait time.

---

## Per-Request Allocation Estimate

Per outbound OpenAI/Codex request, observed allocations and syscalls in the default (legacy) transform path:

1. `extractRequestUrl(input)` — one `URL.toString()` if `input instanceof URL`.
2. `rewriteUrlForCodex(originalUrl)` (`lib/request/fetch-helpers.ts:377-395`) — `new URL(url)` plus 3 property writes and one `.toString()`.
3. `normalizeRequestInit` may `await requestInput.clone().text()` (body copy) and allocate a new `RequestInit`.
4. `parseRequestBodyFromInit` (`index.ts:1617-1652`) — `JSON.parse` once over the body string/Uint8Array (with a `new TextDecoder()` allocation per binary branch).
5. `transformRequestForCodex` (`lib/request/fetch-helpers.ts:408-525`) may re-parse the body when `parsedBody` is absent (`init.body` path). In the default code path the caller passes `parsedBody`, so the second parse is skipped — but if any caller sets `init.body` without `parsedBody`, the body is parsed twice.
6. `normalizeModel(originalModel)` — up to ~16 sequential `includes`/`test` checks (`lib/request/request-transformer.ts:40-165`).
7. `getModelFamily(normalizedModel)` — another ~10 `includes`/regex checks (`lib/prompts/codex.ts:109-146`).
8. `getCodexInstructions(normalizedModel)` — on hit: Map.get + timestamp compare; on stale-hit: returns memory cache + fires background refresh; on cold: 2 `fs.readFile` reads in parallel, possibly followed by `fetch()`.
9. `transformRequestBody` — prompt injection, tool definition cleanup, `JSON.stringify` on the new body.
10. `JSON.stringify(transformedBody)` (`lib/request/fetch-helpers.ts:519`) — full body re-serialization.
11. `createCodexHeaders` (`lib/request/fetch-helpers.ts:535-564`) — `new Headers(init?.headers ?? {})` + 5-7 `set`/`delete` calls.
12. `setCorrelationId(...)` — optionally `randomUUID()`.
13. `new RetryBudgetTracker(retryBudgetLimits)` (`index.ts:1698`) — allocated fresh per request.
14. `getCurrentOrNextForFamilyHybrid(...)` (`lib/accounts.ts:571-623`) — map + filter + score loop; see finding F08-08.
15. Response path: `ensureContentType(response.headers)` allocates a new `Headers`. Non-streaming path: `convertSseToJson` (`lib/request/response-handler.ts:152-250`).

Per-request allocation lower bound (excluding body-proportional costs): ~10 heap objects (URL, Headers×2, RetryBudgetTracker, AbortController if any, selection closures, logger records, metric snapshot). Per-request CPU lower bound is dominated by SSE parsing on responses.

### Per-Request Recommendations

- Run `autocannon --connections 1 --duration 30 --headers ...` against a local mock Codex backend (e.g. a small Fastify server returning canned SSE). Measure p50/p95/p99 latency per request and divide by request count; compare `--cpu-prof` output before/after any mitigation.
- Use `node --inspect` + `Memory -> Allocation sampling` to confirm per-request heap deltas.
- Run `0x -- node ./bench.js` to generate a flamegraph of the hot stack.

---

## Prompt Template Cache Analysis

`lib/prompts/codex.ts` implements a two-tier cache for Codex system prompts keyed by `ModelFamily`:

- **In-memory LRU-ish**: `Map<ModelFamily, { content, timestamp }>` (`lib/prompts/codex.ts:19`). `MAX_CACHE_SIZE = 50` evicts `memoryCache.keys().next().value` when full (insertion-order eviction — this is a FIFO, not an LRU).
- **Disk**: `~/.opencode/cache/{family}-instructions.md` + `{family}-instructions-meta.json` holding `{ etag, tag, lastChecked, url }`.
- **Release-tag cache**: `latestReleaseTagCache` with `RELEASE_TAG_TTL_MS = 5 * 60 * 1000`.
- **Refresh dedup**: `refreshPromises: Map<ModelFamily, Promise<void>>` prevents parallel refreshes per family.

The hot path (memory-hit) at `lib/prompts/codex.ts:233-236` is a Map.get + timestamp subtract + compare — O(1) and allocation-free. If the memory entry is stale but disk is fresh (within 15 min), it fires a background `refreshInstructionsInBackground` and returns immediately. ETag-based conditional fetch only runs on the cold path. Worst case on first cold request: 2 `fs.readFile` + `getLatestReleaseTag()` (1–2 `fetch`) + 1 `fetch` for the prompt file + 2 `fs.writeFile` + 1 `fs.mkdir`. That is ~8 syscalls + 2–3 network round trips.

Observations:

- Per-request cost is O(1) in the steady state (memory hit). Good.
- `MAX_CACHE_SIZE = 50` vs `MODEL_FAMILIES.length = 8`: cache will almost never evict; the eviction code is dead on realistic workloads.
- `MAX_CACHE_SIZE` evicts FIFO; the code comment does not assert LRU semantics. Acceptable but worth calling out in a finding.
- Stale-while-revalidate returns immediately and refreshes in the background. This is the right pattern.
- No request-level cache for `normalizeModel(modelName) -> ModelFamily` result. Every request re-evaluates up to 26 `includes`/regex probes (F08-09).

### Prompt Cache Recommendations

- Measure cache hit ratio via the existing `runtimeMetrics.promptCacheEnabledRequests` / `promptCacheMissingRequests` counters. Surface these in the `codex-metrics` tool to validate the memory-hit rate is ≥ 99% during steady-state usage.
- Add a benchmark with `benny` (or `mitata`) that exercises `getCodexInstructions("gpt-5-codex")` 1000× after priming; expected p50 ≤ 2 µs.

---

## Findings

### [HIGH | confidence=medium] Quadratic string concatenation of full SSE stream body

- **File**: `lib/request/response-handler.ts:162-176`
- **Quote**:

  ```ts
  	const reader = response.body.getReader();
  	const decoder = new TextDecoder();
  	let fullText = '';
  	const streamStallTimeoutMs = Math.max(
  		1_000,
  		Math.floor(options?.streamStallTimeoutMs ?? DEFAULT_STREAM_STALL_TIMEOUT_MS),
  	);

  	try {
  		// Consume the entire stream
  		while (true) {
  			const { done, value } = await readWithTimeout(reader, streamStallTimeoutMs);
  			if (done) break;
  			fullText += decoder.decode(value, { stream: true });
  			if (fullText.length > MAX_SSE_SIZE) {
  				throw new Error(`SSE response exceeds ${MAX_SSE_SIZE} bytes limit`);
  			}
  		}
  ```

- **Issue**: `fullText += decoder.decode(value, { stream: true })` concatenates a growing string in a tight loop. V8 optimises small-scale `+=` with ConsString ropes, but across many iterations (the Codex SSE stream emits tens to hundreds of small `data:` lines per response, each a few hundred bytes) this degrades to O(n²) work in the worst case. For a 1 MB response chopped into 200 chunks, the auditor estimates ~100 MB of intermediate string material allocated and scanned. Moreover, the MAX_SSE_SIZE check is applied *after* the append, so the peak heap can transiently exceed 10 MB before the throw fires. No caller sees the peak, but the GC does.
- **Recommendation**: Replace the string accumulator with a `string[]` buffer (`chunks.push(decoder.decode(value, { stream: true }))`) and `chunks.join('')` once at the end, or feed an incremental line parser (`split('\n')` on each chunk, keep a trailing partial-line buffer) so the full SSE body never lives in a single string. Compare with `node --prof-process` flamegraphs before/after.
- **Evidence**: direct read at locked SHA. Node.js guidance on string concatenation in loops: <https://nodejs.org/api/buffer.html#class-stringdecoder> and V8 rope notes.

### [HIGH | confidence=medium] MAX_SSE_SIZE enforced after concatenation allows transient memory spike

- **File**: `lib/request/response-handler.ts:170-176`
- **Quote**:

  ```ts
  		while (true) {
  			const { done, value } = await readWithTimeout(reader, streamStallTimeoutMs);
  			if (done) break;
  			fullText += decoder.decode(value, { stream: true });
  			if (fullText.length > MAX_SSE_SIZE) {
  				throw new Error(`SSE response exceeds ${MAX_SSE_SIZE} bytes limit`);
  			}
  		}
  ```

- **Issue**: `MAX_SSE_SIZE = 10 * 1024 * 1024`. The body is appended *then* checked. For a hostile upstream that emits 15 MB in one chunk, the process allocates 15 MB before aborting. Combined with F08-01, this means a single Codex request can briefly hold ~30–40 MB of intermediate string/rope flatten state. For desktop OpenCode users this is usually fine; for CI runners on constrained VMs this compounds with concurrent requests and contributes to OOM risk.
- **Recommendation**: Check `value.byteLength + runningLength > MAX_SSE_SIZE` *before* decoding + appending; `reader.cancel()` and throw. Alternatively, accept only `chunks` whose prefix sum is under the limit, and stop reading as soon as the limit would be exceeded. Validate with `autocannon --duration 60` against a mock endpoint that returns 12 MB of event data; measure RSS delta via `process.memoryUsage().rss`.
- **Evidence**: direct read.

### [MEDIUM | confidence=high] saveToDiskDebounced starvation under sustained activity

- **File**: `lib/accounts.ts:945-966`
- **Quote**:

  ```ts
  	saveToDiskDebounced(delayMs = 500): void {
  		if (this.saveDebounceTimer) {
  			clearTimeout(this.saveDebounceTimer);
  		}
  		this.saveDebounceTimer = setTimeout(() => {
  			this.saveDebounceTimer = null;
  			const doSave = async () => {
  				try {
  					if (this.pendingSave) {
  						await this.pendingSave;
  					}
  					this.pendingSave = this.saveToDisk().finally(() => {
  						this.pendingSave = null;
  					});
  					await this.pendingSave;
  				} catch (error) {
  					log.warn("Debounced save failed", { error: error instanceof Error ? error.message : String(error) });
  				}
  			};
  			void doSave();
  		}, delayMs);
  	}
  ```

- **Issue**: Every call cancels the previous timer. Under sustained rotation activity where `saveToDiskDebounced` is invoked more often than once per 500 ms (e.g. during aggressive multi-account rotation or rapid token refresh), the timer is continually reset and `saveToDisk` never runs. A crash or process kill during this window loses the in-memory state accumulated since the last successful write. The performance angle: when the debounce *does* fire, it awaits any `pendingSave` and then writes — serializing disk I/O — which can compound under load.
- **Recommendation**: Add a `maxDelayMs` upper bound (e.g. 5 000 ms) that forces a flush regardless of the trailing timer. Track `firstScheduledAt: number | null` and if `Date.now() - firstScheduledAt >= maxDelayMs`, run the save immediately and reset the marker. Alternatively, switch to a batching queue that coalesces writes but guarantees a flush every N events. Validate with a benchmark that calls `saveToDiskDebounced()` every 100 ms for 10 s and asserts at least 2 observable writes.
- **Evidence**: direct read.

### [MEDIUM | confidence=high] CircuitBreaker pruneFailures allocates new array on every success and failure

- **File**: `lib/circuit-breaker.ts:69-82, 103-106`
- **Quote**:

  ```ts
  	recordFailure(): void {
  		const now = Date.now();
  		this.pruneFailures(now);
  		this.failures.push(now);

  		if (this.state === "half-open") {
  			this.transitionToOpen(now);
  			return;
  		}

  		if (this.state === "closed" && this.failures.length >= this.config.failureThreshold) {
  			this.transitionToOpen(now);
  		}
  	}
  ```

  ```ts
  	private pruneFailures(now: number): void {
  		const cutoff = now - this.config.failureWindowMs;
  		this.failures = this.failures.filter((timestamp) => timestamp >= cutoff);
  	}
  ```

- **Issue**: `pruneFailures` is invoked from `recordSuccess`, `recordFailure`, and `getFailureCount`. Each invocation allocates a brand-new array via `.filter(...)` regardless of whether any pruning is actually required. Under sustained success (the dominant path), the allocation is pure waste — the `failures` array is already empty or small. With `MAX_CIRCUIT_BREAKERS = 100` active breakers × a few hundred requests per minute per breaker, the GC pressure is measurable under profiler.
- **Recommendation**: Short-circuit when the oldest entry is still within the window (`if (this.failures.length === 0 || this.failures[0] >= cutoff) return;`), or replace the `number[]` with a bounded ring buffer sized to `failureThreshold` so pruning becomes O(1) index math. Measure with `node --cpu-prof` during a 60 s burst of 100 req/s across 10 breaker keys; compare %-CPU of the allocator before/after.
- **Evidence**: direct read.

### [MEDIUM | confidence=high] Double JSON.parse of request body on the legacy fallback path

- **File**: `index.ts:1617-1658` and `lib/request/fetch-helpers.ts:420-436`
- **Quote** (index.ts):

  ```ts
  	const parseRequestBodyFromInit = async (
  		body: unknown,
  	): Promise<Record<string, unknown>> => {
  		if (!body) return {};

  		try {
  			if (typeof body === "string") {
  				return JSON.parse(body) as Record<string, unknown>;
  			}
  ```

- **Quote** (fetch-helpers.ts):

  ```ts
  		let body: RequestBody;
  		if (hasParsedBody) {
  			body = parsedBody as RequestBody;
  		} else {
  			if (typeof init?.body !== "string") return undefined;
  			body = JSON.parse(init.body) as RequestBody;
  		}
  ```

- **Issue**: The fetch wrapper at `index.ts:1655` always calls `parseRequestBodyFromInit` which JSON-parses the incoming body. It then passes the parsed body into `transformRequestForCodex` via `parsedBody`. The fallback branch at `fetch-helpers.ts:434-435` re-parses `init.body` if `parsedBody` is absent. The default path is covered, but a call to `transformRequestForCodex` from any caller that forgets to pass `parsedBody` will parse the body twice. Additionally the transformer emits a fresh `JSON.stringify(transformedBody)` at `fetch-helpers.ts:519` for every request — this is a full re-serialization of the entire request body including the injected `instructions` string (which can be 20–50 KB). Per-request, the body is therefore: parsed once, potentially transformed, serialized once.
- **Recommendation**: Remove the fallback parse path from `transformRequestForCodex` and require callers to always pass `parsedBody` (make it a required argument). For serialization, a streaming serializer (`JSON.stringify` with a replacer is not faster, but `fast-json-stringify` with a pre-compiled schema is 2–3× faster) could be evaluated; measure first with `0x` flamegraphs. Alternatively cache the serialized `instructions` string on a per-family basis so only the final `JSON.stringify` of the envelope includes it.
- **Evidence**: direct read; confirm via a grep that no other caller of `transformRequestForCodex` exists besides the fetch wrapper.

### [MEDIUM | confidence=high] Logger regex sanitization runs on every log message with no fast path

- **File**: `lib/logger.ts:75-110, 155`
- **Quote**:

  ```ts
  function maskString(value: string): string {
  	let result = value;
  	// Mask emails first (before token patterns might match parts of them)
  	result = result.replace(EMAIL_PATTERN, (match) => maskEmail(match));
  	for (const pattern of TOKEN_PATTERNS) {
  		result = result.replace(pattern, (match) => maskToken(match));
  	}
  	return result;
  }
  ```

- **Issue**: `maskString` is invoked on every log message (`logToApp`, `logToConsole`, `logRequest`), and `sanitizeValue` is called recursively on every `data` object up to depth 10. Four global regex replace passes + one email regex pass run across the entire message string regardless of whether any token-like content is present. With `DEBUG_ENABLED`, the hot path includes scoped logger calls from `rotation.ts`, `refresh-queue.ts`, and `request-transformer.ts` at multiple sites per request. The redaction is correct but unconditional; for a 10 KB debug message, five full linear scans is ~50 KB of scanning work per log line.
- **Recommendation**: Add a fast-path guard: `if (!TOKEN_SHAPE_HINT.test(result)) return result` where `TOKEN_SHAPE_HINT = /ey[JK]|Bearer |@|sk-/`. This skips the replace chain when no candidate substring exists. Benchmark with `benny` using a 10 KB clean message and a 10 KB message containing one JWT; expect ≥ 5× speedup on the clean path. Cross-reference: the TOKEN_PATTERNS *coverage* gap is owned by T02 (security); this is the *performance* angle only.
- **Evidence**: direct read. See also `docs/audits/_findings/T02-security.md` for coverage findings.

### [MEDIUM | confidence=high] Storage serializes with pretty-print indent on every save

- **File**: `lib/storage.ts:904-906, 1154-1155, 1323-1324`
- **Quote**:

  ```ts
      const normalizedStorage = normalizeAccountStorage(storage) ?? storage;
      const content = JSON.stringify(normalizedStorage, null, 2);
      await fs.writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 });
  ```

- **Issue**: Every persistence path (`writeAccountsToPathUnlocked`, flagged-account save, export) uses `JSON.stringify(..., null, 2)`. For a storage file with 10 accounts × ~2 KB each including refresh tokens, metadata, and rate-limit maps, the pretty-printed output is roughly 1.8–2.2× the compact size, and `JSON.stringify` with indent is measurably slower (2–3×) than without. Writes happen on every `saveToDiskDebounced` flush. Atomic-rename retry on Windows (`lib/storage.ts:155-175`) can add up to ~160 ms of backoff if antivirus has a lock. Combined: a single save is ~20–40 ms on an unloaded disk + retry window.
- **Recommendation**: Serialize compact (`JSON.stringify(storage)`); if developer-friendly diffs are desired on checked-in fixtures, add an export command that pretty-prints. Measure with `benny` over 100 saves of a representative storage file; expect ~2.5× speedup and ~50% smaller atomic-rename window. No API change required — the file consumers only re-parse the JSON.
- **Evidence**: direct read.

### [MEDIUM | confidence=medium] Hybrid account selection triple-iterates accounts per request

- **File**: `lib/accounts.ts:571-623`
- **Quote**:

  ```ts
  		const accountsWithMetrics: AccountWithMetrics[] = this.accounts
  			.map((account): AccountWithMetrics | null => {
  				if (!account) return null;
  				if (account.enabled === false) return null;
  				clearExpiredRateLimits(account);
  				const isAvailable =
  					!isRateLimitedForFamily(account, family, model) && !this.isAccountCoolingDown(account);
  				return {
  					index: account.index,
  					isAvailable,
  					lastUsed: account.lastUsed,
  				};
  			})
  			.filter((a): a is AccountWithMetrics => a !== null);

  		const selected = selectHybridAccount(accountsWithMetrics, healthTracker, tokenTracker, quotaKey, {}, options);
  ```

- **Issue**: Per request (or per retry inside a request), the pool is mapped, filtered, and then iterated again inside `selectHybridAccount` (`lib/rotation.ts:302-370`), which does its own `available = accounts.filter(...)` plus a scoring loop. For N accounts, that is 3N object walks, 3N `Date.now()` calls minimum, and N ephemeral `AccountWithMetrics` objects allocated. For N ≤ 5 (the common case) this is negligible; for N ≥ 20 (power users with many projects) and heavy retry loops, the cost compounds.
- **Recommendation**: Fuse the filter and score pass: iterate once over `this.accounts` computing `isAvailable` and score inline; track best candidate as you go. Avoid the intermediate `AccountWithMetrics[]` allocation entirely. Measure with `benny` at N=5 and N=50; pre- and post- numbers should differ mostly for the N=50 case.
- **Evidence**: direct read; cross-reference `docs/audits/_findings/T03-rotation.md` for correctness-side findings on the same function.

### [MEDIUM | confidence=high] TokenBucketTracker rebuilds consumptions array on every tryConsume

- **File**: `lib/rotation.ts:186-208`
- **Quote**:

  ```ts
  	tryConsume(accountIndex: number, quotaKey?: string): boolean {
  		const key = this.getKey(accountIndex, quotaKey);
  		const entry = this.buckets.get(key);
  		const currentTokens = entry ? this.refillTokens(entry) : this.config.maxTokens;

  		if (currentTokens < 1) {
  			return false;
  		}

  		const now = Date.now();
  		const cutoff = now - TOKEN_REFUND_WINDOW_MS;
  		const consumptions = (entry?.consumptions ?? []).filter(
  			(timestamp) => timestamp >= cutoff
  		);
  		consumptions.push(now);

  		this.buckets.set(key, {
  			tokens: currentTokens - 1,
  			lastRefill: now,
  			consumptions,
  		});
  		return true;
  	}
  ```

- **Issue**: Every `tryConsume` call allocates a new array via `.filter(...)` and then allocates a new entry object via `this.buckets.set(...)`. With `TOKEN_REFUND_WINDOW_MS = 30_000` and `DEFAULT_TOKEN_BUCKET_CONFIG.maxTokens = 50`, the `consumptions` array tops out around 50 entries — but the allocation still fires every request regardless. The filter walks the array once, pushes once, and then the `buckets.set` replaces the entry wholesale. `refillTokens` additionally calls `Date.now()` a second time inside.
- **Recommendation**: Mutate the existing `entry.consumptions` array in place when one exists: use a two-index sweep to drop stale timestamps in O(k) without allocation; `push(now)`; update `entry.tokens -= 1` and `entry.lastRefill = now`. Only allocate a new entry when `entry` is undefined. Measure with a microbench that calls `tryConsume(0)` 100 000× on a primed bucket; expect ≥ 3× speedup.
- **Evidence**: direct read.

### [MEDIUM | confidence=medium] Prewarm fires unbounded parallel GitHub fetches on first loader call

- **File**: `index.ts:1525-1537` and `lib/prompts/codex.ts:422-432`
- **Quote** (index.ts):

  ```ts
  				const prewarmEnabled =
  					process.env.CODEX_AUTH_PREWARM !== "0" &&
  					process.env.VITEST !== "true" &&
  					process.env.NODE_ENV !== "test";

  				if (!startupPrewarmTriggered && prewarmEnabled && useLegacyRequestTransform) {
  					startupPrewarmTriggered = true;
  					const configuredModels = Object.keys(userConfig.models ?? {});
  					prewarmCodexInstructions(configuredModels);
  ```

- **Quote** (codex.ts):

  ```ts
  export function prewarmCodexInstructions(models: string[] = []): void {
  	const candidates = models.length > 0 ? models : ["gpt-5-codex", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-pro", "gpt-5.2", "gpt-5.1"];
  	for (const model of candidates) {
  		void getCodexInstructions(model).catch((error) => {
  ```

- **Issue**: When cache files are missing or stale, `prewarmCodexInstructions` fans out one `getCodexInstructions` call per configured model with no concurrency limit. If the user has 8 models configured, the first loader invocation triggers 8 parallel network paths, each of which may perform `getLatestReleaseTag()` (2 fetches fallback-chained) plus a prompt fetch. GitHub's unauthenticated rate limit is 60/hr per IP — three back-to-back OpenCode sessions could fire 24 requests and start getting 403s. The request-time `getCodexInstructions` would then fall through to the bundled disk copy (correct behaviour), but the prewarm burst is wasteful.
- **Recommendation**: Dedupe the calls to `getLatestReleaseTag` across the burst by sharing a single in-flight promise (there is already `latestReleaseTagCache` but no in-flight dedup — concurrent callers each issue their own fetch). Wrap the `for (const model of candidates)` loop in a concurrency limiter (`p-limit(2)`). Measure with `node --inspect` during a cold-start scenario; count outgoing fetches to `api.github.com` and `raw.githubusercontent.com`.
- **Evidence**: direct read.

### [LOW | confidence=high] URL parsed twice per request (once in extract, once in rewrite)

- **File**: `lib/request/fetch-helpers.ts:366-395`
- **Quote**:

  ```ts
  export function extractRequestUrl(input: Request | string | URL): string {
  	if (typeof input === "string") return input;
  	if (input instanceof URL) return input.toString();
  	return input.url;
  }
  ```

  ```ts
  export function rewriteUrlForCodex(url: string): string {
  	const parsedUrl = new URL(url);
  ```

- **Issue**: If the incoming `input` is a `URL` instance, `extractRequestUrl` serialises it to a string, and `rewriteUrlForCodex` immediately re-parses that string. One `URL` parse + one `toString` per request could be eliminated. The cost is small (≤ 5 µs) but fires on every request.
- **Recommendation**: Accept `Request | string | URL` directly in `rewriteUrlForCodex` and skip the re-parse when `input instanceof URL`. Benchmark with `benny` at 100 000 iterations of a typical URL; expect ~20% faster rewrite.
- **Evidence**: direct read.

### [LOW | confidence=high] Normalize model runs 16 string probes per request with no memoisation

- **File**: `lib/request/request-transformer.ts:40-165`
- **Quote**:

  ```ts
  export function normalizeModel(model: string | undefined): string {
  	if (!model) return "gpt-5.4";

  	// Strip provider prefix if present (e.g., "openai/gpt-5-codex" → "gpt-5-codex")
  	const modelId = model.includes("/") ? model.split("/").pop() ?? model : model;

  	// Try explicit model map first (handles all known model variants)
  	const mappedModel = getNormalizedModel(modelId);
  	if (mappedModel) {
  		return mappedModel;
  	}
  ```

- **Issue**: Pattern-based fallback after the model map miss does up to 16 sequential `includes` / regex tests. This is only reached when the explicit `getNormalizedModel` map misses — in practice most production traffic hits the map. But `getModelFamily` (`lib/prompts/codex.ts:109-146`) runs unconditionally on every request with a similar probe chain.
- **Recommendation**: Cache `normalizeModel(modelId) -> string` in a small LRU (keyed on modelId string) at module level; same for `getModelFamily(normalizedModel) -> ModelFamily`. Validate correctness via the existing property-based tests in `test/property/transformer.property.test.ts`; measure micro-speed with `benny`.
- **Evidence**: direct read.

### [LOW | confidence=medium] hydrateEmails serializes chunks of 3 with implicit round trips

- **File**: `index.ts:763-830`
- **Quote**:

  ```ts
  		const chunkSize = 3;
  		for (let i = 0; i < accountsToHydrate.length; i += chunkSize) {
  			const chunk = accountsToHydrate.slice(i, i + chunkSize);
  			await Promise.all(
  				chunk.map(async (account) => {
  ```

- **Issue**: For N accounts missing emails, startup adds ⌈N/3⌉ serial rounds of parallel refresh network calls. Chunking at 3 is a reasonable rate-limit mitigation but the serialised rounds can add 2–6 seconds for large pools. Only fired on command paths, not the main loader — but the command paths are the ones users notice.
- **Recommendation**: Measure actual auth0 rate-limit behaviour at chunk sizes 3, 5, and 8; if the larger sizes still stay under the 429 line, raise the chunk size. Alternatively, fire all refreshes in parallel with a 429-aware retry so the steady-state latency collapses to one round trip.
- **Evidence**: direct read.

### [LOW | confidence=medium] Prompt cache FIFO eviction (labelled LRU) never triggers for realistic family counts

- **File**: `lib/prompts/codex.ts:18, 34-41`
- **Quote**:

  ```ts
  const MAX_CACHE_SIZE = 50;
  const memoryCache = new Map<string, { content: string; timestamp: number }>();
  ```

  ```ts
  function setCacheEntry(key: string, value: { content: string; timestamp: number }): void {
  	if (memoryCache.size >= MAX_CACHE_SIZE && !memoryCache.has(key)) {
  		const firstKey = memoryCache.keys().next().value;
  		// istanbul ignore next -- defensive: firstKey always exists when size >= MAX_CACHE_SIZE
  		if (firstKey) memoryCache.delete(firstKey);
  	}
  	memoryCache.set(key, value);
  }
  ```

- **Issue**: `MODEL_FAMILIES` contains 8 entries; `MAX_CACHE_SIZE = 50` means eviction is unreachable under realistic workloads. The code path is defensive but the eviction semantics are FIFO (insertion order), not true LRU — if it ever *did* evict, it could evict a recently-read entry. Not a correctness bug today, but a latent risk if the family list grows.
- **Recommendation**: Reduce `MAX_CACHE_SIZE` to match `MODEL_FAMILIES.length * 2` and convert to true LRU (delete + re-insert on read) or just remove the eviction path entirely and note that the family set is bounded. Measure nothing — this is a semantic cleanup.
- **Evidence**: direct read.

### [LOW | confidence=medium] Scoped logger timers leak on unclosed time() calls

- **File**: `lib/logger.ts:331-391`
- **Quote**:

  ```ts
  const MAX_TIMERS = 100;
  const timers: Map<string, number> = new Map();
  ```

  ```ts
  		time(label: string): () => number {
  			const key = `${scope}:${label}`;
  			const startTime = performance.now();
  		if (timers.size >= MAX_TIMERS) {
  			const firstKey = timers.keys().next().value;
  ```

- **Issue**: `time()` inserts into `timers` but relies on the caller invoking the returned closure (which calls `timers.delete(key)`). If a caller never invokes the closure (e.g. thrown error before the end), the timer leaks. `MAX_TIMERS = 100` caps the damage, but the key eviction is FIFO, so the oldest in-flight timer is deleted regardless of state.
- **Recommendation**: Use `timeEnd(label, startTime)` as the canonical API since `startTime` flows by value and no map is required. Remove the `timers` Map entirely. No perf benchmark needed.
- **Evidence**: direct read.

### [LOW | confidence=medium] Windows atomic-rename retry base delay doubles up to ~160 ms per save

- **File**: `lib/storage.ts:155-175`
- **Quote**:

  ```ts
  const WINDOWS_RENAME_RETRY_ATTEMPTS = 5;
  const WINDOWS_RENAME_RETRY_BASE_DELAY_MS = 10;
  ```

- **Issue**: Rename retries back off as `10 * 2^attempt` ms → worst-case sleep is 10 + 20 + 40 + 80 = 150 ms of backoff before the 5th attempt, plus whichever small additional delay + rename call. Under antivirus lock this compounds, and the debounced save (F08-03) can queue up behind a single stuck rename. The retry policy is reasonable but the total wall-clock wait is non-trivial on Windows.
- **Recommendation**: Cap total elapsed time rather than retry count (e.g. `while (Date.now() - start < 200) { ... }`) so a fast disk sees quick retries and a slow disk gives up faster. Measure actual distribution on a Windows Defender-enabled dev box using 100 saves under light activity.
- **Evidence**: direct read.

---

## Benchmarking Recommendations

Every recommendation above is gated on measurement. The auditor did not execute any benchmark; the table below maps each finding to the tool that should verify it.

| Finding | Tool | Measurement |
| --- | --- | --- |
| F08-01 SSE concat | `node --prof-process` + `0x -- node bench.js` | Flamegraph %-CPU in `convertSseToJson` vs elsewhere; RSS delta during a 5 MB SSE response |
| F08-02 MAX_SSE_SIZE post-check | `autocannon` against mock endpoint returning 12 MB | `process.memoryUsage().rss` peak before abort |
| F08-03 Debounce starvation | `vitest` bench with fake timers | Count of `saveToDisk` calls over 10 s at 100 ms debounce trigger cadence |
| F08-04 CircuitBreaker prune | `benny` or `mitata` | Ops/sec of `recordSuccess()` before/after short-circuit |
| F08-05 Double JSON.parse | `node --cpu-prof` | %-CPU of `JSON.parse` vs `JSON.stringify` in per-request samples |
| F08-06 Logger regex | `benny` with 10 KB message | Ops/sec with clean vs dirty payload |
| F08-07 Storage pretty-print | `benny` over representative V3 storage file | Serialize time + byte size compact vs indented |
| F08-08 Account selection | `benny` at N=5 / N=50 | Ops/sec of `getCurrentOrNextForFamilyHybrid` |
| F08-09 TokenBucket tryConsume | `benny` at 100 000 iterations | Ops/sec + heap allocations via `--trace-gc` |
| F08-10 Prewarm fanout | `node --inspect` + Network tab | Distinct GitHub requests per cold-start |
| F08-11 URL reparse | `benny` | Ops/sec rewriteUrlForCodex with URL vs string input |
| F08-12 Normalize model probe | `benny` + property-based regression | Hit rate of fallback probe chain in real traces |
| F08-13 hydrateEmails chunking | `node --inspect` of live flow | Wall-clock of full hydration at chunk=3 vs chunk=5/8 |
| F08-14 FIFO eviction path | none | Remove path or make LRU; no measurement needed |
| F08-15 Logger timers leak | none | Remove timers Map; no measurement needed |
| F08-16 Windows rename retry | `vitest` + mock `fs.rename` | Total wall-clock distribution over 100 simulated saves |

General tooling notes:

- **`node --cpu-prof --heap-prof`** for off-the-shelf samples; inspect with Chrome DevTools → Open → CPU profile.
- **`0x`** for flamegraphs without code changes; invoked as `npx 0x -- node ./scripts/bench.mjs`.
- **`clinic doctor`** for event-loop lag and async wait time; `clinic flame` for CPU.
- **`autocannon`** (by matteocollina) for synthetic request load against a mock Codex backend; supports `--workers` for multi-core.
- **`benny`** or **`mitata`** for microbenchmarks of individual functions. `mitata` is faster and has better warmup.
- **`tinybench`** is a good alternative for inline Vitest benchmark suites.
- Never rely on `console.time` for microbench — its precision is 1 ms floor and not representative.

All benchmarks should be reproducible and checked into `test/perf/` (out of scope for this task — see T15 for CI infrastructure).

---

## Notes

- No benchmarks were executed as part of this audit; all numeric estimates in the findings are read-derived upper bounds, not measurements.
- Severity budgets: 0 CRITICAL, 2 HIGH, 8 MEDIUM, 6 LOW — within the rubric caps (CRITICAL ≤ 5, HIGH ≤ 15, MEDIUM ≤ 40).
- File-level hotspots that may warrant attention in T17 synthesis: `lib/request/response-handler.ts`, `lib/accounts.ts`, `lib/circuit-breaker.ts`, `lib/rotation.ts`, `lib/logger.ts`.
- Cross-references to other audits: T02 (logger redaction coverage), T03 (rotation correctness), T04 (request pipeline semantics), T07 (concurrency). Performance findings here focus on CPU, memory, and wall-clock cost; correctness implications are owned by the corresponding domain audits.
