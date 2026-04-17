---
sha: d92a8eedad906fcda94cd45f9b75a6244fd9ef51
task: T05-type-safety
agent: opencode-build
date: 2026-04-17T00:00:00Z
scope-files:
  - tsconfig.json
  - eslint.config.js
  - index.ts
  - lib/schemas.ts
  - lib/runtime-contracts.ts
  - lib/types.ts
  - lib/config.ts
  - lib/storage.ts
  - lib/accounts.ts
  - lib/accounts/rate-limits.ts
  - lib/auth/auth.ts
  - lib/auth/login-runner.ts
  - lib/request/fetch-helpers.ts
  - lib/request/response-handler.ts
  - lib/request/helpers/input-utils.ts
  - lib/prompts/codex.ts
  - lib/auto-update-checker.ts
  - lib/recovery/storage.ts
rubric-version: 1
---

# T05 — Type Safety / TypeScript Quality

**Summary**: Strict mode is fully enabled (including `noUncheckedIndexedAccess` and `noImplicitReturns`) and the documented anti-patterns (`as any`, `@ts-ignore`, `@ts-expect-error`, non-null assertion `!.`) are all **absent** from production sources — the repo honors its own `AGENTS.md:67` convention. Principal type-safety risks are at trust boundaries: most `JSON.parse` sites in storage, config, request, and JWT code cast to typed shapes without runtime Zod validation (Zod is available via `lib/schemas.ts` but used in only two code paths). Discriminated unions (`TokenResult`) and the template-literal `QuotaKey` both exist and work as advertised, but **no branded types** are used for credential-bearing strings (AccountId, RefreshToken, AccessToken, email, orgId), so the type system cannot prevent cross-role confusion. `lib/runtime-contracts.ts` is misnamed — it holds 28 lines of OAuth-callback constants + error sentinels, not runtime contracts.

**Files audited**: 18 of 18 in-scope (plus the full `lib/` tree for pattern grep).

---

## Strict-Flag Status Table (tsconfig.json)

All flags read from `tsconfig.json:1-36` at SHA `d92a8ee`.

| Flag | Value | Source | Notes |
|---|---|---|---|
| `strict` | `true` | `tsconfig.json:11` | Master flag — enables all `strict*` / `noImplicit*` substrategies below. |
| `noImplicitAny` | (implicit via `strict`) | implied | Confirmed by zero `:\s*any` matches in `lib/**` + `index.ts`. |
| `strictNullChecks` | (implicit via `strict`) | implied | `?? ` / `??=` discipline is the project norm. |
| `strictFunctionTypes` | (implicit via `strict`) | implied | — |
| `strictBindCallApply` | (implicit via `strict`) | implied | — |
| `strictPropertyInitialization` | (implicit via `strict`) | implied | — |
| `alwaysStrict` | (implicit via `strict`) | implied | — |
| `useUnknownInCatchVariables` | (implicit via `strict` in TS ≥4.4) | implied | Evident in code: `(error as NodeJS.ErrnoException).code`. |
| `noUncheckedIndexedAccess` | `true` | `tsconfig.json:12` | Enables `T \| undefined` on every `arr[i]` and `record[k]` — good, but drives many `?? ""` defaults in auth/token parsing. |
| `noImplicitReturns` | `true` | `tsconfig.json:13` | — |
| `noFallthroughCasesInSwitch` | `true` | `tsconfig.json:14` | — |
| `exactOptionalPropertyTypes` | **not set** (defaults to `false`) | absent | **Gap**. See Finding M5. |
| `noUnusedLocals` | **not set** | absent | Delegated to ESLint `@typescript-eslint/no-unused-vars`. |
| `noUnusedParameters` | **not set** | absent | Delegated to ESLint (`argsIgnorePattern: "^_"`). |
| `noPropertyAccessFromIndexSignature` | **not set** (defaults to `false`) | absent | Acceptable trade-off; see Finding L2. |
| `noImplicitOverride` | **not set** | absent | Low impact (very few classes extend). |
| `esModuleInterop` | `true` | `tsconfig.json:15` | — |
| `skipLibCheck` | `true` | `tsconfig.json:16` | Standard for build throughput. |
| `forceConsistentCasingInFileNames` | `true` | `tsconfig.json:17` | — |
| `resolveJsonModule` | `true` | `tsconfig.json:18` | — |
| `declaration` / `declarationMap` / `sourceMap` | `true` | `tsconfig.json:19-21` | Emits `dist/**/*.d.ts` for consumers. |
| `module` / `moduleResolution` | `ES2022` / `bundler` | `tsconfig.json:7-8` | — |
| `target` | `ES2022` | `tsconfig.json:3` | — |

**Verdict**: strict baseline is solid. Two tightenings are ready to land without churn: `exactOptionalPropertyTypes` and `noUnusedLocals` (see Findings M5 and L1).

---

## ESLint Type Rules (eslint.config.js)

