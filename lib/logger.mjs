import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Logging configuration
const LOGGING_ENABLED = process.env.ENABLE_PLUGIN_REQUEST_LOGGING === "1";
const LOG_DIR = join(homedir(), ".opencode", "logs", "codex-plugin");

// Log startup message about logging state
if (LOGGING_ENABLED) {
	console.log("[openai-codex-plugin] Request logging ENABLED - logs will be saved to:", LOG_DIR);
}

let requestCounter = 0;

/**
 * Log request data to file (only when LOGGING_ENABLED is true)
 * @param {string} stage - The stage of the request (e.g., "before-transform", "after-transform")
 * @param {object} data - The data to log
 */
export function logRequest(stage, data) {
	// Only log if explicitly enabled via environment variable
	if (!LOGGING_ENABLED) return;

	// Ensure log directory exists on first log
	if (!existsSync(LOG_DIR)) {
		mkdirSync(LOG_DIR, { recursive: true });
	}

	const timestamp = new Date().toISOString();
	const requestId = ++requestCounter;
	const filename = join(LOG_DIR, `request-${requestId}-${stage}.json`);

	try {
		writeFileSync(
			filename,
			JSON.stringify(
				{
					timestamp,
					requestId,
					stage,
					...data,
				},
				null,
				2,
			),
			"utf8",
		);
		console.log(`[openai-codex-plugin] Logged ${stage} to ${filename}`);
	} catch (e) {
		console.error("[openai-codex-plugin] Failed to write log:", e.message);
	}
}

export { LOGGING_ENABLED };
