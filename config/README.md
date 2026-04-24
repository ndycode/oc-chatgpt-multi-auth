# Configuration

This directory contains the official OpenCode config templates for `oc-codex-multi-auth`.

## Required: choose the right config file

| File | OpenCode version | Description |
|------|------------------|-------------|
| [`opencode-modern.json`](./opencode-modern.json) | **v1.0.210+** | Variant-based config: 9 base models with 36 total presets |
| [`opencode-legacy.json`](./opencode-legacy.json) | **v1.0.209 and below** | Legacy explicit entries: 36 individual model definitions |

The installer uses the compact modern template by default so the model picker shows only base OAuth model families. Rerun the default installer to remove explicit preset IDs and stale base models left by earlier plugin catalogs. Use `--full` when you want the explicit preset IDs installed too.

## Quick pick

If your OpenCode version is v1.0.210 or newer:

```bash
cp config/opencode-modern.json ~/.config/opencode/opencode.json
```

If your OpenCode version is v1.0.209 or older:

```bash
cp config/opencode-legacy.json ~/.config/opencode/opencode.json
```

Check your version with:

```bash
opencode --version
```

## Why there are two templates

OpenCode v1.0.210+ added model `variants`, so one model entry can expose multiple reasoning levels. That keeps modern config much smaller while preserving the same effective presets.

Both templates include:
- GPT-5.5, GPT-5.5 Fast, GPT-5.4 Mini, GPT-5.4 Nano, GPT-5 Codex, GPT-5.1, GPT-5.1 Codex, GPT-5.1 Codex Max, GPT-5.1 Codex Mini
- Reasoning variants per model family
- `store: false` and `include: ["reasoning.encrypted_content"]`
- Context metadata (`gpt-5.5`/`gpt-5.5-fast`: 1,050,000; `gpt-5.4-mini`/`gpt-5.4-nano`/Codex models: 400,000; `gpt-5.1`: 272,000; all output: 128,000)

Use `opencode debug config` to verify that these template entries were merged into your effective config. The default compact install shows base OAuth entries such as `gpt-5.5` / `gpt-5.5-fast`; the separate OpenCode variant picker exposes the reasoning presets.

If your OpenCode runtime supports global compaction tuning, you can also set:
- `model_context_window = 1050000`
- `model_auto_compact_token_limit = 950000`

## Spark model note

The templates intentionally do **not** include `gpt-5.3-codex-spark` by default. Spark is often entitlement-gated at the account/workspace level, so shipping it by default causes avoidable startup failures for many users.

If your workspace is entitled, you can add Spark model IDs manually.

## Usage examples

Recommended compact UI selectors:

```bash
opencode run "task" --model=openai/gpt-5.5 --variant=medium
opencode run "task" --model=openai/gpt-5.5-fast --variant=medium
opencode run "task" --model=openai/gpt-5-codex --variant=high
```

If you need direct explicit selector IDs for scripts, install with:

```bash
npx -y oc-codex-multi-auth@latest --full
```

## Minimal config (advanced)

A barebones debug template is available at [`minimal-opencode.json`](./minimal-opencode.json). It omits the full preset catalog.

## Unsupported-model behavior

Current defaults are strict entitlement handling:
- `unsupportedCodexPolicy: "strict"` returns entitlement errors directly
- set `unsupportedCodexPolicy: "fallback"` (or `CODEX_AUTH_UNSUPPORTED_MODEL_POLICY=fallback`) to enable automatic fallback retries
- `fallbackToGpt52OnUnsupportedGpt53: true` keeps the legacy `gpt-5.3-codex -> gpt-5.2-codex` edge inside fallback mode
- `gpt-5.5 -> gpt-5.4` is included by default for accounts/workspaces that do not yet expose GPT-5.5
- user-typed `gpt-5.5-pro*` is canonicalized to `gpt-5.5` before fallback because GPT-5.5 Pro is ChatGPT-only, not a Codex-routable model
- `gpt-5.4-pro -> gpt-5.4` remains available for older manual configs
- `unsupportedCodexFallbackChain` lets you override fallback order per model

Default fallback chain (when policy is `fallback`):
- `gpt-5.5 -> gpt-5.4`
- `gpt-5.4-pro -> gpt-5.4` (if you manually select `gpt-5.4-pro`)
- `gpt-5.3-codex -> gpt-5-codex -> gpt-5.2-codex`
- `gpt-5.3-codex-spark -> gpt-5-codex -> gpt-5.3-codex -> gpt-5.2-codex` (only relevant if Spark IDs are added manually)
- `gpt-5.2-codex -> gpt-5-codex`
- `gpt-5.1-codex -> gpt-5-codex`

## Additional docs

- Main config reference: [`docs/configuration.md`](../docs/configuration.md)
- Getting started: [`docs/getting-started.md`](../docs/getting-started.md)
- Troubleshooting: [`docs/troubleshooting.md`](../docs/troubleshooting.md)
