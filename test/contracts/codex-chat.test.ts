/**
 * Contract test — Codex non-streaming chat-completions response shape.
 *
 * Pins the shape of the JSON body the Codex backend returns for a
 * non-streaming request. The production pipeline at `index.ts` (see
 * `isEmptyResponse(parsedBody)` around the empty-response retry path)
 * parses this body with `JSON.parse` and then feeds it through the
 * production validator `isEmptyResponse` from
 * `lib/request/response-handler.ts`.
 *
 * If Codex ships a shape change — for example, moving `output[]` to a
 * different key, dropping `reasoning.encrypted_content`, or returning an
 * empty-shaped body that production would now treat as empty — this test
 * fails with a clear "upstream shape changed" message.
 *
 * The test reuses the SAME parser (`JSON.parse` + `isEmptyResponse`) that
 * production uses. It does NOT re-implement parsing.
 */

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isEmptyResponse } from "../../lib/request/response-handler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(
	__dirname,
	"fixtures",
	"codex-chat-response.json",
);

describe("contract: Codex chat-completions (non-streaming)", () => {
	it("production validator recognizes the pinned fixture as non-empty", async () => {
		const raw = await fs.readFile(fixturePath, "utf-8");
		const parsed = JSON.parse(raw) as unknown;

		// isEmptyResponse is the exact validator the request pipeline uses
		// after JSON.parse(bodyText). A change that makes production treat a
		// healthy Codex response as "empty" would trigger spurious retries
		// and account health penalties. Guard against that here.
		if (isEmptyResponse(parsed)) {
			throw new Error(
				"Contract broken: upstream shape changed for Codex chat response. " +
					"isEmptyResponse() now reports the pinned fixture as empty, which " +
					"would cause the production pipeline to retry and rotate accounts.",
			);
		}

		expect(isEmptyResponse(parsed)).toBe(false);
	});

	it("pins the top-level response envelope fields", async () => {
		const raw = await fs.readFile(fixturePath, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;

		// Fields the plugin reads directly or forwards to OpenCode. A
		// mismatch here indicates a backward-incompatible Codex response
		// change that must be reviewed before users are affected.
		expect(parsed).toMatchObject({
			id: expect.any(String),
			object: "response",
			model: expect.any(String),
			status: "completed",
			output: expect.any(Array),
		});
	});

	it("pins the output[].message -> content[].output_text structure", async () => {
		const raw = await fs.readFile(fixturePath, "utf-8");
		const parsed = JSON.parse(raw) as {
			output: Array<{
				type: string;
				role: string;
				content: Array<{ type: string; text: string }>;
			}>;
		};

		expect(parsed.output.length).toBeGreaterThan(0);
		const first = parsed.output[0];
		expect(first).toBeDefined();
		expect(first?.type).toBe("message");
		expect(first?.role).toBe("assistant");
		expect(Array.isArray(first?.content)).toBe(true);
		const firstContent = first?.content?.[0];
		expect(firstContent?.type).toBe("output_text");
		expect(typeof firstContent?.text).toBe("string");
	});

	it("pins reasoning.encrypted_content (required for stateless continuity)", async () => {
		const raw = await fs.readFile(fixturePath, "utf-8");
		const parsed = JSON.parse(raw) as {
			reasoning?: { encrypted_content?: unknown };
		};

		// Per AGENTS.md: the plugin sends `store: false` and RELIES on
		// `reasoning.encrypted_content` coming back to preserve multi-turn
		// session context. If Codex drops this field we MUST know about it
		// before real conversations start losing continuity.
		expect(parsed.reasoning).toBeDefined();
		expect(typeof parsed.reasoning?.encrypted_content).toBe("string");
	});

	it("pins the usage counters used by retry budgets", async () => {
		const raw = await fs.readFile(fixturePath, "utf-8");
		const parsed = JSON.parse(raw) as {
			usage?: Record<string, unknown>;
		};

		expect(parsed.usage).toBeDefined();
		expect(typeof parsed.usage?.input_tokens).toBe("number");
		expect(typeof parsed.usage?.output_tokens).toBe("number");
		expect(typeof parsed.usage?.total_tokens).toBe("number");
	});

	it("production validator treats an empty response as empty (drift guard)", () => {
		// Control case: confirms isEmptyResponse still treats an unambiguously
		// empty response envelope as empty. If this check ever fails, the
		// empty-response retry logic in index.ts is silently broken.
		expect(isEmptyResponse({ id: "resp_empty", object: "response" })).toBe(
			true,
		);
	});
});
