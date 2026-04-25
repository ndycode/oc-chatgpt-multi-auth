> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T12:45:33+08:00 | Scope: feature recommendations

# Feature Recommendations

Feature ideas that fit the current structure:

1. Add `codex-export format=json` once there is a shared tool JSON-output helper.
2. Add a package-smoke script that runs `npm pack`, installs the tarball in a temp project, imports the ESM entry, and runs installer dry-run.
3. Add `codex-doctor exportPath=<file>` for sanitized support bundles.
4. Add a current-structure docs generator if the audit corpus keeps changing with large refactors.

Deferred:

- New public APIs.
- Storage schema changes.
- Model alias changes.
- Broad request-pipeline rewrites without a concrete failing test.