| Rule | Production (`index.ts`, `lib/**`) | Tests (`test/**`) | Notes |
|---|---|---|---|
| `@typescript-eslint/no-explicit-any` | `error` (`eslint.config.js:23`) | `off` (`:70`) | Test relaxation is intentional per `AGENTS.md:63`. |
| `@typescript-eslint/no-non-null-assertion` | `warn` (`:26`) | `off` (`:71`) | Warn-only is looser than the AGENTS anti-pattern claim; see Finding L3. |
| `@typescript-eslint/no-unused-vars` | `error` with `argsIgnorePattern: "^_"` (`:24`) | `off` (`:72`) | — |
| `@typescript-eslint/no-floating-promises` | `error` (`:29`) | default | — |
| `@typescript-eslint/no-misused-promises` | `error` (`:30`) | default | — |
| `@typescript-eslint/await-thenable` | `error` (`:31`) | default | — |
| `@typescript-eslint/require-await` | `warn` (`:32`) | default | — |
| `eqeqeq` | `error` | `error` (scripts share) | — |
| `no-duplicate-imports` | `error` | `off` | — |

---

## Anti-Pattern Scan Results

Scope: `index.ts` + `lib/**/*.ts` at SHA `d92a8ee`. All counts are from direct `Grep` at the locked SHA; see companion evidence `.sisyphus/evidence/task-5-antipattern-count.md` for reproduction.

| Pattern | Count (prod) | Count (tests) | Verdict |
|---|---|---|---|
| `\bas any\b` | **0** | 55 (8 files) | Production honors `AGENTS.md:67`. Tests use it deliberately with `no-explicit-any` disabled. |
| `@ts-ignore` | **0** | 0 | Not present anywhere in the repo. |
| `@ts-expect-error` | **0** | 0 | Not present anywhere in the repo. |
| `@ts-nocheck` | **0** | 0 | Not present anywhere in the repo. |
| `as unknown as` | **5** | 96+ | 5 production sites — see Findings M1/M2/L4. |
| Non-null assertion `x!.y` / `x![...]` (`lib/**`) | **0** | many | Production: zero. ESLint rule `no-non-null-assertion` is `warn`-only (see Finding L3). |
| `: any\b` or `<any>` in production types | **0** | n/a | No bare `any` types leak into production signatures. |

**Key takeaway**: the three AGENTS-declared anti-patterns (`as any`, `@ts-ignore`, `@ts-expect-error`) are at **zero** across `index.ts` + `lib/**`. The project's stated convention at `AGENTS.md:67` is upheld. Test-file usage is intentional and gated by the relaxed ESLint block at `eslint.config.js:68-74`.

---

## Type-Authority Modules — Layout & Overlap

The plan flags `lib/schemas.ts` / `lib/runtime-contracts.ts` / `lib/types.ts` as a "potential duplication hotspot". Ground truth after reading all three:

| File | Size | Purpose | Zod? |
|---|---|---|---|
| `lib/schemas.ts` | 346 lines | Zod schemas + inferred types + `safeParseXxx` helpers. Contains the authoritative shape for `PluginConfig`, `AccountMetadataV3`, `AccountStorageV3` (plus V1 for migration), `TokenResult`, `OAuthTokenResponse`. | Yes — single source of truth. |
| `lib/runtime-contracts.ts` | 28 lines | **Not type contracts.** Holds OAuth-callback host/port/path constants (`OAUTH_CALLBACK_LOOPBACK_HOST`, `OAUTH_CALLBACK_PORT = 1455`, `OAUTH_CALLBACK_PATH`, `OAUTH_CALLBACK_BIND_URL`) plus two error sentinel factories. | No. |
| `lib/types.ts` | 146 lines | Re-exports schema-inferred types under shorter aliases, plus non-validated plain interfaces for SDK- or boundary-flavoured shapes (`UserConfig`, `ConfigOptions`, `ReasoningConfig`, `OAuthServerInfo`, `PKCEPair`, `AuthorizationFlow`, `ParsedAuthInput`, `JWTPayload`, `InputItem`, `RequestBody`, `SSEEventData`, `CacheMetadata`, `GitHubRelease`, `OAuthAuthDetails`). | No. |

Overlap is **minimal**: `types.ts` aliases schema-inferred types via `export type { … as … } from "./schemas.js"` (`lib/types.ts:3-10`). Original interfaces declared in `types.ts` do not duplicate Zod-owned shapes. The one real issue is naming — see Finding L5.

---

## Discriminated Unions & Template-Literal Types (quality claims verification)

`AGENTS.md:122` claims `strict mode, template-literal types (QuotaKey), discriminated unions (TokenResult), Zod inference`. Verified at SHA `d92a8ee`:

