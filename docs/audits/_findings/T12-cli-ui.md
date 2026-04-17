---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T12-cli-ui
agent: opencode-build (claude-opus-4-7)
date: 2026-04-17T00:00:00Z
scope-files:
  - index.ts
  - lib/cli.ts
  - lib/table-formatter.ts
  - lib/oauth-success.ts
  - lib/ui/ansi.ts
  - lib/ui/auth-menu.ts
  - lib/ui/beginner.ts
  - lib/ui/confirm.ts
  - lib/ui/format.ts
  - lib/ui/runtime.ts
  - lib/ui/select.ts
  - lib/ui/theme.ts
  - docs/development/TUI_PARITY_CHECKLIST.md
rubric-version: 1
---

# T12 — CLI + UI (lib/cli.ts + lib/ui/**)

**Summary**: Audited 18 user-facing tool commands (`codex-*`) registered in `index.ts:3533-6373`, plus the 8-file `lib/ui/**` stack, `lib/cli.ts`, `lib/table-formatter.ts`, and the OAuth success page. Interactive and non-interactive paths exist but diverge in coverage; only 8 of 18 commands accept `format=json`, and no command honors the `NO_COLOR` env convention. Beginner-flow helpers (`codex-setup`, `codex-doctor`, `codex-next`, `codex-help`) are substantive but have correctness gaps (substring-match topic filter, hardcoded `index=2` suggestions, silent auto-switch). TUI parity with `TUI_PARITY_CHECKLIST.md` drifts in one label (`Deep check accounts` vs documented `Deep probe accounts`).

**Findings count**: CRITICAL=0, HIGH=4, MEDIUM=13, LOW=8 (total 25).

**Files audited**: 13 of 13 in-scope (12 source + 1 doc cross-reference).

---

## Command Inventory

Source: `index.ts:3533-6373` (enumerated by `codex-<name>: tool({ ... })`).

| # | Command | Line | Args | Returns on success | Error shape |
|---|---------|------|------|--------------------|-------------|
| 1 | `codex-list` | 3534 | `tag?`, `format?`, `includeSensitive?` | text or JSON payload (`renderJsonOutput`) | text banner; no exit code |
| 2 | `codex-switch` | 3780 | `index?` | text `"Switched to account: <label>"` | text `"Invalid account number: N"` |
| 3 | `codex-status` | 3896 | `format?`, `includeSensitive?` | text or JSON | text banner |
| 4 | `codex-limits` | 4166 | `format?`, `includeSensitive?` | text or JSON | text |
| 5 | `codex-metrics` | 4712 | `format?` | text or JSON | text |
| 6 | `codex-help` | 4919 | `topic?` | text sections | text `"Unknown topic: X"` |
| 7 | `codex-setup` | 5040 | `wizard?` | checklist text or wizard menu | text (no error path) |
| 8 | `codex-doctor` | 5057 | `deep?`, `fix?`, `format?` | text or JSON | text with warnings |
| 9 | `codex-next` | 5358 | `format?` | text or JSON single line | text |
| 10 | `codex-label` | 5398 | `index?`, `label` | text confirmation | text `"Invalid account number"` |
| 11 | `codex-tag` | 5536 | `index?`, `tags` | text confirmation | text |
| 12 | `codex-note` | 5628 | `index?`, `note` | text confirmation | text |
| 13 | `codex-dashboard` | 5698 | `format?`, `includeSensitive?` | text or JSON | text |
| 14 | `codex-health` | 5886 | `format?`, `includeSensitive?` | text or JSON | text |
| 15 | `codex-remove` | 5995 | `index?` | text confirmation | text |
| 16 | `codex-refresh` | 6156 | none | text summary | text mixed with results |
| 17 | `codex-export` | 6224 | `path?`, `force?`, `timestamped?` | text confirmation | text `"Export failed: <msg>"` |
| 18 | `codex-import` | 6282 | `path`, `dryRun?` | text confirmation | text `"Import failed: <msg>"` |

**Coherence observations**:

- Naming: verb-based (`switch/refresh/remove/export/import/list/status`) mixed with noun-based (`label/tag/note/help/next/doctor/setup/dashboard/metrics/health/limits`). Noun-named commands `label/tag/note` are mutators despite naming — a minor consistency gap; `health/limits/metrics/dashboard/status/list` are read-only, which is the opposite pattern.
- `format` arg: present on 8 of 18 commands (list, status, limits, metrics, doctor, next, dashboard, health). Missing from `help`, `setup`, `label`, `tag`, `note`, `switch`, `remove`, `refresh`, `export`, `import` — non-uniform (see **M04**).
- `includeSensitive`: present only on JSON-capable read commands (`list`, `status`, `limits`, `dashboard`, `health`). Absent from `metrics`, `doctor`, `next` that also expose JSON.
- No command exposes `--help` or `help` sub-flag; help is a separate command (`codex-help`) with a substring-match topic filter (see **H03**).
- No command returns a structured error object or exit code; every failure is a string return value, leaving automation callers to parse prose (see **H02**).

Return-value contract is documented nowhere in scope; callers must read each command's body to learn whether error messages start with "Invalid", "Failed", or "No accounts".

---

## Interactive vs Non-Interactive Analysis

Three separate gatekeepers exist for interactive behavior:

