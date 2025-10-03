# AI Agent Maintenance Guide

This guide is specifically written for AI coding assistants (Claude, GPT-4, etc.) maintaining the OpenAI Codex OAuth plugin. It provides quick reference for common tasks and patterns to follow.

## 🎯 Core Philosophy

This codebase follows these principles:
1. **Single Responsibility** - Each function does one thing well
2. **Centralized Configuration** - All magic values in `lib/constants.ts`
3. **Type Safety First** - Strict TypeScript throughout
4. **Test Everything** - 93 tests covering all functionality
5. **Clear Naming** - Function names describe exactly what they do
6. **Comprehensive JSDoc** - Every public function documented

## 📁 Codebase Structure

### Quick Navigation

```
index.ts                          → Main plugin entry (213 lines)
├── exports OpenAIAuthPlugin
├── contains fetch() implementation (42 lines, 7 steps)
└── contains authorize() OAuth flow

lib/
├── constants.ts                  → ALL magic values, URLs, error messages
├── types.ts                      → TypeScript type definitions
├── fetch-helpers.ts              → 10 focused helper functions
├── auth.ts                       → OAuth/PKCE authentication
├── request-transformer.ts        → Request body transformation
├── response-handler.ts           → SSE to JSON conversion
├── browser.ts                    → Platform-specific browser opening
├── codex.ts                      → Codex instructions fetching
├── logger.ts                     → Debug logging utilities
└── server.ts                     → Local OAuth callback server

test/
├── fetch-helpers.test.ts         → 15 tests for helper functions
├── browser.test.ts               → 4 tests for platform detection
├── auth.test.ts                  → 16 tests for OAuth flow
├── request-transformer.test.ts   → 30 tests for transformations
├── response-handler.test.ts      → 10 tests for SSE conversion
├── config.test.ts                → 13 tests for configuration
└── logger.test.ts                → 5 tests for logging

config/
├── full-opencode.json            → Complete configuration example
├── minimal-opencode.json         → Minimal configuration example
└── README.md                     → Configuration documentation
```

## 🔧 Common Modification Scenarios

### 1. Adding a New Header

**Location**: `lib/fetch-helpers.ts` → `createCodexHeaders()`

```typescript
export function createCodexHeaders(
    init: RequestInit | undefined,
    accountId: string,
    accessToken: string
): Headers {
    const headers = new Headers(init?.headers ?? {});

    // Add your new header here
    headers.set("X-New-Header", "value");

    return headers;
}
```

**Test Location**: `test/fetch-helpers.test.ts`

```typescript
it('should include new header', () => {
    const headers = createCodexHeaders(undefined, accountId, accessToken);
    expect(headers.get('X-New-Header')).toBe('value');
});
```

### 2. Adding a New Constant

**Location**: `lib/constants.ts`

```typescript
// Add to appropriate category
export const NEW_CONSTANT_GROUP = {
    KEY1: "value1",
    KEY2: "value2",
} as const;
```

**Pattern**: Always use `as const` for type safety and group related constants together.

### 3. Modifying URL Rewriting Logic

**Location**: `lib/fetch-helpers.ts` → `rewriteUrlForCodex()`

```typescript
export function rewriteUrlForCodex(url: string): string {
    // Add new URL transformations here
    return url
        .replace(URL_PATHS.RESPONSES, URL_PATHS.CODEX_RESPONSES)
        .replace(URL_PATHS.NEW_PATH, URL_PATHS.NEW_CODEX_PATH); // New transformation
}
```

**Test Location**: `test/fetch-helpers.test.ts`

```typescript
it('should rewrite new path correctly', () => {
    const url = 'https://example.com/new-path';
    expect(rewriteUrlForCodex(url)).toBe('https://example.com/codex/new-path');
});
```

### 4. Adding Request Transformation Logic

**Location**: `lib/request-transformer.ts` → `transformRequestBody()`

This function already handles:
- Reasoning effort configuration
- Reasoning summary configuration
- Text verbosity configuration
- System message injection

**Pattern**: Follow existing configuration pattern in `transformRequestBody()`.

### 5. Modifying Token Refresh Logic

**Location**: `lib/fetch-helpers.ts` → `shouldRefreshToken()` and `refreshAndUpdateToken()`

```typescript
// Check condition
export function shouldRefreshToken(auth: Auth): boolean {
    return auth.type !== "oauth"
        || !auth.access
        || auth.expires < Date.now()
        || yourNewCondition; // Add here
}

// Refresh implementation
export async function refreshAndUpdateToken(
    currentAuth: Auth,
    client: OpencodeClient
): Promise<{ success: true; auth: Auth } | { success: false; response: Response }> {
    // Modification goes here
}
```

