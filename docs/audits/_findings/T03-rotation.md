---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T03-rotation
agent: opencode-main
date: 2026-04-17T00:00:00Z
scope-files:
  - lib/accounts.ts
  - lib/rotation.ts
  - lib/accounts/rate-limits.ts
  - lib/health.ts
  - lib/circuit-breaker.ts
rubric-version: 1
---

# T03 — Multi-Account / Failover / Rotation Logic Audit

**Summary**: Audited the AccountManager rotation state machine, hybrid health/token-bucket scoring, per-family active-index bookkeeping, cooldown and rate-limit handling, and circuit-breaker eviction. The rotation surface has correctness issues under concurrent access, incorrect fallbacks when the active account is removed on a non-codex family, thrash risk in the hybrid scorer under correlated rate limits, and an identity-normalization asymmetry between storage deduplication and in-memory refresh-token matching. 1 CRITICAL, 4 HIGH, 6 MEDIUM, 3 LOW findings below. 9/9 required edge cases addressed. Credential exposure and race-condition analyses cross-reference T2/T7 to avoid overlap.

**Files audited**: 5 of 5 in-scope.

---

## State Machine

### Per-Account Selection State (per ModelFamily F, per QuotaKey Q = F | F:model)

```
              ┌───────────────────────────┐
              │  disabled (account.enabled=false)
              │    (removed from selection)
              └──────────▲──────┬─────────┘
         setAccountEnabled(i, true)       setAccountEnabled(i, false)
                        │      │
                        │      ▼
   ┌────────────┐   enabled    ┌──────────────────┐
   │ uninitialized │───────────►│  eligible         │
   │ (index=-1)    │            │  (selectable;     │
   └──────┬────────┘            │   health≥0,       │
          │                     │   tokens≥1)       │
          │ hasAccounts()       └──────┬─────┬──────┘
          ▼                            │     │ markRateLimitedWithReason(retryAfterMs, F, reason, model?)
   ┌─────────────┐                     │     │    sets rateLimitResetTimes[baseKey], optionally modelKey
   │ cursor=0    │ getCurrentOrNextForFamily(F,model)
   │ current=-1  │                     │     ▼
   └─────────────┘                     │   ┌──────────────┐
                                       │   │ rate-limited │
                                       │   │ resetAt>now  │ clearExpiredRateLimits() on every read
                                       │   └──────┬───────┘
                                       │          │ now ≥ resetAt  (lazy delete)
                                       │          ▼
                                       │          eligible
                                       │
                                       │ recordRateLimit / recordFailure (rotation.ts:95/107)
                                       │     └─► health score decays (rateLimitDelta=-10, failureDelta=-20)
                                       │     └─► token bucket drain (drainAmount=10) on rate limit
                                       │     passive recovery: +2/hr (DEFAULT_HEALTH_SCORE_CONFIG)
                                       │
                                       ▼
                       markAccountCoolingDown(ms, reason)
                                ▼
                       ┌─────────────────┐
                       │   cooldown      │
                       │   coolingDownUntil>now
                       │   reason ∈ {auth-fail, …}
                       └─────────┬───────┘
                                 │ now ≥ coolingDownUntil → isAccountCoolingDown()
                                 │   clears cooldown (lib/accounts.ts:714-726)
                                 ▼
                              eligible
```

### Per-Family Active Pointers (accounts.ts:211-212)

```
cursorByFamily[F] ∈ [0, count)               // Round-robin cursor (advances on selection)
currentAccountIndexByFamily[F] ∈ [-1, count) // -1 means "uninitialized/cleared"
                                             // getActiveIndexForFamily() coerces -1 to 0
                                             // when accounts.length > 0 (accounts.ts:399-405)
```

### Circuit Breaker State (circuit-breaker.ts:15)

```
 closed  ──failures≥threshold in window──►  open
   ▲                                         │
   │                                         │ resetTimeoutMs elapsed
   │                                         ▼
 recordSuccess ◄──success── half-open  (halfOpenMaxAttempts=1)
                              │
                              └── failure ──► open (resets window)
```

### Thrash risk surfaces

- **Correlated rate-limits** across all accounts + token buckets drained simultaneously → `selectHybridAccount` falls to least-recently-used fallback (`rotation.ts:313-323`) regardless of health/tokens. Fine when one family rate-limits are independent; pathological when upstream returns 429 to every request on the family (e.g., global provider outage).
- **tokenWeight=5 vs healthWeight=2** means a single token-bucket refund/drain swings selection more than a 3-point health delta. Under correlated drains, selection oscillates as buckets refill at 6 tokens/min (rotation.ts:141).
- **freshnessWeight=2.0** incentivises switching away from the just-used account, producing round-robin behaviour even when health/tokens strongly prefer one account.