- **Discriminated unions**: `TokenResultSchema` is a proper `z.discriminatedUnion("type", [TokenSuccessSchema, TokenFailureSchema])` (`lib/schemas.ts:244-247`). `AnyAccountStorageSchema` is likewise `z.discriminatedUnion("version", [V1, V3])` (`:191-194`). ✅
- **Template-literal types**: `QuotaKey = BaseQuotaKey | \`${BaseQuotaKey}:${string}\`` at `lib/accounts/rate-limits.ts:10`. Works as documented. ✅
- **Zod inference**: `PluginConfigFromSchema`, `AccountMetadataV3FromSchema`, etc. via `z.infer<typeof …>` (`lib/schemas.ts:57,128,150,227,239,249,267`), then re-exported as short aliases in `lib/types.ts:3-10`. ✅

The advertised trio is real and correctly used. The weakness — no branded types — is addressed in Finding M3.

---

## Findings

### [HIGH | confidence=high] Imported accounts JSON has no schema validation before merge

- **File**: `lib/storage.ts:1231-1256`
- **Quote**:

  ```ts
  async function readAndNormalizeImportFile(filePath: string): Promise<{
  	resolvedPath: string;
  	normalized: AccountStorageV3;
  }> {
  	const resolvedPath = resolvePath(filePath);

  	if (!existsSync(resolvedPath)) {
  		throw new Error(`Import file not found: ${resolvedPath}`);
  	}

  	const content = await fs.readFile(resolvedPath, "utf-8");

  	let imported: unknown;
  	try {
  		imported = JSON.parse(content);
  	} catch {
  		throw new Error(`Invalid JSON in import file: ${resolvedPath}`);
  	}

  	const normalized = normalizeAccountStorage(imported);
  ```

- **Issue**: The import path used by `previewImportAccounts` / `importAccounts` parses an arbitrary user-supplied JSON file and passes it directly to `normalizeAccountStorage`, which is a lenient coercer (`filter + clamp + default`), not a schema validator. `AnyAccountStorageSchema` exists (`lib/schemas.ts:191-194`) and is used to **log warnings only** elsewhere (`lib/storage.ts:773-779`, `:815-818`) — here it is not even consulted. A malformed or adversarially-crafted import thus bypasses the contract and can inject accounts with ill-typed / missing fields (e.g. non-string `refreshToken`, object in `rateLimitResetTimes`, extra top-level keys) that `normalizeAccountStorage` silently drops rather than rejecting with a diagnostic. This interacts with the pre-seeded HIGH at `lib/storage.ts:1340` (importAccounts default `backupMode='none'`).
- **Recommendation**: Call `safeParseAccountStorage(imported)` (already exported at `lib/schemas.ts:289`) before `normalizeAccountStorage` and surface the Zod issues in the thrown `Error` message; keep `normalizeAccountStorage` as the downgrade path for the happy case. Alternatively, route all three entry points (`loadAccountsInternal`, `attemptGlobalFallbackToProject`, `readAndNormalizeImportFile`) through one function that parses → normalizes in that order.
- **Evidence**: `lib/storage.ts:771-781` and `:813-820` already use `getValidationErrors(AnyAccountStorageSchema, data)` — only warn-on-error. The import path is the only entrypoint where that check is skipped entirely. Cross-reference T02 import-no-backup finding (`storage.ts:1340`) and T06 for file-system import flow.

---

### [HIGH | confidence=medium] JWT payload parsed without runtime shape validation

- **File**: `lib/auth/auth.ts:115-130`
- **Quote**:

  ```ts
  export function decodeJWT(token: string): JWTPayload | null {
  	try {
  		const parts = token.split(".");
  		if (parts.length !== 3) return null;
  		const payload = parts[1] ?? "";
  		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  		const padded = normalized.padEnd(
  			normalized.length + ((4 - (normalized.length % 4)) % 4),
  			"=",
  		);
  		const decoded = Buffer.from(padded, "base64").toString("utf-8");
  		return JSON.parse(decoded) as JWTPayload;
  	} catch {
  		return null;
  	}
  }
  ```

- **Issue**: `decodeJWT` returns `JSON.parse(decoded) as JWTPayload`. The `JWTPayload` interface in `lib/types.ts:61-76` permits `[key: string]: unknown`, so downstream code relies on type-guard predicates when reading nested fields (e.g. `chatgpt_account_id`). The cast itself creates no *memory-safety* hole, but: (a) there is no Zod schema for JWT payloads, so a token whose decoded body is `42` or `"hello"` or `null` is typed as `JWTPayload` despite not being an object, and (b) downstream callers like `getAccountIdCandidates` (feeds `resolveAccountSelection` in `login-runner.ts:73`) effectively infer trust from a shape they never verified. This is a type-discipline gap at the most sensitive boundary in the plugin (token → accountId).
- **Recommendation**: Add a minimal Zod schema for the JWT payload in `lib/schemas.ts` (object with `["https://api.openai.com/auth"]` as optional record of string/unknown, plus the loose fields already in `JWTPayload`). Make `decodeJWT` return `safeParseJWTPayload(JSON.parse(decoded))` so non-object bodies become `null` instead of masquerading as payloads. Keep the return type as `JWTPayload | null` (no breaking change for callers).
- **Evidence**: `JWTPayload` in `lib/types.ts:61-76` is permissive by design. Cross-reference T02 for credential-flow scope; this finding covers only the TypeScript-validation angle.

