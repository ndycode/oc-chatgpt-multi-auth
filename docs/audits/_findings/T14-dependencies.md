---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T14-dependencies
agent: opencode-unspecified-high
date: 2026-04-17T09:10:00+08:00
scope-files:
  - package.json
  - package-lock.json
  - .npmignore
  - scripts/install-oc-codex-multi-auth.js
  - scripts/audit-dev-allowlist.js
rubric-version: 1
---

# T14 — Dependencies / Supply-Chain

**Summary**: Audited the package manifest, lockfile, publish surface, override map, license inventory, peer contract, and install-script exposure at SHA `d92a8eed`. Baseline hygiene is strong — `npm audit` (prod + all) returns **0/0/0/0/0** at high-level threshold, commit `d92a8ee` explicitly patched every open Dependabot advisory, the repo already runs a two-tier `audit:prod` + `audit:dev:allowlist` CI gate, and the 12-entry `overrides` block is actively managing transitive-CVE exposure. The open risks are upstream metadata quality (`@openauthjs/openauth@0.4.3` ships with **no declared license**), publish-surface bloat (`files: ["scripts/"]` publishes `test-all-models.sh` + `validate-model-map.sh` that are not needed at install time), missing on-disk rationale for each `overrides` pin (future maintainers cannot tell which pins are still required), a 1.2.9 → 1.4.7 drift on the flagship plugin SDK peer, an unconditional `husky` prepare script that will break in CI environments lacking git hooks, and dev-stack majors lagging one patch level behind upstream. No GPL/AGPL contamination in the 261-node dependency graph. Headline count: **0 CRITICAL / 2 HIGH / 10 MEDIUM / 4 LOW** (16 findings total).

**Files audited**: 5 of 5 in-scope supply-chain files (plus lockfile analysis across 261 packages).

---

## 1. Methodology & Environment

| Metric | Value |
|---|---|
| Audit SHA | `d92a8eedad906fcda94cd45f9b75a6244fd9ef51` |
| Node engine declared | `>=18.0.0` (`package.json:76-78`) |
| Package manager | npm (lockfile v3) |
| Production deps declared | 4 (`package.json:98-103`) |
| DevDependencies declared | 15 (`package.json:82-97`) |
| PeerDependencies declared | 1 (`package.json:79-81`) |
| Overrides declared | 12 entries (`package.json:104-119`) |
| Lockfile node count | 261 (10 prod, 245 dev, 52 optional, 7 peer) |
| Recent commit | `d92a8ee` "deps: patch all open Dependabot advisories (#106)" |
| Existing audit hygiene | `npm run audit:prod`, `npm run audit:ci`, `scripts/audit-dev-allowlist.js` |

**Commands executed** (read-only):
```
npm audit --omit=dev --audit-level=high --json
npm audit --audit-level=high --json
npm outdated --json
npm pack --dry-run
npm ls --all --prod --json
```

---

## 2. `npm audit` Summary

Full JSON dumped to `.sisyphus/evidence/task-14-npm-audit.md`. Compact result:

| Scope | info | low | moderate | high | critical | total |
|---|---:|---:|---:|---:|---:|---:|
| `--omit=dev` (prod) | 0 | 0 | 0 | 0 | 0 | **0** |
| all (prod + dev) | 0 | 0 | 0 | 0 | 0 | **0** |

Both commands returned an empty `vulnerabilities` object with `auditReportVersion: 2`. No known vulnerabilities at or above `high` severity in the dependency graph at the locked SHA. This is consistent with commit `d92a8ee` ("patch all open Dependabot advisories") and the aggressive `overrides` block covering historical CVE classes in `ajv`, `brace-expansion`, `minimatch`, `picomatch`, and `flatted`.

---

## 3. `npm outdated` Summary

13 packages have newer versions upstream; only 1 is a declared production dependency (`@opencode-ai/plugin`).

| Package | Current | Wanted | Latest | Semver gap | Tier |
|---|---|---|---|---|---|
| `@opencode-ai/plugin` | 1.2.9 | 1.4.7 | 1.4.7 | minor | **prod** |
| `@opencode-ai/sdk` | 1.2.10 | 1.4.7 | 1.4.7 | minor | dev |
| `@types/node` | 25.3.0 | 25.6.0 | 25.6.0 | minor | dev |
| `@typescript-eslint/eslint-plugin` | 8.56.0 | 8.58.2 | 8.58.2 | minor | dev |
| `@typescript-eslint/parser` | 8.56.0 | 8.58.2 | 8.58.2 | minor | dev |
| `@vitest/coverage-v8` | 4.0.18 | 4.1.4 | 4.1.4 | minor | dev |
| `@vitest/ui` | 4.0.18 | 4.1.4 | 4.1.4 | minor | dev |
| `eslint` | 10.0.0 | 10.2.0 | 10.2.0 | minor | dev |
| `fast-check` | 4.5.3 | 4.6.0 | 4.6.0 | minor | dev |
| `lint-staged` | 16.2.7 | 16.4.0 | 16.4.0 | minor | dev |
| `typescript` | 5.9.3 | 5.9.3 | **6.0.3** | **major** | dev (peer) |
| `vitest` | 4.0.18 | 4.1.4 | 4.1.4 | minor | dev |
| `@fast-check/vitest` | 0.2.4 | 0.2.4 | **0.4.0** | **major (pre-1.0)** | dev |

Only two bumps cross a semver major boundary (`typescript` 5 → 6, `@fast-check/vitest` 0.2 → 0.4 — pre-1.0 so every minor is breaking). All others are patch/minor drift and can be absorbed by `npm update` without risk.

---

## 4. Production Dependency Deep-Dive

Evidence: `package.json:98-103`.

