> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# 09 — Security & Trust

**Scope**: consolidates T02 security + T14 dependency findings + trust-relevant items from T06/T09/T10/T11. Cross-referenced against `SECURITY.md`, `docs/privacy.md`, and the OAuth loopback contract.

**Single-sentence posture**: the plugin handles ChatGPT OAuth tokens locally with reasonable-but-not-hardened permissions, is free of declared CVEs at the locked SHA, and ships several credential-handling defects that are defensible-in-depth but sit one accident away from escalating severity.

---

## Auth / token lifecycle

- **Plaintext tokens at rest** — `lib/storage.ts:188-209`. Tokens persist under `0o600` file mode with no envelope encryption. Ledger HIGH `13`. Risk class: local-file exfiltration (trojan, backup leak). Mitigation: use OS keychain (`keytar`) for at-rest encryption of the refresh token only; access token can stay in-memory (60-min TTL).
- **Unsigned cross-process token injection** — `lib/accounts.ts:104-155`. Codex-CLI bridges its own token state into the plugin via JSON with zero schema validation (HIGH `15`). A malicious Codex-CLI installation can inject credentials the plugin will accept. See [§07-refactoring-plan.md#rc-9](07-refactoring-plan.md).
- **Credential resurrection on merge** — `lib/auth/login-runner.ts:331-348`. Account merge uses `||` instead of `??`, so invalidated empty strings in the incoming record pick up valid tokens from the stored record (HIGH `16`). Fix: adopt `??` + explicit opt-in flag for credential carry-over.
- **Unverified JWT drives identity** — `lib/auth/auth.ts:115-130`. `accountId` / `organizationId` are lifted from a decoded-but-unverified JWT payload (HIGH-demoted-to-MEDIUM `82`). For identity routing this is workable because the server issued the JWT; for audit trails it is brittle — any token replay looks identical.
- **Silent token loss on refresh** — `lib/proactive-refresh.ts:200-215`. Rotated refresh tokens sit in the 500 ms `saveToDiskDebounced` window; a crash in that window produces a usable-in-memory token that is lost to disk (HIGH `14`). See [§07-refactoring-plan.md#rc-10](07-refactoring-plan.md).
- **In-memory auth-failure race** — `lib/accounts.ts:728-733`. The single CRITICAL finding (ledger `47`). See [§03-critical-issues.md](03-critical-issues.md).
- **OAuth loopback drift** — `REDIRECT_URI = http://localhost:1455` but the server binds `127.0.0.1` (ledger `3`, `23`). RFC 8252 §7.3 is explicit about the loopback literal; align the constants.

---

## File / storage trust boundary

- **Account dir not `0o700`** — `lib/storage.ts:894-906` / `lib/storage/paths.ts:37-45`. Account file is `0o600`; parent directory inherits umask and is typically world-readable. Ledger HIGH `100`. Mitigation: explicit `fs.mkdir(..., { mode: 0o700 })`.
- **Import/export silent overwrite** — `lib/storage.ts:1335-1394` (`importAccounts` default `backupMode: "none"`), `lib/storage.ts:1303-1326` (`exportAccounts` default `force: true`). Ledger HIGH `17`, `176`, `177`. Change defaults to safe-by-default; require explicit opt-in for destructive modes.
- **No at-rest encryption** — see "Plaintext tokens" above; complete picture is that backup files inherit the same posture.
- **Project-key collision surface** — 48-bit hash truncation in `lib/storage/paths.ts:37-45` (ledger `41`, `99`). Collision probability is small for typical users but non-zero for heavy multi-worktree use; cache a collision-resolution log or widen to 72 bits.

---

## Logging / privacy

- **Opaque refresh tokens not masked** — `lib/logger.ts:29-34`. `TOKEN_PATTERNS` matches `sk-*`-style patterns but not OpenAI opaque base64url refresh tokens (ledger `37`, `151`). High-risk defect: one errant `logger.debug(account)` leaks a refresh token verbatim.
- **Cause-chain leaks token paths** — `lib/auth/login-runner.ts:172-194`. Wrapping the original error via `cause` causes downstream `logError` implementations (console, file, JSON) to print the full file path to the token file (ledger `28`). Mitigation: strip `cause` in `logError` before serialization unless a debug env var is set.
- **Correlation-ID propagation missing** — `lib/logger.ts:127-140`. AsyncLocalStorage hand-off is not wired, so multi-account request chains lose correlation when crossing async boundaries (ledger `152`).
- **Unbounded per-request file dumps** — `lib/logger.ts:254-291`. `logRequest` writes every request to disk when enabled; no retention policy. Mitigation: size-capped rolling logs.

---

## User-trust messaging

- **Audit log promised, not delivered** — `docs/privacy.md` references audit logging; `lib/audit.ts` is dead code (HIGH `302`). Two options: wire it in (F1) or delete the promise. See [§07-refactoring-plan.md#rc-5](07-refactoring-plan.md).
- **"Recovered" toast for half-recovery** — `lib/recovery.ts:222-241`. Session-resume swallows the inner prompt error and still shows "recovered" to the user (ledger `184`). Users over-trust the toast.
- **SSE session-breaking warning** — T09 HIGH `153`. "No final response" is logged at `warn`; users see "empty response" without any tie-back.
- **Destructive defaults** — `codex-remove` without confirmation (HIGH `175`), `importAccounts(backupMode: 'none')` default, `exportAccounts(force: true)` default, installer `provider.openai` wholesale overwrite (HIGH `202`). Collective pattern: the plugin trusts users to catch their own mistakes. Re-sequence defaults to safe-by-default.

---

## Hardening steps (sorted by payoff / risk)

1. **Ship CRITICAL fix** — per-refresh-token promise chain around `incrementAuthFailures`. Tiny patch; largest security payoff. Quick (<1h).
2. **Flush-on-shutdown** — RC-10. Closes the paired debounce-crash window. Short (1-4h).
3. **Swap defaults to safe-by-default** — `importAccounts` backupMode: `"timestamped"`; `exportAccounts` force: `false`; `codex-remove` confirm: `true`. Short (1-4h).
4. **OAuth redirect alignment** — change `REDIRECT_URI` to use `OAUTH_CALLBACK_LOOPBACK_HOST`. Quick (<1h).
5. **Extend `TOKEN_PATTERNS`** — add OpenAI opaque base64url refresh-token format; add a regression test. Quick (<1h).
6. **Wire `auth-rate-limit.ts`** — into `lib/auth/server.ts` callback handler. Quick (<1h).
7. **Process-boundary validation** — RC-9. Short (1-4h).
8. **OS keychain for refresh tokens** — new dependency (`keytar` or `node-keytar-prebuild`) but isolated. Medium (1-2d). Requires discussion — violates the "no new dep" default.

---

## Supply chain

- `@openauthjs/openauth@0.4.3` ships with no declared license (HIGH `274`). Blocks corporate redistribution. See [§04-high-priority.md](04-high-priority.md).
- ESLint 10 requires Node ≥ 20 but `engines.node` claims `>=18` (ledger `277`). Tighten to `>=20`.
- Host SDK declared as hard `dependency` instead of `peerDependency` (`279`). Risks duplicate SDK at runtime; combined with `281` (duplicate zod) this is latent.
- Three pre-1.0 packages in the credential path (`285`). Budget for a yearly review.
- 6 transitive deps share one maintainer (`284`). Supply-chain concentration note; monitor via OpenSSF Scorecard (see [§11-dx-cli-docs.md](11-dx-cli-docs.md)).

---

## SECURITY.md status

- Disclosure channel is `security@opencode.ai` placeholder in `SECURITY.md` (LOW `295`). Verify the mailbox is real; otherwise move to a dedicated email or GitHub Security Advisory. Recommended: enable `https://github.com/ndycode/oc-codex-multi-auth/security/advisories/new` as the canonical report path.

---

## Residual risk statement

After the 7 hardening steps above ship, the residual risk is:

- **Plaintext tokens on disk** — mitigated by 0o700 posture; eliminated only by OS-keychain adoption (opt-in in a later release).
- **Unverified JWT for identity** — acceptable for routing, rejected for strong-identity audit (audit log records JWT fingerprint, not claims).
- **Supply chain** — monitored via Dependabot + Scorecard; weekly-at-worst review cadence.