### 6. Adding a New Platform for Browser Opening

**Location**: `lib/browser.ts` → `getBrowserOpener()`

**Step 1**: Add constant to `lib/constants.ts`
```typescript
export const PLATFORM_OPENERS = {
    darwin: "open",
    win32: "start",
    linux: "xdg-open",
    freebsd: "xdg-open", // Add new platform
} as const;
```

**Step 2**: Update `getBrowserOpener()`
```typescript
export function getBrowserOpener(): string {
    const platform = process.platform;
    if (platform === "darwin") return PLATFORM_OPENERS.darwin;
    if (platform === "win32") return PLATFORM_OPENERS.win32;
    if (platform === "freebsd") return PLATFORM_OPENERS.freebsd; // Add here
    return PLATFORM_OPENERS.linux;
}
```

**Step 3**: Add test in `test/browser.test.ts`
```typescript
it('should handle freebsd platform', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'freebsd' });
    expect(getBrowserOpener()).toBe(PLATFORM_OPENERS.freebsd);
    Object.defineProperty(process, 'platform', { value: originalPlatform });
});
```

### 7. Adding Error Messages

**Location**: `lib/constants.ts` → `ERROR_MESSAGES`

```typescript
export const ERROR_MESSAGES = {
    NO_ACCOUNT_ID: "Failed to extract accountId from token",
    TOKEN_REFRESH_FAILED: "Failed to refresh token, authentication required",
    NEW_ERROR: "Your new error message", // Add here
} as const;
```

**Usage**:
```typescript
console.error(`[${PLUGIN_NAME}] ${ERROR_MESSAGES.NEW_ERROR}`);
```

### 8. Adding Configuration Options

**Location**: `lib/types.ts` → `ConfigOptions`

```typescript
export interface ConfigOptions {
    reasoningEffort?: "minimal" | "low" | "medium" | "high";
    reasoningSummary?: "auto" | "concise" | "detailed";
    textVerbosity?: "low" | "medium" | "high";
    newOption?: "value1" | "value2"; // Add here
    include?: string[];
}
```

**Then update**: `lib/request-transformer.ts` to handle the new option.

## 🧪 Testing Requirements

### When to Add Tests

**ALWAYS add tests when**:
- Adding new functions
- Modifying existing logic
- Adding new constants (if they affect behavior)
- Adding new configuration options
- Changing URL rewriting
- Modifying header creation
- Updating token refresh logic

### Test Structure Pattern

```typescript
describe('Module Name', () => {
    describe('functionName', () => {
        it('should handle normal case', () => {
            // Arrange
            const input = createTestInput();

            // Act
            const result = functionName(input);

            // Assert
            expect(result).toBe(expectedValue);
        });

        it('should handle edge case', () => {
            // Test edge case
        });

        it('should handle error case', () => {
            // Test error handling
        });
    });
});
```

### Running Tests

```bash
npm test                    # Run all tests
npm test -- --watch        # Watch mode
npm test -- --ui           # Visual UI
npm test -- --coverage     # Coverage report
```

**Requirement**: All 93 tests must pass before committing.

## 📝 Code Patterns to Follow

### 1. Function Naming

✅ **Good** - Verb + Noun, describes what it does:
```typescript
shouldRefreshToken()
createCodexHeaders()
extractRequestUrl()
rewriteUrlForCodex()
handleErrorResponse()
```

❌ **Bad** - Vague or unclear:
```typescript
checkToken()        // Check what about token?
makeHeaders()       // Make what kind?
getUrl()           // Get from where?
```

### 2. JSDoc Comments

**Always include** for public functions:
```typescript
/**
 * Brief description of what function does
 *
 * @param paramName - Description of parameter
 * @param anotherParam - Description of another parameter
 * @returns Description of return value
 *
 * @example
 * const result = functionName(input);
 */
export function functionName(paramName: Type, anotherParam: Type): ReturnType {
    // implementation
}
```

### 3. Error Handling

**Pattern**: Return result objects instead of throwing
```typescript
// ✅ Good - Discriminated union return type
type Result =
    | { success: true; data: Data }
    | { success: false; error: Error };

export function doSomething(): Result {
    if (errorCondition) {
        return { success: false, error: new Error("message") };
    }
    return { success: true, data: result };
}

// Usage
const result = doSomething();
if (!result.success) {
    return result.error;
}
// Use result.data
```

