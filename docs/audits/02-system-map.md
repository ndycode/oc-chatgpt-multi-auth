> Audit source: 3331324cb14d2b80dd8dfb424619870a88476706 | Generated: 2026-04-25T12:45:33+08:00 | Scope: system map

# System Map

```text
OpenCode
  -> index.ts
     -> auth.loader and fetch pipeline
     -> ToolContext construction
     -> createToolRegistry(ctx)
        -> 21 lib/tools/codex-*.ts modules
  -> lib/request/*
     -> URL rewrite, body transform, headers, retry classification, SSE handling
  -> lib/accounts.ts
     -> accounts/state.ts, persistence.ts, rotation.ts, recovery.ts, rate-limits.ts
  -> lib/storage.ts
     -> storage/load-save.ts, export-import.ts, keychain.ts, flagged.ts, paths.ts
  -> ChatGPT Codex backend
```

Key current anchors:

- Tool registry: `lib/tools/index.ts`.
- Registry attachment: `index.ts` builds `ToolContext` and exposes `tool: createToolRegistry(ctx)`.
- Stateless request contract: `lib/request/request-transformer.ts` forces `store: false` and includes `reasoning.encrypted_content`.
- OAuth callback: `lib/oauth-constants.ts` and `lib/auth/server.ts` keep port 1455.
- Storage facade: `lib/storage.ts` preserves public imports while focused modules own implementation.
