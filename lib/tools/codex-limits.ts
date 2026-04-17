/**
 * `codex-limits` tool — show Codex usage limits per account.
 * Extracted from `index.ts` per RC-1 Phase 2.
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import {
	loadAccounts,
	withAccountStorageTransaction,
	type AccountStorageV3,
} from "../storage.js";
import { extractAccountId } from "../accounts.js";
import { queuedRefresh } from "../refresh-queue.js";
import { createCodexHeaders } from "../request/fetch-helpers.js";
import { createUsageRequestTimeoutError } from "../error-sentinels.js";
import { CODEX_BASE_URL, PLUGIN_NAME } from "../constants.js";
import { getFetchTimeoutMs, loadPluginConfig } from "../config.js";
import { logWarn } from "../logger.js";
import {
	formatUiBadge,
	formatUiHeader,
	formatUiItem,
	formatUiKeyValue,
} from "../ui/format.js";
import { normalizeToolOutputFormat, renderJsonOutput } from "../runtime.js";
import type { ToolContext } from "./index.js";

export function createCodexLimitsTool(ctx: ToolContext): ToolDefinition {
	const {
		resolveUiRuntime,
		resolveActiveIndex,
		formatCommandAccountLabel,
		buildJsonAccountIdentity,
		invalidateAccountManagerCache,
	} = ctx;
	return tool({
		description:
			"Show live 5-hour and weekly Codex usage limits for all accounts.",
		args: {
			format: tool.schema
				.string()
				.optional()
				.describe('Output format: "text" (default) or "json".'),
			includeSensitive: tool.schema
				.boolean()
				.optional()
				.describe(
					"Include raw account labels, emails, and account IDs in JSON output. Defaults to false.",
				),
		},
		async execute({
			format,
			includeSensitive,
		}: {
			format?: string;
			includeSensitive?: boolean;
		} = {}) {
			const ui = resolveUiRuntime();
			const outputFormat = normalizeToolOutputFormat(format);
			const includeSensitiveOutput = includeSensitive === true;
			const storage = await loadAccounts();
			if (!storage || storage.accounts.length === 0) {
				if (outputFormat === "json") {
					return renderJsonOutput({
						message:
							"No Codex accounts configured. Run: opencode auth login",
						totalAccounts: 0,
						uniqueCredentialCount: 0,
						activeIndex: null,
						accounts: [],
					});
				}
				if (ui.v2Enabled) {
					return [
						...formatUiHeader(ui, "Codex limits"),
						"",
						formatUiItem(ui, "No accounts configured.", "warning"),
						formatUiItem(ui, "Run: opencode auth login", "accent"),
					].join("\n");
				}
				return "No Codex accounts configured. Run: opencode auth login";
			}

			type UsageWindow = {
				used_percent?: number;
				limit_window_seconds?: number;
				reset_at?: number;
				reset_after_seconds?: number;
			} | null;

			type LimitWindow = {
				usedPercent?: number;
				windowMinutes?: number;
				resetAtMs?: number;
			};

			type UsageRateLimit = {
				primary_window?: UsageWindow;
				secondary_window?: UsageWindow;
			} | null;

			type UsageCredits = {
				has_credits?: boolean;
				unlimited?: boolean;
				balance?: string | null;
			} | null;

			type UsagePayload = {
				plan_type?: string;
				rate_limit?: UsageRateLimit;
				code_review_rate_limit?: UsageRateLimit;
				additional_rate_limits?: Array<{
					limit_name?: string;
					metered_feature?: string;
					rate_limit?: UsageRateLimit;
				}> | null;
				credits?: UsageCredits;
			};

			const formatWindowLabel = (windowMinutes: number | undefined): string => {
				if (
					!windowMinutes ||
					!Number.isFinite(windowMinutes) ||
					windowMinutes <= 0
				) {
					return "quota";
				}
				if (windowMinutes % 1440 === 0) return `${windowMinutes / 1440}d`;
				if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`;
				return `${windowMinutes}m`;
			};

			const formatReset = (
				resetAtMs: number | undefined,
			): string | undefined => {
				if (
					!resetAtMs ||
					!Number.isFinite(resetAtMs) ||
					resetAtMs <= 0
				)
					return undefined;
				const date = new Date(resetAtMs);
				if (!Number.isFinite(date.getTime())) return undefined;

				const now = new Date();
				const sameDay =
					now.getFullYear() === date.getFullYear() &&
					now.getMonth() === date.getMonth() &&
					now.getDate() === date.getDate();
				const time = date.toLocaleTimeString(undefined, {
					hour: "2-digit",
					minute: "2-digit",
					hour12: false,
				});
				if (sameDay) return time;
				const day = date.toLocaleDateString(undefined, {
					month: "short",
					day: "2-digit",
				});
				return `${time} on ${day}`;
			};

			const mapWindow = (window: UsageWindow): LimitWindow => {
				if (!window) return {};
				return {
					usedPercent:
						typeof window.used_percent === "number" &&
						Number.isFinite(window.used_percent)
							? window.used_percent
							: undefined,
					windowMinutes:
						typeof window.limit_window_seconds === "number" &&
						Number.isFinite(window.limit_window_seconds)
							? Math.max(1, Math.ceil(window.limit_window_seconds / 60))
							: undefined,
					resetAtMs:
						typeof window.reset_at === "number" && window.reset_at > 0
							? window.reset_at * 1000
							: typeof window.reset_after_seconds === "number" &&
									window.reset_after_seconds > 0
								? Date.now() + window.reset_after_seconds * 1000
								: undefined,
				};
			};

			const formatLimitTitle = (
				windowMinutes: number | undefined,
				fallback = "quota",
			): string => {
				if (windowMinutes === 300) return "5h limit";
				if (windowMinutes === 10080) return "Weekly limit";
				if (fallback !== "quota") return fallback;
				return `${formatWindowLabel(windowMinutes)} limit`;
			};

			const formatLimitSummary = (window: LimitWindow): string => {
				const used = window.usedPercent;
				const left =
					typeof used === "number" && Number.isFinite(used)
						? Math.max(0, Math.min(100, Math.round(100 - used)))
						: undefined;
				const reset = formatReset(window.resetAtMs);
				if (left !== undefined && reset)
					return `${left}% left (resets ${reset})`;
				if (left !== undefined) return `${left}% left`;
				if (reset) return `resets ${reset}`;
				return "unavailable";
			};

			const toLimitPayload = (name: string, window: LimitWindow) => ({
				name,
				windowMinutes: window.windowMinutes ?? null,
				usedPercent:
					typeof window.usedPercent === "number" ? window.usedPercent : null,
				leftPercent:
					typeof window.usedPercent === "number"
						? Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)))
						: null,
				resetAtMs: window.resetAtMs ?? null,
				summary: formatLimitSummary(window),
			});

			const formatCredits = (
				credits: UsageCredits,
			): string | undefined => {
				if (!credits) return undefined;
				if (credits.unlimited) return "unlimited";
				if (
					typeof credits.balance === "string" &&
					credits.balance.trim()
				) {
					return credits.balance.trim();
				}
				if (credits.has_credits) return "available";
				return undefined;
			};

			const formatExtraName = (name: string | undefined): string => {
				if (!name) return "Additional limit";
				if (name === "code_review_rate_limit") return "Code review";
				return name
					.replace(/[_-]+/g, " ")
					.replace(/\b\w/g, (match) => match.toUpperCase());
			};

			const sanitizeUsageErrorMessage = (
				status: number,
				bodyText: string,
			): string => {
				const normalized = bodyText.replace(/\s+/g, " ").trim();
				const redacted = normalized
					.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
					.replace(
						/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
						"[redacted-token]",
					)
					.replace(
						/\bsk-[A-Za-z0-9][A-Za-z0-9._:-]{19,}\b/gi,
						"[redacted-token]",
					)
					.replace(/\b[a-f0-9]{40,}\b/gi, "[redacted-token]");
				return redacted
					? `HTTP ${status}: ${redacted.slice(0, 200)}`
					: `HTTP ${status}`;
			};

			const isAbortError = (error: unknown): boolean =>
				(error instanceof Error && error.name === "AbortError") ||
				(typeof DOMException !== "undefined" &&
					error instanceof DOMException &&
					error.name === "AbortError");

			const applyRefreshedCredentials = (
				target: {
					refreshToken: string;
					accessToken?: string;
					expiresAt?: number;
				},
				result: {
					refresh: string;
					access: string;
					expires: number;
				},
			): void => {
				target.refreshToken = result.refresh;
				target.accessToken = result.access;
				target.expiresAt = result.expires;
			};
			const usageErrorBodyMaxChars = 4096;

			const persistRefreshedCredentials = async (params: {
				previousRefreshToken: string;
				accountId?: string;
				organizationId?: string;
				email?: string;
				refreshResult: {
					refresh: string;
					access: string;
					expires: number;
				};
			}): Promise<boolean> => {
				return await withAccountStorageTransaction(async (current, persist) => {
					const latestStorage: AccountStorageV3 =
						current ??
						({
							version: 3,
							accounts: [],
							activeIndex: 0,
							activeIndexByFamily: {},
						} satisfies AccountStorageV3);

					const uniqueMatch = <T>(matches: T[]): T | undefined =>
						matches.length === 1 ? matches[0] : undefined;

					let updated = false;
					if (params.previousRefreshToken) {
						for (const storedAccount of latestStorage.accounts) {
							if (
								storedAccount.refreshToken === params.previousRefreshToken
							) {
								applyRefreshedCredentials(storedAccount, params.refreshResult);
								updated = true;
							}
						}
					}

					if (!updated) {
						const normalizedOrganizationId =
							params.organizationId?.trim() ?? "";
						const normalizedEmail = params.email?.trim().toLowerCase();
						const orgScopedMatches = params.accountId
							? latestStorage.accounts.filter(
									(storedAccount) =>
										storedAccount.accountId === params.accountId &&
										(storedAccount.organizationId?.trim() ?? "") ===
											normalizedOrganizationId,
								)
							: [];
						const accountIdMatches = params.accountId
							? latestStorage.accounts.filter(
									(storedAccount) =>
										storedAccount.accountId === params.accountId,
								)
							: [];
						const emailMatches =
							normalizedEmail && !params.accountId
								? latestStorage.accounts.filter(
										(storedAccount) =>
											storedAccount.email?.trim().toLowerCase() ===
											normalizedEmail,
									)
								: [];

						const fallbackTarget =
							uniqueMatch(orgScopedMatches) ??
							uniqueMatch(accountIdMatches) ??
							uniqueMatch(emailMatches);

						if (fallbackTarget) {
							applyRefreshedCredentials(fallbackTarget, params.refreshResult);
							updated = true;
						}
					}

					if (updated) {
						await persist(latestStorage);
					}
					if (!updated) {
						logWarn(
							`[${PLUGIN_NAME}] persistRefreshedCredentials could not find a matching stored account. Refreshed credentials remain in-memory for this invocation only.`,
							{
								accountId: params.accountId,
								organizationId: params.organizationId,
							},
						);
					}

					return updated;
				});
			};

			const usageFetchTimeoutMs = getFetchTimeoutMs(loadPluginConfig());

			const fetchUsage = async (params: {
				accountId: string;
				accessToken: string;
				organizationId: string | undefined;
			}): Promise<UsagePayload> => {
				const headers = createCodexHeaders(
					undefined,
					params.accountId,
					params.accessToken,
					{
						organizationId: params.organizationId,
					},
				);
				headers.set("accept", "application/json");
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), usageFetchTimeoutMs);

				try {
					const response = await fetch(`${CODEX_BASE_URL}/wham/usage`, {
						method: "GET",
						headers,
						signal: controller.signal,
					});
					if (!response.ok) {
						let bodyText = "";
						try {
							bodyText = (await response.text()).slice(
								0,
								usageErrorBodyMaxChars,
							);
						} catch (error) {
							if (isAbortError(error) || controller.signal.aborted) {
								throw createUsageRequestTimeoutError();
							}
							throw error;
						}
						if (controller.signal.aborted) {
							throw createUsageRequestTimeoutError();
						}
						throw new Error(
							sanitizeUsageErrorMessage(response.status, bodyText),
						);
					}
					return (await response.json()) as UsagePayload;
				} catch (error) {
					if (isAbortError(error)) {
						throw createUsageRequestTimeoutError();
					}
					throw error;
				} finally {
					clearTimeout(timeout);
				}
			};

			// Deduplicate accounts by refreshToken (same credential = same limits)
			const seenTokens = new Set<string>();
			const uniqueIndices: number[] = [];
			for (let i = 0; i < storage.accounts.length; i++) {
				const acct = storage.accounts[i];
				if (!acct) continue;
				const refreshToken =
					typeof acct.refreshToken === "string"
						? acct.refreshToken.trim()
						: "";
				if (refreshToken && seenTokens.has(refreshToken)) continue;
				if (refreshToken) seenTokens.add(refreshToken);
				uniqueIndices.push(i);
			}

			const lines: string[] = ui.v2Enabled
				? [...formatUiHeader(ui, "Codex limits"), ""]
				: [
						`Codex limits (${uniqueIndices.length} account${uniqueIndices.length === 1 ? "" : "s"}):`,
						"",
					];
			const activeIndex = resolveActiveIndex(storage, "codex");
			const activeRefreshToken =
				typeof activeIndex === "number" &&
				activeIndex >= 0 &&
				activeIndex < storage.accounts.length
					? storage.accounts[activeIndex]?.refreshToken?.trim() || undefined
					: undefined;
			let storageChanged = false;
			const jsonAccounts: Array<Record<string, unknown>> = [];

			for (const i of uniqueIndices) {
				const account = storage.accounts[i];
				if (!account) continue;
				const sharesActiveCredential =
					!!activeRefreshToken && account.refreshToken === activeRefreshToken;
				const displayIndex =
					sharesActiveCredential && typeof activeIndex === "number"
						? activeIndex
						: i;
				const displayAccount = storage.accounts[displayIndex];
				if (sharesActiveCredential && !displayAccount) {
					logWarn(
						`[${PLUGIN_NAME}] active account entry missing for index ${displayIndex}, falling back to account ${i}`,
					);
				}
				const effectiveDisplayAccount = displayAccount ?? account;
				const label = formatCommandAccountLabel(
					effectiveDisplayAccount,
					displayIndex,
				);
				const isActive = i === activeIndex || sharesActiveCredential;
				const activeSuffix = isActive
					? ui.v2Enabled
						? ` ${formatUiBadge(ui, "active", "accent")}`
						: " [active]"
					: "";

				try {
					let accessToken = account.accessToken;
					if (
						typeof accessToken !== "string" ||
						!accessToken ||
						typeof account.expiresAt !== "number" ||
						account.expiresAt <= Date.now() + 30_000
					) {
						const previousRefreshToken = account.refreshToken;
						if (!previousRefreshToken) {
							throw new Error("Cannot refresh: account has no refresh token");
						}
						const refreshResult = await queuedRefresh(previousRefreshToken);
						if (refreshResult.type !== "success") {
							throw new Error(
								refreshResult.message ?? refreshResult.reason,
							);
						}

						let refreshedCount = 0;
						for (const storedAccount of storage.accounts) {
							if (!storedAccount) continue;
							if (storedAccount.refreshToken === previousRefreshToken) {
								applyRefreshedCredentials(storedAccount, refreshResult);
								refreshedCount += 1;
							}
						}
						if (refreshedCount === 0) {
							applyRefreshedCredentials(account, refreshResult);
						}

						const persistedRefresh = await persistRefreshedCredentials({
							previousRefreshToken,
							accountId: account.accountId,
							organizationId: account.organizationId,
							email: account.email,
							refreshResult,
						});

						accessToken = refreshResult.access;
						storageChanged = storageChanged || persistedRefresh;
					}

					const effectiveAccount = sharesActiveCredential
						? effectiveDisplayAccount
						: account;
					const accountId =
						effectiveAccount.accountId ?? extractAccountId(accessToken);
					if (!accountId) {
						throw new Error("Missing account id");
					}

					const payload = await fetchUsage({
						accountId,
						accessToken,
						organizationId: effectiveAccount.organizationId,
					});

					const primary = mapWindow(payload.rate_limit?.primary_window ?? null);
					const secondary = mapWindow(
						payload.rate_limit?.secondary_window ?? null,
					);
					const codeReviewRateLimit =
						payload.code_review_rate_limit ??
						payload.additional_rate_limits?.find(
							(entry) => entry.limit_name === "code_review_rate_limit",
						)?.rate_limit ??
						null;
					const codeReview = mapWindow(
						codeReviewRateLimit?.primary_window ?? null,
					);
					const credits = formatCredits(payload.credits ?? null);
					const additionalLimits = (
						payload.additional_rate_limits ?? []
					).filter(
						(entry) => entry.limit_name !== "code_review_rate_limit",
					);
					const limits = [
						toLimitPayload(formatLimitTitle(primary.windowMinutes), primary),
						toLimitPayload(
							formatLimitTitle(secondary.windowMinutes),
							secondary,
						),
					];
					if (
						codeReview.windowMinutes ||
						typeof codeReview.usedPercent === "number" ||
						codeReview.resetAtMs
					) {
						limits.push(toLimitPayload("Code review", codeReview));
					}
					for (const limit of additionalLimits) {
						const extraWindow = mapWindow(
							limit.rate_limit?.primary_window ?? null,
						);
						limits.push(
							toLimitPayload(
								formatExtraName(limit.limit_name ?? limit.metered_feature),
								extraWindow,
							),
						);
					}
					jsonAccounts.push({
						...buildJsonAccountIdentity(displayIndex, {
							includeSensitive: includeSensitiveOutput,
							account: effectiveDisplayAccount,
							label,
						}),
						isActive,
						sharesActiveCredential,
						planType: payload.plan_type ?? null,
						credits: credits ?? null,
						limits,
					});

					if (ui.v2Enabled) {
						lines.push(formatUiItem(ui, `${label}${activeSuffix}`));
						lines.push(
							`  ${formatUiKeyValue(ui, formatLimitTitle(primary.windowMinutes), formatLimitSummary(primary), "muted")}`,
						);
						lines.push(
							`  ${formatUiKeyValue(ui, formatLimitTitle(secondary.windowMinutes), formatLimitSummary(secondary), "muted")}`,
						);
						if (
							codeReview.windowMinutes ||
							typeof codeReview.usedPercent === "number" ||
							codeReview.resetAtMs
						) {
							lines.push(
								`  ${formatUiKeyValue(ui, "Code review", formatLimitSummary(codeReview), "muted")}`,
							);
						}
						for (const limit of additionalLimits) {
							const extraWindow = mapWindow(
								limit.rate_limit?.primary_window ?? null,
							);
							lines.push(
								`  ${formatUiKeyValue(ui, formatExtraName(limit.limit_name ?? limit.metered_feature), formatLimitSummary(extraWindow), "muted")}`,
							);
						}
						if (payload.plan_type) {
							lines.push(
								`  ${formatUiKeyValue(ui, "Plan", payload.plan_type, "muted")}`,
							);
						}
						if (credits) {
							lines.push(
								`  ${formatUiKeyValue(ui, "Credits", credits, "muted")}`,
							);
						}
					} else {
						lines.push(`${label}${activeSuffix}:`);
						lines.push(
							`  ${formatLimitTitle(primary.windowMinutes)}: ${formatLimitSummary(primary)}`,
						);
						lines.push(
							`  ${formatLimitTitle(secondary.windowMinutes)}: ${formatLimitSummary(secondary)}`,
						);
						if (
							codeReview.windowMinutes ||
							typeof codeReview.usedPercent === "number" ||
							codeReview.resetAtMs
						) {
							lines.push(
								`  Code review: ${formatLimitSummary(codeReview)}`,
							);
						}
						for (const limit of additionalLimits) {
							const extraWindow = mapWindow(
								limit.rate_limit?.primary_window ?? null,
							);
							lines.push(
								`  ${formatExtraName(limit.limit_name ?? limit.metered_feature)}: ${formatLimitSummary(extraWindow)}`,
							);
						}
						if (payload.plan_type) {
							lines.push(`  Plan: ${payload.plan_type}`);
						}
						if (credits) {
							lines.push(`  Credits: ${credits}`);
						}
					}
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					jsonAccounts.push({
						...buildJsonAccountIdentity(displayIndex, {
							includeSensitive: includeSensitiveOutput,
							account: effectiveDisplayAccount,
							label,
						}),
						isActive,
						sharesActiveCredential,
						error: message.slice(0, 160),
					});
					if (ui.v2Enabled) {
						lines.push(formatUiItem(ui, `${label}${activeSuffix}`));
						lines.push(
							`  ${formatUiKeyValue(ui, "Error", message.slice(0, 160), "danger")}`,
						);
					} else {
						lines.push(`${label}${activeSuffix}:`);
						lines.push(`  Error: ${message.slice(0, 160)}`);
					}
				}

				lines.push("");
			}

			if (storageChanged) {
				invalidateAccountManagerCache();
			}
			if (outputFormat === "json") {
				return renderJsonOutput({
					totalAccounts: storage.accounts.length,
					uniqueCredentialCount: uniqueIndices.length,
					activeIndex: activeIndex + 1,
					accounts: jsonAccounts,
				});
			}

			while (lines.length > 0 && lines[lines.length - 1] === "") {
				lines.pop();
			}

			return lines.join("\n");
		},
	});
}
