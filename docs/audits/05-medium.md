> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# 05 — Medium-Priority Findings

**Count**: 40 of 40 cap. 28 were demoted from HIGH by T17 re-classification (see `_meta/severity-reclassifications.md`). Sorted by file, then start line. Each block names the ledger id so the full narrative can be retrieved from `docs/audits/_findings/T<NN>-<domain>.md`.

---

### [MEDIUM | confidence=high] CHANGELOG.md does not conform to Keep a Changelog format

- **File**: `CHANGELOG.md:1-22`
- **Task**: T15 (ci-release) — ledger id `294`
- **Details**: see `docs/audits/_findings/T15-ci-release.md`

### [MEDIUM | confidence=high] Metrics are process-local and volatile

- **File**: `index.ts:345-372`
- **Task**: T09 (observability) — ledger id `161`
- **Details**: see `docs/audits/_findings/T09-observability.md`

### [MEDIUM | confidence=high] toolOutputFormatSchema throws on invalid value, surfacing as opaque tool error

- **File**: `index.ts:388-392`
- **Task**: T12 (cli-ui) — ledger id `228`
- **Details**: see `docs/audits/_findings/T12-cli-ui.md`

### [MEDIUM | confidence=high] 36 unused exports + 100 unused exported types + 9 unused AuditAction enum members (knip)

- **File**: `lib/accounts.ts:38-42`
- **Task**: T16 (code-health) — ledger id `310`
- **Details**: see `docs/audits/_findings/T16-code-health.md`

### [MEDIUM | confidence=high] getActiveIndexForFamily silently rewrites -1 to 0 without updating the stored pointer

- **File**: `lib/accounts.ts:399-405`
- **Task**: T03 (rotation) — ledger id `55`
- **Details**: see `docs/audits/_findings/T03-rotation.md`

### [MEDIUM | confidence=high] setActiveIndex accepts any in-range non-disabled account but bypasses rate-limit/cooldown checks

- **File**: `lib/accounts.ts:483-498`
- **Task**: T03 (rotation) — ledger id `54`
- **Details**: see `docs/audits/_findings/T03-rotation.md`

### [MEDIUM | confidence=high] Hybrid selection ignores current/enabled/cooldown states for *all* accounts when bypassing eligibility

- **File**: `lib/accounts.ts:598-613`
- **Task**: T03 (rotation) — ledger id `51`
- **Details**: see `docs/audits/_findings/T03-rotation.md`

### [MEDIUM | confidence=high] Active index reset to -1 after removing the current account leaves a non-codex family "clawless"

- **File**: `lib/accounts.ts:851-862`
- **Task**: T03 (rotation) — ledger id `48`
- **Details**: see `docs/audits/_findings/T03-rotation.md`

### [MEDIUM | confidence=high] Identity-normalization asymmetry between storage dedupe and in-memory removeAccountsWithSameRefreshToken

- **File**: `lib/accounts.ts:880-896`
- **Task**: T03 (rotation) — ledger id `49`
- **Details**: see `docs/audits/_findings/T03-rotation.md`

### [MEDIUM | confidence=high] Concurrent rotate-and-save loses writes through the 500 ms debounce window â€” saveToDiskDebounced

- **File**: `lib/accounts.ts:945-966`
- **Task**: T07 (concurrency) — ledger id `120`
- **Details**: see `docs/audits/_findings/T07-concurrency.md`

### [MEDIUM | confidence=high] Audit log infrastructure present but never invoked

- **File**: `lib/audit.ts:145-176`
- **Task**: T09 (observability) — ledger id `149`
- **Details**: see `docs/audits/_findings/T09-observability.md`

### [MEDIUM | confidence=high] CODEX_AUTH_ACCOUNT_ID env override trusted verbatim with no character validation

- **File**: `lib/auth/login-runner.ts:56-71`
- **Task**: T02 (security) — ledger id `27`
- **Details**: see `docs/audits/_findings/T02-security.md`

### [MEDIUM | confidence=high] persistResolvedAccountSelection wraps original error as cause â€” downstream consumers may log the full stack (token paths leaked)

- **File**: `lib/auth/login-runner.ts:172-194`
- **Task**: T02 (security) — ledger id `28`
- **Details**: see `docs/audits/_findings/T02-security.md`

### [MEDIUM | confidence=high] Plugin config userConfig spread as Partial<PluginConfig> despite known validation errors

- **File**: `lib/config.ts:66-107`
- **Task**: T05 (type-safety) — ledger id `83`
- **Details**: see `docs/audits/_findings/T05-type-safety.md`