---

### [HIGH | confidence=high] Plugin config `userConfig` spread as `Partial<PluginConfig>` despite known validation errors

- **File**: `lib/config.ts:66-107`
- **Quote**:

  ```ts
  const userConfig = JSON.parse(normalizedFileContent) as unknown;
  // ...
  const schemaErrors = getValidationErrors(PluginConfigSchema, userConfig);
  if (schemaErrors.length > 0) {
  	logWarn(`Plugin config validation warnings: ${schemaErrors.slice(0, 3).join(", ")}`);
  }

  return {
  	...DEFAULT_CONFIG,
  	...(userConfig as Partial<PluginConfig>),
  };
  ```

- **Issue**: The loader runs `getValidationErrors(PluginConfigSchema, userConfig)` (`:92`), logs warnings, and then still spreads `userConfig as Partial<PluginConfig>` into the returned config (`:99`). This widens the contract: any stray top-level key remains in the returned object, and an offending typed field (e.g. `fastSessionMaxInputItems: "thirty"`) reaches downstream `resolve*Setting` helpers which then rely on their own `typeof === "number"` guards to rescue things. `safeParsePluginConfig` is already exported for this exact use case (`lib/schemas.ts:277-283`) and would produce a parsed, strongly-typed object with unknown fields dropped.
- **Recommendation**: Replace `const userConfig = … as unknown` + `getValidationErrors` + spread with `const parsed = safeParsePluginConfig(JSON.parse(normalizedFileContent)); if (!parsed) { … warn … return DEFAULT_CONFIG; }` and then `return { ...DEFAULT_CONFIG, ...parsed };`. Keep the "legacy settings detected" pre-check (`:75-90`) working against the pre-parse value.
- **Evidence**: `safeParsePluginConfig` is defined at `lib/schemas.ts:277` and unused. `lib/config.ts:78-90` inspects raw keys before validation; that part remains valid with the refactor.

---

### [MEDIUM | confidence=high] `as unknown as` used to defeat V1/V3 union after migration decision

- **File**: `lib/storage.ts:651-655`
- **Quote**:

  ```ts
  const fromVersion = data.version as AnyAccountStorage["version"];
  const baseStorage: AccountStorageV3 =
  	fromVersion === 1
  		? migrateV1ToV3(data as unknown as AccountStorageV1)
  		: (data as unknown as AccountStorageV3);
  ```

- **Issue**: Two `as unknown as` casts in the same expression are used to coerce `data` (typed as `AnyAccountStorage`, a `z.discriminatedUnion`-derived type) into the specific variant. The discriminated union would narrow on `data.version === 1` if TypeScript saw the control-flow; it is defeated here because `fromVersion` is a *copy* of the discriminant, not the discriminant itself — a classic narrowing bug that is being papered over instead of fixed. This is the only production use of double-cast inside a migration path and risks silent drift if the V1 shape ever gains a required field that is absent in V3.
- **Recommendation**: Keep the switch on `data.version` (not a copy) so TypeScript narrows naturally:
  ```ts
  const baseStorage: AccountStorageV3 =
      data.version === 1 ? migrateV1ToV3(data) : data;
  ```
  If `AnyAccountStorage` is defined as `AccountStorageV1 | AccountStorageV3` this compiles without casts. If it is typed more loosely, tighten the parameter upstream instead of casting at the call site.
- **Evidence**: `lib/schemas.ts:191-194` defines `AnyAccountStorageSchema` as a proper discriminated union; `z.infer` of that preserves narrowing.

---

### [MEDIUM | confidence=high] Request/response bodies cast to typed shapes without Zod validation

- **File**: `lib/request/fetch-helpers.ts:430-436, 449, 460, 484, 514, 665, 733` and `lib/request/response-handler.ts:104`
- **Quote** (fetch-helpers):

  ```ts
  let body: RequestBody;
  if (hasParsedBody) {
  	body = parsedBody as RequestBody;
  } else {
  	if (typeof init?.body !== "string") return undefined;
  	body = JSON.parse(init.body) as RequestBody;
  }
  // …
  body: body as unknown as Record<string, unknown>,
  ```

  **Quote** (response-handler):

  ```ts
  const data = JSON.parse(payload) as SSEEventData;
  ```

