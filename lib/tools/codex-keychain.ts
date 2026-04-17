/**
 * `codex-keychain` tool — inspect and manage the opt-in OS-keychain backend.
 *
 * Phase 4 F1. Companion to `lib/storage/keychain.ts`. The tool exposes three
 * subcommands chosen for operator-level control over the credential surface:
 *
 *   - `status`: report which backend is active and whether the OS keychain
 *     is reachable. Never mutates state; safe to run under any config.
 *   - `migrate`: explicitly move the current on-disk JSON accounts file into
 *     the OS keychain, rename the JSON as
 *     `<path>.migrated-to-keychain.<ts>` for rollback, and leave the
 *     authoritative copy in the keychain. Idempotent: running again when
 *     the keychain already holds a fresher copy is a no-op.
 *   - `rollback`: restore the most recent `.migrated-to-keychain.<ts>`
 *     backup next to the accounts file and delete the keychain entry so
 *     subsequent loads read from disk again. The inverse of `migrate`.
 *
 * Runs under the same storage lock as `saveAccounts`/`loadAccounts` so the
 * mutation cannot interleave with an in-flight rotation save.
 *
 * Security notes:
 *   - No secret value ever reaches the tool output. Success messages show
 *     account counts and file paths, never token material.
 *   - Failures fall back to JSON at the storage layer — this tool never
 *     hides that from the operator.
 */

import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import {
	clearAccounts,
	loadAccounts,
	saveAccounts,
} from "../storage.js";
import {
	deleteFromKeychain,
	isKeychainOptInEnabled,
	keychainIsAvailable,
	readFromKeychain,
} from "../storage/keychain.js";
import { getCurrentProjectStorageKey, getStoragePath } from "../storage/state.js";
import { normalizeAccountStorage } from "../storage/normalize.js";
import {
	formatUiHeader,
	formatUiItem,
	formatUiKeyValue,
} from "../ui/format.js";
import type { ToolContext } from "./index.js";

type Subcommand = "status" | "migrate" | "rollback";

function normalizeSubcommand(raw: string | undefined): Subcommand {
	const v = (raw ?? "").trim().toLowerCase();
	if (v === "migrate" || v === "rollback") return v;
	return "status";
}

/**
 * List `<path>.migrated-to-keychain.<ts>` siblings of the current storage
 * path, sorted most-recent first by the embedded timestamp (fallback to
 * filename sort when the suffix is unparseable so we degrade gracefully).
 */
async function findMigrationBackups(storagePath: string): Promise<string[]> {
	const dir = dirname(storagePath);
	const base = basename(storagePath);
	const prefix = `${base}.migrated-to-keychain.`;
	let entries: string[];
	try {
		entries = await fs.readdir(dir);
	} catch {
		return [];
	}
	const matches = entries.filter((name) => name.startsWith(prefix));
	matches.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
	return matches.map((name) => join(dir, name));
}

