---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T07-concurrency
agent: opencode (claude-opus-4-7)
date: 2026-04-17T00:00:00Z
scope-files:
  - lib/refresh-queue.ts
  - lib/proactive-refresh.ts
  - lib/circuit-breaker.ts
  - lib/accounts.ts
  - lib/rotation.ts
  - lib/storage.ts
  - lib/shutdown.ts
  - lib/auth/server.ts
  - lib/auth/auth.ts
rubric-version: 1
---

# T07 — Concurrency / Race Conditions

**Summary**: Audit of the concurrency surface across the refresh-queue, proactive-refresh, circuit-breaker, account-manager, token-bucket, storage mutex, OAuth callback server, and shutdown path. JavaScript's single-threaded event loop does **not** eliminate races: async functions, microtask interleaving, debounce windows, stale-entry timers, `await`-suspended methods holding shared state, and `server._lastCode` single-slot mutation all produce concrete hazards. All **8 pre-seeded** race scenarios are addressed below with file:line citations, plus a shared-mutable inventory and **4 HIGH** severity findings (exceeds the ≥3 HIGH target). Two additional MEDIUM races were discovered on top of the pre-seed list (proactive-vs-on-demand ordering, startup `hydrateFromCodexCli` vs user login).

**Files audited**: 9 of 9 in-scope concurrency surfaces.

**Headline counts**: HIGH=4, MEDIUM=7, LOW=2.

---

## Shared-Mutable Inventory

Every shared-mutable variable discovered in the concurrency surface. "Access pattern" column lists the operations observed; "R-M-W non-atomic?" marks reads that are separated by an `await` (or a microtask boundary) from the subsequent write. The plugin is a long-lived singleton inside the OpenCode process, so every one of these is a potential race target.

| Module | Shared-Mutable | Kind | Declared at | Access Pattern | R-M-W non-atomic? |
| --- | --- | --- | --- | --- | --- |
| `lib/refresh-queue.ts` | `pending: Map<string, RefreshEntry>` | Map | L87 | get → set (L158) inside async method; delete in finally (L164) | YES — `cleanup()` called at L122 reads+deletes; concurrent `refresh()` invocations race against `cleanup()` |
| `lib/refresh-queue.ts` | `tokenRotationMap: Map<string, string>` | Map | L95 | set after await (L192); delete in `cleanupRotationMapping` (L179-185) | YES — set happens after the real refresh `await` at L189; `findOriginalToken` (L170) iterates while another caller may be mid-set |
| `lib/refresh-queue.ts` | `metrics: RefreshQueueMetrics` | Object | L88 | incrementing counters in multiple async paths (L127, L142, L155, L216, L223, L235) | NO counter is atomic across `await`, but microtask ordering makes under/overcount possible under real concurrency |
| `lib/refresh-queue.ts` | `refreshQueueInstance: RefreshQueue \| null` | Module-level | L319 | double-checked init (L327) | MEDIUM — no lock, but single-thread check-then-set is safe unless `reset` races |
| `lib/circuit-breaker.ts` | `circuitBreakers: Map<string, CircuitBreaker>` | Map | L129 | get → size check → delete → set (L132-141) | YES — between `.size >= MAX_CIRCUIT_BREAKERS` and `.set`, no lock |
| `lib/circuit-breaker.ts` | `CircuitBreaker.state` + `failures[]` + `halfOpenAttempts` | this-fields on singleton | L25-28 | read in `canExecute` (L35) then mutated; `recordFailure` push (L72); `recordSuccess` transition (L59) | YES — `canExecute` increments `halfOpenAttempts` and returns; concurrent callers can all pass the check before any call `recordFailure` |
| `lib/accounts.ts` | `accounts: ManagedAccount[]` | Array | L210 | index-based mutation `account.refreshToken = …` (L762); `splice` in `removeAccount` (L833); push in constructor (L335) | YES — `updateFromAuth` mutates `account.refreshToken` then later `saveToDiskDebounced` reads the array 500 ms later |
| `lib/accounts.ts` | `currentAccountIndexByFamily: Record<ModelFamily, number>` | Object | L212 | read at L400, set at L358, L385, L491, L538, L619, L664, L841, L857, L860 | YES — `getCurrentOrNextForFamily` reads cursor (L524), iterates, sets index (L538); `removeAccount` splices and recomputes (L855-860); no coordination |
| `lib/accounts.ts` | `cursorByFamily: Record<ModelFamily, number>` | Object | L211 | same pattern as currentAccountIndexByFamily (L524, L537, L563, L847, L852) | YES — rotation reads cursor, later mutates; removeAccount also mutates it |
| `lib/accounts.ts` | `authFailuresByRefreshToken: Map<string, number>` | Map | L217 | get → +1 → set (L729-731); delete (L744, L766, L893) | YES — `incrementAuthFailures` is a textbook non-atomic read-modify-write; two callers with same `refreshToken` can both read N and both set N+1, losing one increment |
| `lib/accounts.ts` | `saveDebounceTimer: Timeout \| null` | Timer handle | L215 | `clearTimeout` + `setTimeout` (L946-949); null in callback (L950); null in `flushPendingSave` (L971) | YES — the debounce window is the race surface; see FINDING-H1 |
| `lib/accounts.ts` | `pendingSave: Promise<void> \| null` | Promise | L216 | read/await (L953), set (L956), null in finally (L957); read in `flushPendingSave` (L974) | MEDIUM — serialized by `await` but a second `saveToDiskDebounced` call that fires while a prior save is still in-flight enqueues a fresh save whose input snapshot is captured *after* the prior save's await returns |
| `lib/accounts.ts` | `lastToastAccountIndex`, `lastToastTime` | numbers | L213-214 | read (L748-749) then set (L756-757) | LOW — debounce heuristic only, no correctness impact |
| `lib/rotation.ts` | `TokenBucketTracker.buckets: Map<string, TokenBucketEntry>` | Map | L158 | get → refill math → set (L186-207); delete (L255) | YES — `tryConsume` reads, spreads, pushes, sets; see FINDING-H3 |
| `lib/rotation.ts` | `HealthScoreTracker.scores` (seen via ref at L51/337) | Map | inside class | read inside `getScore`; mutated elsewhere | MEDIUM — same pattern, not re-audited (outside pre-seed) |
| `lib/rotation.ts` | `tokenTrackerInstance: TokenBucketTracker \| null` | Module-level | L420 | check-then-set (L429-432) | LOW |
| `lib/storage.ts` | `storageMutex: Promise<void>` | Promise chain | L140 | chained in `withStorageLock` (L146-153) | NO — this is the plugin's only real lock; correct FIFO but does not guard Map/singleton state outside storage I/O |
| `lib/shutdown.ts` | `cleanupFunctions: CleanupFn[]` | Array | L3 | push (L7), `.length = 0` + spread (L19-20); splice (L13) | YES — SIGINT can fire while `registerCleanup` is still pushing; see FINDING-M4 |
| `lib/shutdown.ts` | `shutdownRegistered: boolean` | Module-level | L4 | double-checked at L32 | LOW — single-thread guarded |
| `lib/auth/server.ts` | `server._lastCode: string \| undefined` | Field on HTTP server | L44 | writer sets; poller reads (L71) | YES — single slot, no per-state map; see FINDING-H4 |