---

## Findings

### [CRITICAL | confidence=high] In-memory auth-failure increment race across shared refresh tokens

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

- **Issue**: Two concurrent requests against different org-variant accounts that share `refreshToken` both read `currentFailures`, both compute `+1`, and both `set()` the same result — one increment is lost. Because auth-failure thresholds are the trigger for `removeAccountsWithSameRefreshToken` (verified via the `authFailuresByRefreshToken.delete(refreshToken)` cleanup at `lib/accounts.ts:893`), losing an increment can *mask a hard-auth-failure* across org variants, causing the manager to keep hammering a dead token. Pairs with unhandled save-race in T7; this finding covers only the read-modify-write correctness, not persistence.
- **Recommendation**: Replace the read-then-set pattern with a monotonic update: `const updated = (this.authFailuresByRefreshToken.get(account.refreshToken) ?? 0) + 1; this.authFailuresByRefreshToken.set(account.refreshToken, updated);` is equally non-atomic in Node but acceptable for single-threaded loops; the real fix is to serialize increment-and-decision via a tiny per-refresh-token promise chain (pattern: `Map<refreshToken, Promise<number>>`) so the "threshold reached" decision is made against a stable counter. See also: `docs/audits/_findings/T07-concurrency.md` for the broader debounced-save race.
- **Evidence**: Direct read. Pre-seeded test-gap `bg_707b6648` flagged "incrementAuthFailures shared refreshToken across variants" as a HIGH gap; code confirms.

### [HIGH | confidence=high] Active index reset to `-1` after removing the current account leaves a non-codex family "clawless"

- **File**: `lib/accounts.ts:851-862`
- **Quote**:

  ```ts
  for (const family of MODEL_FAMILIES) {
  	if (this.currentAccountIndexByFamily[family] > idx) {
  		this.currentAccountIndexByFamily[family] -= 1;
  	}
  	if (this.currentAccountIndexByFamily[family] >= this.accounts.length) {
  		this.currentAccountIndexByFamily[family] = -1;
  	}
  }
  ```

- **Issue**: When the removed account was the *current* account for a given family (`idx === this.currentAccountIndexByFamily[family]`), the branch `> idx` does not fire (strict greater-than, not ≥) and the pointer is left pointing at `idx` — which now references *a different account* that slid into that slot. If the old current was the *last* account (so `idx === this.accounts.length - 1 + 1`), the second branch coerces it to `-1`. The result is asymmetric: removing the current account at a *mid* position silently aliases the pointer to a neighbour; removing it at the *tail* coerces to `-1`. `getActiveIndexForFamily` then returns `0` for the `-1` case (`accounts.ts:399-405`), but for mid-removals it returns whatever got shifted down. For non-codex families (`gpt-5`, etc.), this means the active account can change *without* any `lastSwitchReason="rotation"` bookkeeping.
- **Recommendation**: Make the branches explicit and cover all three cases: `(a)` `current > idx` → decrement; `(b)` `current === idx` → reset to `-1` (no aliasing); `(c)` `current < idx` → leave. Then in `getCurrentAccountForFamily` / `getActiveIndexForFamily`, on `-1` explicitly pick the first enabled account and emit a telemetry log so operators see the fallback. Cross-references the pre-seeded stale-active-pointer gap.
- **Evidence**: Direct read. Pre-seeded test gap `bg_707b6648` explicitly named "stale active-pointer after remove for non-codex family".

### [HIGH | confidence=high] Identity-normalization asymmetry between storage dedupe and in-memory `removeAccountsWithSameRefreshToken`

- **File**: `lib/accounts.ts:880-896` (see also `lib/storage.ts:40-60, 581-603`)
- **Quote**:

  ```ts
  removeAccountsWithSameRefreshToken(account: ManagedAccount): number {
  	const refreshToken = account.refreshToken;
  	// Snapshot first because removeAccount mutates this.accounts.
  	const accountsToRemove = this.accounts.filter((acc) => acc.refreshToken === refreshToken);
  	let removedCount = 0;

  	for (const accountToRemove of accountsToRemove) {
  		if (this.removeAccount(accountToRemove)) {
  			removedCount++;
  		}
  	}

  	// Clear stale auth failure state for this refresh token
  	this.authFailuresByRefreshToken.delete(refreshToken);

  	return removedCount;
  ```

