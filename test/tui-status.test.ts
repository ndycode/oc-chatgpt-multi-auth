import { describe, expect, it } from "vitest";

import {
	formatPromptStatusText,
	formatQuotaDetailsText,
	resolvePromptReasoningVariant,
	resolveQuotaPromptTone,
	type CompactQuotaStatus,
	type PromptStatusConfig,
	type PromptStatusMessage,
} from "../lib/tui-status.js";

describe("TUI prompt status helpers", () => {
	const sep = ` ${String.fromCharCode(183)} `;
	const quota: CompactQuotaStatus = {
		type: "ready",
		limits: [
			{ label: "5h", leftPercent: 88 },
			{ label: "7d", leftPercent: 83 },
		],
		stale: false,
	};

	it("formats prompt status text from supplied quota labels", () => {
		expect(
			formatPromptStatusText({
				variant: "xhigh",
				quota,
				width: 120,
			}),
		).toBe(`xhigh${sep}5h 88%${sep}7d 83%`);

		expect(
			formatPromptStatusText({
				variant: "xhigh",
				quota,
				width: 80,
			}),
		).toBe(`xhigh${sep}5h 88%${sep}7d 83%`);

		expect(
			formatPromptStatusText({
				variant: "xhigh",
				quota,
				width: 50,
			}),
		).toBe("xhigh");
	});

	it("falls back to non-sensitive status when quota is unavailable", () => {
		expect(
			formatPromptStatusText({
				variant: "high",
				quota: { type: "unavailable" },
				width: 120,
			}),
		).toBe(`high${sep}limits ?`);
		expect(
			formatPromptStatusText({
				quota: { type: "missing" },
				width: 120,
			}),
		).toBe("no auth");
		expect(
			formatPromptStatusText({
				quota: { type: "loading" },
				width: 120,
			}),
		).toBe("");
	});

	it("adds account hint only when multiple accounts are configured", () => {
		expect(
			formatPromptStatusText({
				quota: {
					...quota,
					accountIndex: 2,
					accountCount: 3,
				},
				width: 120,
			}),
		).toBe(`A2${sep}5h 88%${sep}7d 83%`);

		expect(
			formatPromptStatusText({
				quota: {
					...quota,
					accountIndex: 1,
					accountCount: 1,
				},
				width: 120,
			}),
		).toBe(`5h 88%${sep}7d 83%`);
	});

	it("resolves prompt tone from quota thresholds", () => {
		expect(resolveQuotaPromptTone(quota)).toBe("normal");
		expect(
			resolveQuotaPromptTone({
				...quota,
				limits: [{ label: "5h", leftPercent: 20 }],
			}),
		).toBe("warning");
		expect(
			resolveQuotaPromptTone({
				...quota,
				limits: [{ label: "5h", leftPercent: 8 }],
			}),
		).toBe("danger");
		expect(resolveQuotaPromptTone({ ...quota, stale: true })).toBe("stale");
	});

	it("formats quota details for the command dialog", () => {
		const details = formatQuotaDetailsText(
			{
				...quota,
				accountIndex: 2,
				accountCount: 3,
				accountLabel: "Account 2 (neil@example.com)",
				source: "headers",
				fetchedAt: 1_000,
				planType: "plus",
				activeLimit: 40,
			},
			31_000,
		);

		expect(details).toContain("Account: A2 (Account 2");
		expect(details).toContain("5h: 88% left");
		expect(details).toContain("Plan: plus");
		expect(details).toContain("Active limit: 40");
		expect(details).toContain("Source: response headers");
		expect(details).toContain("Updated: just now");
	});

	it("resolves the selected variant from session messages before config defaults", () => {
		const messages: PromptStatusMessage[] = [
			{
				role: "assistant",
				modelID: "gpt-5.5-high",
				variant: "high",
			},
			{
				role: "user",
				userModel: {
					modelID: "gpt-5.5",
					variant: "xhigh",
				},
			},
		];
		const config: PromptStatusConfig = {
			model: "openai/gpt-5.5-medium",
		};

		expect(resolvePromptReasoningVariant({ messages, config })).toBe("xhigh");
	});

	it("resolves legacy suffixes and provider reasoning options from config", () => {
		expect(
			resolvePromptReasoningVariant({
				config: {
					model: "openai/gpt-5.5-fast-medium",
				},
			}),
		).toBe("medium");

		expect(
			resolvePromptReasoningVariant({
				config: {
					model: "openai/gpt-5.5",
					provider: {
						openai: {
							options: {
								reasoningEffort: "high",
							},
						},
					},
				},
			}),
		).toBe("high");
	});

	it("prefers the selected agent reasoning effort over provider defaults", () => {
		const config: PromptStatusConfig = {
			model: "openai/gpt-5.5",
			default_agent: "Sisyphus - Ultraworker",
			agent: {
				"Sisyphus - Ultraworker": {
					model: "openai/gpt-5.5",
					reasoningEffort: "xhigh",
				},
			},
			provider: {
				openai: {
					options: {
						reasoningEffort: "medium",
					},
				},
			},
		};

		expect(resolvePromptReasoningVariant({ config })).toBe("xhigh");
	});
});
