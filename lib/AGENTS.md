# LIB KNOWLEDGE BASE

Generated: 2026-01-30

## OVERVIEW
Core plugin logic: authentication, request pipeline, account management, prompt templates.

## STRUCTURE
```
lib/
├── auth/           # OAuth flow (PKCE, server, browser)
├── request/        # fetch pipeline (transform, headers, response)
├── prompts/        # model-family prompts (Codex, bridge)
├── recovery/       # session state persistence
├── accounts.ts     # multi-account pool, rotation, health scoring
├── storage.ts      # V3 JSON storage, per-project/global
├── config.ts       # plugin config parsing
├── constants.ts    # URLs, limits, labels
├── types.ts        # TypeScript interfaces
├── logger.ts       # debug/request logging
├── rotation.ts     # account selection algorithm
└── index.ts        # barrel exports
```

## WHERE TO LOOK
| Task | Location | Notes |
| --- | --- | --- |
| Token exchange/refresh | `auth/auth.ts` | PKCE flow, JWT decode, skew window |
| Browser launch | `auth/browser.ts` | platform-specific open |
| Callback server | `auth/server.ts` | HTTP on port 1455 |
| URL/body transform | `request/request-transformer.ts` | model map, prompt injection |
| Headers + errors | `request/fetch-helpers.ts` | Codex headers, rate limit handling |
| SSE parsing | `request/response-handler.ts` | `response.done` extraction |
| Rate limit backoff | `request/rate-limit-backoff.ts` | exponential + jitter |
| Model family detection | `prompts/codex.ts` | GPT-5.x, Codex variants |
| Bridge prompts | `prompts/codex-opencode-bridge.ts` | tool remapping instructions |
| Account selection | `rotation.ts` | hybrid health + token bucket |
| Storage format | `storage.ts` | V3 with migration from V1/V2 |

## CONVENTIONS
- All exports via `lib/index.ts` barrel.
- Model families defined in `prompts/codex.ts`: `MODEL_FAMILIES` constant.
- Account health: 0-100 score, decrements on failure, resets on success.
- Token bucket: per-account request tracking for rate limit avoidance.

## ANTI-PATTERNS
- Never import from `dist/`; use source paths.
- Never suppress type errors.
- Never hardcode OAuth ports (use `REDIRECT_URI` constant).