- **Issue**: The request pipeline treats two different trust boundaries as if they were typed: the inbound body that OpenCode passes into the plugin fetch hook (`fetch-helpers.ts:435`), and the upstream SSE event JSON (`response-handler.ts:104`). Both assume `RequestBody` / `SSEEventData` structurally without runtime validation. The `as unknown as Record<string, unknown>` quartet (`:449/:460/:484/:514`) converts the same values to a widened log-shape purely for `logRequest`, which is a different class: a deliberate cast to a broader type, not a precision claim — but it still forfeits the `RequestBody` invariant at the logging seam.
- **Recommendation**: (a) Define a lightweight Zod schema for the fields the pipeline actually reads from the inbound body (`model`, `input`, `tools`, `reasoning`, `text.verbosity`, `include`, `max_output_tokens`, `max_completion_tokens`, `prompt_cache_key`, `providerOptions`) and run `safeParse` at `:435`; log and fall through on validation failure. (b) For SSE events, the permissive `SSEEventData { type: string; response?: unknown }` shape is acceptable because the consumers (`parseSseStream` at `response-handler.ts:96-139`) already guard via string compares and `toRecord`; no change needed beyond a code comment documenting why `as SSEEventData` is safe here. (c) Replace the four `body as unknown as Record<string, unknown>` log adapters with a single helper `toLogRecord(body: RequestBody): Record<string, unknown>` that does `return body as Record<string, unknown>;` once — this preserves the invariant that `body` remained `RequestBody` at its site of truth.
- **Evidence**: `lib/request/fetch-helpers.ts` header block (`:1-20`) does not import `safeParse*`. `lib/types.ts:93-114` defines `RequestBody` but carries `[key: string]: unknown` and `tools?: unknown`, so the cast's precision is mostly illusory.

---

### [MEDIUM | confidence=high] Credential merge uses `||` where `??` is the correct operator

- **File**: `lib/auth/login-runner.ts:331-348`
- **Quote**:

  ```ts
  accounts[targetIndex] = {
  	...target,
  	accountId: target.accountId ?? source.accountId,
  	organizationId: target.organizationId ?? source.organizationId,
  	accountIdSource: target.accountIdSource ?? source.accountIdSource,
  	accountLabel: target.accountLabel ?? source.accountLabel,
  	email: target.email ?? source.email,
  	refreshToken: newer.refreshToken || older.refreshToken,
  	accessToken: newer.accessToken || older.accessToken,
  	expiresAt: newer.expiresAt ?? older.expiresAt,
  	enabled: mergedEnabled,
  	addedAt: Math.max(target.addedAt ?? 0, source.addedAt ?? 0),
  	lastUsed: Math.max(target.lastUsed ?? 0, source.lastUsed ?? 0),
  	lastSwitchReason: target.lastSwitchReason ?? source.lastSwitchReason,
  ```

- **Issue** *(T5 angle only; full credential-flow impact is owned by T2)*: Every field on this merge uses `??` except `refreshToken` and `accessToken`, which use `||`. With TypeScript strict null checks and the Zod schema declaring `refreshToken: z.string().min(1)`, these fields are typed as `string` (not `string | undefined`). The `||` short-circuit falls back to `older` whenever `newer` is falsy — which includes the empty string `""`. Because the field type is `string`, TypeScript cannot warn that the programmer almost certainly meant "take the newer value even if it is empty" or "take newer unless nullish" (the rest of the object chose the latter). The inconsistency on one object literal is exactly the kind of defect a branded `RefreshToken`/`AccessToken` type (Finding M3) plus an explicit `nonEmpty<T>(a: T | "", b: T | ""): T` helper would make unrepresentable.
- **Recommendation**: Convert both lines to `??` to match the rest of the merge, then add an ESLint override for the file that disallows `LogicalExpression[operator='||']` on properties whose name is in the set `{refreshToken, accessToken, idToken}`. Alternatively (and complementary) accept the T2 fix which reworks the merge conditions, and keep this finding as "apply `@typescript-eslint/prefer-nullish-coalescing` with `ignorePrimitives: { string: false }`" once the refactor lands.
- **Evidence**: ESLint config (`eslint.config.js`) does not currently enable `@typescript-eslint/prefer-nullish-coalescing`, so this pattern is not flagged. Cross-reference T02 pre-seed: `storage.ts:194/906/1155/1324` and `login-runner.ts:338-339` are the credential-flow sites.

---

### [MEDIUM | confidence=medium] No branded types for credential-bearing strings

- **File**: `lib/schemas.ts:108-126`, `lib/types.ts:61-76`, `lib/auth/login-runner.ts:40-79`
- **Quote**:

  ```ts
  export const AccountMetadataV3Schema = z.object({
  	accountId: z.string().optional(),
  	organizationId: z.string().optional(),
  	accountIdSource: AccountIdSourceSchema.optional(),
  	accountLabel: z.string().optional(),
  	accountTags: AccountTagsSchema,
  	accountNote: AccountNoteSchema,
  	email: z.string().optional(),
  	refreshToken: z.string().min(1), // Required, non-empty
  	accessToken: z.string().optional(),
  ```