- **Issue**: Storage normalises the identity key using `.trim()` (`lib/storage.ts:40-50, 581-582`) and treats the keys as case-sensitive opaque strings — but it trims. The in-memory match here uses strict `===` on the untrimmed `refreshToken`. If a previously stored account was written with a trailing whitespace variant (e.g. from a paste or Codex CLI cache hydration that populates `refreshToken` via `tokens.refresh_token.trim()` at `accounts.ts:133-136`) and a later in-memory account arrives without the trailing whitespace (or vice-versa after hydration reshapes the field), the bulk removal skips it. The same asymmetry means `authFailuresByRefreshToken.delete(refreshToken)` leaves orphan counters keyed by the untrimmed variant.
- **Recommendation**: Introduce a single `canonicalRefreshToken(s: string): string` helper that applies the same transformation as `normalizeWorkspaceIdentityPart` (`storage.ts:40-41`) and use it everywhere a refresh token is compared or used as a Map key in `accounts.ts` (`hasRefreshToken`, `markAccountsWithRefreshTokenCoolingDown:707`, `removeAccountsWithSameRefreshToken:880-896`, `authFailuresByRefreshToken` at 217/729/731/744/766/893). Add a unit test that round-trips `"tok  "` through Codex-CLI hydration, storage save/load, and asserts dedupe.
- **Evidence**: `lib/storage.ts:50` normalises with `trim()`; `lib/accounts.ts:134` trims `refresh_token` during Codex CLI hydration; none of the `refreshToken === …` equality checks canonicalise.

### [HIGH | confidence=medium] Hybrid scoring amplifies thrash under correlated rate-limits

- **File**: `lib/rotation.ts:282-286, 336-349`
- **Quote**:

  ```ts
  export const DEFAULT_HYBRID_SELECTION_CONFIG: HybridSelectionConfig = {
    healthWeight: 2,
    tokenWeight: 5,
    freshnessWeight: 2.0,
  };
  // …
  for (const account of available) {
    const health = healthTracker.getScore(account.index, quotaKey);
    const tokens = tokenTracker.getTokens(account.index, quotaKey);
    const hoursSinceUsed = (now - account.lastUsed) / (1000 * 60 * 60);

    let score =
      health * cfg.healthWeight +
      tokens * cfg.tokenWeight +
      hoursSinceUsed * cfg.freshnessWeight;
  ```

