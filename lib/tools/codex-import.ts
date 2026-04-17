/**
 * `codex-import` tool — import accounts from JSON file.
 * Extracted from `index.ts` per RC-1 Phase 2.
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { importAccounts, previewImportAccounts } from "../storage.js";
import { formatUiHeader, formatUiItem, formatUiKeyValue } from "../ui/format.js";
import type { ToolContext } from "./index.js";

export function createCodexImportTool(ctx: ToolContext): ToolDefinition {
	const { resolveUiRuntime, getStatusMarker, invalidateAccountManagerCache } =
		ctx;
	return tool({
		description:
			"Import accounts from a JSON file, with dry-run preview and automatic timestamped backup before apply.",
		args: {
			path: tool.schema
				.string()
				.describe("File path to import from (e.g., ~/codex-backup.json)"),
			dryRun: tool.schema
				.boolean()
				.optional()
				.describe("Preview import impact without applying changes."),
		},
		async execute({
			path: filePath,
			dryRun,
		}: {
			path: string;
			dryRun?: boolean;
		}) {
			const ui = resolveUiRuntime();
			try {
				const preview = await previewImportAccounts(filePath);
				if (dryRun) {
					if (ui.v2Enabled) {
						return [
							...formatUiHeader(ui, "Import preview"),
							"",
							formatUiItem(ui, "No changes applied (dry run).", "warning"),
							formatUiKeyValue(ui, "Path", filePath, "muted"),
							formatUiKeyValue(
								ui,
								"New accounts",
								String(preview.imported),
								preview.imported > 0 ? "success" : "muted",
							),
							formatUiKeyValue(
								ui,
								"Duplicates skipped",
								String(preview.skipped),
								preview.skipped > 0 ? "warning" : "muted",
							),
							formatUiKeyValue(
								ui,
								"Resulting total",
								String(preview.total),
								"accent",
							),
						].join("\n");
					}
					return [
						"Import preview (dry run):",
						`Path: ${filePath}`,
						`New accounts: ${preview.imported}`,
						`Duplicates skipped: ${preview.skipped}`,
						`Resulting total: ${preview.total}`,
					].join("\n");
				}

				const result = await importAccounts(filePath, {
					preImportBackupPrefix: "codex-pre-import-backup",
					backupMode: "required",
				});
				const backupSummary =
					result.backupStatus === "created"
						? (result.backupPath ?? "created")
						: result.backupStatus === "failed"
							? `failed (${result.backupError ?? "unknown error"})`
							: "skipped (no existing accounts)";
				const backupStatus: "ok" | "warning" =
					result.backupStatus === "created" ? "ok" : "warning";
				invalidateAccountManagerCache();
				const lines = [`Import complete.`, ``];
				lines.push(
					`Preview: +${preview.imported} new, ${preview.skipped} skipped, ${preview.total} total`,
				);
				lines.push(`Auto-backup: ${backupSummary}`);
				if (result.imported > 0) {
					lines.push(`New accounts: ${result.imported}`);
				}
				if (result.skipped > 0) {
					lines.push(`Duplicates skipped: ${result.skipped}`);
				}
				lines.push(`Total accounts: ${result.total}`);
				if (ui.v2Enabled) {
					const styled = [
						...formatUiHeader(ui, "Import accounts"),
						"",
						formatUiItem(
							ui,
							`${getStatusMarker(ui, "ok")} Import complete`,
							"success",
						),
						formatUiKeyValue(ui, "Path", filePath, "muted"),
						formatUiKeyValue(
							ui,
							"Auto-backup",
							backupSummary,
							backupStatus === "ok" ? "muted" : "warning",
						),
						formatUiKeyValue(
							ui,
							"Preview",
							`+${preview.imported}, skipped=${preview.skipped}, total=${preview.total}`,
							"muted",
						),
						formatUiKeyValue(
							ui,
							"New accounts",
							String(result.imported),
							result.imported > 0 ? "success" : "muted",
						),
						formatUiKeyValue(
							ui,
							"Duplicates skipped",
							String(result.skipped),
							result.skipped > 0 ? "warning" : "muted",
						),
						formatUiKeyValue(
							ui,
							"Total accounts",
							String(result.total),
							"accent",
						),
					];
					return styled.join("\n");
				}
				return lines.join("\n");
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				if (ui.v2Enabled) {
					return [
						...formatUiHeader(ui, "Import accounts"),
						"",
						formatUiItem(
							ui,
							`${getStatusMarker(ui, "error")} Import failed`,
							"danger",
						),
						formatUiKeyValue(ui, "Error", msg, "danger"),
					].join("\n");
				}
				return `Import failed: ${msg}`;
			}
		},
	});
}