### 4. Logging

**Pattern**: Use constants and plugin name prefix
```typescript
import { PLUGIN_NAME, ERROR_MESSAGES, LOG_STAGES } from "./constants.js";

// ✅ Good
console.error(`[${PLUGIN_NAME}] ${ERROR_MESSAGES.TOKEN_REFRESH_FAILED}`);
logRequest(LOG_STAGES.RESPONSE, data);

// ❌ Bad
console.error("Failed to refresh token");
console.log("Response:", data);
```

### 5. Type Definitions

**Pattern**: Import types with `type` keyword
```typescript
// ✅ Good
import type { Auth, OpencodeClient } from "@opencode-ai/sdk";
import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { UserConfig, ConfigOptions } from "./types.js";

// ❌ Bad
import { Auth } from "@opencode-ai/sdk"; // Runtime import when only type is needed
```

### 6. Constants

**Pattern**: Group related constants, use `as const`
```typescript
// ✅ Good
export const OPENAI_HEADERS = {
    ACCOUNT_ID: "ChatGPT-Account-ID",
    BETA: "OpenAI-Beta",
    SESSION_ID: "OpenAI-Sentinel-Chat-Session-Id",
} as const;

// ❌ Bad
export const HEADER_ACCOUNT_ID = "ChatGPT-Account-ID";
export const HEADER_BETA = "OpenAI-Beta";
export const HEADER_SESSION_ID = "OpenAI-Sentinel-Chat-Session-Id";
```

## 🎯 Main Fetch Flow (Critical Understanding)

The `fetch()` function in `index.ts` is the heart of the plugin. It follows a strict 7-step flow:

```typescript
async fetch(input: Request | string | URL, init?: RequestInit): Promise<Response> {
    // Step 1: Check and refresh token if needed
    const currentAuth = await getAuth();
    if (shouldRefreshToken(currentAuth)) {
        const refreshResult = await refreshAndUpdateToken(currentAuth, client);
        if (!refreshResult.success) return refreshResult.response;
    }

    // Step 2: Extract and rewrite URL for Codex backend
    const originalUrl = extractRequestUrl(input);
    const url = rewriteUrlForCodex(originalUrl);

    // Step 3: Transform request body with Codex instructions
    const transformation = transformRequestForCodex(init, url, CODEX_INSTRUCTIONS, userConfig);
    const hasTools = transformation?.body.tools !== undefined;
    const requestInit = transformation?.updatedInit ?? init;

    // Step 4: Create headers with OAuth and ChatGPT account info
    const accessToken = currentAuth.type === "oauth" ? currentAuth.access : "";
    const headers = createCodexHeaders(requestInit, accountId, accessToken);

    // Step 5: Make request to Codex API
    const response = await fetch(url, { ...requestInit, headers });

    // Step 6: Log response
    logRequest(LOG_STAGES.RESPONSE, { status, ok, statusText, headers });

    // Step 7: Handle error or success response
    if (!response.ok) return await handleErrorResponse(response);
    return await handleSuccessResponse(response, hasTools);
}
```

**Important**: Each step is isolated in its own helper function for maintainability.

## 🔍 Where to Look for Specific Functionality

| Need to modify... | Go to... |
|-------------------|----------|
| URL rewriting | `lib/fetch-helpers.ts` → `rewriteUrlForCodex()` |
| Headers | `lib/fetch-helpers.ts` → `createCodexHeaders()` |
| Token refresh | `lib/fetch-helpers.ts` → `refreshAndUpdateToken()` |
| Token validation | `lib/fetch-helpers.ts` → `shouldRefreshToken()` |
| Request body transformation | `lib/request-transformer.ts` → `transformRequestBody()` |
| SSE to JSON conversion | `lib/response-handler.ts` → `convertSseToJson()` |
| Error handling | `lib/fetch-helpers.ts` → `handleErrorResponse()` |
| OAuth flow | `lib/auth.ts` → `createAuthorizationFlow()` |
| Browser opening | `lib/browser.ts` → `openBrowserUrl()` |
| Codex instructions | `lib/codex.ts` → `getCodexInstructions()` |
| Any constant/magic value | `lib/constants.ts` |
| Type definitions | `lib/types.ts` |

## 🚀 Quick Start for Common Tasks

### Task: Fix a Bug in Token Refresh

1. Read `lib/fetch-helpers.ts` → `shouldRefreshToken()` and `refreshAndUpdateToken()`
2. Read existing tests in `test/fetch-helpers.test.ts`
3. Add test case reproducing the bug
4. Fix the bug in the helper function
5. Verify all 93 tests pass: `npm test`
6. Run build: `npm run build`

