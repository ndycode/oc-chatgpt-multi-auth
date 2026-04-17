# AUDIT RUBRIC — Repo Audit (oc-codex-multi-auth)

> **Audit SHA**: d92a8eedad906fcda94cd45f9b75a6244fd9ef51 | **Generated**: 2026-04-17 | **Task**: T0 Setup | **Source**: `docs/audits/_meta/sha.lock`
>
> All audit tasks T1–T18 must read this file before producing findings.

---

## READ-ONLY Directive (CRITICAL)

**All downstream audit agents (T1–T16, T17, T18) operate in STRICT READ-ONLY mode on the repository.**

- DO NOT edit `lib/**`, `test/**`, `scripts/**`, `config/**`, `index.ts`, `package.json`, or any source/config file under audit.
- DO NOT run `npm install`, `npm run build`, or any command that mutates `node_modules/`, `dist/`, lockfiles, or working tree.
- DO NOT commit, stage, stash, or branch. `git` is allowed ONLY for read operations (`rev-parse`, `ls-files`, `log`, `blame`, `show`, `diff --stat`).
- DO NOT create files outside `docs/audits/**` and `.sisyphus/**`.
- DO NOT call external APIs, fetch remote content, or send telemetry.
- The SHA in `sha.lock` is the immutable point of reference. If you detect drift (working tree differs from SHA), HALT and report.

Violation of READ-ONLY = immediate task failure and rework required.

---

## Scope

- **In scope**: every path listed in `scope-whitelist.txt`.
- **Out of scope**: `dist/`, `node_modules/`, `coverage/`, `tmp*/`, `.sisyphus/`, `.claude/`, secrets (`.env*`, `*.key`, `*.pem`, `*credentials*`).
- If a path is not in the whitelist, do not audit it. If you believe an out-of-scope path is critical, flag in your findings `Notes` section; do not include it as a finding.

---

## Exclusion List (do NOT produce findings for these categories)

1. **Style nits** with no correctness/security/performance impact (e.g., single vs double quotes, import ordering when lint already catches it).
2. **Generated files**: `dist/**`, `coverage/**`, `*.d.ts` that are emitted outputs.
3. **Test fixtures** that are intentionally malformed to exercise error paths.
4. **Third-party code** under `node_modules/`.
5. **Historical commits**: audit current SHA only; do not report findings rooted in prior revisions.
6. **Speculative future features**: only audit code that exists at the locked SHA.
7. **Personal taste**: naming preferences, file length, comment density — unless they cause concrete defects.
8. **Duplicate findings**: if another agent has already logged the same issue with same file+line, do not re-log. Cross-reference instead.

---

## Severity Rubric

| Severity | Definition | Examples | Max Count |
|---|---|---|---|
| **CRITICAL** | Active security vulnerability, data-loss bug, credential exposure, RCE surface, or production-breaking defect with high likelihood of exploit / occurrence. | Hardcoded secret in committed file; token written to world-readable path; SQL/command injection; auth bypass; race that corrupts on-disk account JSON. | **≤ 5** |
| **HIGH** | Serious correctness, security, or reliability defect; likely to cause user-visible failure, silent data corruption, or meaningful security degradation. Fix required before next release. | Missing input validation on OAuth callback; unbounded retry storm; token refresh without mutex; PII in logs; broken circuit breaker. | **≤ 15** |
| **MEDIUM** | Real defect or risk that degrades robustness, performance, or maintainability. Fix recommended; workaround usually exists. | Missing error handling on non-critical path; N+1 fetch; missing test for edge case; inconsistent timeout values; confusing API shape. | **≤ 40** |
| **LOW** | Minor issue: code smell with mild risk, documentation gap, small optimisation, tightening that would reduce future defect probability. | Magic number; unclear variable name in hot path; missing JSDoc on public export; redundant cast. | unbounded |

**Budget enforcement**: if you exceed a severity max, down-grade the weakest items in that tier to the next tier down and note the downgrade in your `Notes`.

---

## Confidence Rubric

Every finding MUST include `confidence=high|medium|low`.

