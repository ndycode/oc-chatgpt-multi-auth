import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth/auth.js", () => ({
	AUTHORIZE_URL: "https://auth.openai.com/oauth/authorize",
	CLIENT_ID: "test-client-id",
	exchangeAuthorizationCode: vi.fn(async () => ({
		type: "success" as const,
		access: "device-access",
		refresh: "device-refresh",
		expires: Date.now() + 60_000,
	})),
}));

vi.mock("../lib/logger.js", () => ({
	logError: vi.fn(),
}));

import {
	buildDeviceCodeInstructions,
	completeDeviceCodeSession,
	createDeviceCodeSession,
} from "../lib/auth/device-code.js";
import { exchangeAuthorizationCode } from "../lib/auth/auth.js";

describe("device-code auth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("creates a device-code session from the auth server response", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response(
				JSON.stringify({
					device_auth_id: "device-auth-1",
					usercode: "ABCD-EFGH",
					interval: "7",
				}),
				{ status: 200 },
			),
		) as typeof fetch;

		const result = await createDeviceCodeSession();

		expect(result).toEqual({
			type: "ready",
			session: {
				verificationUrl: "https://auth.openai.com/codex/device",
				userCode: "ABCD-EFGH",
				deviceAuthId: "device-auth-1",
				intervalSeconds: 7,
			},
		});
		if (result.type === "ready") {
			expect(buildDeviceCodeInstructions(result.session)).toContain("ABCD-EFGH");
		}
	});

	it("reports when device-code login is unavailable", async () => {
		globalThis.fetch = vi.fn(async () => new Response("missing", { status: 404 })) as typeof fetch;

		const result = await createDeviceCodeSession();

		expect(result.type).toBe("failed");
		if (result.type === "failed") {
			expect(result.failure.reason).toBe("http_error");
			expect(result.failure.statusCode).toBe(404);
			expect(result.failure.message).toContain("not enabled");
		}
	});

	it("polls until an authorization code is issued and exchanges it", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response("", { status: 403 }))
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						authorization_code: "auth-code-1",
						code_verifier: "code-verifier-1",
					}),
					{ status: 200 },
				),
			) as typeof fetch;

		const result = await completeDeviceCodeSession({
			verificationUrl: "https://auth.openai.com/codex/device",
			userCode: "ABCD-EFGH",
			deviceAuthId: "device-auth-1",
			intervalSeconds: 0,
		});

		expect(result.type).toBe("success");
		expect(vi.mocked(exchangeAuthorizationCode)).toHaveBeenCalledWith(
			"auth-code-1",
			"code-verifier-1",
			"https://auth.openai.com/deviceauth/callback",
		);
	});

	it("times out when no authorization code is issued", async () => {
		globalThis.fetch = vi.fn(async () => new Response("", { status: 403 })) as typeof fetch;

		const result = await completeDeviceCodeSession(
			{
				verificationUrl: "https://auth.openai.com/codex/device",
				userCode: "ABCD-EFGH",
				deviceAuthId: "device-auth-1",
				intervalSeconds: 0,
			},
			{ maxWaitMs: 0 },
		);

		expect(result).toEqual({
			type: "failed",
			reason: "unknown",
			message: "Device code authorization timed out after 15 minutes",
		});
	});
});
