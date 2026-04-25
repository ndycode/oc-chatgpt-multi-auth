/**
 * Shared helpers re-exported for codex-* tool modules.
 *
 * Shared helpers for per-file `lib/tools/*` modules
 * under `lib/tools/<name>.ts`, each tool will import its pure, closure-free
 * helpers from this barrel. Helpers that depend on the plugin closure
 * (e.g. `resolveUiRuntime`, `cachedAccountManager`, `formatCommandAccountLabel`)
 * will be threaded through a `ToolContext` factory argument once the full
 * split lands.
 *
 * See `docs/audits/07-refactoring-plan.md#rc-1` and
 * `docs/audits/13-phased-roadmap.md` §2.1.
 */

export {
	normalizeToolOutputFormat,
	renderJsonOutput,
	type ToolOutputFormat,
} from "../runtime.js";

export {
	formatRoutingValue,
	formatExplainabilitySummary,
	serializeSelectionExplainability,
	type SerializedSelectionExplainability,
	type RoutingVisibilitySnapshot,
	type SelectionSnapshot,
	type RuntimeMetrics,
} from "../runtime.js";

// Note: `toolOutputFormatSchema` and `toolSensitiveJsonSchema` cannot be
// exported from `lib/runtime.ts` because their Zod return type cannot be
// named without a path into the plugin's bundled zod copy (TS2742). They
// remain inline inside `index.ts`. Per-tool files moved out of `index.ts`
// during the next RC-1 follow-up will receive them via `ToolContext`.