| Confidence | Criteria |
|---|---|
| **high** | Trivially obvious from a direct read of the quoted code; no assumptions about runtime state or external behaviour required. |
| **medium** | Requires 1–2 reasoning steps or a small assumption about typical runtime/config (documented in the finding). |
| **low** | Speculative; depends on assumptions about usage patterns, third-party behaviour, or unobserved runtime state. Include an explicit "Assumption" sentence. |

**Calibration rule**: if the fix is non-obvious OR the bug only manifests in a narrow edge case, downgrade confidence by one tier.

---

## Finding Format (exact template)

Every finding MUST use this exact markdown structure, in this exact order:

```markdown
### [SEVERITY | confidence=X] <concise title (≤80 chars)>

- **File**: `path/to/file.ts:line` (or `path/to/file.ts:lineStart-lineEnd`)
- **Quote**:

  ```ts
  // exact verbatim code from the file, ≤15 lines
  ```

- **Issue**: <1–3 sentences describing the defect, why it matters, and the concrete impact.>
- **Recommendation**: <specific, actionable fix. Reference APIs/patterns where helpful. No vague "consider refactoring".>
- **Evidence**: <cross-references: other file:line, test names, log excerpts, or RFC/CVE links. If none, write "direct read".>
```

Rules:
- `SEVERITY` ∈ {`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`} — uppercase, no quotes.
- `confidence=X` lowercased `X` ∈ {`high`, `medium`, `low`}.
- Title is a noun phrase describing the defect, not the fix.
- `File` path MUST be repo-relative, forward-slashes, with exact line(s).
- `Quote` MUST be verbatim from the locked SHA; do not paraphrase.
- `Issue`, `Recommendation`, `Evidence` are mandatory; empty/"n/a" not accepted.

---

## Per-Finding Document Header Block (MANDATORY at top of every audit deliverable)

Every `docs/audits/NN-<domain>.md` file produced by T1–T16 MUST begin with this header block before any finding:

```markdown
---
sha: <40-char SHA from sha.lock>
task: T<N>-<domain-slug>
agent: <agent name or id>
date: <ISO-8601 timestamp>
scope-files:
  - path/to/file1.ts
  - path/to/file2.ts
  # ... complete list of files this task actually audited
rubric-version: 1
---

# T<N> — <Domain Name>

**Summary**: <2–4 sentence high-level summary of what was audited and the headline findings count by severity.>

**Files audited**: <N> of <M> in-scope.

---

## Findings

<findings below using the Finding Format template>
```

Rules:
- The `sha` MUST match `docs/audits/_meta/sha.lock` exactly. If it does not, the document is invalid.
- `scope-files` MUST be a proper subset of `scope-whitelist.txt`.
- `rubric-version: 1` is the current rubric; bump only if this file is revised.

---

## Cross-Referencing

When a finding relates to another finding in the same or another audit doc, reference by:
- `See also: 04-security.md#<anchor-slug>` (Markdown heading anchor), or
- `Duplicate of: 06-reliability.md#<anchor>` when intentionally not re-logged.

Do not copy-paste duplicate findings across domains.

---

## Output Locations (reference)

- `docs/audits/INDEX.md` — TOC + executive pointers (T18 populates body).
- `docs/audits/01-executive-summary.md` … `docs/audits/16-verdict.md` — domain audits (one per T1..T16).
- `docs/audits/_findings/` — optional: per-task raw finding dumps if a task wants to stage intermediate artefacts.
- `docs/audits/_meta/` — this file, `sha.lock`, `scope-whitelist.txt`, `environment.md`.

---

## Quality Checklist (self-review before submitting an audit doc)

1. Header block present and `sha` matches `sha.lock`.
2. Every finding uses the exact Finding Format template.
3. Severity budgets respected (CRITICAL ≤5, HIGH ≤15, MEDIUM ≤40).
4. Every finding has a confidence rating with calibration applied.
5. No findings from the Exclusion List.
6. All `File` paths are in `scope-whitelist.txt`.
7. No quotes paraphrased; all verbatim.
8. READ-ONLY respected: no repo mutations, no network calls, no package installs.
9. Cross-references resolve (target headings exist).
10. Summary count by severity matches actual finding count.

---

*End of rubric. Rubric version: 1.*
