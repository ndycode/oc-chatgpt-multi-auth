# GitHub Discoverability Guide

GitHub-facing audit and recommended presentation for `oc-codex-multi-auth`.

---

## Product Summary

- Purpose: provide an OpenCode plugin for ChatGPT Plus/Pro OAuth, Codex/GPT-5 routing, multi-account rotation, account switching, health checks, quota status, diagnostics, recovery tooling, and TUI quota visibility
- Target users: individual developers using OpenCode who want ChatGPT OAuth-backed Codex workflows, visible local account state, explicit account switching, health-aware account selection, redacted diagnostics, project-scoped account pools, and guided setup/recovery commands
- Not the target: hosted auth services, commercial resale, shared multi-user credential pools, generic API-key users, or production workloads that should use the OpenAI Platform API

---

## Natural Search Terms

Developers looking for a tool like this are likely to search for:

- opencode chatgpt oauth
- opencode codex plugin
- opencode gpt 5 plugin
- opencode multi account oauth
- opencode chatgpt plus plugin
- codex oauth opencode
- openai codex opencode
- opencode account switching
- opencode quota status
- codex health checks opencode
- opencode diagnostics plugin
- opencode recovery tools
- chatgpt plus codex routing
- gpt 5 codex opencode
- opencode pkce oauth

These terms belong naturally in the README intro, feature list, docs landing pages, package keywords, and GitHub topics. They should not be stuffed into every heading.

---

## Recommended Repository Description

Use this as the GitHub repository description:

`OpenCode plugin for ChatGPT Plus/Pro OAuth with Codex/GPT-5 routing, multi-account rotation, account switching, health checks, diagnostics, and recovery tools`

## Recommended README Title

Use a descriptive H1 rather than a bare package name when possible:

`oc-codex-multi-auth: ChatGPT OAuth and multi-account Codex routing for OpenCode`

---

## Recommended Topics

GitHub allows up to 20 topics. Recommended set:

- opencode
- opencode-plugin
- codex
- gpt-5
- openai
- chatgpt
- chatgpt-plus
- chatgpt-pro
- oauth
- oauth2
- pkce
- multi-account
- account-switching
- account-health
- quota-management
- diagnostics
- recovery-tools
- terminal-ui
- typescript
- nodejs

---

## Suggested Badges

Useful badges:

- npm version
- npm downloads
- CI status
- license

Avoid vanity badges unless they add real trust or decision value.

---

## Social Preview Concept

Use a clean terminal-first image with:

- project name: `oc-codex-multi-auth`
- tagline: `ChatGPT OAuth and multi-account Codex routing for OpenCode`
- a simple visual of `npx oc-codex-multi-auth -> opencode auth login -> codex-status -> codex-switch`
- terminal/OpenCode styling rather than abstract marketing graphics

The image should immediately communicate:

- this is an OpenCode plugin
- it uses ChatGPT Plus/Pro OAuth
- it enables Codex/GPT-5 workflows
- it gives users visible multi-account management and recovery tools

---

## High-Confidence Wording Rules

- First paragraph: say what it is, who it is for, and how it relates to OpenCode and ChatGPT OAuth.
- Feature bullets: lead with outcomes such as account switching, health checks, recovery, diagnostics, quota visibility, and Codex/GPT-5 routing.
- Metadata: keep package keywords and GitHub topics aligned with natural search terms.
- Trust: explain local-only storage, redacted diagnostics, keychain opt-in, independent/non-official status, and OpenAI Platform API boundary.
- Do not claim guaranteed GitHub ranking. The repo can improve relevance and click confidence, not control search placement.

---

## What Makes A Developer Star The Repo

- They understand the value in one screen: OpenCode can use ChatGPT OAuth-backed Codex workflows with visible multi-account management.
- Install and first login are short and credible.
- The docs explain `store: false`, `reasoning.encrypted_content`, and why stateless request handling matters.
- Recovery commands are visible before a user needs them.
- The project sounds honest about what it is and what it is not.

---

## What Makes A Developer Leave The Repo

- The README reads like a model catalog before it explains the product.
- OpenCode plugin entry, installer, TUI plugin, and `codex-*` tools are blurred together.
- Stale package names or release versions make the repo look abandoned.
- The GitHub homepage points to an old package name.
- Safety/trust language is missing or sounds like a hosted auth service.

---

## Files Added Or Tightened In This Pass

- `README.md`
- `package.json`
- `.codex-plugin/plugin.json`
- `AGENTS.md`
- `lib/AGENTS.md`
- `docs/README.md`
- `docs/index.md`
- `docs/DOCUMENTATION.md`
- `docs/architecture.md`
- `docs/development/ARCHITECTURE.md`
- `docs/development/GITHUB_DISCOVERABILITY.md`
- `docs/_config.yml`