### [MEDIUM | confidence=high] lib/constants.ts exports both PACKAGE_NAME and PLUGIN_NAME pointing at the same string

- **File**: `lib/constants.ts:7-13`
- **Task**: T16 (code-health) — ledger id `313`
- **Details**: see `docs/audits/_findings/T16-code-health.md`

### [MEDIUM | confidence=high] Correlation ID not propagated across async task boundaries

- **File**: `lib/logger.ts:127-140`
- **Task**: T09 (observability) — ledger id `152`
- **Details**: see `docs/audits/_findings/T09-observability.md`

### [MEDIUM | confidence=high] logRequest per-request file dumps are unbounded

- **File**: `lib/logger.ts:254-291`
- **Task**: T09 (observability) — ledger id `159`
- **Details**: see `docs/audits/_findings/T09-observability.md`

### [MEDIUM | confidence=high] Parallel probe failures log only the winner

- **File**: `lib/parallel-probe.ts:118-132`
- **Task**: T09 (observability) — ledger id `163`
- **Details**: see `docs/audits/_findings/T09-observability.md`

### [MEDIUM | confidence=high] fetchAndPersistInstructions throws HTTP 304 when cache file is missing

- **File**: `lib/prompts/codex.ts:340-364`
- **Task**: T04 (request-pipeline) — ledger id `64`
- **Details**: see `docs/audits/_findings/T04-request-pipeline.md`

### [MEDIUM | confidence=high] resumeSession swallows its prompt error â†’ user sees "recovered" toast on half-recovery

- **File**: `lib/recovery.ts:222-241`
- **Task**: T10 (error-handling) — ledger id `184`
- **Details**: see `docs/audits/_findings/T10-error-handling.md`

### [MEDIUM | confidence=high] Recovery toast failure is silently swallowed

- **File**: `lib/recovery.ts:382-390`
- **Task**: T10 (error-handling) — ledger id `187`
- **Details**: see `docs/audits/_findings/T10-error-handling.md`

### [MEDIUM | confidence=high] MESSAGE_STORAGE and PART_STORAGE are module-level constants resolved once at import time; changing XDG_DATA_HOME or APPDATA at runtime has no effect, blocking test isolation and multi-user-per-session scenarios

- **File**: `lib/recovery/constants.ts:14-26`
- **Task**: T06 (filesystem) — ledger id `112`
- **Details**: see `docs/audits/_findings/T06-filesystem.md`

### [MEDIUM | confidence=high] Recovery storage readers silently discard corruption

- **File**: `lib/recovery/storage.ts:62-87`
- **Task**: T10 (error-handling) — ledger id `183`
- **Details**: see `docs/audits/_findings/T10-error-handling.md`

### [MEDIUM | confidence=high] prependThinkingPart reuses a fixed file id, so calling it twice overwrites the first synthetic part and produces silent double-write with no audit

- **File**: `lib/recovery/storage.ts:243-266`
- **Task**: T06 (filesystem) — ledger id `101`
- **Details**: see `docs/audits/_findings/T06-filesystem.md`

### [MEDIUM | confidence=high] tokenRotationMap keys are raw refresh_token strings stored in an unbounded in-process Map

- **File**: `lib/refresh-queue.ts:85-200`
- **Task**: T02 (security) — ledger id `29`
- **Details**: see `docs/audits/_findings/T02-security.md`

### [MEDIUM | confidence=high] Refresh-queue stale eviction removes the pending entry but abandons the in-flight promise

- **File**: `lib/refresh-queue.ts:254-279`
- **Task**: T02 (security) — ledger id `30`
- **Details**: see `docs/audits/_findings/T02-security.md`

### [MEDIUM | confidence=high] Streaming path skips per-read stall timeout; only absolute fetchTimeoutMs applies

- **File**: `lib/request/fetch-helpers.ts:624-648`
- **Task**: T04 (request-pipeline) — ledger id `63`
- **Details**: see `docs/audits/_findings/T04-request-pipeline.md`

### [MEDIUM | confidence=high] parseSseStream misses response.incomplete-with-null-response JSON error extraction

- **File**: `lib/request/response-handler.ts:107-122`
- **Task**: T04 (request-pipeline) — ledger id `71`
- **Details**: see `docs/audits/_findings/T04-request-pipeline.md`

### [MEDIUM | confidence=high] addJitter uses symmetric jitter and clamps to 0 â€” can produce 0 delay from a non-zero base