- **Issue**: `accountId`, `organizationId`, `email`, `refreshToken`, `accessToken`, and the various ID-like identifiers across `lib/auth/**` are all typed as plain `string`. There is no structural-distinct `AccountId`, `OrgId`, `Email`, `RefreshToken`, `AccessToken`, or `IdToken` brand, so the TS compiler cannot prevent cross-assignment — for example, passing a `refreshToken` where an `accountId` is expected (both are non-empty strings). AGENTS.md:122 explicitly lists "template literal types (`QuotaKey`), discriminated unions (`TokenResult`), Zod inference" as the quality bar; a branded type is the next step on that ladder, especially given the five HIGH credential findings in T02 concentrated in one merge routine.
- **Recommendation**: Introduce a tiny branding helper in `lib/schemas.ts`:
  ```ts
  type Brand<T, B> = T & { readonly __brand: B };
  export type AccountId    = Brand<string, "AccountId">;
  export type OrgId        = Brand<string, "OrgId">;
  export type RefreshToken = Brand<string, "RefreshToken">;
  export type AccessToken  = Brand<string, "AccessToken">;
  export type IdToken      = Brand<string, "IdToken">;
  export const AccountIdSchema    = z.string().min(1).transform((s) => s as AccountId);
  export const RefreshTokenSchema = z.string().min(1).transform((s) => s as RefreshToken);
  // ...
  ```
  Wire `AccountMetadataV3Schema` to use `RefreshTokenSchema`/`AccountIdSchema`/etc. The cost is zero at runtime (brand is a phantom type) and catches category-confusion bugs at compile time — including the `||`-vs-`??` inconsistency in Finding M2 if paired with a helper. Do not try to brand every string at once; start with `RefreshToken` + `AccessToken` + `AccountId` and extend.
- **Evidence**: `lib/accounts/rate-limits.ts:10` shows the project already uses template-literal refinement for `QuotaKey`; branding is the complementary pattern. Cross-reference `lib/auth/login-runner.ts:338-339` for the exact site where cross-role confusion is most dangerous.

---

### [MEDIUM | confidence=high] `RateLimitState` index signature drops the `QuotaKey` invariant

- **File**: `lib/accounts/rate-limits.ts:9-43`
- **Quote**:

  ```ts
  export type BaseQuotaKey = ModelFamily;
  export type QuotaKey = BaseQuotaKey | `${BaseQuotaKey}:${string}`;
  // ...
  export interface RateLimitState {
  	[key: string]: number | undefined;
  }

  export interface RateLimitedEntity {
  	rateLimitResetTimes: RateLimitState;
  }
  ```

- **Issue**: `QuotaKey` is a precise template-literal type on the *producer* side (`getQuotaKey` returns it), but the *consumer* side stores it in a `Record<string, number | undefined>` (`RateLimitState`). The moment a value is written to `entity.rateLimitResetTimes[key]`, the compiler forgets it originated as a `QuotaKey` — any string literal can read it back. Combined with the write-only `clearExpiredRateLimits` loop at `:45-54` which iterates `Object.keys(entity.rateLimitResetTimes)` (type `string[]`), the stored key space is `string`, not `QuotaKey`. This is a partial invariant: enough to satisfy the happy path, but nothing prevents a stray `"gpt-7.0:latest"` being injected by a future dev and going undetected.
- **Recommendation**: Narrow the state type to `Partial<Record<QuotaKey, number>>` (or `{ [K in QuotaKey]?: number }`). Adjust `Object.keys` iteration with `(Object.keys(entity.rateLimitResetTimes) as QuotaKey[])` and guard at the edge (e.g. the JSON-parse boundary) by validating that stored keys match the expected template before adoption. This is a two-line change plus one Zod schema tightening: replace `z.record(z.string(), z.number().optional())` at `lib/schemas.ts:87` with `z.record(QuotaKeySchema, z.number().optional())` where `QuotaKeySchema` is a `z.string().regex(...)` mirror of the template literal.
- **Evidence**: `lib/accounts.ts:420-432` shows the typed producer/consumer pair; `:431` reads `account.rateLimitResetTimes[baseQuotaKey]` where TypeScript returns `number | undefined` solely because of `noUncheckedIndexedAccess`, not because of QuotaKey knowledge.

---

### [MEDIUM | confidence=medium] `exactOptionalPropertyTypes` disabled allows `undefined` to masquerade as "absent"

- **File**: `tsconfig.json:1-25` (absence of flag); illustrated at `lib/schemas.ts:108-126`, `lib/types.ts:23-28`
- **Quote**:

  ```json
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true,
  ```

- **Issue**: The tsconfig enables strict + `noUncheckedIndexedAccess` + `noImplicitReturns` but omits `exactOptionalPropertyTypes`. With the current setting, a property declared as `enabled?: boolean` accepts either the key being absent *or* present-with-`undefined`. The schema author's intent (as seen at `AccountMetadataV3Schema.enabled: z.boolean().optional()`, `lib/schemas.ts:119`) is "the key may be absent". Under current tsconfig, callers can write `{ enabled: undefined }` without a compile error, which differs from `{}` in JSON (one carries the key, the other does not) and interacts with storage round-tripping and debounced saves. Turning the flag on would surface and fix those subtle discrepancies.
- **Recommendation**: Add `"exactOptionalPropertyTypes": true` to `tsconfig.json`. Run `npm run typecheck` to enumerate the call sites that need migration (estimate: 10-40 narrow fixes, each converting `{ foo: undefined }` to `{}` or vice versa, or tightening `foo?: T` to `foo?: T | undefined` where truly intentional). Stage with a one-off flag-enable PR.
- **Evidence**: `tsconfig.json:11-14` lists every strict flag the project opted into; `exactOptionalPropertyTypes` is conspicuously absent. The project follows a disciplined `?? ` style in `lib/config.ts:142-182` which will keep most sites compatible after the flip.

