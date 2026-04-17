> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17T09:28:39Z | **Task**: T18 Synthesis | **Source**: docs/audits/_meta/findings-ledger.csv

# 11 — Developer Experience, CLI & Docs

**Scope**: consolidates T11 config/installer, T12 CLI/UI, T15 CI/release, and OSS-readiness items. This chapter is prescriptive — its job is to identify the user-visible and contributor-visible gaps and map each to the ledger row that confirms the gap.

---

## Command ergonomics

- **No `NO_COLOR` support** — HIGH `221`. ANSI helpers gate only on `isTTY`. See [§08-feature-recommendations.md#f2](08-feature-recommendations.md).
- **Substring `codex-help --topic` match** — HIGH `223`. Exact-match + suggestions on miss.
- **`codex-remove` without confirmation** — HIGH `175`. Pair with `codex-disable` (F8) for reversible paths.
- **`codex-doctor --fix` silent account switching** — HIGH `224` (deduped behind `223`). Show diff before acting.
- **10 of 18 commands lack `--format=json`** — MEDIUM `225` pre-verification. Scriptability is blocked; ship F3.
- **`codex-export` default `force=true`** — MEDIUM `230` (deduped behind `175`). Swap default.
- **`codex-help -h / --help` unsupported** — MEDIUM `236`. Accept both and emit a consistent usage string.
- **`codex-setup` bundles two operations** — MEDIUM `229`. Split or require `--with-auth` to keep non-interactive CI paths clean.
- **Table truncation by byte length** — MEDIUM `226`. Wide-char CJK users see misaligned tables.
- **`truncateAnsi` miscounts wide chars** — MEDIUM `227`. Same family.
- **Dead `promptLoginModeFallback` branch** — LOW `232`. Delete after confirming via `ts-prune`.
- **`codex-list` legacy-mode fixed 42-char width** — LOW `244`. Use grapheme-width.

---

## Install / setup flow

- **Installer overwrites `provider.openai` wholesale** — HIGH `202`. Deep-merge; see F6.
- **Corrupt `opencode.json` silently replaced** — MEDIUM `206` (deduped behind `202`). Surface a diff; require `--force`.
- **No rollback on partial-write failure** — MEDIUM `205` (deduped). Reuse the backup path.
- **Home-dir resolver drift** — MEDIUM `203`. Installer and runtime can target different dirs on unusual HOME setups. Fix: share a single resolver.
- **Atomic-write temp suffix non-crypto** — MEDIUM `207`. Use `crypto.randomBytes(8).toString('hex')`.
- **Backup filename timestamp has ms-collision risk** — MEDIUM `208`. Append crypto random suffix; add retention policy (keep last N).
- **`mergeFullTemplate` throws on overlap without recovery hint** — MEDIUM `213`. Include the conflicting key in the error message.
- **Plugin-list normaliser misses file-path entries** — MEDIUM `209` (deduped behind `213`).
- **Cache-clear path hardcoded to `.cache/opencode`** — MEDIUM `212`. Use OS-aware `$XDG_CACHE_HOME` or `%LOCALAPPDATA%`.
- **Installer strips pinned versions** — MEDIUM `214` (deduped). Document or preserve user pin.
- **Windows-only `scripts/test-all-models.sh` + `validate-model-map.sh`** — LOW `217`, `218`. Provide PowerShell parity or document.
- **`minimal-opencode.json` omits `reasoning.encrypted_content`** — LOW `216`. Breaks multi-turn; update the sample.

---

## Docs mismatches

- **ARCHITECTURE.md describes v4.x features** — LOW `12`. v6.0.0 rebrand + per-project storage namespacing undocumented.
- **TUI_PARITY_CHECKLIST drift** — LOW `240`, `241`. "Deep probe" vs "Deep check"; missing `[cooldown]` / `[error]` badges.
- **`FORCE_INTERACTIVE_MODE` undocumented** — LOW `242`. Document in `docs/configuration.md`.
- **README has no CI / Scorecard badge** — LOW `297`.
- **Issue-template `contact_links` references stale repo** — LOW `299`. Point to `ndycode/oc-codex-multi-auth`.
- **CONTRIBUTING.md lacks local-dev setup** — LOW `300`. Add "First-time setup" section with `npm ci --ignore-scripts && npm run test`.

---

## Contributor ergonomics

- **No CI on PR** — HIGH `290`. See F9. Ship `ci.yml` matrix.
- **No release automation** — MEDIUM `291`. Manual `npm publish`. Add a release workflow triggered by tag.
- **No Dependabot config** — MEDIUM `292` pre-verification. Add `.github/dependabot.yml`.
- **No OpenSSF Scorecard** — MEDIUM `293` pre-verification. Add `scorecard.yml` workflow.
- **CHANGELOG.md non-conforming** — MEDIUM `294`. Switch to Keep-a-Changelog format.
- **CODEOWNERS is single-person catch-all** — LOW `296`. Add per-domain reviewers (auth/, request/, storage/).
- **Husky wires only pre-commit** — LOW `298`. Add `commit-msg` for Conventional Commits, `pre-push` for typecheck.
- **`.coderabbit.yaml` minimal** — LOW `301`. Add path filters + review profile.

---

## OSS readiness scorecard

| Dimension | Status | Primary ledger anchor | Action |
|---|---|---|---|
| License | ✅ MIT | — | None. |
| Code of Conduct | ✅ present | — | None. |
| Contributing guide | ⚠️ partial | `300` | Add local-dev section. |
| Security policy | ⚠️ placeholder email | `295` | Verify channel. |
| CI on PR | ❌ missing | `290` | F9. |
| Dependabot | ❌ missing | `292` | Add config. |
| Scorecard | ❌ missing | `293` | Add workflow. |
| Release automation | ❌ missing | `291` | Add workflow. |
| Badges | ⚠️ 0 of 3 | `297` | Add CI + Scorecard + License badges. |
| Release notes | ⚠️ informal | `294` | Keep-a-Changelog. |
| Issue templates | ⚠️ stale URL | `299` | Update config. |
| Pre-commit hooks | ⚠️ minimal | `298` | Extend. |

---

## Prioritised DX plan

1. **Ship F9 (CI)** — unblocks confidence in everything else.
2. **Add Dependabot + Scorecard + release workflow** — one PR each; each is < 1h.
3. **Installer deep-merge + diff preview (F6)** — highest user-visible payoff.
4. **`NO_COLOR` + `--format=json` universal (F2 + F3)** — scripting baseline.
5. **Doc drift cleanup** — batch LOW `12`, `240`, `241`, `242`, `297`, `299`, `300` into one PR.

See [§12-quick-wins.md](12-quick-wins.md) for items < 1h and [§13-phased-roadmap.md#phase-3](13-phased-roadmap.md) for calendar sequencing.
