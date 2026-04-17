# lib/tools/

Per-tool modules for the 18 `codex-*` tools registered by the plugin.

## Status — RC-1 Phase 2 (incremental)

RC-1 (see `docs/audits/07-refactoring-plan.md#rc-1`) targets extracting every
inline tool from `index.ts` into its own file here. The current commit lands
the closure-free scaffolding — `lib/runtime.ts` holds pure helpers and types
used by every tool, and `lib/tools/_shared.ts` re-exports them — but leaves
the 18 inline tool definitions in `index.ts` for a follow-up PR.

## Target layout

```
lib/tools/
  _shared.ts              # re-exports closure-free helpers from lib/runtime.ts
  index.ts                # barrel: (ctx) => ({ "codex-list": ..., ... })
  codex-list.ts           # one file per tool
  codex-switch.ts
  codex-status.ts
  codex-limits.ts
  codex-metrics.ts
  codex-help.ts
  codex-setup.ts
  codex-doctor.ts
  codex-next.ts
  codex-label.ts
  codex-tag.ts
  codex-note.ts
  codex-dashboard.ts
  codex-health.ts
  codex-remove.ts
  codex-refresh.ts
  codex-export.ts
  codex-import.ts
```

## Factory pattern (to apply in follow-up PR)

Every tool in `index.ts` captures plugin closure state (`cachedAccountManager`,
`accountManagerPromise`, `runtimeMetrics`) and a large family of local
helpers (`resolveUiRuntime`, `formatCommandAccountLabel`,
`promptAccountIndexSelection`, …). To move them out without changing
behaviour, each tool should be rewritten as:

```ts
// lib/tools/codex-refresh.ts
import { tool } from "@opencode-ai/plugin/tool";
import type { ToolContext } from "./index.js";

export const createCodexRefreshTool = (ctx: ToolContext) =>
  tool({
    description: "…",
    args: {},
    async execute() {
      const ui = ctx.resolveUiRuntime();
      const storage = await ctx.loadAccounts();
      // …
    },
  });
```

`ToolContext` (declared in `lib/tools/index.ts`) will expose the closure
state and helpers the tools need. `index.ts` will then shrink to wiring:
build the context, call `createToolRegistry(ctx)`, register it.

## Why this is split into two PRs

Moving 2 870 lines of closely-coupled tool code in one commit risks breaking
the 2 088-test suite in ways that are hard to review. This commit:

1. Establishes the directory + module conventions.
2. Proves the import path works against `lib/runtime.ts`.
3. Leaves a clean starting point for the per-tool extraction follow-up.