---

### [LOW | confidence=high] `as unknown as InputItem` in `injectMissingToolOutputs` hides missing `role`

- **File**: `lib/request/helpers/input-utils.ts:251-256`
- **Quote**:

  ```ts
  result.push({
  	type: outputType,
  	call_id: callId,
  	output: CANCELLED_TOOL_OUTPUT,
  } as unknown as InputItem);
  ```

- **Issue**: `InputItem` is declared with mandatory `role: string` at `lib/types.ts:82-88`, but the literal pushed here carries only `{ type, call_id, output }`. The `as unknown as InputItem` double-cast hides the missing `role`, and the consumer is assumed to tolerate it (the function is describing synthesised tool-call outputs). Either the type is too strict (role should be optional for synthesised items) or the synthesised object is missing `role: "tool"`. The cast blocks the compiler from telling which.
- **Recommendation**: Either (a) add `role: "tool"` (or the correct constant) to the literal and drop the double cast, or (b) relax `InputItem.role?` to optional in `lib/types.ts:82-88` — whichever matches the upstream Codex contract. Update `collectOutputCallIds`/`getCallId` only if (b) changes a currently-exhaustive check.
- **Evidence**: `lib/types.ts:82-88` is the sole definition of `InputItem`; no other code path synthesises items without `role`.

---

### [LOW | confidence=medium] Enable `noUnusedLocals` in tsconfig to stop relying solely on ESLint

- **File**: `tsconfig.json:1-36`
- **Quote**: (absence)

  ```json
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true,
  ```

- **Issue**: The project delegates unused-locals detection to ESLint (`@typescript-eslint/no-unused-vars`). Running `npm run typecheck` (`tsc --noEmit`) does not catch unused locals, so a partial dev loop that runs typecheck-only can miss hygiene regressions. Enabling `noUnusedLocals` in tsconfig is cheap and makes `typecheck` a stricter gate.
- **Recommendation**: Add `"noUnusedLocals": true` to `tsconfig.json`. Keep ESLint's pattern-based `argsIgnorePattern: "^_"` for parameters (tsconfig's `noUnusedParameters` is more aggressive about parameters; leave it off unless the team wants to rename all `_unused` args explicitly).
- **Evidence**: ESLint rule present at `eslint.config.js:24`; tsconfig lacks the equivalent.

---

### [LOW | confidence=high] `@typescript-eslint/no-non-null-assertion` is warn-only, not error

- **File**: `eslint.config.js:21-27`
- **Quote**:

  ```js
  // TypeScript strict rules
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  "@typescript-eslint/explicit-function-return-type": "off",
  "@typescript-eslint/no-non-null-assertion": "warn",
  ```

- **Issue**: `AGENTS.md:67` names the non-null assertion as a project anti-pattern alongside `as any`, but the ESLint config makes it `warn`-only rather than `error`. Production currently has zero instances (verified by grep), so promoting to `error` is cost-free and turns the documented convention into an enforced one.
- **Recommendation**: Change `:26` from `"warn"` to `"error"` in `eslint.config.js`. If a true need arises later, the narrowly-scoped exception belongs in an inline `// eslint-disable-next-line` comment, not a global knob.
- **Evidence**: Production non-null assertion count is 0 (evidence file `.sisyphus/evidence/task-5-antipattern-count.md`).

---

### [LOW | confidence=medium] `as unknown as` in fetch-helpers log adapters should be a one-liner helper

- **File**: `lib/request/fetch-helpers.ts:449, 460, 484, 514`
- **Quote**:

  ```ts
  body: body as unknown as Record<string, unknown>,
  ```

- **Issue**: Four near-identical `as unknown as Record<string, unknown>` casts exist purely to widen `RequestBody` into a logger-friendly shape. `RequestBody` already has `[key: string]: unknown` (`lib/types.ts:113`), so `body as Record<string, unknown>` compiles without the `as unknown` intermediate. The extra `as unknown` makes reviewers reach for "what invariant is being defeated here" when the answer is "none — it is only a type-widening coercion".
- **Recommendation**: Introduce `function toLogRecord(body: RequestBody | undefined): Record<string, unknown> { return body as Record<string, unknown>; }` near the top of `fetch-helpers.ts` and use it at the four call sites. Keep the transformed-body site (`:514`) on the same helper, since `transformedBody` is also typed as `RequestBody`.
- **Evidence**: `lib/types.ts:93-114` defines `RequestBody` with an index signature; the extra `as unknown` is redundant noise.