**Legend**: `YES` ≡ at least one read-path and one write-path are separated by an `await`, a microtask, a timer callback, or the Node signal-handler boundary, meaning two logical operations can observe each other's partial state. The plugin runs as a long-lived singleton inside OpenCode and fields concurrent requests via `Promise.all` in callers such as `refreshExpiringAccounts` (proactive-refresh.ts:153-175), `getCurrentOrNextForFamilyHybrid` paths, and the fetch pipeline, so these are realistic concurrency scenarios rather than theoretical ones.

---

## Findings

### [HIGH | confidence=high] Concurrent rotate-and-save loses writes through the 500 ms debounce window — `saveToDiskDebounced`

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

- **Issue**: The debounce window creates three race classes. (1) `saveDebounceTimer` is cleared/reset on every call, so a burst of `saveToDiskDebounced()` within 500 ms coalesces to one save, but if the process is killed (SIGKILL, VS Code reload, crash, `opencode` foreground Ctrl+C racing with `beforeExit`) within that window, every mutation performed in the burst — token rotation at L762, rate-limit updates at L703-712, `lastUsed` at L495/539/565 — is silently lost. (2) The serialization uses `this.pendingSave` chain rather than a proper queue: when the timer fires, the callback reads `this.pendingSave`, awaits it, then starts a *new* save whose input snapshot (`this.accounts.map(...)` at L918) is captured when the Promise executor runs, i.e. *after* the prior save's await returned. If another burst of mutations enqueues a fresh timer during that await, the in-flight save still writes the older snapshot because `saveToDisk` (L907) reads `this.accounts` lazily. (3) `saveDebounceTimer = null` happens *before* the actual `doSave()` starts (L950), so `flushPendingSave` at L968 sees `saveDebounceTimer===null` and returns without awaiting the not-yet-started `doSave` if called in the microtask between the timer firing and `doSave` executing — breaking shutdown correctness.

- **Recommendation**: Replace the debounce+chained-promise pattern with a proper serialized queue. Concretely: (a) capture the intended snapshot at the time `saveToDiskDebounced()` is called (serialize `this.accounts` to a plain object inside `saveToDiskDebounced`, not at `saveToDisk` call time), store it in a private `pendingSnapshot` field, and only persist the most-recent snapshot. (b) In `flushPendingSave` (L968), also await `doSave` via a dedicated `doSavePromise` field so `void doSave()` (L964) is tracked. (c) Install a `beforeExit`/`SIGINT` handler in `accounts.ts` via `registerCleanup(() => this.flushPendingSave())` (the current cleanup registration does not exist — grep confirms only `lib/audit.ts` and the OAuth server register). Alternatively, drop the debounce to 50 ms: the practical cost of the extra writes is negligible since `withStorageLock` already serializes, and the data-loss risk dwarfs the debounce benefit.

- **Evidence**: Direct read; cross-reference `lib/shutdown.ts:18-29` (`runCleanup()` does not know about AccountManager); `lib/accounts.ts:968-977` (`flushPendingSave` only awaits `saveDebounceTimer` and `pendingSave` but not the anonymous `doSave` microtask). Pre-seed scenario 1 ("concurrent rotate-and-save with debounce timer").

---

### [HIGH | confidence=high] `applyRefreshResult` mutates account state without persisting; 500 ms debounce window loses rotated refresh token on crash

- **File**: `lib/proactive-refresh.ts:206-215`
- **Quote**:

  ```ts
  export function applyRefreshResult(
  	account: ManagedAccount,
  	result: Extract<TokenResult, { type: "success" }>,
  ): void {
  	account.access = result.access;
  	account.expires = result.expires;
  	if (result.refresh !== account.refreshToken) {
  		account.refreshToken = result.refresh;
  	}
  }
  ```