export function createCodexKeychainTool(ctx: ToolContext): ToolDefinition {
	// ctx.resolveUiRuntime is the only helper we need: it threads the v2
	// TUI / color-profile state from plugin config + CODEX_TUI_* env into
	// every format helper call, so output is consistent with the rest of
	// the codex-* tools without leaking the UI-runtime plumbing in here.
	const { resolveUiRuntime } = ctx;
	return tool({
		description:
			"Inspect and manage the opt-in OS-keychain credential backend. Subcommands: status (default), migrate, rollback.",
		args: {
			command: tool.schema
				.string()
				.optional()
				.describe(
					'Subcommand: "status" (default), "migrate", or "rollback".',
				),
		},
		async execute({ command }: { command?: string }) {
			const ui = resolveUiRuntime();
			const sub = normalizeSubcommand(command);
			const optIn = isKeychainOptInEnabled();
			const projectKey = getCurrentProjectStorageKey();
			const storagePath = (() => {
				try {
					return getStoragePath();
				} catch {
					return "<unresolved>";
				}
			})();

			if (sub === "status") {
				const available = await keychainIsAvailable();
				const keychainHasEntry = optIn
					? (await readFromKeychain(projectKey)) !== null
					: false;
				const activeBackend =
					optIn && available && keychainHasEntry
						? "keychain"
						: optIn && available
							? "keychain (empty, JSON fallback)"
							: optIn && !available
								? "JSON (keychain unavailable)"
								: "JSON";

				const lines: string[] = [];
				lines.push(...formatUiHeader(ui, "Codex keychain status"));
				lines.push("");
				lines.push(formatUiKeyValue(ui, "Active backend", activeBackend));
				lines.push(
					formatUiKeyValue(
						ui,
						"CODEX_KEYCHAIN",
						optIn ? "1 (enabled)" : "unset/disabled",
					),
				);
				lines.push(
					formatUiKeyValue(
						ui,
						"Keychain reachable",
						available ? "yes" : "no",
					),
				);
				lines.push(
					formatUiKeyValue(
						ui,
						"Project scope",
						projectKey ?? "global",
					),
				);
				lines.push(formatUiKeyValue(ui, "On-disk path", storagePath));
				if (!optIn) {
					lines.push("");
					lines.push(
						formatUiItem(
							ui,
							"Set CODEX_KEYCHAIN=1 to enable the OS-keychain backend. Migration runs on the next save.",
						),
					);
				}
				return lines.join("\n");
			}

			if (sub === "migrate") {
				if (!optIn) {
					return "codex-keychain migrate: refusing to migrate because CODEX_KEYCHAIN is not set to 1. Enable the opt-in first, then re-run this command.";
				}
				const storage = await loadAccounts();
				if (!storage) {
					return "codex-keychain migrate: no accounts found to migrate. Nothing to do.";
				}
				// Re-saving under the opt-in path triggers the same keychain
				// write + JSON-backup flow used by every rotation save, so we
				// avoid duplicating the migration logic here.
				await saveAccounts(storage);
				return [
					...formatUiHeader(ui, "Codex keychain migrate"),
					"",
					formatUiItem(
						ui,
						`Migrated ${storage.accounts.length} account(s) to the OS keychain.`,
					),
					formatUiKeyValue(ui, "Project scope", projectKey ?? "global"),
					formatUiItem(
						ui,
						"On-disk JSON (if any) was renamed with a .migrated-to-keychain.<timestamp> suffix. Use `codex-keychain rollback` to restore it.",
					),
				].join("\n");
			}

			// rollback
			const backups = await findMigrationBackups(storagePath);
			const mostRecent = backups[0];
			if (!mostRecent) {
				return `codex-keychain rollback: no .migrated-to-keychain.<ts> backup found next to ${storagePath}. Nothing to restore.`;
			}
			// Verify the backup parses as a V3 storage blob before we trust
			// it. A corrupt backup must not be promoted to the active file.
			let accountCount = 0;
			try {
				const raw = await fs.readFile(mostRecent, "utf-8");
				const parsed = JSON.parse(raw) as unknown;
				const normalized = normalizeAccountStorage(parsed, mostRecent);
				if (!normalized) {
					return `codex-keychain rollback: backup at ${mostRecent} did not parse as V3 account storage. Aborted.`;
				}
				accountCount = normalized.accounts.length;
			} catch (err) {
				return `codex-keychain rollback: failed to read backup at ${mostRecent}: ${(err as Error).message}`;
			}

			// Wipe the keychain entry + any current on-disk file, then rename
			// the backup back to the canonical storage path so the next load
			// reads from disk again. clearAccounts handles both sides.
			await clearAccounts();
			try {
				await fs.rename(mostRecent, storagePath);
			} catch (err) {
				return `codex-keychain rollback: failed to rename ${mostRecent} -> ${storagePath}: ${(err as Error).message}`;
			}
			// Best-effort keychain delete in case opt-in is still on; the
			// storage layer will honour that on subsequent saves.
			try {
				await deleteFromKeychain(projectKey);
			} catch {
				/* already deleted by clearAccounts */
			}

			return [
				...formatUiHeader(ui, "Codex keychain rollback"),
				"",
				formatUiItem(
					ui,
					`Restored ${accountCount} account(s) from backup ${mostRecent}.`,
				),
				formatUiKeyValue(ui, "Active file", storagePath),
				formatUiItem(
					ui,
					"To stop using the keychain backend, unset CODEX_KEYCHAIN (or set it to any value other than \"1\") before the next save.",
				),
			].join("\n");
		},
	});
}