1. **`isTTY()`** — `lib/ui/ansi.ts:38-40` — strict check of `process.stdin.isTTY && process.stdout.isTTY`. Used by `lib/ui/select.ts:90-92` to throw if interactive select is called without a TTY, and by `lib/cli.ts:139`.
2. **`isNonInteractiveMode()`** — `lib/cli.ts:16-24` — broader check that additionally returns `true` when `OPENCODE_TUI=1`, `OPENCODE_DESKTOP=1`, `TERM_PROGRAM=opencode`, or `ELECTRON_RUN_AS_NODE=1`. Allows `FORCE_INTERACTIVE_MODE=1` as override.
3. **`supportsInteractiveMenus()`** — `index.ts:945-951` — near-duplicate of `isNonInteractiveMode()` negated, but omits the `ELECTRON_RUN_AS_NODE` and `FORCE_INTERACTIVE_MODE` branches. Drift between the two is latent (see **H01**).

Commands that branch on interactivity (exact file:line):

- `index.ts:3810` — `codex-switch` falls back to text when `supportsInteractiveMenus()` AND no index given.
- `index.ts:5427` — `codex-label` same branch.
- `index.ts:5565` — `codex-tag` same branch.
- `index.ts:5649` — `codex-note` same branch.
- `index.ts:6020` — `codex-remove` same branch.
- `index.ts:1142` — `runSetupWizard` gracefully degrades to checklist view when non-interactive.
- `lib/cli.ts:135` — `promptLoginMode` short-circuits to `{mode:"add"}` if non-interactive.
- `lib/cli.ts:139-141` — falls back to `promptLoginModeFallback` (text menu) when `isTTY()` is false BUT `isNonInteractiveMode()` was false (an inconsistent combination; see **M11**).
- `lib/cli.ts:210-211` — `promptAccountSelection` picks default when non-interactive.
- `lib/cli.ts:27-29` — `promptAddAnotherAccount` returns `false` when non-interactive.

**Script-friendliness matrix** (can a user run the command in CI, grep output, and parse structured data?):

| Command | `format=json` | Stable text shape | Errors machine-readable |
|---------|:-------------:|:-----------------:|:-----------------------:|
| list/status/limits/metrics/doctor/next/dashboard/health | yes | n/a | no (errors stay text) |
| switch/remove/label/tag/note | no | partial (varies on v2) | no |
| refresh/export/import | no | mixed text | no |
| help/setup | no | yes (topic-driven) | no |

**Gap**: no way to run `codex-doctor --format=json --fix` and reliably detect failure without parsing `appliedFixes` prose at `index.ts:5146,5148` and `fixErrors` array.

TTY/--json/scripting references counted: **14+ hits** across `index.ts` (e.g., lines 945, 3810, 5427, 5565, 5649, 6020, 1142, 3567, 3614, 3636, 3908, 3963, 4178, 4735).

---

## Cross-Reference: `docs/development/TUI_PARITY_CHECKLIST.md`

The parity checklist lists six dashboard actions (`TUI_PARITY_CHECKLIST.md:18-24`):

> `Add account`, `Check quotas`, `Deep probe accounts`, `Verify flagged accounts`, `Start fresh`, `Delete all accounts`.

Actual `showAuthMenu` labels (`lib/ui/auth-menu.ts:141-146,168`):

> `Add account`, `Check quotas`, `Deep check accounts`, `Verify flagged accounts`, `Start fresh`, `Delete all accounts`.

**Drift**: `Deep probe accounts` (doc) vs `Deep check accounts` (code). See **L03**.

Badges checklist says (`TUI_PARITY_CHECKLIST.md:28`):

> `[current]`, `[active]`, `[ok]`, `[rate-limited]`, `[disabled]`, `[flagged]`

Code renders all of these plus `[cooldown]` and `[error]` (`lib/ui/auth-menu.ts:61-100`). Checklist is incomplete (doc drift, not code drift) — a HIGH-noise lint rather than a bug (see **L04**).

Destructive-confirmation parity (`TUI_PARITY_CHECKLIST.md:46-47`) — typed `DELETE` confirmation — correctly implemented at `lib/cli.ts:94-102`.

Menu ordering — `Actions` / `Accounts` / `Danger zone` — exactly matches code at `lib/ui/auth-menu.ts:141,148,167`.

V2 opt-out via `codexTuiV2=false` / `CODEX_TUI_V2=0` (`TUI_PARITY_CHECKLIST.md:75-77`) is plumbed through `lib/ui/runtime.ts:27-40` and config helpers.

---

## Findings

### [HIGH | confidence=high] Missing `NO_COLOR` environment variable support