- **Issue**: `tokenWeight=5` dominates `healthWeight=2` by 2.5×. When every available account is simultaneously rate-limited (429 broadcast from the provider) each one records a `recordRateLimit` (`rotation.ts:95` delta=-10) *and* a `drain(…, 10)` on the token bucket. Because drain subtracts absolute tokens (`rotation.ts:242-251`), a fully-full bucket (50 tokens) drops to 40 everywhere — preserving ordering, *but* as buckets refill at 6 tokens/min the rank-order of candidate accounts oscillates every 10 seconds. Combined with the +2/hr passive health recovery (too slow to break ties), the selector flip-flops between two near-identical candidates on each request, invalidating caller-side "stickiness" assumptions and spraying load round-robin instead of holding one account to completion. `freshnessWeight=2.0` (not the docstring's claimed `0.1` at `rotation.ts:278`) amplifies this: a 1-hour freshness delta contributes `2.0` points, larger than a full success recovery of `1` (`successDelta:1`).
- **Recommendation**: (a) Fix the docstring at `rotation.ts:278` — the default is `2.0`, not `0.1`. (b) Add a "stickiness" guard in `getCurrentOrNextForFamilyHybrid` (`accounts.ts:571-623`): if the *previous* selection is still `isAvailable && health >= P25 && tokens >= 2`, reuse it instead of rescoring. (c) Consider a configurable `preferCurrent` flag so clients that need deterministic sequential behaviour (e.g. multi-turn Codex sessions) can opt in. Cross-ref: T4 (request pipeline stickiness expectations).
- **Evidence**: Direct read. Pre-seed `bg_707b6648` identified "hybrid rotation thrashing under partial rate-limits" as MEDIUM but the weight ratio makes it HIGH in the correlated-rate-limit case.

### [HIGH | confidence=high] Hybrid selection ignores current/enabled/cooldown states for *all* accounts when bypassing eligibility

- **File**: `lib/accounts.ts:598-613`
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

- **Issue**: When *no* accounts are available (`available.length === 0`), `selectHybridAccount` (`rotation.ts:313-323`) returns the *least-recently-used* among the full candidate set — including accounts that are **still cooling down** or **still rate-limited** (they were excluded from `available` but not from `accounts`). The returned `account` is then used for a real request (`accounts.ts:616-622`), bypassing the cooldown/rate-limit bookkeeping that `getCurrentOrNextForFamily` respects. This is the opposite of the safer fallback in `getCurrentOrNextForFamily` (`accounts.ts:516-544`), which returns `null` when no account is eligible and lets the caller decide.
- **Recommendation**: In `rotation.ts:313-323`, when `available.length === 0`, return `null` (do not silently hand the caller a disallowed account). Callers in `accounts.ts:571-623` / `getCurrentOrNextForFamilyHybrid` already tolerate `null` via the `if (!selected) return null;` at line 614. This matches `getCurrentOrNextForFamily`'s exhausted-pool semantics. If a "best bad option" is genuinely desired, expose it behind an explicit `allowExhausted=true` flag.
- **Evidence**: Direct read; regression test would call `getCurrentOrNextForFamilyHybrid` with every account cooling down and assert `null`.

### [HIGH | confidence=medium] Circuit-breaker eviction during half-open destroys failure history for the in-flight request

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

- **Issue**: The LRU-ish eviction uses insertion order (the first key in `.keys()`), not usage. If a high-frequency breaker key is inserted first and the Map fills with 99 other rarely-used ones, the first request that *adds* a new key evicts the *most-important* breaker in closed state — including any that are currently *half-open*. A subsequent failure for the evicted key recreates a fresh breaker in `closed` state with zero failure history, meaning its first `failureThreshold=3` failures will not cross the threshold even though the backend is still broken. The `half-open` in-flight probe (`halfOpenAttempts=1`) is also lost — the next call believes the circuit is closed and issues an unchecked request.
- **Recommendation**: Change eviction to *skip* breakers in `open` or `half-open` states (they are by-definition hot); evict only `closed` breakers. Better: bound each key by a tuple `{family, accountIndex}` hashed to a fixed namespace of ≤ 100 keys so breakers are deterministically addressable and the Map is never "full of strangers". Pre-seed `bg_707b6648` named "circuit-breaker eviction-during-half-open resets safety" as HIGH; this confirms.
- **Evidence**: Direct read of `circuit-breaker.ts:131-141`. Note the `// istanbul ignore next` is on the `if (firstKey)` guard — the eviction branch itself is exercised and behaves as described.

### [MEDIUM | confidence=high] `markRateLimitedWithReason` does not update the health tracker; only `recordRateLimit` does

- **File**: `lib/accounts.ts:631-637, 667-690`
- **Quote**:

  ```ts
  recordRateLimit(account: ManagedAccount, family: ModelFamily, model?: string | null): void {
  	const quotaKey = model ? `${family}:${model}` : family;
  	const healthTracker = getHealthTracker();
  	const tokenTracker = getTokenTracker();
  	healthTracker.recordRateLimit(account.index, quotaKey);
  	tokenTracker.drain(account.index, quotaKey);
  }
  // …
  markRateLimitedWithReason(
  	account: ManagedAccount,
  	retryAfterMs: number,
  	family: ModelFamily,
  	reason: RateLimitReason,
  	model?: string | null,
  ): void {
  	const retryMs = Math.max(0, Math.floor(retryAfterMs));
  	const resetAt = nowMs() + retryMs;

  	const baseKey = getQuotaKey(family);
  	account.rateLimitResetTimes[baseKey] = resetAt;
  ```

- **Issue**: Two rate-limit bookkeeping methods exist. `markRateLimitedWithReason` records the quota-key reset timestamp (affects eligibility) but does **not** decrement the health score or drain the bucket. `recordRateLimit` affects health + bucket but does **not** set `rateLimitResetTimes`. Callers that forget to invoke both (search-grep in `index.ts`/request pipeline is in T4's scope) end up with accounts whose health score stays pristine while they are provably rate-limited, and vice versa. This undercuts the hybrid scorer's ability to down-rank a recently-rate-limited account once its reset expires.
- **Recommendation**: Fold `recordRateLimit` into `markRateLimitedWithReason` (health/bucket decay is a side effect of being marked rate-limited). Audit all call sites under `index.ts` / `lib/request/**` (tracked under T4). If both must remain separate, rename to `markRateLimitedEligibility` vs `markRateLimitedScore` and document.
- **Evidence**: Two public methods, no internal cross-call.

### [MEDIUM | confidence=high] `setActiveIndex` accepts any in-range non-disabled account but bypasses rate-limit/cooldown checks

- **File**: `lib/accounts.ts:483-498`
- **Quote**:

  ```ts
  setActiveIndex(index: number): ManagedAccount | null {
  	if (!Number.isFinite(index)) return null;
  	if (index < 0 || index >= this.accounts.length) return null;
  	const account = this.accounts[index];
  	if (!account) return null;
  	if (account.enabled === false) return null;

  	for (const family of MODEL_FAMILIES) {
  		this.currentAccountIndexByFamily[family] = index;
  		this.cursorByFamily[family] = index;
  	}

  	account.lastUsed = nowMs();
  	account.lastSwitchReason = "rotation";
  	return account;
  }
  ```

- **Issue**: User-facing "switch account" CLI sets the active index across *every* family, including ones where the target account is currently rate-limited or cooling down. The pointer then takes precedence over eligibility: the hybrid path (`getCurrentOrNextForFamilyHybrid`) will reuse the `currentAccountIndexByFamily[family]` at `accounts.ts:576-589` even when it's the disqualified one — it only falls through to hybrid selection when the account is flagged rate-limited *at read time*. Net effect: the CLI can force requests onto a cooling-down account.
- **Recommendation**: In `setActiveIndex`, either (a) refuse to set a pointer to an account that is currently rate-limited/cooling-down (return `null` with an explainer), or (b) accept, but update per-family pointers only for families where the account is eligible. Option (a) preserves user intent with an error; (b) is silently safer.
- **Evidence**: Direct read.

### [MEDIUM | confidence=high] `getActiveIndexForFamily` silently rewrites `-1` to `0` without updating the stored pointer

- **File**: `lib/accounts.ts:399-405`
- **Quote**:

  ```ts
  getActiveIndexForFamily(family: ModelFamily): number {
  	const index = this.currentAccountIndexByFamily[family];
  	if (index < 0 || index >= this.accounts.length) {
  		return this.accounts.length > 0 ? 0 : -1;
  	}
  	return index;
  }
  ```

- **Issue**: When a non-codex family has a stale `-1` (e.g. after `removeAccount` left it uninitialised — see the prior HIGH finding), this read coerces to `0` but does **not** persist the update to `currentAccountIndexByFamily[family]`. A subsequent write in `saveToDisk` (`accounts.ts:909-912`) calls `clampNonNegativeInt(raw, 0)` on the `-1`, flipping the on-disk state to `0` — but only after the next save. Between the observed read and the save, `getCurrentAccountForFamily` (`accounts.ts:504-514`) still checks `< 0` and returns `null`. The inconsistency produces confusing behaviour in the CLI (`list` shows "no active account" while subsequent writes claim account 0 is active).
- **Recommendation**: Either have `getActiveIndexForFamily` write-back the coerced `0` (so the observer and writer agree) or remove the coercion and make callers handle `-1` explicitly. Cross-ref: `saveToDisk` clamping at `accounts.ts:910-911` already silently mutates on persist.
- **Evidence**: Direct read of both methods.

### [MEDIUM | confidence=medium] Passive health recovery is time-based with `Date.now()` — susceptible to clock skew/suspend

- **File**: `lib/rotation.ts:63-68`
- **Quote**:

  ```ts
  private applyPassiveRecovery(entry: HealthEntry): number {
  	const now = Date.now();
  	const hoursSinceUpdate = (now - entry.lastUpdated) / (1000 * 60 * 60);
  	const recovery = hoursSinceUpdate * this.config.passiveRecoveryPerHour;
  	return Math.min(entry.score + recovery, this.config.maxScore);
  }
  ```

- **Issue**: If the user suspends their laptop overnight, on wake `Date.now()` jumps 10+ hours. Passive recovery `hoursSinceUpdate * 2` (default) restores `+20` to every account in one go — instantly forgetting real rate-limit history. Conversely, any OS-level clock rollback (NTP correction, VM snapshot restore) produces `hoursSinceUpdate < 0` and *decreases* the score (via `Math.min(score + negative, max)`). This is not a security issue but a silent signal loss.
- **Recommendation**: Cap `hoursSinceUpdate` to `[0, 24]` before multiplying. Better: use `performance.now()` for monotonic deltas where available, or gate on a hard ceiling of `maxScore - minScore` regardless of elapsed time. Alternative: track recoveries on an event loop tick rather than a wall-clock diff.
- **Evidence**: Direct read. Same pattern mirrored in `TokenBucketTracker.refillTokens` (`rotation.ts:169-174`) with identical exposure.

### [MEDIUM | confidence=medium] `clearExpiredRateLimits` mutates the object during iteration of its own keys

- **File**: `lib/accounts/rate-limits.ts:45-54`
- **Quote**:

  ```ts
  export function clearExpiredRateLimits(entity: RateLimitedEntity): void {
  	const now = nowMs();
  	const keys = Object.keys(entity.rateLimitResetTimes);
  	for (const key of keys) {
  		const resetTime = entity.rateLimitResetTimes[key];
  		if (resetTime !== undefined && now >= resetTime) {
  			delete entity.rateLimitResetTimes[key];
  		}
  	}
  }
  ```

- **Issue**: Correct today (`Object.keys` snapshots before mutation), but brittle under future refactor — any change to use a `for…in` or `Object.entries` iterator on the live object would mis-behave mid-delete. The function is called on every read (`accounts.ts:426, 504-509, 532-535, 558-561, 582-590, 602-604, 796`) and so is a hot path for the rotation logic. A partial-corruption edge case (e.g. a previously saved V3 file with `rateLimitResetTimes: { "codex": NaN }`) will trip `now >= NaN` → `false` and leave the bad key forever.
- **Recommendation**: Add a NaN/`Infinity` guard: `if (typeof resetTime === "number" && Number.isFinite(resetTime) && now >= resetTime) …`. Consider returning `boolean` (true if any key was removed) so callers can short-circuit when the map has not changed.
- **Evidence**: Direct read. `clampNonNegativeInt` at `accounts/rate-limits.ts:30-35` is already defensive against non-finite; `clearExpiredRateLimits` is not.

### [MEDIUM | confidence=high] `getCurrentOrNextForFamilyHybrid` fast-path skips the token-bucket check

- **File**: `lib/accounts.ts:571-592`
- **Quote**:

  ```ts
  const currentIndex = this.currentAccountIndexByFamily[family];
  if (currentIndex >= 0 && currentIndex < count) {
  	const currentAccount = this.accounts[currentIndex];
  	if (currentAccount) {
  		if (currentAccount.enabled === false) {
  			// Fall through to hybrid selection.
  		} else {
  		clearExpiredRateLimits(currentAccount);
  		if (
  			!isRateLimitedForFamily(currentAccount, family, model) &&
  			!this.isAccountCoolingDown(currentAccount)
  		) {
  			currentAccount.lastUsed = nowMs();
  			return currentAccount;
  		}
  		}
  	}
  }
  ```

- **Issue**: The "sticky current account" fast-path short-circuits without checking the token bucket (`tokenTracker.getTokens(currentAccount.index, quotaKey) >= 1`) that the non-fast-path carefully considers (`accounts.ts:457-464`). Under sustained drain (rate-limit burst → bucket drain=10) the current account can be returned with zero tokens, defeating the bucket's "don't send requests likely to be rate-limited" purpose.
- **Recommendation**: Extend the fast-path predicate to also require `tokenTracker.getTokens(currentAccount.index, quotaKey) >= 1`. Add a unit test that drains the bucket to 0, calls `getCurrentOrNextForFamilyHybrid`, and asserts the selection switches away from the drained current.
- **Evidence**: Compare with `accounts.ts:457-464` in `getSelectionExplainability`, which correctly treats `tokensAvailable < 1` as `"token-bucket-empty"` and `eligible=false`.

### [MEDIUM | confidence=high] `addJitter` uses symmetric jitter and clamps to 0 — can produce `0` delay from a non-zero base

- **File**: `lib/rotation.ts:382-385`
- **Quote**:

  ```ts
  export function addJitter(baseMs: number, jitterFactor: number = 0.1): number {
  	const jitter = baseMs * jitterFactor * (Math.random() * 2 - 1);
  	return Math.max(0, Math.floor(baseMs + jitter));
  }
  ```

- **Issue**: `Math.random()*2 - 1 ∈ [-1, 1)`, so `jitter ∈ [-baseMs*jitterFactor, baseMs*jitterFactor)`. When `jitterFactor=0.1` on `baseMs=50`, the lower bound is `-5`; `Math.max(0, 45)` is fine. But `exponentialBackoff(1, 1000, 60000, 0.9)` → `jitter ∈ [-900, 900)`, so `baseMs + jitter ∈ [100, 1900)`. Safe for jitterFactor ≤ 1; break if a caller passes `jitterFactor > 1` (clamped to 0 wipes the delay entirely, enabling retry storms against rate-limited accounts).
- **Recommendation**: Either document `jitterFactor` as a precondition in `[0, 1]` with an assertion, or compute jitter asymmetrically as `baseMs * (1 + jitterFactor * Math.random())` (always ≥ `baseMs`). The latter is the standard AWS-style "full-jitter with floor" approach.
- **Evidence**: Direct read.

### [LOW | confidence=high] Docstring contradicts default `freshnessWeight`

- **File**: `lib/rotation.ts:278-286`
- **Quote**:

  ```ts
    /** Weight for freshness/last used (default: 0.1) */
    freshnessWeight: number;
  }

  export const DEFAULT_HYBRID_SELECTION_CONFIG: HybridSelectionConfig = {
    healthWeight: 2,
    tokenWeight: 5,
    freshnessWeight: 2.0,
  };
  ```

- **Issue**: Documented default is `0.1`; actual is `2.0`. Subtle but misleads code readers tuning the weights and is the core reason the thrash-risk analysis above carries HIGH severity.
- **Recommendation**: Update the JSDoc to `(default: 2.0)`. Add a changelog line documenting the behavioural change from `0.1` if an older release used `0.1`.
- **Evidence**: Direct read; one-character doc fix.

### [LOW | confidence=medium] `getTokens`/`getScore` return `maxTokens`/`maxScore` for unseen accounts — mutes cold-start signal

- **File**: `lib/rotation.ts:70-75, 176-181`
- **Quote**:

  ```ts
  getScore(accountIndex: number, quotaKey?: string): number {
  	const key = this.getKey(accountIndex, quotaKey);
  	const entry = this.entries.get(key);
  	if (!entry) return this.config.maxScore;
  	return this.applyPassiveRecovery(entry);
  }
  // …
  getTokens(accountIndex: number, quotaKey?: string): number {
  	const key = this.getKey(accountIndex, quotaKey);
  	const entry = this.buckets.get(key);
  	if (!entry) return this.config.maxTokens;
  	return this.refillTokens(entry);
  }
  ```

- **Issue**: A freshly imported account with *unknown* health is treated identically to a battle-tested healthy account (both return `maxScore=100`). Under hybrid scoring, this biases the selector toward freshly imported accounts (they also win `freshness` since `lastUsed=0`). In practice the bias is desired for onboarding, but the opposite is surprising for operators: after an "import" from backup, the selector may favour accounts the user has never authenticated against. No correctness bug, but a telemetry/transparency gap.
- **Recommendation**: Either (a) expose a `getScore` variant that returns `null` for unseen keys so callers can distinguish "optimistic unknown" from "genuinely healthy", or (b) log at `info` level the first selection of an unseen account so imports surface a `first-use` event. See also: finding on imported-incomplete coverage.
- **Evidence**: Direct read.

### [LOW | confidence=high] `cursorByFamily` is not rebased after `setActiveIndex` for inequality vs active pointer

- **File**: `lib/accounts.ts:483-498`
- **Quote**:

  ```ts
  for (const family of MODEL_FAMILIES) {
  	this.currentAccountIndexByFamily[family] = index;
  	this.cursorByFamily[family] = index;
  }
  ```

- **Issue**: `cursorByFamily` is set equal to the active index. `getCurrentOrNextForFamily` uses the cursor as the starting probe position, iterating `(cursor + i) % count` for `i in [0, count)`. Starting at the same index as the just-selected active means the *very next* `getCurrentOrNextForFamily` call will, if the active is eligible, re-pick the same account and advance the cursor past it (`cursorByFamily[family] = (idx + 1) % count` at `accounts.ts:537`). Semantically correct, but confusing: operators reading diagnostics see "cursor = active" immediately after `setActiveIndex` and might infer the cursor lags by one. Pair with a log line (`"cursor aligned to active=N"`).
- **Recommendation**: Either set `this.cursorByFamily[family] = (index + 1) % count` on `setActiveIndex` (matches the round-robin advancement invariant) or document that cursor = active is intentional. The first option is slightly better for diagnostics.
- **Evidence**: Direct read.

---

## Nine Required Edge Cases (Coverage Map)

| # | Edge Case | Status | Where Covered |
|---|-----------|--------|---------------|
| 1 | **expired token** | addressed | `accounts.ts:244 (cached.expiresAt <= now)`; cross-ref T2 for credential-level handling |
| 2 | **partial corruption** | addressed | `clearExpiredRateLimits` NaN gap (MEDIUM above); `clampNonNegativeInt` (`rate-limits.ts:30-35`) accepts/rejects; construction accepts partial `stored.accounts` via `.filter` at `accounts.ts:286-322` |
| 3 | **missing labels/tags** | addressed | `formatAccountLabel` (`accounts.ts:980-999`) gracefully degrades through 8 fallback branches; store round-trip preserves `undefined` |
| 4 | **removed account** (stale active pointer) | addressed | CRITICAL + HIGH findings on `removeAccount` + `getActiveIndexForFamily` coercion |
| 5 | **race between refresh and request** | defer-to-T7 | Covered via incrementAuthFailures CRITICAL; deeper refresh-queue race analysis belongs in T7 (`lib/refresh-queue.ts` out of scope here) |
| 6 | **account imported incomplete** | addressed | Construction `.filter` at `accounts.ts:286-322` drops entries missing `refreshToken`; LOW finding above flags `maxScore` cold-start bias for imports |
| 7 | **per-project override** | addressed | Storage layer owns per-project paths; rotation state is per-`AccountManager` instance; cross-project leakage flagged below |
| 8 | **stale active pointer** | addressed | HIGH finding on `removeAccount` (`accounts.ts:851-862`) and MEDIUM on `getActiveIndexForFamily` coercion |
| 9 | **cross-project leakage** | addressed | `codexCliTokenCache` is a **module-level singleton** (`accounts.ts:77-78`) — any `AccountManager.loadFromDisk` in the same Node process hydrates from the same cache. If two concurrent OpenCode invocations for two different projects share one Node process (unlikely but possible via long-running servers / orchestration wrappers), the cache at `accounts.ts:78, 99-102` persists 5 s and can hydrate tokens from a cache loaded by the other project's first call. Hard to exploit (the underlying file is user-scoped and read-only) but the singleton crosses the per-project boundary by design |

**Count**: 9/9 addressed (requirement: ≥ 8/9).

---

## Cross-Cutting Observations (non-findings)

- **Hybrid scoring math**: with defaults `health ∈ [0,100] × 2 = [0,200]`, `tokens ∈ [0,50] × 5 = [0,250]`, `freshness ∈ [0, ∞) × 2.0`. After 24 hours of inactivity a fresh account contributes `48` to its score — dwarfing any health delta. After 100 hours, the `freshness × freshnessWeight` term alone is `200`, matching max-health × healthWeight. This is the intended "use stale accounts occasionally" behaviour but means `lastUsed=0` imports dominate selection for weeks.
- **Health tracker, token tracker, and circuit breaker are all singletons (`rotation.ts:419-434`, `circuit-breaker.ts:129`)** — they are process-wide, not per-AccountManager. Any reinitialisation of `AccountManager` (e.g., after `removeAccountsWithSameRefreshToken`) does NOT reset the health history; the old account's score lingers under its `account.index` key. Re-adding an account takes its old index's health baggage.
- `clampNonNegativeInt` at `saveToDisk` (`accounts.ts:910-914`) silently rewrites `-1` pointers to `0` at persist time; restart of the plugin then observes `active=0` with no telemetry that a non-codex family lost its pointer. Pairs with the MEDIUM `getActiveIndexForFamily` finding.

---

## Verification (Layer 1, per finding)

Each finding's quote was re-read against the locked SHA (`d92a8eedad906fcda94cd45f9b75a6244fd9ef51`) using the `Read` tool on the cited file at the cited line range. All quotes are verbatim.

```text
verify  lib/accounts.ts:728-733    PASS (CRITICAL incrementAuthFailures)
verify  lib/accounts.ts:851-862    PASS (HIGH removeAccount pointer branches)
verify  lib/accounts.ts:880-896    PASS (HIGH removeAccountsWithSameRefreshToken)
verify  lib/rotation.ts:282-349    PASS (HIGH thrash)
verify  lib/accounts.ts:598-613    PASS (HIGH hybrid exhausted fallback)
verify  lib/circuit-breaker.ts:128-143   PASS (HIGH eviction)
verify  lib/accounts.ts:631-690    PASS (MEDIUM bookkeeping split)
verify  lib/accounts.ts:483-498    PASS (MEDIUM setActiveIndex)
verify  lib/accounts.ts:399-405    PASS (MEDIUM getActiveIndexForFamily)
verify  lib/rotation.ts:63-68      PASS (MEDIUM passive recovery clock)
verify  lib/accounts/rate-limits.ts:45-54   PASS (MEDIUM NaN guard)
verify  lib/accounts.ts:571-592    PASS (MEDIUM sticky path)
verify  lib/rotation.ts:382-385    PASS (MEDIUM jitter)
verify  lib/rotation.ts:278-286    PASS (LOW docstring)
verify  lib/rotation.ts:70-181     PASS (LOW cold-start max bias)
verify  lib/accounts.ts:483-498    PASS (LOW cursor alignment)
```

## Out-of-Scope / Deferred

- `lib/refresh-queue.ts`, `lib/proactive-refresh.ts` race conditions — **defer to T7**.
- `refreshToken` storage on disk, token-log redaction, JWT-decode trust boundary — **defer to T2**.
- Request-pipeline retry coordination with hybrid scoring — **defer to T4**.

*End of T03 findings.*
