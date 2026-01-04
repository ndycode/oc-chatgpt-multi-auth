# OpenAI Codex OAuth Plugin for OpenCode

[![npm version](https://img.shields.io/npm/v/opencode-openai-codex-auth.svg)](https://www.npmjs.com/package/opencode-openai-codex-auth)
[![Tests](https://github.com/numman-ali/opencode-openai-codex-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/numman-ali/opencode-openai-codex-auth/actions)
[![npm downloads](https://img.shields.io/npm/dm/opencode-openai-codex-auth.svg)](https://www.npmjs.com/package/opencode-openai-codex-auth)

![Codex OAuth Banner](assets/readme-hero.svg)

Use your ChatGPT Plus/Pro subscription inside OpenCode via official OAuth (Codex backend).

## Install / Update (1 command)

```bash
npx -y opencode-openai-codex-auth@latest
```

What it does:
- Writes the **global** config at `~/.config/opencode/opencode.json`
- Uses the **modern** variants config by default
- Backs up your existing config
- Clears OpenCode’s plugin cache so the latest version installs

Legacy OpenCode (v1.0.209 and below):

```bash
npx -y opencode-openai-codex-auth@latest --legacy
```

## Quick Start

```bash
opencode auth login
opencode run "write hello world to test.txt" --model=openai/gpt-5.2 --variant=medium
```

Legacy usage:

```bash
opencode run "write hello world to test.txt" --model=openai/gpt-5.2-medium
```

## Models (22 presets)

- **gpt-5.2** (none/low/medium/high/xhigh)
- **gpt-5.2-codex** (low/medium/high/xhigh)
- **gpt-5.1-codex-max** (low/medium/high/xhigh)
- **gpt-5.1-codex** (low/medium/high)
- **gpt-5.1-codex-mini** (medium/high)
- **gpt-5.1** (none/low/medium/high)

## Configuration (Manual)

- Modern (OpenCode v1.0.210+): `config/opencode-modern.json`
- Legacy (OpenCode v1.0.209 and below): `config/opencode-legacy.json`

Minimal configs are not supported for GPT 5.x; use the full configs above.

## Docs

- Getting Started: `docs/getting-started.md`
- Configuration: `docs/configuration.md`
- Troubleshooting: `docs/troubleshooting.md`
- Architecture: `docs/development/ARCHITECTURE.md`

## Usage Notice (Short)

This plugin is for **personal development use** with your own ChatGPT Plus/Pro subscription.
For production or multi-user applications, use the OpenAI Platform API.

Follow on X: [@nummanthinks](https://x.com/nummanthinks)
