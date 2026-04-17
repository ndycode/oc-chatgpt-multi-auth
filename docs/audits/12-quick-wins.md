> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# 12 — Quick Wins

**Scope**: 10-20 high-ROI changes, each ≤ 2 hours, that deliver visible quality, safety, or DX payoff independently. Sorted by urgency × impact / effort.

Every entry names the ledger id (so the context can be retrieved) and the tag **Quick (<1h)** or **Short (1-4h)**.

---

## Safety & correctness

1. **Fix CRITICAL auth-failure race** — `lib/accounts.ts:728-733`. Add a per-refresh-token promise chain serializing read-modify-write. Ledger `47`. **Short (1-4h)** including the test from §10 #1.
2. **Flush debounced save on SIGINT/SIGTERM** — `lib/shutdown.ts`. Call `flushPendingSave(1500ms)` in `runCleanup`. Ledger `95`, `130`. **Short**.
3. **Swap destructive defaults to safe-by-default** — `importAccounts(backupMode: 'timestamped')`, `exportAccounts(force: false)`, `codex-remove(confirm: true)`. Ledger `17`, `175`, `176`, `177`. **Quick (<1h)** (three 1-line changes + test updates).
4. **Align OAuth redirect URI** — `lib/auth/auth.ts:12` → use `OAUTH_CALLBACK_LOOPBACK_HOST` constant. Ledger `3`, `23`. **Quick**.
5. **Extend `TOKEN_PATTERNS` for OpenAI opaque refresh format** — `lib/logger.ts:29-34` + regression test. Ledger `37`, `151`, `271`. **Quick**.

## DX & user trust

6. **Add `NO_COLOR` + `FORCE_COLOR` support** — `lib/ui/ansi.ts`. ~10-line patch. Ledger `221`. **Quick**.
7. **Exact-match `codex-help --topic`** — `index.ts:4992-5006`. Add "did you mean" on miss. Ledger `223`. **Quick**.
8. **Installer diff preview (dry-run)** — `scripts/install-oc-codex-multi-auth-core.js`. Print the JSON diff before write; require `--yes` or interactive confirm. Ledger `202`, `206`. **Short**.
9. **Diagnostics snapshot export** — wire `codex-doctor --snapshot` to emit redacted JSON. Ledger `181`. **Short** (F4).
10. **`codex-disable` as reversible alternative to `codex-remove`** — one new tool. Ledger `175`. **Quick** (F8).

## CI / OSS readiness

11. **Add CI workflow (typecheck / lint / test / build)** — `.github/workflows/ci.yml`. Matrix Node 18/20/22. Ledger `290`. **Short**.
12. **Add Dependabot config** — `.github/dependabot.yml` for `npm` + `github-actions`. Ledger `292` pre-verification. **Quick**.
13. **Add OpenSSF Scorecard workflow** — `.github/workflows/scorecard.yml`. Ledger `293` pre-verification. **Quick**.
14. **Keep-a-Changelog migration** — `CHANGELOG.md`. Ledger `294`. **Short**.
15. **README status badges** — CI + Scorecard + License. Ledger `297`. **Quick**.

## Cleanups

16. **Delete dead `_lastCode` slot** — or add a `Map<state, authorizationCode>` to support parallel logins. See RC-5 decision. **Quick** (delete path) or **Short** (map path).
17. **UTC backup timestamps** — `lib/storage.ts:1203-1212`. DST-safe ordering. Ledger `116`. **Quick**.
18. **Typed refresh-queue log field** — mask `tokenSuffix` behind `TOKEN_PATTERNS`. Ledger `43`. **Quick**.

## Docs

19. **Doc-drift cleanup batch** — README repo link, issue-template URL, `FORCE_INTERACTIVE_MODE` doc, TUI parity badges, ARCHITECTURE v6.0.0 note. Ledger `12`, `240`, `241`, `242`, `299`. **Short**.

## Testing

20. **Promote inline test fixtures to files** — migrate 6 high-traffic inline fixtures to `test/fixtures/*.json`. Ledger `251`, `268`. **Short**.

---

## Batch suggestions

- **PR #1 "Safety-first"**: items 1-5. Cross-cutting but each piece is small. Land within a single milestone.
- **PR #2 "DX baseline"**: items 6-10. Mostly user-visible.
- **PR #3 "CI/OSS"**: items 11-15. All YAML + docs.
- **PR #4 "Cleanup"**: items 16-18.
- **PR #5 "Docs + tests"**: items 19-20 plus the test-file promotions.

Estimated total elapsed effort across all 20: **≈ 2 days of focused work** for a single maintainer, or **1 day for two people working in parallel**.

See [§13-phased-roadmap.md#phase-1](13-phased-roadmap.md) for phase alignment.