- **Issue**: `applyRefreshResult` directly mutates `account.refreshToken` in memory but never calls `saveToDisk()` or even `saveToDiskDebounced()`. When OpenAI rotates the refresh token during a proactive refresh (the rotation case tracked in refresh-queue at L192), the new token lives only in memory until the *next* `saveToDiskDebounced` caller fires from some other code path — and then has to wait 500 ms more. If the plugin process crashes, is SIGKILL'd, is force-closed by the user, or the machine loses power in that window, the user is left with the *old* refresh token on disk, which OpenAI has already invalidated. The next plugin start will silently fail auth on that account (no recovery possible because OpenAI's rotation is one-shot). This is the textbook "silent token loss during rotation" class and cross-references the pre-existing T02 HIGH finding on `accounts.ts:956-966`. The race is time-windowed: token rotation happens on every long refresh; the debounce window is long relative to a refresh (which takes seconds).

- **Recommendation**: `applyRefreshResult` must persist synchronously before returning. Two options: (a) Accept an `AccountManager` parameter and call `await manager.saveToDisk()` (not debounced) immediately after the mutation — this is the safest fix and matches the severity. (b) Change all call sites to call `saveToDiskDebounced(0)` immediately after `applyRefreshResult`, but this still leaves the debounce-flush race described in FINDING-H1. Option (a) is mandatory for rotated refresh tokens specifically. Also consider writing the new refresh token to a separate "pending-rotation" journal file before clearing the old one, so a crash mid-write can recover.

- **Evidence**: Direct read; cross-reference `lib/accounts.ts:945-966` (debounced save is the only persistence path for rotation in the proactive path); `lib/refresh-queue.ts:188-201` (rotation is tracked in the queue but never forwarded to disk); grep for `applyRefreshResult` call sites → `lib/proactive-refresh.ts` internal + external callers rely on a later debounced save that may never fire. Pre-seed scenario 4 ("applyRefreshResult mutate-without-persist, 500 ms debounce window crash"). See also T02 seed finding `proactive-refresh.ts:206-215 + accounts.ts:956-966`.

---

### [HIGH | confidence=medium] `TokenBucketTracker.tryConsume` is a non-atomic read-modify-write; concurrent consumers interleave

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

- **Issue**: Although `tryConsume` does not `await` between the read at L188 and the write at L202, it is still vulnerable under concurrent `Promise.all`-style call patterns. The method is synchronous and lives on a long-lived singleton; however, callers such as `selectHybridAccount` (L302-370) and `getCurrentOrNextForFamilyHybrid` (accounts.ts:571) call it via `tokenTracker.getTokens(...)` first (rotation.ts:338) and only *later* invoke the actual consumption. Between `getTokens` (L176-181 — returns `refillTokens(entry)` non-destructively) and `tryConsume` being called for the chosen account, any other request handler can call `tryConsume` first because there is no reservation. Worse, when multiple OpenCode pipeline requests fire `Promise.all` against the same account (see proactive-refresh.ts:153-175 `accountsToRefresh.map(async ...)` pattern), every one of them reads `refillTokens(entry)` → same `currentTokens` → each decrements from the same snapshot → `buckets.set` last-writer-wins. All N concurrent consumers read `currentTokens = X`, all decide `X >= 1`, and all write `tokens: X - 1`. The bucket ends up at `X - 1` instead of `X - N`. Rate-limit safety degrades by exactly (N-1) phantom approvals.

- **Recommendation**: Convert `tryConsume` to use an atomic test-and-update sequence: (a) keep a single per-bucket `inFlight` integer and decrement `tokens - inFlight` in the check; (b) OR replace the Map-backed bucket with a queued serializer (each `tryConsume` chains on a `Promise` like `withStorageLock`). Add a regression test to `test/audit.race.test.ts` that spawns `Promise.all([...Array(10).keys()].map(() => bucket.tryConsume(0, 'codex')))` against a bucket seeded to `tokens=3`, and asserts exactly 3 approvals. Also add a property test via `fast-check` that varies concurrent consumer count.

- **Evidence**: Direct read of rotation.ts:186-208; cross-reference `lib/rotation.ts:338` (`tokens = tokenTracker.getTokens(account.index, quotaKey)` is a non-reserving read); `lib/accounts.ts:457-464` (selection explanation reads `tokensAvailable` without consuming); `lib/proactive-refresh.ts:152-175` (`Promise.all` pattern for concurrent account refresh). Pre-seed scenario 6 ("TokenBucketTracker concurrent tryConsume interleaving").

---

### [HIGH | confidence=high] OAuth callback server stores the authorization code in a single slot `server._lastCode` — concurrent logins collide with PKCE verifier mismatch

- **File**: `lib/auth/server.ts:44,71`
- **Quote**:

  ```ts
  (server as http.Server & { _lastCode?: string })._lastCode = code;
  ```

  ```ts
  const lastCode = (server as http.Server & { _lastCode?: string })._lastCode;
  ```

