/**
 * `codex-metrics` tool — runtime request metrics.
 * Extracted from `index.ts` per RC-1 Phase 2.
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { formatWaitTime } from "../accounts.js";
import { getRefreshQueueMetrics } from "../refresh-queue.js";
import {
	formatUiHeader,
	formatUiKeyValue,
} from "../ui/format.js";
import { normalizeToolOutputFormat, renderJsonOutput } from "../runtime.js";
import type { ToolContext } from "./index.js";

export function createCodexMetricsTool(ctx: ToolContext): ToolDefinition {
	const {
		resolveUiRuntime,
		runtimeMetrics,
		beginnerSafeModeRef,
		buildRoutingVisibilitySnapshot,
		appendRoutingVisibilityText,
		appendRoutingVisibilityUi,
	} = ctx;
	return tool({
		description: "Show runtime request metrics for this plugin process.",
		args: {
			format: tool.schema
				.string()
				.optional()
				.describe('Output format: "text" (default) or "json".'),
		},
		execute({ format }: { format?: string } = {}) {
			const ui = resolveUiRuntime();
			const outputFormat = normalizeToolOutputFormat(format);
			const now = Date.now();
			const uptimeMs = Math.max(0, now - runtimeMetrics.startedAt);
			const total = runtimeMetrics.totalRequests;
			const successful = runtimeMetrics.successfulRequests;
			const refreshMetrics = getRefreshQueueMetrics();
			const successRate =
				total > 0 ? ((successful / total) * 100).toFixed(1) : "0.0";
			const avgLatencyMs =
				successful > 0
					? Math.round(runtimeMetrics.cumulativeLatencyMs / successful)
					: 0;
			const lastRequest =
				runtimeMetrics.lastRequestAt !== null
					? `${formatWaitTime(now - runtimeMetrics.lastRequestAt)} ago`
					: "never";
			const routingVisibility = buildRoutingVisibilitySnapshot();
			const beginnerSafeModeEnabled = beginnerSafeModeRef.current;
			if (outputFormat === "json") {
				return Promise.resolve(
					renderJsonOutput({
						uptimeMs,
						totalRequests: total,
						successfulResponses: successful,
						failedResponses: runtimeMetrics.failedRequests,
						successRatePercent: Number(successRate),
						averageSuccessfulLatencyMs: avgLatencyMs,
						rateLimitedResponses: runtimeMetrics.rateLimitedResponses,
						serverErrors: runtimeMetrics.serverErrors,
						networkErrors: runtimeMetrics.networkErrors,
						authRefreshFailures: runtimeMetrics.authRefreshFailures,
						accountRotations: runtimeMetrics.accountRotations,
						emptyResponseRetries: runtimeMetrics.emptyResponseRetries,
						retryProfile: runtimeMetrics.retryProfile,
						beginnerSafeMode: beginnerSafeModeEnabled,
						retryBudgetExhaustions: runtimeMetrics.retryBudgetExhaustions,
						retryBudgetUsage: { ...runtimeMetrics.retryBudgetUsage },
						retryBudgetLimits: { ...runtimeMetrics.retryBudgetLimits },
						refreshQueue: { ...refreshMetrics },
						lastRequestAt: runtimeMetrics.lastRequestAt,
						lastRequestAgeMs:
							runtimeMetrics.lastRequestAt !== null
								? Math.max(0, now - runtimeMetrics.lastRequestAt)
								: null,
						lastError: runtimeMetrics.lastError,
						lastErrorCategory: runtimeMetrics.lastErrorCategory,
						lastSelectedAccountIndex:
							runtimeMetrics.lastSelectedAccountIndex === null
								? null
								: runtimeMetrics.lastSelectedAccountIndex + 1,
						lastQuotaKey: runtimeMetrics.lastQuotaKey,
						lastBudgetExhaustion:
							runtimeMetrics.lastRetryBudgetExhaustedClass === null
								? null
								: {
										budgetClass:
											runtimeMetrics.lastRetryBudgetExhaustedClass,
										reason: runtimeMetrics.lastRetryBudgetReason,
									},
						routingVisibility,
					}),
				);
			}

			const lines = [
				"Codex Plugin Metrics:",
				"",
				`Uptime: ${formatWaitTime(uptimeMs)}`,
				`Total upstream requests: ${total}`,
				`Successful responses: ${successful}`,
				`Failed responses: ${runtimeMetrics.failedRequests}`,
				`Success rate: ${successRate}%`,
				`Average successful latency: ${avgLatencyMs}ms`,
				`Rate-limited responses: ${runtimeMetrics.rateLimitedResponses}`,
				`Server errors (5xx): ${runtimeMetrics.serverErrors}`,
				`Network errors: ${runtimeMetrics.networkErrors}`,
				`Auth refresh failures: ${runtimeMetrics.authRefreshFailures}`,
				`Account rotations: ${runtimeMetrics.accountRotations}`,
				`Empty-response retries: ${runtimeMetrics.emptyResponseRetries}`,
				`Retry profile: ${runtimeMetrics.retryProfile}`,
				`Beginner safe mode: ${beginnerSafeModeEnabled ? "on" : "off"}`,
				`Retry budget exhaustions: ${runtimeMetrics.retryBudgetExhaustions}`,
				`Retry budget usage (auth/network/server/short/global/empty): ` +
					`${runtimeMetrics.retryBudgetUsage.authRefresh}/` +
					`${runtimeMetrics.retryBudgetUsage.network}/` +
					`${runtimeMetrics.retryBudgetUsage.server}/` +
					`${runtimeMetrics.retryBudgetUsage.rateLimitShort}/` +
					`${runtimeMetrics.retryBudgetUsage.rateLimitGlobal}/` +
					`${runtimeMetrics.retryBudgetUsage.emptyResponse}`,
				`Refresh queue (started/success/failed/pending): ` +
					`${refreshMetrics.started}/` +
					`${refreshMetrics.succeeded}/` +
					`${refreshMetrics.failed}/` +
					`${refreshMetrics.pending}`,
				`Last upstream request: ${lastRequest}`,
			];

			if (runtimeMetrics.lastError) {
				lines.push(`Last error: ${runtimeMetrics.lastError}`);
			}
			if (runtimeMetrics.lastErrorCategory) {
				lines.push(`Last error category: ${runtimeMetrics.lastErrorCategory}`);
			}
			if (runtimeMetrics.lastSelectedAccountIndex !== null) {
				lines.push(
					`Last selected account: ${runtimeMetrics.lastSelectedAccountIndex + 1}`,
				);
			}
			if (runtimeMetrics.lastQuotaKey) {
				lines.push(`Last quota key: ${runtimeMetrics.lastQuotaKey}`);
			}
			if (runtimeMetrics.lastRetryBudgetExhaustedClass) {
				lines.push(
					`Last budget exhaustion: ${runtimeMetrics.lastRetryBudgetExhaustedClass}` +
						(runtimeMetrics.lastRetryBudgetReason
							? ` (${runtimeMetrics.lastRetryBudgetReason})`
							: ""),
				);
			}
			lines.push("");
			appendRoutingVisibilityText(lines, routingVisibility, {
				includeExplainability: true,
			});

			if (ui.v2Enabled) {
				const styled: string[] = [
					...formatUiHeader(ui, "Codex plugin metrics"),
					formatUiKeyValue(ui, "Uptime", formatWaitTime(uptimeMs)),
					formatUiKeyValue(ui, "Total upstream requests", String(total)),
					formatUiKeyValue(
						ui,
						"Successful responses",
						String(successful),
						"success",
					),
					formatUiKeyValue(
						ui,
						"Failed responses",
						String(runtimeMetrics.failedRequests),
						"danger",
					),
					formatUiKeyValue(ui, "Success rate", `${successRate}%`, "accent"),
					formatUiKeyValue(
						ui,
						"Average successful latency",
						`${avgLatencyMs}ms`,
					),
					formatUiKeyValue(
						ui,
						"Rate-limited responses",
						String(runtimeMetrics.rateLimitedResponses),
						"warning",
					),
					formatUiKeyValue(
						ui,
						"Server errors (5xx)",
						String(runtimeMetrics.serverErrors),
						"danger",
					),
					formatUiKeyValue(
						ui,
						"Network errors",
						String(runtimeMetrics.networkErrors),
						"danger",
					),
					formatUiKeyValue(
						ui,
						"Auth refresh failures",
						String(runtimeMetrics.authRefreshFailures),
						"warning",
					),
					formatUiKeyValue(
						ui,
						"Account rotations",
						String(runtimeMetrics.accountRotations),
						"accent",
					),
					formatUiKeyValue(
						ui,
						"Empty-response retries",
						String(runtimeMetrics.emptyResponseRetries),
						"warning",
					),
					formatUiKeyValue(
						ui,
						"Retry profile",
						runtimeMetrics.retryProfile,
						"muted",
					),
					formatUiKeyValue(
						ui,
						"Beginner safe mode",
						beginnerSafeModeEnabled ? "on" : "off",
						beginnerSafeModeEnabled ? "accent" : "muted",
					),
					formatUiKeyValue(
						ui,
						"Retry budget exhaustions",
						String(runtimeMetrics.retryBudgetExhaustions),
						"warning",
					),
					formatUiKeyValue(
						ui,
						"Retry budget usage",
						`A${runtimeMetrics.retryBudgetUsage.authRefresh} N${runtimeMetrics.retryBudgetUsage.network} S${runtimeMetrics.retryBudgetUsage.server} RS${runtimeMetrics.retryBudgetUsage.rateLimitShort} RG${runtimeMetrics.retryBudgetUsage.rateLimitGlobal} E${runtimeMetrics.retryBudgetUsage.emptyResponse}`,
						"muted",
					),
					formatUiKeyValue(
						ui,
						"Retry budget limits",
						`A${runtimeMetrics.retryBudgetLimits.authRefresh} N${runtimeMetrics.retryBudgetLimits.network} S${runtimeMetrics.retryBudgetLimits.server} RS${runtimeMetrics.retryBudgetLimits.rateLimitShort} RG${runtimeMetrics.retryBudgetLimits.rateLimitGlobal} E${runtimeMetrics.retryBudgetLimits.emptyResponse}`,
						"muted",
					),
					formatUiKeyValue(
						ui,
						"Refresh queue",
						`started=${refreshMetrics.started} dedup=${refreshMetrics.deduplicated} reuse=${refreshMetrics.rotationReused} success=${refreshMetrics.succeeded} failed=${refreshMetrics.failed} pending=${refreshMetrics.pending}`,
						"muted",
					),
					formatUiKeyValue(ui, "Last upstream request", lastRequest, "muted"),
				];
				if (runtimeMetrics.lastError) {
					styled.push(
						formatUiKeyValue(
							ui,
							"Last error",
							runtimeMetrics.lastError,
							"danger",
						),
					);
				}
				if (runtimeMetrics.lastErrorCategory) {
					styled.push(
						formatUiKeyValue(
							ui,
							"Last error category",
							runtimeMetrics.lastErrorCategory,
							"warning",
						),
					);
				}
				if (runtimeMetrics.lastSelectedAccountIndex !== null) {
					styled.push(
						formatUiKeyValue(
							ui,
							"Last selected account",
							String(runtimeMetrics.lastSelectedAccountIndex + 1),
							"accent",
						),
					);
				}
				if (runtimeMetrics.lastQuotaKey) {
					styled.push(
						formatUiKeyValue(
							ui,
							"Last quota key",
							runtimeMetrics.lastQuotaKey,
							"muted",
						),
					);
				}
				if (runtimeMetrics.lastRetryBudgetExhaustedClass) {
					styled.push(
						formatUiKeyValue(
							ui,
							"Last budget exhaustion",
							runtimeMetrics.lastRetryBudgetReason
								? `${runtimeMetrics.lastRetryBudgetExhaustedClass} (${runtimeMetrics.lastRetryBudgetReason})`
								: runtimeMetrics.lastRetryBudgetExhaustedClass,
							"warning",
						),
					);
				}
				styled.push("");
				appendRoutingVisibilityUi(ui, styled, routingVisibility, {
					includeExplainability: true,
				});
				return Promise.resolve(styled.join("\n"));
			}

			return Promise.resolve(lines.join("\n"));
		},
	});
}