---

### [LOW | confidence=high] `runtime-contracts.ts` misnamed — file holds constants, not type contracts

- **File**: `lib/runtime-contracts.ts:1-28`
- **Quote**:

  ```ts
  /**
   * Shared runtime constants and sentinel helpers only. This module is pure: it
   * does not perform I/O, persistence, or logging, so centralizing these values
   * does not introduce new Windows lock or token-redaction surfaces.
   */
  export const OAUTH_CALLBACK_LOOPBACK_HOST = "127.0.0.1";
  export const OAUTH_CALLBACK_PORT = 1455;
  export const OAUTH_CALLBACK_PATH = "/auth/callback";
  export const OAUTH_CALLBACK_BIND_URL = `http://${OAUTH_CALLBACK_LOOPBACK_HOST}:${OAUTH_CALLBACK_PORT}`;

  export const DEACTIVATED_WORKSPACE_ERROR_CODE = "deactivated_workspace";
  export const USAGE_REQUEST_TIMEOUT_MESSAGE = "Usage request timed out";

  export function createDeactivatedWorkspaceError(): Error {
  	return new Error(DEACTIVATED_WORKSPACE_ERROR_CODE);
  }
  ```

- **Issue**: The file's name implies "runtime contracts" (i.e. runtime-validated shape boundaries in the Zod sense), but the file holds OAuth callback constants and two error-sentinel helpers. A reader hunting for `safeParse*` or runtime validation boundaries opens this file, finds none, and has to pivot to `lib/schemas.ts`. A mis-spoken filename has outsized cost in a 30-module plugin.
- **Recommendation**: Rename `lib/runtime-contracts.ts` → `lib/oauth-callback-constants.ts` (or `lib/auth/callback-constants.ts` to sit next to `lib/auth/server.ts`). Update imports. If the error sentinels belong elsewhere, split them into `lib/errors.ts` which already exists. No functional change; LSP-assisted rename. This will also make T01's architecture finding easier to state cleanly.
- **Evidence**: Module actually contains 3 exported constants + 4 exported helpers, all related to OAuth loopback + one error sentinel; nothing Zod-like or schema-like. `lib/schemas.ts` is the real runtime-contract surface.

---

## Notes

- **Severity budget observed**: 3 HIGH, 6 MEDIUM, 5 LOW — well under caps (HIGH ≤15, MEDIUM ≤40).
- **Confidence calibration**: M2 was downgraded from HIGH to MEDIUM on the T5 angle because T2 owns the credential-flow impact; M3 kept at MEDIUM (confidence=medium) because the "branded types everywhere" recommendation requires taste/scope judgment beyond a mechanical fix.
- **Not flagged** (deliberate non-findings): the `parsedBody as RequestBody` at `lib/request/fetch-helpers.ts:432` is typed rather than `as unknown as`, so it is only one notch looser than a runtime-validated shape and is covered by Finding M1's recommendation; the `CacheMetadata` cast at `lib/prompts/codex.ts:253` reads a local ETag cache written by this same module (`storage.ts` pattern applies to a trust-controlled file), so runtime validation there is defense-in-depth rather than mandatory.
- **Cross-references**:
  - T02 (security/auth) owns credential-flow detail; T5 cites only the TS-discipline aspect (Findings H2, M2, M3).
  - T01 (architecture) owns the `schemas.ts` / `runtime-contracts.ts` / `types.ts` split; T5 corroborates with Finding L5 (rename, not merge).
  - T04 (request pipeline) owns SSE/error-mapping detail; T5 cites only the `JSON.parse as SSEEventData` cast in Finding M1.
  - T06 (filesystem) owns import-file I/O; T5 cites only the missing Zod validation in Finding H1.
- **AGENTS.md quality claim verified**: strict mode (yes), template-literal types (`QuotaKey` at `rate-limits.ts:10`), discriminated unions (`TokenResult` at `schemas.ts:244`, `AnyAccountStorage` at `:191`), Zod inference (`z.infer` used at 7 sites in `schemas.ts`). Anti-pattern compliance (`as any`/`@ts-ignore`/`@ts-expect-error`): 0 in production ✅.

---

## Findings Summary by Severity

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 3 | H1 (storage import Zod gap), H2 (JWT payload), H3 (plugin config spread) |
| MEDIUM | 6 | M1 (storage V1/V3 `as unknown as`), M2 (request/response JSON.parse), M3 (`\|\|` vs `??` credential merge), M4 (no branded types), M5 (QuotaKey invariant loss), M6 (`exactOptionalPropertyTypes` off) |
| LOW | 5 | L1 (input-utils cast missing `role`), L2 (enable `noUnusedLocals`), L3 (non-null-assertion warn→error), L4 (`as unknown as` log helper), L5 (`runtime-contracts.ts` naming) |

*End of T05 findings.*