- **Issue**: The OAuth callback server is a module-scoped singleton on fixed port 1455 (runtime-contracts.ts `OAUTH_CALLBACK_PORT`). The code returned by the OAuth provider is stashed on `server._lastCode` — a **single string slot per server**. The server is also spawned *per-login* via `startLocalOAuthServer({ state })` (L17), so each login call creates its own server. However, port 1455 is a fixed port and a second concurrent login attempt on the same host will either (a) fail to bind (see the `.on('error', ...)` branch at L80) or (b) be accepted if the first server has already released — but the real race is within the first server: if the user opens two browser tabs pointing to the OAuth URL (common when copying the URL manually), both will hit `/auth/callback` with different codes and different states. The state check at L27 rejects only *other* states; when the initial `startLocalOAuthServer({ state: S1 })` is still in its 5-minute poll loop (L66-74) and the user retries with a *new* `createAuthorizationFlow()` producing `state: S2`, the first server still holds port 1455 and rejects S2's callback. More dangerously, the PKCE verifier is generated per `createAuthorizationFlow()` call (auth.ts:197) and bound to the code-challenge in the URL. If two parallel `createAuthorizationFlow()` calls occur (e.g. `opencode codex-add-account` invoked twice quickly), the second call's `pkce` is held by its caller while the first server is still listening. If the first browser tab submits a code and the test code exchanges it against the *second* caller's PKCE verifier (because the CLI caller holds the "wrong" verifier), the exchange fails with "PKCE mismatch". Even worse: there is no map from `state -> verifier`; the caller holds its verifier locally but there is no enforcement that the `_lastCode` observed corresponds to *this* caller's state. The poll loop at L69-74 simply returns the first code seen, regardless of which login the caller was.

- **Recommendation**: Replace `_lastCode: string` with `_codesByState: Map<string, string>` keyed by the state parameter, so each logical login exchange only reads the code attached to its own state. Add an assertion in `waitForCode` that the code returned matches the state the server was started with (it already is — but the single-slot pattern makes it brittle; the Map makes correctness structural). Additionally, reject connections on port 1455 if a login is already in-flight (hold a module-level `inflightStates: Set<string>`, reject second login with a clear "another login in progress" error). Document the single-concurrent-login constraint in `docs/troubleshooting.md` and add a test in `test/auth-server.test.ts` that simulates two concurrent `startLocalOAuthServer` calls and asserts the second errors deterministically rather than races.

- **Evidence**: Direct read of `lib/auth/server.ts:44,71`; cross-reference `lib/auth/auth.ts:196-218` (`createAuthorizationFlow` produces fresh PKCE per call; state is also fresh); `lib/runtime-contracts.ts` for fixed port 1455; pre-existing T2 MEDIUM seed on "OAuth callback `_lastCode` persistence". Pre-seed scenario 8 ("PKCE verifier collision in concurrent logins, port-1455 `_lastCode`"). See also `test/audit.race.test.ts` which lacks coverage for this case per bg_707b6648 gap analysis.

---

### [MEDIUM | confidence=high] Refresh-queue stale eviction races with the in-flight promise resolver — evicted entry still resolves later

- **File**: `lib/refresh-queue.ts:258-279`
- **Quote**:

  ```ts
  private cleanup(): void {
    const now = Date.now();
    const staleTokens: string[] = [];

    for (const [token, entry] of this.pending.entries()) {
      if (now - entry.startedAt > this.maxEntryAgeMs) {
        staleTokens.push(token);
      }
    }

    for (const token of staleTokens) {
      // istanbul ignore next -- defensive: token always exists in pending at this point (not yet deleted)
      const ageMs = now - (this.pending.get(token)?.startedAt ?? now);
      this.metrics.staleEvictions += 1;
      log.warn("Removing stale refresh entry", {
        tokenSuffix: token.slice(-6),
        ageMs,
      });
      this.pending.delete(token);
    }
    this.metrics.pending = this.pending.size;
  }
  ```

- **Issue**: `cleanup()` is called at the top of every `refresh()` (L122). When an entry has been in flight longer than `maxEntryAgeMs` (30 s default), it is evicted from `pending`. BUT the underlying promise (`entry.promise`) is not cancelled — it is still chained off the real `executeRefreshWithRotationTracking` which will later run the `finally` block at L163-167 that does `this.pending.delete(refreshToken)` and `this.cleanupRotationMapping(refreshToken)`. Sequence: (1) Caller A starts refresh, inserts `pending[tok] = entryA`. (2) Time passes; entry is evicted by Caller B's `cleanup()` call. (3) Caller C arrives, checks `pending.get(tok)` → miss → starts *new* refresh, inserts `pending[tok] = entryC`. (4) Caller A's original promise resolves and its finally deletes `pending[tok]`, which is now entryC's entry — **leaking entryC from the Map** and causing any concurrent Caller D to fire a third refresh. Duplicate token refresh calls hit OpenAI's endpoint, which will rotate the refresh token for the first success and invalidate the others, cascading into `removeAccountsWithSameRefreshToken` (accounts.ts:880-896). The `// istanbul ignore next` comment at L269 claims the token "always exists in pending at this point (not yet deleted)" — but this is only true *within* `cleanup()`, not between the iteration and the finally-block ordering issue.

- **Recommendation**: The `finally` at L164 must verify identity before deleting. Change to:

  ```ts
  } finally {
    const entry = this.pending.get(refreshToken);
    if (entry && entry.promise === promise) {
      this.pending.delete(refreshToken);
    }
    this.cleanupRotationMapping(refreshToken);
    this.metrics.pending = this.pending.size;
  }
  ```

  This ensures a stale promise whose entry has been evicted doesn't delete the replacement entry. Add a test that simulates the eviction-then-reinsert-then-resolve ordering.

