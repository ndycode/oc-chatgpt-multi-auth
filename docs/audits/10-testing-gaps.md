> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T12:45:33+08:00 | Scope: testing gaps

# Testing Gaps

Current high-value coverage:

- `test/index.test.ts` covers tool registration and extracted tool behavior through plugin wiring.
- `test/tools-codex-*.test.ts` covers focused tool regressions.
- `test/storage.test.ts` covers non-destructive export defaults.
- `test/doc-parity.test.ts` now covers config contract, tool registry count, and stale audit anchors.
- `test/contracts/*` pins Codex response shapes.

Remaining gaps:

- Package-smoke automation is still manual.
- Branch coverage is below the aspirational 80% floor; the executable gate is calibrated to the current baseline.
- Large request modules have broad tests, but not per-subdomain ownership tests.
