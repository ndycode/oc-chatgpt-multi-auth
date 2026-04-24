# OpenCode Config Flow

This document describes the current config surfaces used by `oc-codex-multi-auth` on `main`.

## Primary Config Surfaces

### Global OpenCode config

The installer writes and updates:

```text
~/.config/opencode/opencode.json
```

That file is the primary global config surface used by the shipped install flow in this repository.

### Project override

Project-specific overrides can live in:

```text
<project>/.opencode.json
```

Use that when you want per-project model or provider overrides without changing the global install.

### One-shot overrides

OpenCode can also accept override content at process start:

```bash
OPENCODE_CONFIG=/path/to/config.json opencode
OPENCODE_CONFIG_CONTENT='{"model":"openai/gpt-5.5","variant":"medium"}' opencode
```

### Plugin runtime config

Plugin-specific runtime settings live outside the OpenCode config file:

```text
~/.opencode/openai-codex-auth-config.json
```

That file controls plugin behavior such as retry policy, beginner safe mode, fallback policy, TUI output, and per-project account storage.

## Installer Flow

`scripts/install-oc-codex-multi-auth.js` performs these steps:

1. Load the selected template set (`config/opencode-modern.json` by default, merged modern+legacy templates with `--full`, or `config/opencode-legacy.json` with `--legacy`).
2. Back up an existing `~/.config/opencode/opencode.json`.
3. Normalize the plugin list so it ends with plain `oc-codex-multi-auth`.
4. Replace `provider.openai` with the selected shipped template block.
5. Clear the cached OpenCode plugin copy under `~/.cache/opencode/`.

Important detail:

- The installer intentionally writes the plugin entry as `oc-codex-multi-auth`, not `oc-codex-multi-auth@latest`.
- The default install mode uses the compact modern base-model template so the TUI model picker shows real OAuth model families and leaves reasoning depth to the variant picker.
- `--full` merges the modern base-model template with the explicit legacy preset entries for scripts that require direct selector IDs.

## Shipped Template Structure

### Modern template

`config/opencode-modern.json` is the compact variant-based template for OpenCode `v1.0.210+`.

It currently ships:

- 9 base model families
- 36 total variants
- `gpt-5.5` and `gpt-5.5-fast` at 1,050,000 context / 128,000 output
- `gpt-5.4-mini`, `gpt-5.4-nano`, and Codex families at 400,000 context / 128,000 output
- `gpt-5.1` at 272,000 context / 128,000 output
- `store: false` plus `include: ["reasoning.encrypted_content"]`

### Default installer mode

The default installer mode writes:

- the 9 modern base model entries from `config/opencode-modern.json`

That compact install mode keeps the OpenCode TUI model picker focused on actual OAuth model families. Reasoning presets are selected through the separate variant picker.

Example shape:

```json
{
  "plugin": ["oc-codex-multi-auth"],
  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "medium",
        "reasoningSummary": "auto",
        "textVerbosity": "medium",
        "include": ["reasoning.encrypted_content"],
        "store": false
      },
      "models": {
        "gpt-5.4": {
          "name": "GPT 5.5 (OAuth)",
          "variants": {
            "medium": { "reasoningEffort": "medium" },
            "high": { "reasoningEffort": "high" }
          }
        }
      }
    }
  }
}
```

Default install uses base model IDs plus variants:

```bash
opencode run "task" --model=openai/gpt-5.5 --variant=medium
opencode run "task" --model=openai/gpt-5.5-fast --variant=medium
```

### Full installer mode

`--full` combines:

- the 9 modern base model entries from `config/opencode-modern.json`
- the 36 explicit preset entries from `config/opencode-legacy.json`

Use it when scripts require direct selector IDs:

```bash
npx -y oc-codex-multi-auth@latest --full
opencode run "task" --model=openai/gpt-5.5-medium
opencode run "task" --model=openai/gpt-5.5-fast-medium
```

### Legacy template

`config/opencode-legacy.json` is for OpenCode `v1.0.209` and earlier.

It currently ships:

- 36 explicit model entries
- separate model IDs such as `gpt-5.5-medium`, `gpt-5.5-fast-medium`, `gpt-5.5-high`, and `gpt-5.4-mini-xhigh`
- the same OpenAI provider defaults (`store: false`, `reasoning.encrypted_content`)

Legacy OpenCode selection uses:

```bash
opencode run "task" --model=openai/gpt-5.5-high
```

## Runtime Resolution

At runtime, OpenCode passes `provider.openai.options` and `provider.openai.models` into the plugin loader. The plugin then:

1. Reads global provider options.
2. Reads per-model definitions.
3. Applies request-shaping behavior (`native` by default, `legacy` when explicitly enabled).
4. Normalizes selected model IDs to canonical upstream Codex/ChatGPT model families before the final API call.

Examples:

- `openai/gpt-5.5` with variant `medium` normalizes to `gpt-5.5`
- `openai/gpt-5.4-mini-xhigh` normalizes to `gpt-5.4-mini`
- legacy aliases such as `gpt-5-mini` normalize to `gpt-5.4-mini`

## Verification

Use these commands when checking the effective config:

```bash
opencode debug config
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "ping" --model=openai/gpt-5.5 --variant=medium
```

Important runtime behavior:

- `opencode debug config` shows merged provider models from your config.
- The default install shows compact GPT-5.5 OAuth base entries such as `gpt-5.5` / `gpt-5.5-fast`.
- `--full` additionally shows explicit GPT-5.5 entries such as `gpt-5.5-medium` / `gpt-5.5-fast-medium` / `gpt-5.5-high`.

## File Locations

| Path | Purpose |
|------|---------|
| `~/.config/opencode/opencode.json` | global OpenCode config used by the installer |
| `<project>/.opencode.json` | project-local OpenCode override |
| `~/.opencode/openai-codex-auth-config.json` | plugin runtime config |
| `~/.opencode/auth/openai.json` | OAuth token storage |
| `~/.opencode/oc-codex-multi-auth-accounts.json` | global account storage |
| `~/.opencode/projects/<project-key>/oc-codex-multi-auth-accounts.json` | per-project account storage |
| `~/.opencode/logs/codex-plugin/` | plugin request/debug logs |

## See Also

- [CONFIG_FIELDS.md](./CONFIG_FIELDS.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [../../config/README.md](../../config/README.md)