- **Evidence**: Direct read of refresh-queue.ts:121-167 and 258-279; the pattern is: `try { return await promise; } finally { this.pending.delete(refreshToken); }` — deletes by *key*, not by identity. Pre-seed scenario 2 ("refresh-queue stale eviction vs in-flight promise").

---

### [MEDIUM | confidence=high] `tokenRotationMap` cleanup in the `finally` block uses key-only deletion; rotation mapping leaks on concurrent rotation

- **File**: `lib/refresh-queue.ts:164-167,179-186`
- **Quote**:

  ```ts
  } finally {
    this.pending.delete(refreshToken);
    this.cleanupRotationMapping(refreshToken);
    this.metrics.pending = this.pending.size;
  }
  ```

  ```ts
  private cleanupRotationMapping(token: string): void {
    this.tokenRotationMap.delete(token);
    for (const [oldToken, newToken] of this.tokenRotationMap.entries()) {
      if (newToken === token) {
        this.tokenRotationMap.delete(oldToken);
      }
    }
  }
  ```

- **Issue**: `cleanupRotationMapping` is called with `refreshToken` — the **input** to the refresh, not the **rotated output**. When the refresh rotates the token (L191-198), `tokenRotationMap.set(refreshToken, result.refresh)` stores the mapping `old → new`. The finally block then calls `cleanupRotationMapping(refreshToken)` which deletes `tokenRotationMap.delete(refreshToken)` — correct for the *old* token — then scans for entries whose **value** equals `refreshToken` (the input). But the new rotated token is `result.refresh`, not `refreshToken`. Any follower caller arriving *after* the finally ran will correctly not find the mapping (because both entries are deleted). However, if the rotation happens mid-flight (between `findOriginalToken` at L170 and the finally at L166), the rotation map can contain a mapping whose *value* is the newly rotated token — and `cleanupRotationMapping(newToken)` is never called, because the finally only cleans `refreshToken` (the old). This is only actually a problem when the rotated token is *itself later* passed to `refresh()` and the old entry is stale — but the cleanup of the value-side is partial. Additionally, the scan loop at L181-185 mutates `this.tokenRotationMap` while iterating it, which in ECMAScript is permitted but brittle: the delete within the loop invalidates the iterator's current entry (and entries yet to be visited if they coincide with the deleted key). Under contention (multiple concurrent rotations for different parent tokens), iteration can skip entries.

- **Recommendation**: Call `cleanupRotationMapping` with **both** `refreshToken` and the rotated output (if any). Capture `result.refresh` into a local, pass it. Also, collect keys to delete into an array first, then delete them *outside* the iteration — the idiomatic Map-delete-while-iterating pattern:

  ```ts
  const toDelete: string[] = [];
  for (const [oldToken, newToken] of this.tokenRotationMap.entries()) {
    if (oldToken === token || newToken === token) toDelete.push(oldToken);
  }
  for (const k of toDelete) this.tokenRotationMap.delete(k);
  ```

- **Evidence**: Direct read of refresh-queue.ts:121-201 and 179-186; cross-reference `executeRefreshWithRotationTracking` at L188-201 which performs the actual `tokenRotationMap.set`. Pre-seed scenario 3 ("tokenRotationMap cleanup finally-block ordering").

---

### [MEDIUM | confidence=medium] Circuit-breaker eviction during half-open state resets safety

- **File**: `lib/circuit-breaker.ts:128-143`
- **Quote**:

  ```ts
  const MAX_CIRCUIT_BREAKERS = 100;
  const circuitBreakers = new Map<string, CircuitBreaker>();

  export function getCircuitBreaker(key: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  	let breaker = circuitBreakers.get(key);
  	if (!breaker) {
  		if (circuitBreakers.size >= MAX_CIRCUIT_BREAKERS) {
  			const firstKey = circuitBreakers.keys().next().value;
  			// istanbul ignore next -- defensive: firstKey always exists when size >= MAX_CIRCUIT_BREAKERS
  			if (firstKey) circuitBreakers.delete(firstKey);
  		}
  		breaker = new CircuitBreaker(config);
  		circuitBreakers.set(key, breaker);
  	}
  	return breaker;
  }
  ```

- **Issue**: When a breaker is evicted by the "size >= MAX" rule and its key is still being used by in-flight request handlers, the *next* call to `getCircuitBreaker(sameKey)` returns a **fresh** `CircuitBreaker` with `state = "closed"` and `failures = []` — losing all accumulated state. If the evicted breaker was in `half-open` state (per `canExecute` at L46-52, which increments `halfOpenAttempts` before returning), the single half-open probe request can still be in-flight when the breaker is evicted. The next request arrives, gets a fresh breaker (state="closed", can-execute=true), bypasses the half-open bound, and makes N concurrent calls to the protected resource. This is the textbook "breaker stampede" that half-open is designed to prevent. Additionally, `Map.keys().next().value` returns the *insertion-oldest* key which may not be the least-recently-used breaker — it may in fact be an active high-traffic key that happens to have been inserted first, while stale breakers (e.g. from removed accounts) sit in the middle of the Map.

- **Recommendation**: (a) Never evict a breaker in `half-open` or `open` state — only closed breakers with `failureCount === 0` are safe to evict. Add a guard: `if (breaker.getState() !== 'closed' || breaker.getFailureCount() > 0) continue`. (b) Switch eviction from "first key" to a proper LRU by tracking `lastAccessed` timestamps on the breaker. (c) Bump `MAX_CIRCUIT_BREAKERS` — the per-account breakers plus per-family breakers plus per-endpoint breakers already approach 100 in a typical 5-account setup, so eviction is happening in steady state, not just under attack. Add a metric for evictions.