- **File**: `lib/rotation.ts:382-385`
- **Task**: T03 (rotation) — ledger id `59`
- **Details**: see `docs/audits/_findings/T03-rotation.md`

### [MEDIUM | confidence=high] Graceful shutdown never flushes debounced account save; in-flight mutations are silently dropped on SIGINT/SIGTERM

- **File**: `lib/shutdown.ts:35-45`
- **Task**: T06 (filesystem) — ledger id `95`
- **Details**: see `docs/audits/_findings/T06-filesystem.md`

### [MEDIUM | confidence=high] as unknown as used to defeat V1/V3 union after migration decision

- **File**: `lib/storage.ts:651-655`
- **Task**: T05 (type-safety) — ledger id `84`
- **Details**: see `docs/audits/_findings/T05-type-safety.md`

### [MEDIUM | confidence=high] loadAccountsInternal returns null on JSON.parse failure, silently masking data loss on a truncated or corrupt accounts file

- **File**: `lib/storage.ts:810-888`
- **Task**: T06 (filesystem) — ledger id `96`
- **Details**: see `docs/audits/_findings/T06-filesystem.md`

### [MEDIUM | confidence=high] Imported accounts JSON has no schema validation before merge

- **File**: `lib/storage.ts:1231-1256`
- **Task**: T05 (type-safety) — ledger id `81`
- **Details**: see `docs/audits/_findings/T05-type-safety.md`

### [MEDIUM | confidence=high] resolvePath allows any path under cwd() or tmpdir(), which bypasses the nominal home-directory restriction when opencode is run from the user's project root

- **File**: `lib/storage/paths.ts:90-109`
- **Task**: T06 (filesystem) — ledger id `104`
- **Details**: see `docs/audits/_findings/T06-filesystem.md`

### [MEDIUM | confidence=high] Table truncation measures byte length instead of visible grapheme width

- **File**: `lib/table-formatter.ts:25-28`
- **Task**: T12 (cli-ui) — ledger id `226`
- **Details**: see `docs/audits/_findings/T12-cli-ui.md`

### [MEDIUM | confidence=high] truncateAnsi in select.ts miscounts wide and composite characters

- **File**: `lib/ui/select.ts:31-57`
- **Task**: T12 (cli-ui) — ledger id `227`
- **Details**: see `docs/audits/_findings/T12-cli-ui.md`

### [MEDIUM | confidence=high] lib/utils.ts is generically named and underused â€” isRecord + nowMs are re-defined in 4 modules

- **File**: `lib/utils.ts:1-56`
- **Task**: T16 (code-health) — ledger id `306`
- **Details**: see `docs/audits/_findings/T16-code-health.md`

### [MEDIUM | confidence=high] mergeFullTemplate throws on model-key overlap with no recovery hint

- **File**: `scripts/install-oc-codex-multi-auth-core.js:112-134`
- **Task**: T11 (config-installer) — ledger id `213`
- **Details**: see `docs/audits/_findings/T11-config-installer.md`

### [MEDIUM | confidence=high] writeFileAtomic temp-file suffix uses non-crypto randomness

- **File**: `scripts/install-oc-codex-multi-auth-core.js:163-175`
- **Task**: T11 (config-installer) — ledger id `207`
- **Details**: see `docs/audits/_findings/T11-config-installer.md`

### [MEDIUM | confidence=high] Backup filename timestamp has millisecond-collision risk and no retention policy

- **File**: `scripts/install-oc-codex-multi-auth-core.js:215-226`
- **Task**: T11 (config-installer) — ledger id `208`
- **Details**: see `docs/audits/_findings/T11-config-installer.md`

---

## Cross-cutting themes

- **Silent failure chains** (8 items): storage, recovery, and logger paths that swallow errors or downgrade fatal conditions to warnings. Aggregate impact discussed in [§09-security-trust.md#silent-failure-chains](09-security-trust.md).
- **Debounce/persistence race window** (4 items): 500 ms ``saveToDiskDebounced`` window missing flush-on-shutdown, missing on-persist, and missing on-refresh-success. See [§07-refactoring-plan.md#rc-2-storage-split](07-refactoring-plan.md).
- **Schema-validation gaps** (5 items): imports, JWT, config spread, and cross-process CLI bridge all accept unchecked JSON. See [§09-security-trust.md#auth-token](09-security-trust.md).
- **Installer file-handling** (5 items): atomic-write, backup retention, and merge-overwrite issues concentrated in ``scripts/install-oc-codex-multi-auth-core.js``. See [§11-dx-cli-docs.md#install-setup-flow](11-dx-cli-docs.md).

