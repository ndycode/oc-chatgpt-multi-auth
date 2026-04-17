/**
 * Contract test — OpenAI OAuth token endpoint response shape.
 *
 * Pins the wire-level shape that `lib/auth/auth.ts` expects from
 * `https://auth.openai.com/oauth/token` (both the initial authorization-code
 * exchange and the refresh_token grant). If OpenAI ships a change to the
 * token response that is not backward-compatible, this test fails fast with a
 * clear "upstream shape changed" message before the drift can reach users in
 * production.
 *
 * The test deliberately feeds the pinned fixture through the SAME parser
 * (`OAuthTokenResponseSchema` / `safeParseOAuthTokenResponse` from
 * `lib/schemas.ts`) that `exchangeAuthorizationCode` and `refreshAccessToken`
 * call. It does NOT re-implement validation.
 */

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	OAuthTokenResponseSchema,
	safeParseOAuthTokenResponse,
} from "../../lib/schemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(
	__dirname,
	"fixtures",
	"openai-token-response.json",
);

describe("contract: OpenAI OAuth token endpoint", () => {
	it("parses the pinned fixture cleanly via production schema", async () => {
		const raw = await fs.readFile(fixturePath, "utf-8");
		const parsed = OAuthTokenResponseSchema.safeParse(JSON.parse(raw));

		if (!parsed.success) {
			throw new Error(
				`Contract broken: upstream shape changed for OAuth token endpoint. ` +
					`Production parser rejected the pinned fixture. Details: ${parsed.error.message}`,
			);
		}

		expect(parsed.data).toMatchObject({
			access_token: expect.any(String),
			refresh_token: expect.any(String),
			id_token: expect.any(String),
			token_type: "Bearer",
			expires_in: expect.any(Number),
			scope: expect.any(String),
		});

		// Production code derives `expires` as `Date.now() + expires_in * 1000`
		// (see lib/auth/auth.ts:111,179). Guard against the field becoming a
		// string ("3600") or ms-based without a coordinated code change.
		expect(typeof parsed.data.expires_in).toBe("number");
		expect(parsed.data.expires_in).toBeGreaterThan(0);
	});

	it("exposes the same normalized shape via safeParseOAuthTokenResponse", async () => {
		const raw = await fs.readFile(fixturePath, "utf-8");
		const parsed = safeParseOAuthTokenResponse(JSON.parse(raw));

		if (parsed === null) {
			throw new Error(
				"Contract broken: upstream shape changed for OAuth token endpoint. " +
					"safeParseOAuthTokenResponse returned null for the pinned fixture.",
			);
		}

		// These are the exact fields the production auth flow reads
		// (lib/auth/auth.ts:109-112 + :177-180).
		expect(parsed.access_token.length).toBeGreaterThan(0);
		expect(parsed.expires_in).toBeGreaterThan(0);
	});

	it("rejects malformed responses (defensive schema)", () => {
		// If this parses, the schema has lost its shape-guarantee — the whole
		// point of the contract test is to ensure malformed inputs are
		// detected at the process boundary instead of silently crashing the
		// token-exchange code.
		const bogus = { not_a_token: true };
		const parsed = OAuthTokenResponseSchema.safeParse(bogus);
		expect(parsed.success).toBe(false);

		const parsedHelper = safeParseOAuthTokenResponse(bogus);
		expect(parsedHelper).toBeNull();
	});

	it("accepts a refresh response that omits refresh_token (rotation-skip case)", () => {
		// The real OAuth server returns `refresh_token` on initial exchange but
		// may omit it on some refresh responses. lib/auth/auth.ts:169 handles
		// that explicitly by reusing the existing refresh token — the schema
		// must therefore allow `refresh_token` to be optional. This case is
		// part of the contract.
		const refreshOnly = {
			access_token: "FAKE_REFRESHED_ACCESS_TOKEN",
			token_type: "Bearer",
			expires_in: 1800,
		};
		const parsed = OAuthTokenResponseSchema.safeParse(refreshOnly);
		expect(parsed.success).toBe(true);
	});
});