- **Evidence**: Direct read of `lib/circuit-breaker.ts:128-143` and `canExecute` at L35-55. Pre-seed scenario 5 ("circuit-breaker eviction-during-half-open").

---

### [MEDIUM | confidence=high] `incrementAuthFailures` shares a single counter across all account variants using the same refresh token

- **File**: `lib/accounts.ts:728-733`
- **Quote**:

  ```ts
  incrementAuthFailures(account: ManagedAccount): number {
  	const currentFailures = this.authFailuresByRefreshToken.get(account.refreshToken) ?? 0;
  	const newFailures = currentFailures + 1;
  	this.authFailuresByRefreshToken.set(account.refreshToken, newFailures);
  	return newFailures;
  }
  ```

- **Issue**: Two distinct race classes. (1) **Non-atomic read-modify-write**: the get-plus-1-set pattern at L729-731 is not atomic across `await`. `incrementAuthFailures` is synchronous, so two *synchronous* callers in the same tick are fine — but the callers (grep: `fetch-helpers.ts`, `refresh-queue.ts`, `accounts.ts`) can be interleaved by `await` suspensions between the call to `incrementAuthFailures` and the conditional action it triggers. More importantly, the **shared counter** key is `account.refreshToken`: multi-org variants of the same login share a single refresh token (per docstring at L737-741), so when two org variants (e.g. personal + workspace) both fail auth in parallel (during proactive-refresh's `Promise.all`), both read `N`, both set `N+1`, losing one increment. Since the counter gates "remove accounts" decisions in caller code, a real cascade (e.g. 3 consecutive failures → remove account) can be delayed by one tick, which in a tight retry loop means an extra invalid call to OpenAI per account variant. (2) **Clear-on-success collision**: `clearAuthFailures` (L743-745) and `updateFromAuth` (L765-767) both call `authFailuresByRefreshToken.delete(previousRefreshToken)`. If the success clear for the *old* refresh token runs at the same microtask as `incrementAuthFailures` for a *different* org variant using the same token, the delete can wipe the increment, causing indefinite retry.

- **Recommendation**: (a) Key the failure counter by `accountId` (and/or `organizationId`) instead of `refreshToken` — this matches the natural unit of rate-limiting decisions. (b) If keeping `refreshToken` as the key, wrap the RMW in a proper atomic helper (e.g. `getOrInit().count++`) that guarantees Map-based mutation. (c) Use a typed helper on the Map like:

  ```ts
  private bumpAuthFailures(token: string): number {
    const entry = this.authFailuresByRefreshToken.get(token);
    if (entry === undefined) {
      this.authFailuresByRefreshToken.set(token, 1);
      return 1;
    }
    const next = entry + 1;
    this.authFailuresByRefreshToken.set(token, next);
    return next;
  }
  ```

  (d) Add a property test that varies concurrent callers with varying token sets.

- **Evidence**: Direct read of `lib/accounts.ts:728-733`, docstring at L737-741 confirming shared state, `lib/accounts.ts:765-767` (delete path), `lib/accounts.ts:893` (cascaded delete). Pre-seed scenario 7 ("incrementAuthFailures shared refreshToken").

---

### [MEDIUM | confidence=medium] Proactive refresh vs on-demand refresh collision ordering

- **File**: `lib/refresh-queue.ts:121-167` and `lib/proactive-refresh.ts:92-127`
- **Quote**:

  ```ts
  async refresh(refreshToken: string): Promise<TokenResult> {
    this.cleanup();

    // Check for existing in-flight refresh (direct match)
    const existing = this.pending.get(refreshToken);
    if (existing) {
      this.metrics.deduplicated += 1;
  ```

- **Issue**: The refresh-queue's deduplication is keyed by the **refresh token string**. Proactive refresh (proactive-refresh.ts:111 `await queuedRefresh(account.refreshToken)`) and on-demand refresh inside `fetch-helpers.ts` (reactive retry) both flow through `queuedRefresh`, which is correct for deduplication. BUT: after a rotation, the *two callers* see different outcomes. Proactive refresh A starts with `tok1`, gets `tok2`, calls `applyRefreshResult` which mutates `account.refreshToken=tok2`. On-demand caller B (in a parallel request handler) reads `account.refreshToken=tok1` at the start of its retry, calls `queuedRefresh(tok1)` — which may find entry under `tok1` via `findOriginalToken` (L170) IF the first refresh is still pending, OR miss if it has cleaned up (L179-185 deletes `tok1` mapping). If it misses, Caller B starts a *second* refresh with `tok1`, which OpenAI rejects because `tok1` has been invalidated by the rotation, cascading into auth failure and possibly account removal. This is not a pure race — it is a correctness gap in cross-path coordination. `applyRefreshResult` does not inform `queuedRefresh` of the rotation in time.

- **Recommendation**: Callers should always read `account.refreshToken` *after* the caller's own proactive check, not cache it. The real fix is to centralize auth resolution: every refresh path (proactive + reactive) must go through a single `AccountManager.refreshAccount(account)` method that (a) takes the account reference, (b) reads `account.refreshToken` at call time, (c) calls `queuedRefresh`, (d) applies the result and persists synchronously (see FINDING-H2). Do not let caller code carry a stale `refreshToken` string across awaits.

- **Evidence**: Direct read of `lib/proactive-refresh.ts:96-127`, `lib/refresh-queue.ts:121-167`; grep for `queuedRefresh` call sites confirms reactive retry in fetch-helpers also uses it. Not in the pre-seed 8 but listed in the task spec as "Proactive vs on-demand refresh collision ordering".

---

### [MEDIUM | confidence=medium] Startup race: `hydrateFromCodexCli` runs async; user `auth login` during hydration overwrites in-memory state

- **File**: `lib/accounts.ts:219-276`
- **Quote**:

  ```ts
  static async loadFromDisk(authFallback?: OAuthAuthDetails): Promise<AccountManager> {
  	const stored = await loadAccounts();
  	const manager = new AccountManager(authFallback, stored);
  	await manager.hydrateFromCodexCli();
  	return manager;
  }
  ```

- **Issue**: `loadFromDisk` `await`s `hydrateFromCodexCli` before returning, which is fine for the explicit call path — but the method itself (L230-276) mutates `account.access`, `account.expires`, `account.accountId` on in-memory accounts and then calls `await this.saveToDisk()` at L272. If a user invokes `opencode auth login` while plugin init is happening (rare but possible with slow disk I/O), the login flow creates a *second* `AccountManager` via a different code path — or worse, the login-runner re-reads the storage file after the hydrate write has landed but before its own fallback is merged, producing the known "merge resurrection" issue (pre-seed T02 HIGH at login-runner.ts:338-339) triggered by a race rather than the documented `||` bug. Furthermore, `saveToDisk` at L272 is called without awaiting a prior `pendingSave` (L216) check — it assumes constructor initialization, but `hydrateFromCodexCli` is called as the **last** step of `loadFromDisk`, and if any caller starts mutating the manager between constructor return and hydrate completion (e.g. tool tests that set up a manager manually), the hydrate's `saveToDisk` can overwrite their mutations.

- **Recommendation**: (a) Make `hydrateFromCodexCli` idempotent and guarded by a `hydrated: boolean` flag, so calling it twice is a no-op. (b) Use `withAccountStorageTransaction` (storage.ts:951) inside `hydrateFromCodexCli` so the read-modify-write is atomic at the file level. (c) Document in `docs/development/ARCHITECTURE.md` that `AccountManager.loadFromDisk` must fully return before any other code touches account storage — and enforce it with a module-level `Promise<AccountManager>` cache on first access.

- **Evidence**: Direct read of `lib/accounts.ts:219-276`; cross-reference pre-existing T02 HIGH on `lib/auth/login-runner.ts:338-339` (the `||` merge path). Task spec item 5 ("Startup race: `hydrateFromCodexCli` async vs user auth login").

---

### [MEDIUM | confidence=high] Shutdown race: `runCleanup` does not know about `AccountManager.flushPendingSave`

- **File**: `lib/shutdown.ts:18-29` and `lib/accounts.ts:968-977`
- **Quote**:

  ```ts
  export async function runCleanup(): Promise<void> {
  	const fns = [...cleanupFunctions];
  	cleanupFunctions.length = 0;

  	for (const fn of fns) {
  		try {
  			await fn();
  		} catch {
  			// Ignore cleanup errors during shutdown
  		}
  	}
  }
  ```

  ```ts
  async flushPendingSave(): Promise<void> {
  	if (this.saveDebounceTimer) {
  		clearTimeout(this.saveDebounceTimer);
  		this.saveDebounceTimer = null;
  		await this.saveToDisk();
  	}
  	if (this.pendingSave) {
  		await this.pendingSave;
  	}
  }
  ```

- **Issue**: `lib/shutdown.ts` exposes `registerCleanup(fn)` (L6-9) which is the only mechanism to flush pending work on SIGINT/SIGTERM/`beforeExit`. Grepping the repo: `registerCleanup` is called only from `lib/audit.ts` and `lib/auth/server.ts`, **never from `lib/accounts.ts`**. That means on SIGINT the `AccountManager.saveDebounceTimer` is still ticking — the handler at L35-39 fires `runCleanup()` then `process.exit(0)`, but the 500 ms debounce timer is not registered, so the pending save silently dies. Worse, even if `registerCleanup(() => accountManager.flushPendingSave())` were added, the handler uses `process.exit(0)` (L37) which terminates before the sync fs.rename completes on Windows under EBUSY retry (see `renameWithWindowsRetry` at `lib/storage.ts:164-181` which retries with 10/20/40/80/160 ms backoff — up to ~310 ms, but `process.exit` does not await microtasks once `runCleanup()` resolves). `runCleanup` does `await fn()` for each registered cleanup, which *would* await `flushPendingSave` IF it were registered. Additionally, the `beforeExit` handler (L43) uses `void runCleanup()` (no await!) — it fires the cleanup but the process still exits.

- **Recommendation**: (a) In `AccountManager.loadFromDisk`, call `registerCleanup(() => this.flushPendingSave())` — the AccountManager is the primary persistence owner and must participate in shutdown. (b) Change the `beforeExit` handler to `beforeExit: async () => { await runCleanup(); }` (Node does synchronously wait for async `beforeExit` handlers if they're registered via event emitter with explicit handling). (c) Adopt the pattern used by graceful Node servers: the SIGINT handler should `await runCleanup()` *before* `process.exit(0)`, which the current handler at L35-39 does via `.finally(() => process.exit(0))` — but this still relies on `cleanupFunctions` containing the right fns.

- **Evidence**: `lib/shutdown.ts:1-50` fully; `lib/accounts.ts:968-977`; grep for `registerCleanup` → 2 hits in `lib/audit.ts` and `lib/auth/server.ts`, 0 in `lib/accounts.ts` (confirmed via symbol search). Task spec item 6 ("Shutdown race: lib/shutdown.ts flush vs debounced save").

---

### [LOW | confidence=medium] `CircuitBreaker.canExecute` increments `halfOpenAttempts` before the caller has actually executed

- **File**: `lib/circuit-breaker.ts:35-55`
- **Quote**:

  ```ts
  canExecute(): boolean {
  	const now = Date.now();

  	if (this.state === "open") {
  		if (now - this.lastStateChange >= this.config.resetTimeoutMs) {
  			this.transitionToHalfOpen(now);
  		} else {
  			throw new CircuitOpenError();
  		}
  	}

  	if (this.state === "half-open") {
  		if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
  			throw new CircuitOpenError("Circuit is half-open");
  		}
  		this.halfOpenAttempts += 1;
  		return true;
  	}

  	return true;
  }
  ```

- **Issue**: In half-open state, `canExecute` increments `halfOpenAttempts` **before** the caller has actually executed the protected operation. If the caller's call-site is `if (!breaker.canExecute()) return; await doWork();` and the `await doWork()` never runs (the caller throws between the check and the work, or the caller is cancelled), the slot is consumed without any real probe happening. Under concurrent callers, this can silently exhaust the `halfOpenMaxAttempts=1` budget without the single probe ever completing, and the breaker remains stuck. This is a consequence of the `canExecute` shape — a separate `canExecuteAndRun(fn)` method would avoid the leak.

- **Recommendation**: Rename to `tryAcquire` and require callers to call `releaseIfUnused()` on exception paths, or refactor to a `runProtected(fn)` API that owns the state transitions. Not urgent because `halfOpenMaxAttempts=1` and the state auto-transitions on next recorded outcome; only bumped to LOW.

- **Evidence**: Direct read; no caller audit performed beyond identifying the API shape. Not in the pre-seed 8.

---

### [LOW | confidence=low] `shutdownRegistered` boolean is not atomic across cluster-mode

- **File**: `lib/shutdown.ts:4-9,31-46`
- **Quote**:

  ```ts
  const cleanupFunctions: CleanupFn[] = [];
  let shutdownRegistered = false;

  export function registerCleanup(fn: CleanupFn): void {
  	cleanupFunctions.push(fn);
  	ensureShutdownHandler();
  }
  ```

- **Issue**: `shutdownRegistered` guards against double-registering the process-signal handler. On a single-threaded Node process this is fine (the `if (shutdownRegistered) return;` at L32 runs before the assignment at L33, same tick). But if the plugin is loaded multiple times (e.g. OpenCode hot-reload during development, or nested worker threads), the module-level boolean does not synchronize across module instances. This is a theoretical concern only; the plugin is not documented to support worker threads.

- **Recommendation**: Document the single-import assumption in a JSDoc above `ensureShutdownHandler` and add a no-op if `process.listenerCount('SIGINT')` is already above some threshold.

- **Evidence**: Direct read. Not in pre-seed 8.

---

## Summary Count by Severity

- **CRITICAL**: 0
- **HIGH**: 4 (debounced-save data loss on crash; applyRefreshResult persists via debounce; TokenBucket tryConsume non-atomic; OAuth `_lastCode` single-slot PKCE collision)
- **MEDIUM**: 7 (refresh-queue stale eviction identity-check; tokenRotationMap key-only delete + iterator mutation; circuit-breaker eviction during half-open; incrementAuthFailures shared-token counter; proactive vs on-demand refresh coordination; startup hydrate race; shutdown registerCleanup gap)
- **LOW**: 2 (canExecute pre-increment leak; shutdownRegistered not cross-instance-atomic)

**Total findings**: 13. All 8 pre-seeded race scenarios addressed with concrete file:line evidence and recommendations. One finding (HIGH-2, applyRefreshResult) cross-references the T02 security seed; deferred to T02 for credential-leakage aspects, retained here for the **concurrency-race** aspect (the timing window).

## Notes

- `test/audit.race.test.ts` exists (pre-seed gap analysis bg_707b6648) but lacks coverage for: (a) FINDING-H1 (SIGKILL mid-debounce), (b) FINDING-H3 (concurrent `tryConsume`), (c) FINDING-H4 (two browser tabs submitting codes).
- No CRITICAL findings were found. The debounced-save data-loss (FINDING-H1) and applyRefreshResult persist gap (FINDING-H2) are HIGH rather than CRITICAL because the user-visible failure is "re-login required" rather than "credential stolen" — the data loss is recoverable by re-running `opencode auth login`. If product reclassifies a forced re-login as user-hostile enough, promote FINDING-H1 and FINDING-H2 to CRITICAL.
- The `withStorageLock` chain (storage.ts:140-153) is the only real serialization primitive in the plugin. It correctly serializes **file I/O** but does *not* serialize the in-memory Maps on `AccountManager`, `TokenBucketTracker`, `CircuitBreaker`, or `RefreshQueue`. Expanding `withStorageLock`-style serialization to these hot in-memory structures would be the most impactful concurrency hardening; see T16 (refactor opportunities) for design-level recommendations.
- The task spec instructs not to propose locking primitives without specific race evidence. Each HIGH/MEDIUM finding above cites its specific race; the recommendations scope locking to just that race rather than a blanket mutex.