### Task: Add Support for New Model Configuration

1. Update `lib/types.ts` → `ConfigOptions` interface
2. Update `lib/request-transformer.ts` → `transformRequestBody()`
3. Add tests in `test/request-transformer.test.ts`
4. Update `config/full-opencode.json` with example
5. Update `config/README.md` with documentation
6. Verify all tests pass

### Task: Change How URLs are Rewritten

1. Update `lib/fetch-helpers.ts` → `rewriteUrlForCodex()`
2. Update constants in `lib/constants.ts` if needed
3. Add tests in `test/fetch-helpers.test.ts`
4. Verify all tests pass

### Task: Improve Error Messages

1. Update `lib/constants.ts` → `ERROR_MESSAGES`
2. Update usage in relevant files (search for old message)
3. Update tests that check error messages
4. Verify all tests pass

## ⚠️ Critical Rules

1. **NEVER modify code without reading relevant tests first**
2. **ALWAYS run tests before and after changes**
3. **NEVER use magic strings** - add to `lib/constants.ts`
4. **ALWAYS add JSDoc** to new public functions
5. **NEVER create functions > 70 lines** - extract helpers
6. **ALWAYS use discriminated unions** for result types
7. **NEVER throw exceptions** - return error objects
8. **ALWAYS import types with `type` keyword** when only type is needed
9. **NEVER commit with failing tests**
10. **ALWAYS check TypeScript compilation**: `npm run build`

## 📊 Quality Checklist

Before completing any task:

- [ ] All 93 tests pass (`npm test`)
- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] New functions have JSDoc comments
- [ ] New functionality has tests
- [ ] No magic strings (all in `constants.ts`)
- [ ] Functions are < 70 lines
- [ ] Clear, descriptive naming
- [ ] Types imported with `type` keyword where applicable
- [ ] No `any` types used
- [ ] Error handling follows result pattern

## 🎓 Understanding the Architecture

### Why 10 Helper Functions?

The original `fetch()` was 148 lines. Breaking it into 10 focused functions:
- Reduces cognitive load (each function < 40 lines)
- Enables isolated testing
- Makes modifications surgical instead of risky
- Allows LLMs to load only relevant context
- Documents the flow through function names

### Why Centralized Constants?

Having all magic values in `lib/constants.ts`:
- Single source of truth
- Easy to find and modify
- Type-safe access
- Reveals all configurable values at a glance
- Reduces context needed to understand strings/values

### Why Discriminated Unions for Results?

Pattern like `{ success: true; data } | { success: false; error }`:
- Type-safe error handling
- Forces consumers to handle errors
- No unexpected exceptions
- Clear success/failure paths
- Better than throwing exceptions

### Why Separate Test Files?

Each module has its own test file:
- Tests colocated with functionality conceptually
- Easy to find relevant tests
- Faster test execution (can run subset)
- Clear coverage per module
- Easier to maintain

## 🔮 Future Extension Points

The architecture makes these additions easy:

1. **New authentication method** → Add to `lib/auth.ts`, follow OAuth pattern
2. **New model variant** → Update `config/` examples, no code changes needed
3. **New configuration option** → Update `lib/types.ts` and `lib/request-transformer.ts`
4. **New platform support** → Add to `lib/browser.ts` and `lib/constants.ts`
5. **Additional headers** → Modify `createCodexHeaders()` in `lib/fetch-helpers.ts`
6. **Different response format** → Add handler in `lib/response-handler.ts`
7. **Enhanced logging** → Update `lib/logger.ts`
8. **Rate limiting** → Add helper in `lib/fetch-helpers.ts`, integrate in step flow

## 📚 Additional Resources

- **config/README.md** - Configuration examples and documentation
- **test/** - Reference implementations showing how to use each module
- **lib/types.ts** - Complete type definitions for the plugin

## 🤝 Maintenance Philosophy

This codebase is optimized for AI agent maintenance. When making changes:

1. **Read first, write second** - Understand existing patterns before modifying
2. **Follow established patterns** - Consistency reduces cognitive load
3. **Test everything** - Tests are documentation and safety net
4. **Keep functions small** - < 70 lines, single responsibility
5. **Document intent** - JSDoc explains the "why", code shows the "how"
6. **Use type system** - Let TypeScript catch errors early
7. **Centralize configuration** - DRY principle for all constants

Remember: The goal is maintainability by AI assistants. Every change should make the codebase easier to understand, modify, and extend.