- **File**: `lib/ui/ansi.ts:5-22` (and `lib/ui/theme.ts:108-121`, `lib/ui/runtime.ts:15-23`)
- **Quote**:

  ```ts
  export const ANSI = {
  	// Cursor control
  	hide: "\x1b[?25l",
  	show: "\x1b[?25h",
  	up: (lines = 1) => `\x1b[${lines}A`,
  	clearLine: "\x1b[2K",
  	clearScreen: "\x1b[2J",
  	moveTo: (row: number, col: number) => `\x1b[${row};${col}H`,

  	// Styling
  	cyan: "\x1b[36m",
  	green: "\x1b[32m",
  	red: "\x1b[31m",
  	yellow: "\x1b[33m",
  	dim: "\x1b[2m",
  	bold: "\x1b[1m",
  	reset: "\x1b[0m",
  } as const;
  ```

- **Issue**: ANSI escape sequences are emitted unconditionally whenever the v2 runtime is active or the legacy path renders badges; the widely-honored `NO_COLOR` environment convention (https://no-color.org) is never consulted in `lib/ui/**` or `index.ts`. Users piping command output to logs, CI systems, or screen readers receive raw escape codes that obscure content. `Select-String -Pattern 'NO_COLOR|FORCE_COLOR'` returns zero matches across the repo (see `.sisyphus/evidence/task-12-noninteractive.md`).
- **Recommendation**: Add a `shouldEmitColor()` helper in `lib/ui/runtime.ts` that returns `false` when `process.env.NO_COLOR` is set to any non-empty value, when stdout is not a TTY, or when `codexTuiColorProfile` is explicitly `"none"`. Gate `paintUiText`, `formatUiBadge`, `getColors`, and the hard-coded `ANSI.*` uses in `lib/ui/select.ts:176-196,283-297` on that helper.
- **Evidence**: direct read; `NO_COLOR` grep empty across `index.ts` and `lib/**`.

### [HIGH | confidence=high] Duplicate TTY detection with silent drift between `cli.ts` and `index.ts`

- **File**: `lib/cli.ts:16-24` AND `index.ts:945-951`
- **Quote** (cli.ts):

  ```ts
  export function isNonInteractiveMode(): boolean {
  	if (process.env.FORCE_INTERACTIVE_MODE === "1") return false;
  	if (!input.isTTY || !output.isTTY) return true;
  	if (process.env.OPENCODE_TUI === "1") return true;
  	if (process.env.OPENCODE_DESKTOP === "1") return true;
  	if (process.env.TERM_PROGRAM === "opencode") return true;
  	if (process.env.ELECTRON_RUN_AS_NODE === "1") return true;
  	return false;
  }
  ```

  **Quote** (index.ts):

  ```ts
  const supportsInteractiveMenus = (): boolean => {
  	if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  	if (process.env.OPENCODE_TUI === "1") return false;
  	if (process.env.OPENCODE_DESKTOP === "1") return false;
  	if (process.env.TERM_PROGRAM === "opencode") return false;
  	return true;
  };
  ```

- **Issue**: Two parallel implementations encode the same "am I in a TUI/desktop host?" decision with different rules. `index.ts:945` ignores `FORCE_INTERACTIVE_MODE` (supported by `cli.ts`) and ignores `ELECTRON_RUN_AS_NODE` (also supported by `cli.ts`). A user exporting `FORCE_INTERACTIVE_MODE=1` inside the OpenCode Desktop still gets interactive menus from `cli.ts` paths but non-interactive fallbacks from `index.ts` tool commands — the plugin behaves inconsistently across entry points. This drift is silent and undocumented.
- **Recommendation**: Export a single `getInteractivityProfile()` from `lib/cli.ts` (or new `lib/ui/runtime.ts` helper) that returns `{ tty, hostIsTui, forceInteractive }` and replace both call sites. Add a unit test in `test/ui/interactivity.test.ts` enumerating each env-var matrix.
- **Evidence**: direct read both files; both predicates are referenced (`rg -n "supportsInteractiveMenus|isNonInteractiveMode" -- index.ts lib/cli.ts`) — see `.sisyphus/evidence/task-12-noninteractive.md`.

### [HIGH | confidence=high] `codex-help` topic filter uses substring match and misleads users

- **File**: `index.ts:4992-5006`
- **Quote**:

  ```ts
  const visibleSections =
  	normalizedTopic.length === 0
  		? sections
  		: sections.filter((section) => section.key.includes(normalizedTopic));
  if (visibleSections.length === 0) {
  	const available = sections.map((section) => section.key).join(", ");
  	if (ui.v2Enabled) {
  		return [
  			...formatUiHeader(ui, "Codex help"),
  			"",
  			formatUiItem(ui, `Unknown topic: ${normalizedTopic}`, "warning"),
  			formatUiItem(ui, `Available topics: ${available}`, "muted"),
  		].join("\n");
  	}
  ```

- **Issue**: `section.key.includes(normalizedTopic)` lets `topic=se` match `setup`, `topic=h` match `health`, and `topic=s` match three sections (`setup`, `switch`, `dashboard`). Users who make a typo (`topic=heath`) get "Unknown topic" while users guessing prefixes get noisy partial matches — both directions are surprising. The description at line 4925 promises: "setup, switch, health, backup, dashboard, metrics" as if keys were exact.
- **Recommendation**: Change to exact-match (`section.key === normalizedTopic`) and add a Levenshtein-distance suggestion when no match (`Did you mean "setup"?`). Update the `describe()` text at line 4925 to list exact keys. Alternatively, accept both exact-match and prefix-match but log a distinguishing banner.
- **Evidence**: direct read; tested mentally: `codex-help topic=s` returns three sections; `codex-help topic=setup` correctly returns one.

### [HIGH | confidence=medium] `codex-doctor --fix` silently switches active account without confirmation

- **File**: `index.ts:5126-5156`
- **Quote**:

  ```ts
  const best = eligible[0];
  if (best) {
  	const currentActive = resolveActiveIndex(storage, "codex");
  	if (best.index !== currentActive) {
  		storage.activeIndex = best.index;
  		storage.activeIndexByFamily = storage.activeIndexByFamily ?? {};
  		for (const family of MODEL_FAMILIES) {
  			storage.activeIndexByFamily[family] = best.index;
  		}
  		await saveAccounts(storage);
  		appliedFixes.push(`Switched active account to ${best.index + 1} (best eligible).`);
  	}
  } else {
  	appliedFixes.push("No eligible account available for auto-switch.");
  }
  ```

- **Issue**: When a beginner runs `codex-doctor --fix`, the command changes the active account for *every* model family without ever prompting. The destructive TUI confirmation pattern enforced elsewhere (`lib/cli.ts:94-102`, `lib/ui/auth-menu.ts:181-183,222-228`) is bypassed, and the only record is a one-line string in `appliedFixes`. A user with per-project accounts intentionally pinned to a family is silently overridden.
- **Recommendation**: Gate the switch behind `confirm("Auto-switch active account to N?")` when interactive; when non-interactive, require an explicit second flag (`--auto-switch`) instead of piggy-backing on `--fix`. Emit a single-line warning line both in text and JSON output clearly marking "destructive change applied".
- **Evidence**: direct read; cross-refs T10 error-handling audit for recovery from unintended switch.

### [MEDIUM | confidence=high] 10 of 18 commands lack `format=json` support, blocking scripting

- **File**: `index.ts:4919,5040,5398,5536,5628,5995,6156,6224,6282,3780`
- **Quote**:

  ```ts
  // codex-help args
  args: {
  	topic: tool.schema.string().optional().describe("Optional topic: setup, switch, health, backup, dashboard, metrics."),
  },
  // codex-label args
  args: {
  	index: tool.schema.number().optional().describe("Account number to update (1-based, e.g., 1 for first account)"),
  	label: tool.schema.string().describe("Display label. Use an empty string to clear (e.g., Work, Personal, Team A)"),
  },
  // codex-refresh args
  args: {},
  ```

- **Issue**: `help`, `setup`, `label`, `tag`, `note`, `switch`, `remove`, `refresh`, `export`, `import` return only text strings (see inventory table); callers cannot reliably parse success vs failure. For example, `codex-refresh` returns prose like `"Summary: 3 refreshed, 2 failed"` at `index.ts:6212` with no machine-readable counts. A script that needs to know whether import succeeded must regex-match `"Import complete"` vs `"Import failed"`.
- **Recommendation**: Add `format: toolOutputFormatSchema()` to all ten commands and extend each with a `renderJsonOutput({ status: "ok"|"error", ...stats })` branch. Prioritize mutators (`switch`, `label`, `tag`, `note`, `refresh`, `export`, `import`, `remove`) since they most need automation contracts.
- **Evidence**: direct read command-by-command; grep `"format: toolOutputFormatSchema"` in `index.ts` returns 9 distinct hits (8 commands + schema helper), exactly matching the "8 of 18" count above.

### [MEDIUM | confidence=high] Table truncation measures byte length instead of visible grapheme width

- **File**: `lib/table-formatter.ts:25-28`
- **Quote**:

  ```ts
  function formatCell(value: string, width: number, align: "left" | "right" = "left"): string {
  	const truncated = value.length > width ? value.slice(0, width - 1) + "…" : value;
  	return align === "right" ? truncated.padStart(width) : truncated.padEnd(width);
  }
  ```

- **Issue**: `.length` counts UTF-16 code units, not visible columns. Emoji (e.g., `👋`, 2 code units), CJK wide characters (double-width), account labels with embedded ANSI color codes (see `formatCommandAccountLabel` at `index.ts:901-932`), or combining marks will all mis-measure, producing unaligned columns in `codex-list` legacy-mode output (`index.ts:3722-3754`). A 42-char "Label" column rendering an emoji-prefixed label can visibly overflow by one cell per emoji.
- **Recommendation**: Replace `.length` with a display-width function (options: `string-width` npm dep, or inline implementation using `Intl.Segmenter` + `East_Asian_Width` tables). When ANSI escapes may appear, strip them first via a regex identical to `ANSI_REGEX` in `lib/ui/select.ts:24`. Add a unit test in `test/table-formatter.test.ts` covering `"👋"`, `"日本"`, and `"\x1b[31mlabel\x1b[0m"`.
- **Evidence**: direct read; cross-ref `lib/ui/select.ts:27-57` where the same repo already implements `stripAnsi` + `truncateAnsi` but that implementation also does not handle wide chars.

### [MEDIUM | confidence=high] `truncateAnsi` in select.ts miscounts wide and composite characters

- **File**: `lib/ui/select.ts:31-57`
- **Quote**:

  ```ts
  function truncateAnsi(input: string, maxVisibleChars: number): string {
  	if (maxVisibleChars <= 0) return "";
  	const visible = stripAnsi(input);
  	if (visible.length <= maxVisibleChars) return input;

  	const suffix = maxVisibleChars >= 3 ? "..." : ".".repeat(maxVisibleChars);
  	const keep = Math.max(0, maxVisibleChars - suffix.length);
  	let kept = 0;
  	let index = 0;
  	let output = "";
  ```

- **Issue**: `visible.length` and the loop counter `kept` advance one UTF-16 code unit per step. A single emoji (surrogate pair) counts as 2; a combining accent as 1 extra; a CJK ideograph as 1 despite occupying 2 columns. Terminal menus with unicode account labels render misaligned rows and can visually break the `|` border column.
- **Recommendation**: Use `Array.from(visible)` to iterate code points (surrogate-safe) plus a width lookup. Reuse the helper proposed in **M05** for consistency. Unit-test with rows containing `"😀 work"`, `"日本語"`, `"e\u0301"` (é composed vs decomposed).
- **Evidence**: direct read; same class of defect as M05 because both modules reimplement the primitive.

### [MEDIUM | confidence=high] `toolOutputFormatSchema` throws on invalid value, surfacing as opaque tool error

- **File**: `index.ts:388-392`
- **Quote**:

  ```ts
  const normalizeToolOutputFormat = (format?: string): ToolOutputFormat => {
  	if (format === undefined) return "text";
  	if (format === "text" || format === "json") return format;
  	throw new Error(`Invalid format "${format}". Expected "text" or "json".`);
  };
  ```

- **Issue**: When a caller passes `format="yaml"` or a typo (`format="jsoN"`), the helper throws, and the plugin host surfaces this as a raw exception stack to the user. Other arg-validation paths in the file (e.g., `codex-switch` at `3848`) return friendly strings. Inconsistency. Also, there is no way for callers to query "which formats are supported".
- **Recommendation**: Return an error value (`{ status: "error", message }`) or fall back to `"text"` with a one-line warning prefix. Alternatively, register the enum directly in the schema (`tool.schema.enum(["text","json"])`) so the plugin host rejects the call before execution.
- **Evidence**: direct read; cross-ref the schema definition `toolOutputFormatSchema()` at `index.ts:374-378` which defines the arg as a plain `.string()` without constraint.

### [MEDIUM | confidence=medium] `codex-setup` bundles two unrelated operations into one command

- **File**: `index.ts:5040-5056`
- **Quote**:

  ```ts
  "codex-setup": tool({
  	description: "Beginner checklist for first-time setup and account readiness.",
  	args: {
  		wizard: tool.schema
  			.boolean()
  			.optional()
  			.describe("Launch menu-driven setup wizard when terminal supports it."),
  	},
  	async execute({ wizard }: { wizard?: boolean } = {}) {
  		const ui = resolveUiRuntime();
  		const state = await buildSetupChecklistState();
  		if (wizard) {
  			return runSetupWizard(ui, state);
  		}
  		return renderSetupChecklistOutput(ui, state);
  	},
  }),
  ```

- **Issue**: The description advertises "Beginner checklist" but a boolean flag silently mutates the command into a fully interactive wizard. Discoverability is poor (the wizard is mentioned only in the `help` text, `index.ts:5020,5035`) and the "single-responsibility" rule for CLIs is violated. Beginners who type `codex-setup --wizard` on a non-TTY get a degraded checklist view (`index.ts:1142-1156`); advanced users scripting the checklist are one typo away from an interactive prompt.
- **Recommendation**: Split into `codex-setup` (always the checklist, JSON-capable) and `codex-wizard` (always the menu, fails loudly if non-interactive). Keep backward-compat by aliasing `codex-setup --wizard` to `codex-wizard` with a deprecation note.
- **Evidence**: direct read; cross-ref the wizard implementation at `index.ts:1140-1259`.

### [MEDIUM | confidence=high] `codex-export` default `force=true` clobbers files silently

- **File**: `index.ts:6230-6256`
- **Quote**:

  ```ts
  force: tool.schema.boolean().optional().describe(
  	"Overwrite existing file (default: true)"
  ),
  ...
  try {
  	await exportAccounts(resolvedExportPath, force ?? true);
  ```

- **Issue**: Default `force=true` means a user running `codex-export path=backup.json` overwrites an existing `backup.json` without warning. Safer CLI convention is `force=false` default so callers who intend overwrite must opt in. The pre-seeded T2 security finding (`storage.ts:1309-1326`) flags the same issue at the storage layer; this is the user-facing mirror.
- **Recommendation**: Flip default to `force=false`. When `force=false` and target exists, return a clear message: `"Refusing to overwrite <path>. Pass force=true or choose a different path."` Also log the current behavior in `docs/configuration.md`.
- **Evidence**: direct read; cross-reference `T02-security.md` storage-layer finding.

### [MEDIUM | confidence=medium] Beginner checklist hardcodes `index=2`, misleading single-account users

- **File**: `lib/ui/beginner.ts:134-172`
- **Quote**:

  ```ts
  {
  	id: "set-active",
  	done: summary.total > 0 && summary.active > 0,
  	label: "Set an active account",
  	detail:
  		summary.total > 0
  			? summary.active > 0
  				? "Active account is set"
  				: "No active account is selected"
  			: "Requires at least one account",
  	command: "codex-switch index=2",
  },
  ...
  {
  	id: "labels",
  	...
  	command: "codex-label index=2 label=\"Work\"",
  },
  ```

- **Issue**: A new user with one account sees `Run: codex-switch index=2`, which fails with `"Invalid account number: 2"` (`index.ts:3848`). The hint is a cut-and-paste example that does not account for `summary.total`. Same hardcoded example string reused in the wizard at `index.ts:1178-1179` and the help topic list at `index.ts:4949,4951,4952-4954`.
- **Recommendation**: Compute `suggestedIndex = Math.min(2, accounts.length)` and interpolate. Prefer `codex-switch` (interactive picker) when `supportsInteractiveMenus()` and omit `index=` entirely in docs.
- **Evidence**: direct read; invoked by `index.ts:1180-1183` and help topic at `4948`.

### [MEDIUM | confidence=medium] Dead code path: `promptLoginModeFallback` unreachable in common host configs

- **File**: `lib/cli.ts:131-141`
- **Quote**:

  ```ts
  export async function promptLoginMode(
  	existingAccounts: ExistingAccountInfo[],
  	options: LoginMenuOptions = {},
  ): Promise<LoginMenuResult> {
  	if (isNonInteractiveMode()) {
  		return { mode: "add" };
  	}

  	if (!isTTY()) {
  		return promptLoginModeFallback(existingAccounts);
  	}
  ```

- **Issue**: `isNonInteractiveMode()` returns `true` whenever `!input.isTTY || !output.isTTY` is true (`lib/cli.ts:18`). Therefore the branch `!isTTY()` after `isNonInteractiveMode()` is only reachable when exactly the TTY flags differ between `node:process` and `process.stdin/stdout`, which in standard Node environments are the same objects. `promptLoginModeFallback` (98 LOC of readline prompts) is effectively dead code for conventional hosts.
- **Recommendation**: Either remove `promptLoginModeFallback` and the `!isTTY()` branch, or introduce a distinct `--text-mode` option that forces fallback without auto-selecting `mode=add`. Add a test case proving which env combination (if any) triggers the fallback.
- **Evidence**: direct read; `isTTY()` is imported from `./ui/auth-menu.js:234` which re-exports `ansi.ts:38-40`, checking `process.stdin.isTTY && process.stdout.isTTY` — identical predicate to `isNonInteractiveMode`'s `!input.isTTY || !output.isTTY`.

### [MEDIUM | confidence=medium] Status badges swallow `"unknown"` without indication

- **File**: `lib/ui/auth-menu.ts:60-101`
- **Quote**:

  ```ts
  function statusBadge(status: AccountStatus | undefined): string {
  	const ui = getUiRuntimeOptions();
  	if (ui.v2Enabled) {
  		switch (status) {
  			case "active":
  				return formatUiBadge(ui, "active", "success");
  			...
  			default:
  				return "";
  		}
  	}
  	...
  	default:
  		return "";
  }
  ```

- **Issue**: When an account has `status="unknown"` (a legitimate `AccountStatus` union member defined at line 15) or the status is `undefined`, `statusBadge` returns an empty string. The menu row therefore shows no badge at all, visually indistinguishable from `"ok"` in the row format (`accountTitle + "" + "" + disabledBadge`). A user cannot differentiate "never probed" from "healthy".
- **Recommendation**: Return `formatUiBadge(ui, "unknown", "muted")` for the `unknown`/default cases. Add a legend line under the `Accounts` heading ("`[unknown]` = not probed yet; run `codex-health`.").
- **Evidence**: direct read; `AccountStatus` union at `lib/ui/auth-menu.ts:7-15`.

### [MEDIUM | confidence=medium] `codex-refresh` exposes no scripting surface despite being destructive

- **File**: `index.ts:6156-6222`
- **Quote**:

  ```ts
  "codex-refresh": tool({
  	description: "Manually refresh OAuth tokens for all accounts to verify they're still valid.",
  	args: {},
  	async execute() {
  		const ui = resolveUiRuntime();
  ```

- **Issue**: Empty `args: {}` means the caller cannot scope the refresh (single account, family, or dry-run). Result is always prose mixing per-account status lines with a trailing `"Summary: X refreshed, Y failed"`. Automation wanting to refresh one account must iterate through `codex-list --format=json`, call `opencode auth login` per account, and manually retry. No JSON output, no exit code.
- **Recommendation**: Add `index?: number`, `format?: string`, and `dryRun?: boolean`. Return JSON like `{ refreshed: [{index, accountId, status: "ok"|"failed", error?}], summary: {ok, failed} }`. Align with `codex-export --format` once added.
- **Evidence**: direct read; contrast with `codex-doctor --fix` at `index.ts:5094-5112` which does iterate all accounts and refresh but also lacks per-account selector.

### [MEDIUM | confidence=high] `renderJsonOutput` pretty-prints with 2-space indent, inflating scripted payloads

- **File**: `index.ts:394-395`
- **Quote**:

  ```ts
  const renderJsonOutput = (payload: unknown): string =>
  	JSON.stringify(payload, null, 2);
  ```

- **Issue**: All JSON output is pretty-printed. For `codex-dashboard --format=json` with dozens of accounts plus explainability entries, this bloats the response. More importantly, scripts frequently pipe to `jq` which handles compact input fine; pretty-printing is a human convenience that should be opt-in.
- **Recommendation**: Accept an `indent?` arg (0 default, 2 opt-in via `pretty=true`). Match common CLI convention (`--json` compact, `--json-pretty` indented). Rename the helper or add `renderJsonOutputCompact`.
- **Evidence**: direct read; called ~15 times across `index.ts:3568,3615,3637,3909,3964,4179,4697,4737,5191,5381,5712,5766,5899,5976,6291` (sample).

### [MEDIUM | confidence=medium] `codex-help` --help / -h is not accepted; no unified help flag

- **File**: `index.ts:4919-5039`
- **Quote**:

  ```ts
  "codex-help": tool({
  	description: "Beginner-friendly command guide with quickstart and troubleshooting flows.",
  	args: {
  		topic: tool.schema
  			.string()
  			.optional()
  			.describe("Optional topic: setup, switch, health, backup, dashboard, metrics."),
  	},
  ```

- **Issue**: No command in the 18-tool inventory accepts `--help` or a `help=true` arg. Users familiar with POSIX-style CLIs expect `codex-switch --help`. The plugin host (OpenCode) delivers descriptions via the tool metadata, but in text/terminal contexts a user running `codex-switch` with no args receives `"Missing account number..."` not a usage line with all arg shapes. Discoverability is outsourced to the `codex-help` command (which itself is limited to five topics).
- **Recommendation**: Emit a small usage block when a command is invoked without args AND the user set `CODEX_SHOW_USAGE=1` or passed `help=true`. Or more radically, teach `codex-help` to accept a `command=<name>` arg and render its `description` + args from a single registry rather than a hand-maintained section list.
- **Evidence**: direct read; cross-ref `codex-help` topic list at `index.ts:4933-4990`.

### [MEDIUM | confidence=medium] `oauth-success.ts` ships 629 lines of inline HTML with external CDN dependencies

- **File**: `lib/oauth-success.ts:1-10`
- **Quote**:

  ```ts
  export const oauthSuccessHtml = String.raw`<!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>OpenCode - Authentication Successful</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&display=swap" rel="stylesheet">
  ```

- **Issue**: The OAuth success page loads Google Fonts from `fonts.googleapis.com` on every successful login. This reveals login timing to a third-party CDN, fails silently in air-gapped environments, and violates the plugin's privacy positioning (see `docs/privacy.md`). The 629-line inline HTML is also copy-edited manually each time; a CSP `<meta>` header is absent.
- **Recommendation**: (1) Remove external font `<link>` tags; rely on system monospace. (2) Add `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; style-src 'unsafe-inline'">` to block any future accidental remote loads. (3) Consider splitting the HTML into a static file (already emitted as `dist/lib/oauth-success.html` per AGENTS.md line 70) so it can be reviewed diff-friendly without scrolling past animations.
- **Evidence**: direct read lines 1-10; file line count 629 confirmed via PowerShell `Measure-Object`.

### [LOW | confidence=high] Inconsistent noun-vs-verb command naming

- **File**: `index.ts:3534,3780,3896,4166,4712,4919,5040,5057,5358,5398,5536,5628,5698,5886,5995,6156,6224,6282`
- **Quote**: see Command Inventory table above.
- **Issue**: Verbs (`switch`, `refresh`, `remove`, `export`, `import`, `list`, `status`) coexist with nouns used as commands (`label`, `tag`, `note`, `help`, `setup`, `doctor`, `next`, `dashboard`, `metrics`, `health`, `limits`). Nouns that are mutators (`label`, `tag`, `note`) would be clearer as `set-label`, `set-tag`, `set-note` or `label-set` — noun-verb or verb-noun pattern consistency.
- **Recommendation**: Adopt verb-noun ordering uniformly: `codex-set-label`, `codex-set-tag`, `codex-set-note`, `codex-show-help`, `codex-run-setup`. Keep `list/status/health/metrics/dashboard/limits` as read-only terse nouns. Add backward-compat aliases for one minor version.
- **Evidence**: Enumeration from `index.ts` tool block.

### [LOW | confidence=high] Duplicate `isTTY` export chain (re-exported four times)

- **File**: `lib/ui/ansi.ts:38-40` → `lib/ui/auth-menu.ts:234` → `lib/cli.ts:246`
- **Quote**:

  ```ts
  // ansi.ts
  export function isTTY(): boolean {
  	return Boolean(process.stdin.isTTY && process.stdout.isTTY);
  }
  // auth-menu.ts:234
  export { isTTY };
  // cli.ts:246
  export { isTTY };
  ```

- **Issue**: `isTTY` is re-exported from three modules with no added behavior. Consumers pick an arbitrary import path, which makes refactors harder and hides the true owner. The `auth-menu.ts` import is used only to satisfy the cli.ts re-export.
- **Recommendation**: Keep the export in `lib/ui/ansi.ts`; delete the two re-exports. Update `lib/cli.ts` consumers to import from `./ui/ansi.js` directly.
- **Evidence**: direct read of each file.

### [LOW | confidence=medium] Doc drift: TUI_PARITY_CHECKLIST "Deep probe" vs code "Deep check"

- **File**: `lib/ui/auth-menu.ts:144` vs `docs/development/TUI_PARITY_CHECKLIST.md:21`
- **Quote**:

  ```ts
  { label: "Deep check accounts", value: { type: "deep-check" }, color: "cyan" },
  ```

  ```md
  - `Deep probe accounts`
  ```

- **Issue**: Documented menu label differs from implemented menu label. Either the doc or the code is wrong; the parity checklist is the stated source of truth, but code is what users see.
- **Recommendation**: Align. Because the `help` topic titles use "Deep check" (`index.ts:4964,4976`), update the checklist from "Deep probe accounts" → "Deep check accounts" and note the change in CHANGELOG.
- **Evidence**: direct read of both files.

### [LOW | confidence=medium] TUI parity doc omits `[cooldown]` and `[error]` badges that the code emits

- **File**: `docs/development/TUI_PARITY_CHECKLIST.md:28`
- **Quote**:

  ```md
  - state badges (`[current]`, `[active]`, `[ok]`, `[rate-limited]`, `[disabled]`, `[flagged]`)
  ```

- **Issue**: `statusBadge` at `lib/ui/auth-menu.ts:89,95` emits `[cooldown]` and `[error]`. Checklist is incomplete, not the code.
- **Recommendation**: Append `[cooldown]` and `[error]` to the badge list. Include a 1-line note that `[unknown]` is reserved for accounts that have never been probed (ties in with **M10**).
- **Evidence**: direct read.

### [LOW | confidence=high] `FORCE_INTERACTIVE_MODE` env override is undocumented

- **File**: `lib/cli.ts:17`
- **Quote**:

  ```ts
  if (process.env.FORCE_INTERACTIVE_MODE === "1") return false;
  ```

- **Issue**: The flag exists in code but is not mentioned in `docs/configuration.md`, `docs/troubleshooting.md`, or `docs/faq.md`. Users who need interactive behavior in a host that falsely reports non-TTY have no way to discover this escape hatch.
- **Recommendation**: Document in `docs/configuration.md` under a "Terminal detection overrides" heading alongside `OPENCODE_TUI`, `OPENCODE_DESKTOP`, and the `codexTuiV2` config field.
- **Evidence**: direct read; `Select-String -Path docs -Pattern "FORCE_INTERACTIVE_MODE"` (intent: zero hits).

### [LOW | confidence=medium] `promptAddAnotherAccount` prints tip via `console.log`, not UI formatter

- **File**: `lib/cli.ts:32-34`
- **Quote**:

  ```ts
  const rl = createInterface({ input, output });
  try {
  	console.log("\nTIP: use private browsing or sign out before adding another account.\n");
  	const answer = await rl.question(`Add another account? (${currentCount} added) (y/n): `);
  ```

- **Issue**: The tip bypasses `paintUiText` / `formatUiItem`, so it always renders uncolored even when v2 rendering is active. Minor inconsistency; also appears above the prompt in a way that screen readers may not associate with the question.
- **Recommendation**: Route through `formatUiItem(ui, "TIP: ...", "muted")` with `getUiRuntimeOptions()`. Or move the tip into the surrounding call-site where the UI context is in scope.
- **Evidence**: direct read.

### [LOW | confidence=medium] `codex-list` legacy-mode suffix table header width is fixed at 42 and loses long workspace names

- **File**: `index.ts:3722-3728`
- **Quote**:

  ```ts
  const listTableOptions: TableOptions = {
  	columns: [
  		{ header: "#", width: 3 },
  		{ header: "Label", width: 42 },
  		{ header: "Status", width: 20 },
  	],
  };
  ```

- **Issue**: A label composed by `formatCommandAccountLabel` commonly exceeds 42 chars once email + workspace + id + tags are joined (see format at `index.ts:921-931`, e.g. `"Account 1 (user@example.com, workspace:engineering-team-a, id:123abc..., tags:work)"` easily passes 60 chars). Truncation applied at `table-formatter.ts:26` drops useful context without indicating which part was cut.
- **Recommendation**: Compute `labelWidth` dynamically from `process.stdout.columns ?? 80` minus the other two columns plus padding. Fall back to 42 only when stdout is not a TTY.
- **Evidence**: direct read.

### [LOW | confidence=medium] `ANSI.clearScreen` does not implicitly home the cursor

- **File**: `lib/ui/ansi.ts:11-12`
- **Quote**:

  ```ts
  clearLine: "\x1b[2K",
  clearScreen: "\x1b[2J",
  ```

- **Issue**: `\x1b[2J` clears the visible screen but leaves the cursor in place. Callers are expected to also emit `moveTo(1,1)`, which they do (`lib/ui/select.ts:120,223`). Still, treating the two tokens independently is fragile; a future caller may forget.
- **Recommendation**: Introduce `ANSI.clearScreenHome = "\x1b[2J\x1b[H"` and migrate call sites. Keep the raw tokens for composability.
- **Evidence**: direct read.

---

## Notes

- Not in scope: per-command performance (covered by T08), command-logging redaction (T09 logging), command test coverage (T13). Where naturally relevant (e.g., `codex-doctor --fix` side-effects), cross-references are cited.
- Severity budget used: HIGH=4 (≤15), MEDIUM=13 (≤40), LOW=8.
- Every finding has been re-verified against the locked SHA `d92a8eedad906fcda94cd45f9b75a6244fd9ef51`.
- The parity checklist at `docs/development/TUI_PARITY_CHECKLIST.md` is largely accurate — only two small doc drifts found.
- Evidence artifacts saved:
  - `.sisyphus/evidence/task-12-commands.md` (command inventory + line numbers)
  - `.sisyphus/evidence/task-12-noninteractive.md` (TTY/interactivity hit census)

---