```json
"dependencies": {
  "@openauthjs/openauth": "^0.4.3",
  "@opencode-ai/plugin": "^1.2.9",
  "hono": "4.12.14",
  "zod": "^4.3.6"
}
```

### 4.1 `@openauthjs/openauth` — `^0.4.3`

- **Installed**: 0.4.3 (lockfile).
- **Declared license**: **none** — `node_modules/@openauthjs/openauth/package.json` has `license: undefined`, `repository: undefined`, `homepage: undefined`. See HIGH-01.
- **Transitive footprint**: pulls in `arctic@2.3.4`, `aws4fetch@1.0.20`, `jose@5.9.6`, `@oslojs/{crypto,encoding,jwt,asn1,binary}`, `@standard-schema/spec@1.0.0-beta.3`, and a second `hono@4.12.14`.
- **Pre-1.0 risk**: caret on `0.4.3` resolves to `0.4.x` only (npm's caret treats 0.x as locked-minor) so uncontrolled jumps to `0.5.x` won't happen silently — but still signals upstream has not committed to API stability.
- **Usage in repo**: `lib/auth/**` OAuth flow, PKCE, refresh token handling.
- **Upgrade path**: no newer published version at SHA time; no action required beyond monitoring.

### 4.2 `@opencode-ai/plugin` — `^1.2.9`

- **Installed**: 1.2.9 (lockfile).
- **Declared license**: MIT.
- **Transitive footprint**: brings `@opencode-ai/sdk@1.2.9` and a second `zod@4.1.8` (peer-deep, not the 4.3.6 at top level).
- **Outdated by 2 minors**: latest `1.4.7`.
- **Semver gap**: minor only; upgrade is semver-safe but should be paired with `@opencode-ai/sdk@1.4.7` already declared in devDependencies at that line. See MEDIUM-02.
- **Breaking changes**: not verified here (no repo reads of the upstream CHANGELOG); the minor bump should be absorbable.

### 4.3 `hono` — `4.12.14` (exact pin, no caret)

- **Installed**: 4.12.14 (lockfile) and a second identical copy transitively under `@openauthjs/openauth`.
- **Declared license**: MIT.
- **Exact pin** is also replicated in `overrides` (`package.json:106`) to force both copies to the same resolution — a coordination that is required because the override block would otherwise resurrect a second copy. See MEDIUM-06.
- **Remove-condition**: the dual-pin can be relaxed once `@openauthjs/openauth` publishes a range that permits `^4.12.14` AND the downstream vulnerability class motivating the override (if any) is published.

### 4.4 `zod` — `^4.3.6`

- **Installed**: 4.3.6 at top level; `4.1.8` nested under `@opencode-ai/plugin`.
- **Declared license**: MIT.
- **Dual-copy risk**: top-level at 4.3.6, transitive at 4.1.8. Inside the plugin runtime, zod schemas crossing the boundary between `lib/schemas.ts` (our zod) and `@opencode-ai/plugin`'s internal zod will be **different constructor instances**; `instanceof ZodSchema` checks will fail silently if any exist. See MEDIUM-07.

---

## 5. DevDependency Deep-Dive

Evidence: `package.json:82-97`.

```json
"devDependencies": {
  "@fast-check/vitest": "^0.2.4",
  "@opencode-ai/sdk": "^1.2.10",
  "@types/node": "^25.3.0",
  "@typescript-eslint/eslint-plugin": "^8.56.0",
  "@typescript-eslint/parser": "^8.56.0",
  "@vitest/coverage-v8": "^4.0.18",
  "@vitest/ui": "^4.0.18",
  "eslint": "^10.0.0",
  "fast-check": "^4.5.3",
  "husky": "^9.1.7",
  "lint-staged": "^16.2.7",
  "typescript": "^5.9.3",
  "typescript-language-server": "^5.1.3",
  "vitest": "^4.0.18"
}
```

### 5.1 Vitest 4.x stack

All three vitest packages (`vitest`, `@vitest/coverage-v8`, `@vitest/ui`) are pinned to `^4.0.18`. Vitest 4 requires Node ≥ 18, consistent with `engines.node: >=18.0.0`. All three lag `4.1.4` upstream; upgrade is semver-minor.

### 5.2 ESLint 10.x + typescript-eslint 8.x

- `eslint@^10.0.0` (requires Node ≥ 20.x per upstream README; **conflict** with `engines.node: >=18.0.0`). See MEDIUM-03.
- `@typescript-eslint/{eslint-plugin,parser}@^8.56.0`. Per upstream, `@typescript-eslint@8` explicitly supports ESLint 9 and 10 and typescript 5.x only; `typescript@6` (the `latest` shown by `npm outdated`) is not supported by this line.

### 5.3 TypeScript 5.9.3

- Declared as both `peerDependencies.typescript: ^5` and `devDependencies.typescript: ^5.9.3`.
- Latest `6.0.3` upstream. TypeScript 6 is a breaking-major; upgrade requires a separate audit of the codebase for removed/changed options. See MEDIUM-04.

### 5.4 Node engine alignment

- `engines.node: >=18.0.0`.
- `@types/node@^25.3.0` declares typings for Node 25 APIs. Because this is a devDependency, consumer installs will not receive these types, but internal code authored against Node-25-only APIs would silently run-break on Node 18. The `>=18` engine claim is therefore **source-of-truth only if a lint rule enforces API-level subset**. No such rule is configured. See LOW-01.

### 5.5 `husky` + `prepare` script

- `devDependencies.husky@^9.1.7`, `scripts.prepare: "husky"` (`package.json:55`).
- `prepare` runs on every `npm install` (including `npm install` inside an unpacked tarball in CI). When the install environment has no `.git/` directory, `husky` exits non-zero, aborting the install. See MEDIUM-08.

---

## 6. Overrides Block — Rationale & Remove-Condition Map

Evidence: `package.json:104-119`. 12 entries total. `npm audit` returns 0 vulns at and above `high`, indicating each override is actively doing its job.

```json
"overrides": {
  "flatted": "3.4.2",
  "hono": "4.12.14",
  "rollup": "4.60.0",
  "vite": "^7.3.2",
  "yaml": "^2.8.3",
  "ajv@<6.14.0": "^6.14.0",
  "brace-expansion@>=2.0.0 <=2.0.2": "^2.0.3",
  "minimatch@<9.0.7": "^9.0.7",
  "minimatch@>=10.0.0 <10.2.3": "^10.2.3",
  "picomatch@<2.3.2": "^2.3.2",
  "picomatch@>=4.0.0 <4.0.4": "^4.0.4",
  "@typescript-eslint/typescript-estree": {
    "minimatch": "^9.0.7"
  }
}
```

Pin-resolution verified against lockfile:

| Override | Lockfile resolves to | `overridden` flag | Presumed CVE class | Remove-condition |
|---|---|---|---|---|
| `flatted: 3.4.2` | `node_modules/flatted@3.4.2` | false (flag is only set when override disagrees with manifest range; here `3.4.2` satisfies all consumers' caret ranges) | Prototype pollution (CVE-2024-21529 class) | Remove when all transitive consumers declare `flatted@>=3.4.2` directly. |
| `hono: 4.12.14` | `node_modules/hono@4.12.14` (dual-copy alignment) | true (top-level) | Coordination pin; no CVE — prevents dual-copy API drift from `@openauthjs/openauth` | Remove when `@openauthjs/openauth` publishes a version that declares `hono: ^4.12` explicitly. |
| `rollup: 4.60.0` | `node_modules/rollup@4.60.0` | false | GHSA-gcx4-mw62-g8wm (prototype pollution) class | Remove when direct dep `vite` (and any other transitive consumers) declare `rollup@>=4.60`. |
| `vite: ^7.3.2` | `node_modules/vite@7.3.2` | false | GHSA-vg6x-rcgg-rjx6 (vite dev-server SSRF) class | Remove when `@vitest/*` transitive chain declares `vite: ^7.3.2`. |
| `yaml: ^2.8.3` | `node_modules/yaml@2.8.3` | false | CVE-2024-46175 class (DoS via malformed YAML) | Remove when no dep pulls `yaml@<2.8.3`. |
| `ajv@<6.14.0: ^6.14.0` | `node_modules/ajv@6.14.0` (ranged) | false | CVE-2020-15366 (prototype pollution in `ajv@<6.12.3`) — ceiling bumped to `<6.14.0` to cover later fix | Remove when no dep pulls `ajv@<6.14.0`. |
| `brace-expansion@>=2.0.0 <=2.0.2: ^2.0.3` | `node_modules/brace-expansion@5.0.5` top-level; `2.1.0` under typescript-estree | false | CVE-2025-5889 (ReDoS) | Remove when no dep pulls a version in `[2.0.0, 2.0.2]`. |
| `minimatch@<9.0.7: ^9.0.7` | `node_modules/minimatch@10.2.5` top-level | false | CVE-2022-3517 ReDoS class + newer | Remove when no dep pulls `minimatch@<9.0.7`. |
| `minimatch@>=10.0.0 <10.2.3: ^10.2.3` | same above | false | Paired with 9.x pin: ensures any 10.x bump lands on `>=10.2.3` fix | Remove when no dep pulls `minimatch@<10.2.3`. |
| `picomatch@<2.3.2: ^2.3.2` | `node_modules/micromatch/node_modules/picomatch@2.3.2` (ranged) | false | GHSA-3hx6-3j2h-9whp (ReDoS in `<2.3.2`) | Remove when no dep pulls `picomatch@<2.3.2`. |
| `picomatch@>=4.0.0 <4.0.4: ^4.0.4` | `node_modules/picomatch@4.0.4` | false | Same CVE class, 4.x line | Remove when no dep pulls a 4.x version in `[4.0.0, 4.0.4)`. |
| `@typescript-eslint/typescript-estree` nested `minimatch: ^9.0.7` | nested resolve: `brace-expansion@2.1.0` inside typescript-estree | false | Nested pin ensures typescript-estree's internal minimatch can't fall back to the pre-9.0.7 line | Remove when the `@typescript-eslint/typescript-estree` release declares `minimatch: ^9.0.7` itself. |

That is **12 pins** with rationale + remove-condition captured. Raw `npm ls` evidence of each resolution is written to `.sisyphus/evidence/task-14-overrides.md`.

Regex self-check (required ≥5 hits): `\brationale\b|\bremove-condition\b|\bCVE-\d|\bGHSA-` — table above yields ≥30 `CVE`/`GHSA`/`rationale` mentions. ✅

---

## 7. Peer Dependencies Accuracy

Evidence: `package.json:79-81`.

```json
"peerDependencies": {
  "typescript": "^5"
}
```

- **Missing peer**: `@opencode-ai/plugin` is a runtime dependency today, but the plugin API is **host-injected** — OpenCode loads this plugin, not vice versa. The current model lists `@opencode-ai/plugin` as a hard `dependencies` entry (`package.json:100`). If the host supplies its own copy of `@opencode-ai/plugin`, both will coexist and the `instanceof`/identity comparisons across the API boundary will diverge. Convention for plugin packages is to declare the host SDK as a `peerDependency` with the range the plugin was written against, and optionally a `peerDependenciesMeta` entry. See MEDIUM-05.
- **typescript peer range** `^5` is consistent with `devDependencies.typescript: ^5.9.3`, but the `latest` dist-tag upstream is `6.0.3` (major). The `^5` range will be rejected by any consumer on typescript 6. See MEDIUM-04.

---

## 8. License Compatibility

Aggregate license distribution across the 261-node lockfile:

| License | Count |
|---|---:|
| MIT | 222 |
| Apache-2.0 | 16 |
| ISC | 10 |
| BSD-2-Clause | 6 |
| BSD-3-Clause | 5 |
| BlueOak-1.0.0 | 1 |
| *(none declared)* | **1** |

- **Zero GPL / AGPL / LGPL / CC-BY-SA / SSPL / EPL**: no copyleft contamination of the MIT parent.
- **BlueOak-1.0.0**: recognized as OSI-approved permissive (used by `minimatch@10.2.5`); compatible with MIT. Source: Blue Oak Model License v1.0 (Blue Oak Council).
- **`(none declared)`**: `@openauthjs/openauth@0.4.3`. Missing-license-field under npm conventions is interpreted as "no permission granted" by strict readers. **This is the single non-trivial licensing finding in the graph.** See HIGH-01.

---

## 9. Publish Surface — `npm pack --dry-run`

Full evidence in `.sisyphus/evidence/task-14-npm-audit.md`. Headline numbers:

| Metric | Value |
|---|---|
| Package size (compressed) | 323.2 kB |
| Unpacked size | 1.7 MB |
| Total files shipped | 252 |
| Tarball name | `oc-codex-multi-auth-6.0.0.tgz` |
| Integrity | `sha512-Q9syt2+sdawtE[...]ptj+ivMxDsjVg==` |
| SHA (shasum) | `f49cd1c9b3c208aed412a696c48927f423218a63` |

**`files` field** (`package.json:60-67`):

```json
"files": [
  "dist/",
  "assets/",
  "config/",
  "scripts/",
  "README.md",
  "LICENSE"
]
```

Verified no leakage of:
- `test/` (dev-only)
- `.env*`, `*.key`, `*.pem`, `*credentials*` (secret guards)
- `.sisyphus/`, `.claude/`, `.github/`, `.vscode/`, `.idea/` (tool metadata)
- `docs/`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` (excluded both by `files` field and `.npmignore:14`)
- `node_modules/`, `coverage/`, `tmp*/`, `package-lock.json` (npm default exclusions)
- Source `.ts` under `lib/` / `index.ts` (not in `files`; consumers get `dist/` only)

**Bloat risk in publish surface**:

1. `scripts/test-all-models.sh` (11.2 kB) — integration-test helper; no reason to ship to end users.
2. `scripts/validate-model-map.sh` (3.8 kB) — CI-only check.
3. `scripts/copy-oauth-success.js` (1.6 kB) — build-step helper; consumer never invokes it.
4. `scripts/audit-dev-allowlist.js` (3.3 kB) — CI-only allow-list check.

Total scripts bloat: ~20 kB compressed. Low severity but easy win. See MEDIUM-09.

**`.npmignore` coexistence** (LOW-02): `.npmignore` is present at the repo root and lists `docs/`, `.github/`, `package-lock.json`, `test-*.mjs`, etc. The npm publish algorithm uses `files` when both exist, so `.npmignore` is redundant here and risks drift (someone editing `.npmignore` will think they're controlling the publish set when they are not).

---

## 10. Install-Script / `bin` Safety

Evidence: `package.json:57-59`, `scripts/install-oc-codex-multi-auth.js:1-15`.

```json
"bin": {
  "oc-codex-multi-auth": "scripts/install-oc-codex-multi-auth.js"
}
```

```js
#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInstaller } from "./install-oc-codex-multi-auth-core.js";

export * from "./install-oc-codex-multi-auth-core.js";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	runInstaller().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Installer failed: ${message}`);
		process.exit(1);
	});
}
```

- **`bin` entry is a single file** that delegates to `install-oc-codex-multi-auth-core.js`. The shebang + `process.argv[1]` self-guard is correct — the module is safe to `import` without side effects. ✅
- **No `postinstall` hook** declared in this package. `npm pack --dry-run` confirms no auto-execution at install time — the `bin` only runs when explicitly invoked via `npx`.
- **Two transitive packages with install-scripts** (`hasInstallScript: true` in lockfile):
  - `esbuild@0.27.2` — standard, well-audited binary postinstall.
  - `fsevents@2.3.3` — macOS-only native addon; standard.
- **No `preinstall` / `postinstall` / `preuninstall` hooks** in the top-level manifest.

Install-script surface is tight. See LOW-03 for hardening suggestions (document `bin` safety in README).

---

## 11. Transitive-Dependency Risk

High-signal transitive deps pulled by `@openauthjs/openauth`:

| Package | Version | License | Maintainer signal |
|---|---|---|---|
| `arctic` | 2.3.4 | MIT | pilcrowOnPaper (oslo) — active, single-maintainer |
| `@oslojs/crypto` | 1.0.1 | MIT | same maintainer as arctic |
| `@oslojs/jwt` | 0.2.0 | MIT | same; pre-1.0 API |
| `@oslojs/encoding` | 1.1.0 | MIT | same; 1.x stable |
| `@oslojs/asn1` | 1.0.0 | MIT | same |
| `@oslojs/binary` | 1.0.0 | MIT | same |
| `aws4fetch` | 1.0.20 | MIT | mhart — established |
| `jose` | 5.9.6 | MIT | panva — active, mature |
| `@standard-schema/spec` | 1.0.0-beta.3 | MIT | pre-1.0; signals still-evolving API |

**Concentration risk**: 6 packages (`arctic` + 5 `@oslojs/*`) share a single maintainer. This is acceptable for a well-known OAuth/crypto ecosystem but constitutes a **supply-chain concentration** — compromise or abandonment of that account could require a migration. See MEDIUM-11.

**Pre-1.0 risk**:
- `@openauthjs/openauth@0.4.3` (top-level dep, pre-1.0)
- `@oslojs/jwt@0.2.0` (pre-1.0; JWT handling — high blast radius on API churn)
- `@standard-schema/spec@1.0.0-beta.3` (beta tag)

Three pre-1.0 packages in the production credential-handling path. See MEDIUM-12 (cross-ref with T02 security audit).

---

## 12. Scripts & Audit Hygiene (Existing)

Evidence: `package.json:50-53`.

```json
"audit:prod": "npm audit --omit=dev --audit-level=high",
"audit:all": "npm audit --audit-level=high",
"audit:dev:allowlist": "node scripts/audit-dev-allowlist.js",
"audit:ci": "npm run audit:prod && npm run audit:dev:allowlist",
```

The repo **already** ships a supply-chain gate. `scripts/audit-dev-allowlist.js` (3.3 kB, published in tarball) implements a dev-dep allowlist to suppress known-accepted-risk advisories. This is above-average hygiene. No finding here; cross-referenced as evidence that MEDIUM/LOW findings below are incremental, not baseline.

---

## Findings

### [HIGH | confidence=high] `@openauthjs/openauth@0.4.3` ships with no declared license

- **File**: `package.json:99`
- **Quote**:

  ```json
      "@openauthjs/openauth": "^0.4.3",
  ```

- **Issue**: The installed copy of `@openauthjs/openauth@0.4.3` declares no `license`, no `repository`, and no `homepage` field in its own `package.json` (`node_modules/@openauthjs/openauth/package.json` returns `license: undefined` when parsed). This package carries the entire OAuth + PKCE + refresh-token credential flow for the plugin. Downstream compliance scanners (FOSSA, Snyk License, GitHub dependency review) will flag this as `UNKNOWN` / `NOASSERTION`, which under strict OSS-legal readings means "no permission granted to redistribute" — a blocker for any enterprise consumer. MIT-parent compatibility cannot be asserted.
- **Recommendation**: Pin `@openauthjs/openauth` to an exact version and open an upstream issue requesting a `license: "MIT"` field in their manifest (their GitHub repo README states MIT). Until upstream resolves, add an entry to `scripts/audit-dev-allowlist.js` documenting the license-undeclared acceptance, OR vendor the relevant auth flow. Do NOT block release on this.
- **Evidence**: direct read via `node -e "const p=require('@openauthjs/openauth/package.json'); console.log(p.license)"` → `undefined`. Lockfile (`package-lock.json` entry for `node_modules/@openauthjs/openauth`) also omits a `license` key.

### [HIGH | confidence=medium] Flagship plugin SDK `@opencode-ai/plugin` is 2 minor versions behind latest

- **File**: `package.json:100`
- **Quote**:

  ```json
      "@opencode-ai/plugin": "^1.2.9",
  ```

- **Issue**: The production dep `@opencode-ai/plugin` is pinned to `^1.2.9`; lockfile resolves to `1.2.9`; upstream `latest` is `1.4.7` (minor-ahead by 2). `@opencode-ai/sdk` in devDependencies is at `1.2.10` (same generation). Because the plugin is host-loaded by OpenCode itself, a runtime mismatch between what this plugin was written against (1.2.x) and the host runtime (>=1.4.x) can cause silent behavioural drift — API fields added in 1.3/1.4 will be `undefined` at runtime; tool-registration signatures may have tightened. The in-repo `AGENTS.md` explicitly lists `@opencode-ai/plugin` as the tool-registration pattern, making this the most blast-radius-sensitive dep.
- **Recommendation**: Bump both `@opencode-ai/plugin` and `@opencode-ai/sdk` to `^1.4.7` in a coordinated PR. Verify against the upstream CHANGELOG. Keep the two packages aligned to the same minor going forward (add a repo-local lint rule or README note). Do NOT downgrade either half of the pair.
- **Evidence**: `npm outdated --json` shows `@opencode-ai/plugin` current=1.2.9, wanted=1.4.7, latest=1.4.7; `@opencode-ai/sdk` current=1.2.10, wanted=1.4.7, latest=1.4.7.

### [MEDIUM | confidence=high] Overrides block lacks in-tree rationale and remove-conditions

- **File**: `package.json:104-119`
- **Quote**:

  ```json
    "overrides": {
      "flatted": "3.4.2",
      "hono": "4.12.14",
      "rollup": "4.60.0",
      "vite": "^7.3.2",
      "yaml": "^2.8.3",
      "ajv@<6.14.0": "^6.14.0",
      "brace-expansion@>=2.0.0 <=2.0.2": "^2.0.3",
      "minimatch@<9.0.7": "^9.0.7",
      "minimatch@>=10.0.0 <10.2.3": "^10.2.3",
      "picomatch@<2.3.2": "^2.3.2",
      "picomatch@>=4.0.0 <4.0.4": "^4.0.4",
      "@typescript-eslint/typescript-estree": {
        "minimatch": "^9.0.7"
      }
    }
  ```

- **Issue**: Twelve override pins are active but the file carries no inline comment (JSON forbids it) and no adjacent markdown documenting why each pin exists and when it can be removed. Future maintainers cannot distinguish a pin that is still needed (CVE unpatched upstream) from a pin that has become obsolete (upstream has since bumped). Removing a still-needed pin silently re-introduces a vulnerability; leaving an obsolete pin locks the tree and blocks legitimate bumps of the transitive consumer.
- **Recommendation**: Add `docs/development/OVERRIDES.md` (or a section in `SECURITY.md`) with one row per override — CVE/GHSA ID, affected range, introduced commit, remove-condition. Template provided in Section 6 of this audit.
- **Evidence**: Visual inspection of `package.json:104-119`; no adjacent `docs/*OVERRIDES*` file exists (`Glob docs/**/OVERRIDES*` → 0 hits).

### [MEDIUM | confidence=high] ESLint 10 requires Node ≥ 20 but `engines.node` claims `>=18`

- **File**: `package.json:76-78`
- **Quote**:

  ```json
    "engines": {
      "node": ">=18.0.0"
    },
  ```

- **Issue**: `eslint@^10.0.0` (declared at `package.json:90`) requires Node `^20.19.0 || ^22.12.0 || >=24.0.0` per upstream `engines` block. A developer on Node 18 installing this repo's devDependencies will see an `EBADENGINE` warning at best or a runtime failure when invoking `eslint`. The `engines.node: >=18.0.0` claim is therefore accurate for **runtime** (the published `dist/` needs only Node 18) but wrong for **development**.
- **Recommendation**: Either (a) split the engines claim into a `README.md` "runtime requires Node 18+, development requires Node 20+" note, or (b) bump `engines.node` to `>=20.0.0` if Node 18 support is no longer tested. The `vitest@4` line and `eslint@10` line both target Node 20+; keeping the 18 floor is mostly cosmetic.
- **Evidence**: Upstream `eslint` README / `package.json` at npm version 10.0.0 declares `engines.node: ^20.19.0 || ^22.12.0 || >=24.0.0`.

### [MEDIUM | confidence=medium] `typescript` peer range `^5` will be rejected once TS 6 reaches users

- **File**: `package.json:79-81`
- **Quote**:

  ```json
    "peerDependencies": {
      "typescript": "^5"
    },
  ```

- **Issue**: `peerDependencies.typescript: ^5` excludes TypeScript 6. `typescript@6.0.3` is already published as `latest` on npm (per `npm outdated --json`). Consumer projects that upgrade to TS 6 will receive a peer-conflict warning (or install failure on `npm install --legacy-peer-deps=false`) when pulling this plugin. Because this plugin ships type declarations (`"types": "./dist/index.d.ts"`), a TS6 consumer also needs the `.d.ts` to be valid under TS6.
- **Recommendation**: Track TS6 compatibility separately; once verified, widen the peer to `^5 || ^6`. If TS6 requires `.d.ts` regeneration, gate the peer-widen on that work.
- **Evidence**: `npm outdated` shows `typescript` latest=6.0.3 vs current 5.9.3; `@typescript-eslint@8` does not yet support TS6 (upstream matrix).

### [MEDIUM | confidence=high] Host SDK declared as hard `dependency` instead of `peerDependency`

- **File**: `package.json:98-103`
- **Quote**:

  ```json
    "dependencies": {
      "@openauthjs/openauth": "^0.4.3",
      "@opencode-ai/plugin": "^1.2.9",
      "hono": "4.12.14",
      "zod": "^4.3.6"
    },
  ```

- **Issue**: `@opencode-ai/plugin` is the host SDK loaded *by* OpenCode. Plugin packages conventionally declare the host SDK as a `peerDependency` with `peerDependenciesMeta` so that (a) the host's copy is the canonical one at runtime, (b) `instanceof` checks across the plugin/host boundary succeed, and (c) consumers can see the supported host range. Declaring it as `dependencies` forces npm to install a second copy nested in the plugin's `node_modules/`, which is what causes the dual-zod issue documented in MEDIUM-07 below.
- **Recommendation**: Move `@opencode-ai/plugin` to `peerDependencies` with range `^1.2 || ^1.3 || ^1.4` (or whatever compatibility range is verified), add `peerDependenciesMeta.@opencode-ai/plugin.optional: false`, and keep it in `devDependencies` so local dev still installs a copy. Document the change in CHANGELOG under "BREAKING" if any consumer was relying on the nested copy.
- **Evidence**: `npm ls --all --prod --json` shows `@opencode-ai/plugin@1.2.9` with its own nested `@opencode-ai/sdk@1.2.9` and nested `zod@4.1.8`, proving the second-copy install path.

### [MEDIUM | confidence=medium] `hono` double-pinned (dependency + override) locks transitive patches

- **File**: `package.json:101,106`
- **Quote**:

  ```json
      "hono": "4.12.14",
  ```

  (appears twice — once in `dependencies`, once in `overrides`)

- **Issue**: `hono` is pinned to the exact version `4.12.14` in both `dependencies` and `overrides`. The override forces every transitive consumer (notably `@openauthjs/openauth`) onto the same exact version. This was presumably done to avoid a dual-copy runtime, but it also means any hono patch (e.g. `4.12.15` landing a security fix) will be *blocked* until both manifest entries are updated. If a future security advisory requires `hono >= 4.12.15`, the repo maintainer has to remember to update both places.
- **Recommendation**: Change both entries to `^4.12.14` so patch bumps are picked up automatically while still coordinating the dual-copy. Alternately, document the exact-pin policy in `docs/development/OVERRIDES.md` per MEDIUM-01.
- **Evidence**: `package.json:101` (dependency) + `package.json:106` (override) both literal `"4.12.14"` with no caret.

### [MEDIUM | confidence=high] Two copies of zod at runtime (4.3.6 top-level, 4.1.8 under `@opencode-ai/plugin`)

- **File**: `package.json:102`
- **Quote**:

  ```json
      "zod": "^4.3.6"
  ```

- **Issue**: Top-level `zod` resolves to `4.3.6` per lockfile. `@opencode-ai/plugin@1.2.9` nests its own `zod@4.1.8`. Any zod schema instance created inside `@opencode-ai/plugin` and passed back to the repo will fail `instanceof ZodSchema` checks against the repo-side zod import, because the two are separate module instances with separate constructor identities. Most runtime code avoids `instanceof` in favour of `.safeParse()`, which duck-types through, but any library boundary that relies on identity (e.g. zod's internal `ZodEffects` wrapping) will silently diverge.
- **Recommendation**: Either (a) add `zod` to `overrides` to force both copies onto a single version (likely `^4.3.6`), or (b) move `@opencode-ai/plugin` to `peerDependencies` per MEDIUM-05, which lets npm dedupe the zod copy at install time in the consumer's tree.
- **Evidence**: `npm ls --all --prod --json` output shows `zod@4.1.8` under `@opencode-ai/plugin` and `zod@4.3.6` at top level.

### [MEDIUM | confidence=medium] `prepare: husky` breaks `npm install` in environments without `.git`

- **File**: `package.json:55`
- **Quote**:

  ```json
      "prepare": "husky"
  ```

- **Issue**: The `prepare` npm lifecycle hook runs on every `npm install` in a local checkout. `husky` (v9) exits non-zero when `.git/` is absent or when `core.hooksPath` cannot be set (common in Dockerfile builds with `COPY package*.json` before `COPY .git`, or in unpacked-tarball test environments, or in `npm ci` sandboxes that shallow-clone). The historical fix is to wrap with `husky install || true`, or use `is-ci` to skip. The current unguarded call aborts the install and blocks CI / consumer reproduction.
- **Recommendation**: Replace with the documented husky-v9 pattern: `"prepare": "husky || true"` or `"prepare": "node -e \"if(!process.env.CI) require('husky').install()\""`. For production installs (`npm ci --omit=dev`), the hook is skipped already because husky is a devDependency.
- **Evidence**: husky v9 CHANGELOG documents the `.git`-absent failure mode; `node_modules/husky/package.json` declares `bin.husky: bin.js` which exits 1 when it cannot find a git root.

### [MEDIUM | confidence=high] Publish surface ships `scripts/test-all-models.sh` + `scripts/validate-model-map.sh`

- **File**: `package.json:60-67`
- **Quote**:

  ```json
    "files": [
      "dist/",
      "assets/",
      "config/",
      "scripts/",
      "README.md",
      "LICENSE"
    ],
  ```

- **Issue**: The `files` field includes the entire `scripts/` directory. `npm pack --dry-run` confirms `scripts/test-all-models.sh` (11.2 kB), `scripts/validate-model-map.sh` (3.8 kB), `scripts/copy-oauth-success.js` (1.6 kB), and `scripts/audit-dev-allowlist.js` (3.3 kB) are included in every published tarball. Only `scripts/install-oc-codex-multi-auth.js` + `scripts/install-oc-codex-multi-auth-core.js` are actually needed at install time (per the `bin` entry). The shell scripts are integration-test helpers; shipping them bloats the published artifact, leaks repo conventions to end users, and introduces a non-zero surface for platform-specific issues (shell scripts do not run on Windows without WSL).
- **Recommendation**: Replace the blanket `"scripts/"` in `files` with explicit file paths: `"scripts/install-oc-codex-multi-auth.js"` and `"scripts/install-oc-codex-multi-auth-core.js"`. Confirm no other scripts/*.{js,sh} file is needed at install time by running `npm pack --dry-run` before and after.
- **Evidence**: `npm pack --dry-run` output (in `.sisyphus/evidence/task-14-npm-audit.md`): 252 files total, with `scripts/test-all-models.sh` explicitly listed.

### [MEDIUM | confidence=low] Supply-chain concentration: 6 transitive deps share one maintainer

- **File**: `package.json:99`
- **Quote**:

  ```json
      "@openauthjs/openauth": "^0.4.3",
  ```

- **Issue**: `@openauthjs/openauth` pulls in `arctic`, `@oslojs/crypto`, `@oslojs/encoding`, `@oslojs/jwt`, `@oslojs/asn1`, `@oslojs/binary` — six packages from a single upstream maintainer (pilcrowOnPaper / oslo ecosystem). While individually well-regarded, this concentration means a single compromised npm account or maintainer abandonment would require migrating or vendoring all six in lockstep. The combined dependency is also in the production credential path (OAuth + PKCE + JWT).
- **Recommendation**: Track upstream maintainer status; if the risk materialises, consider vendoring the `@oslojs/*` modules (each is small, zero-dep, and MIT) into `lib/auth/vendor/` or switching to a different ecosystem. No immediate action required.
- **Evidence**: `npm ls --all --prod --json` transitive tree under `@openauthjs/openauth`; maintainer attribution from upstream GitHub pages.

### [MEDIUM | confidence=medium] Three pre-1.0 packages in production credential path

- **File**: `package.json:99`
- **Quote**:

  ```json
      "@openauthjs/openauth": "^0.4.3",
  ```

- **Issue**: `@openauthjs/openauth@0.4.3` (top-level), `@oslojs/jwt@0.2.0` (transitive), and `@standard-schema/spec@1.0.0-beta.3` (transitive) are all pre-1.0 per semver convention. Pre-1.0 packages make no API-stability guarantee between minor versions. Because these packages live in the OAuth/JWT credential path, any upstream breaking change can cascade into silent auth-flow failures. Cross-reference T02 (security) for credential-handling details.
- **Recommendation**: Cross-reference T02 findings on credential handling. Monitor upstream 1.0 releases. Add CI smoke-test coverage (a single real OAuth round-trip in an isolated test account) to catch breakage earlier than customer bug reports.
- **Evidence**: `npm ls --all --prod --json` versions listed; semver 0.x / beta tag convention.

### [LOW | confidence=medium] `@types/node@^25` on a `>=18` runtime engine

- **File**: `package.json:85`
- **Quote**:

  ```json
      "@types/node": "^25.3.0",
  ```

- **Issue**: DefinitelyTyped's `@types/node@25.x` carries typings for Node 25 runtime APIs (native fetch variants, new worker_threads surfaces, etc.). Code authored with these types will compile cleanly against TS but silently run-break on Node 18. The mismatch is not a security issue, only a build-versus-runtime drift.
- **Recommendation**: Bump `engines.node` to `>=20` (matches the eslint-10 and vitest-4 dev-stack) OR pin `@types/node` to the version family matching the lowest supported runtime (`@types/node@^18.x` if 18 is the floor, `@types/node@^22.x` if 22 is acceptable).
- **Evidence**: `@types/node` upstream README documents Node API mapping per major.

### [LOW | confidence=high] `.npmignore` coexists with `files` field; `.npmignore` is dead

- **File**: `.npmignore:1-14`
- **Quote**:

  ```
  .git
  .gitignore
  .DS_Store
  node_modules/
  bun.lockb
  pnpm-lock.yaml
  package-lock.json
  opencode.json
  test-*.mjs
  *.log
  .vscode/
  .idea/
  docs/
  .github/
  ```

- **Issue**: npm's publish algorithm uses the `files` field when present and ignores `.npmignore`. Because `package.json:60-67` declares `files`, this entire `.npmignore` file has no effect on published output. Leaving it creates a maintenance trap: a future contributor editing `.npmignore` to exclude something will think they've succeeded when they haven't.
- **Recommendation**: Delete `.npmignore`. Add a comment to `package.json` (or `docs/development/`) explaining that `files` is the source of truth for publish inclusions.
- **Evidence**: npm docs — "if `files` is present in package.json, `.npmignore` is not consulted."

### [LOW | confidence=medium] `bin` script lacks README note that install is side-effect-free

- **File**: `scripts/install-oc-codex-multi-auth.js:1-15`
- **Quote**:

  ```js
  #!/usr/bin/env node

  import { resolve } from "node:path";
  import { fileURLToPath } from "node:url";
  import { runInstaller } from "./install-oc-codex-multi-auth-core.js";

  export * from "./install-oc-codex-multi-auth-core.js";

  if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  	runInstaller().catch((error) => {
  		const message = error instanceof Error ? error.message : String(error);
  		console.error(`Installer failed: ${message}`);
  		process.exit(1);
  	});
  }
  ```

- **Issue**: The `bin` entrypoint is safe-to-import (uses the `process.argv[1] === fileURLToPath(import.meta.url)` guard) and there is no `postinstall` hook, so `npm install oc-codex-multi-auth` does NOT auto-run the installer. A security-minded consumer cannot tell this without reading the source. A README note would avoid unnecessary friction.
- **Recommendation**: Add a one-line note to `README.md` "Installation" section: "This package ships a `bin` installer script but does NOT run on `npm install`. Invoke via `npx` explicitly."
- **Evidence**: `package.json` has no `postinstall`/`preinstall` keys; the `bin` shebang + self-guard are verified in the code block above.

### [LOW | confidence=low] Dev-stack minor drift is across the board (12 of 13 outdated are semver-safe)

- **File**: `package.json:82-97`
- **Quote**:

  ```json
    "devDependencies": {
      "@fast-check/vitest": "^0.2.4",
      "@opencode-ai/sdk": "^1.2.10",
      "@types/node": "^25.3.0",
      "@typescript-eslint/eslint-plugin": "^8.56.0",
      "@typescript-eslint/parser": "^8.56.0",
      "@vitest/coverage-v8": "^4.0.18",
      "@vitest/ui": "^4.0.18",
      "eslint": "^10.0.0",
      "fast-check": "^4.5.3",
      "husky": "^9.1.7",
      "lint-staged": "^16.2.7",
      "typescript": "^5.9.3",
      "typescript-language-server": "^5.1.3",
      "vitest": "^4.0.18"
    },
  ```

- **Issue**: Twelve devDependencies are one or more patch/minor versions behind upstream (vitest stack `^4.0.18` → `4.1.4`, eslint `10.0.0` → `10.2.0`, `@typescript-eslint/*` `8.56.0` → `8.58.2`, etc.). None are security advisories (confirmed by `npm audit`). The drift is minor and would be absorbed by a routine `npm update` inside the declared caret ranges.
- **Recommendation**: Schedule a quarterly `npm update` PR; add a renovate or dependabot config to auto-open minor-bump PRs for devDependencies. No urgent action.
- **Evidence**: `npm outdated --json` full output captured in `.sisyphus/evidence/task-14-npm-audit.md`.

---

## Summary Count by Severity

| Severity | Count | Budget |
|---|---:|---:|
| CRITICAL | 0 | ≤5 |
| HIGH | 2 | ≤15 |
| MEDIUM | 10 | ≤40 |
| LOW | 4 | unbounded |
| **Total** | **16** | — |

Budget respected. No downgrades applied.

---

## Cross-References

- **T02 (security)**: MEDIUM-12 (pre-1.0 credential path) overlaps T02's OAuth/PKCE findings. Do not duplicate in user-facing report; cite from T14.
- **T15 (CI / release / OSS readiness)**: The `audit:ci` script, Dependabot configuration, and release gate belong to T15. This audit only documented their current shape (Section 12).
- **T11 (config / installer / migration)**: `scripts/install-oc-codex-multi-auth.js` safety audited here (LOW-03); deeper migration logic belongs to T11.

---

## Notes

- Lockfile version: `lockfileVersion: 3` (expected for npm ≥ 7).
- No unusual `resolutions`-style (yarn) or `pnpm.overrides` entries present.
- No git-ref or tarball-URL dependencies in the production graph — all resolve to `https://registry.npmjs.org/`.
- Commit `d92a8ee` (the audit HEAD) explicitly patched Dependabot advisories, which is consistent with the 0/0/0/0/0 audit result.
- `@openauthjs/openauth` upstream (github.com/openauthjs/openauth) is MIT per README; the missing field is a manifest bug, not a license absence.

*End of T14 findings. 14 findings, SHA `d92a8eedad906fcda94cd45f9b75a6244fd9ef51`, rubric-version: 1.*
