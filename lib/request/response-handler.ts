import { createLogger, logRequest, LOGGING_ENABLED } from "../logger.js";

import type { SSEEventData } from "../types.js";

const log = createLogger("response-handler");

const MAX_SSE_SIZE = 10 * 1024 * 1024; // 10MB limit to prevent memory exhaustion
const DEFAULT_STREAM_STALL_TIMEOUT_MS = 45_000;
const STREAM_ERROR_CODE = "stream_error";
const TERMINAL_EVENT_TYPE_PATTERN =
	/"type"\s*:\s*"(?:error|response\.error|response\.failed|response\.incomplete|response\.done|response\.completed)"/;
const TERMINAL_SSE_LINE_PATTERN =
	/response\.(?:error|failed|incomplete|done|completed)|"type"\s*:\s*"error"/;
const RESPONSE_TYPE_PREFIX = "\"type\":\"response.";
const RESPONSE_TYPE_PREFIX_LENGTH = RESPONSE_TYPE_PREFIX.length;

type ParsedSseResult =
	| {
			kind: "response";
			response: unknown;
	  }
	| {
			kind: "error";
			error: {
				message: string;
				type?: string;
				code?: string | number;
			};
	  };

export interface SseConversionResult {
	response: Response;
	parsedResponse?: unknown;
}

function toRecord(value: unknown): Record<string, unknown> | null {
	if (value && typeof value === "object") {
		return value as Record<string, unknown>;
	}
	return null;
}

function extractErrorFromRecord(errorRecord: Record<string, unknown> | null): {
	message: string;
	type?: string;
	code?: string | number;
} | null {
	if (!errorRecord) return null;
	const message =
		typeof errorRecord.message === "string" ? errorRecord.message.trim() : "";
	if (!message) return null;
	const type = typeof errorRecord.type === "string" ? errorRecord.type : undefined;
	const rawCode = errorRecord.code;
	const code =
		typeof rawCode === "string" || typeof rawCode === "number"
			? rawCode
			: undefined;

	return { message, type, code };
}

function extractStreamError(event: SSEEventData): {
	message: string;
	type?: string;
	code?: string | number;
} {
	const errorRecord = toRecord((event as { error?: unknown }).error);
	const eventMessage = (event as { message?: unknown }).message;
	const parsedError = extractErrorFromRecord(errorRecord);
	if (parsedError) return parsedError;

	const message =
		(typeof eventMessage === "string" ? eventMessage.trim() : "") ||
		"Codex stream emitted an error event";
	return { message };
}

function extractResponseError(responseRecord: Record<string, unknown>): {
	message: string;
	type?: string;
	code?: string | number;
} | null {
	const status = typeof responseRecord.status === "string" ? responseRecord.status : "";
	const parsedError = extractErrorFromRecord(
		toRecord((responseRecord as { error?: unknown }).error),
	);
	if (parsedError) return parsedError;
	if (status === "failed" || status === "incomplete") {
		return { message: `Codex stream ended with status: ${status}` };
	}
	return null;
}

function parseDataPayload(line: string): string | null {
	if (!line.startsWith("data:")) return null;
	let payloadStart = 5;
	while (payloadStart < line.length) {
		const code = line.charCodeAt(payloadStart);
		if (code !== 32 && code !== 9) break;
		payloadStart += 1;
	}
	const payload = line.slice(payloadStart);
	if (!payload || payload === "[DONE]") return null;
	return payload;
}

function parseSsePayload(payload: string): ParsedSseResult | null {
	// Fast path: most SSE events are non-terminal deltas we can skip without JSON parsing.
	if (!TERMINAL_EVENT_TYPE_PATTERN.test(payload)) {
		return null;
	}

	try {
		const data = JSON.parse(payload) as SSEEventData;
		const responseRecord = toRecord((data as { response?: unknown }).response);

		if (data.type === "error" || data.type === "response.error") {
			const parsedError = extractStreamError(data);
			log.error("SSE error event received", { error: parsedError });
			return { kind: "error", error: parsedError };
		}

		if (data.type === "response.failed" || data.type === "response.incomplete") {
			const parsedError =
				(responseRecord && extractResponseError(responseRecord)) ??
				extractStreamError(data);
			log.error("SSE response terminal error event received", {
				type: data.type,
				error: parsedError,
			});
			return { kind: "error", error: parsedError };
		}

		if (data.type === "response.done" || data.type === "response.completed") {
			if (responseRecord) {
				const parsedError = extractResponseError(responseRecord);
				if (parsedError) {
					log.error("SSE response completed with terminal error", {
						error: parsedError,
						status: responseRecord.status,
					});
					return { kind: "error", error: parsedError };
				}
			}
			return { kind: "response", response: data.response };
		}
	} catch {
		// Skip malformed JSON
	}

	return null;
}

function isPotentialTerminalSseLine(line: string): boolean {
	const responseTypePrefixIndex = line.indexOf(RESPONSE_TYPE_PREFIX);
	if (responseTypePrefixIndex >= 0) {
		const terminalInitial = line.charCodeAt(
			responseTypePrefixIndex + RESPONSE_TYPE_PREFIX_LENGTH,
		);
		// done/completed/failed/incomplete/error
		return (
			terminalInitial === 100 ||
			terminalInitial === 99 ||
			terminalInitial === 102 ||
			terminalInitial === 105 ||
			terminalInitial === 101
		);
	}

	if (line.includes("\"type\":\"error\"") || line.includes("\"type\": \"error\"")) {
		return true;
	}

	return line.includes("\"type\"") && TERMINAL_SSE_LINE_PATTERN.test(line);
}

function consumeSseBuffer(
	buffer: string,
	options?: { flush?: boolean },
): { parsed: ParsedSseResult | null; remainder: string } {
	let cursor = 0;
	while (true) {
		const lineEnd = buffer.indexOf("\n", cursor);
		if (lineEnd < 0) break;
		let line = buffer.slice(cursor, lineEnd);
		if (line.endsWith("\r")) {
			line = line.slice(0, -1);
		}
		if (!isPotentialTerminalSseLine(line)) {
			cursor = lineEnd + 1;
			continue;
		}
		const payload = parseDataPayload(line);
		if (payload) {
			const parsed = parseSsePayload(payload);
			if (parsed) {
				return {
					parsed,
					remainder: "",
				};
			}
		}
		cursor = lineEnd + 1;
	}

	const remainder = buffer.slice(cursor);
	const trimmedRemainder = remainder.trim();
	if (options?.flush && trimmedRemainder.length > 0) {
		if (!isPotentialTerminalSseLine(trimmedRemainder)) {
			return {
				parsed: null,
				remainder: "",
			};
		}
		const payload = parseDataPayload(trimmedRemainder);
		if (payload) {
			const parsed = parseSsePayload(payload);
			if (parsed) {
				return {
					parsed,
					remainder: "",
				};
			}
		}
	}

	return {
		parsed: null,
		remainder: options?.flush ? "" : remainder,
	};
}

function buildErrorResponse(
	parsedError: { message: string; type?: string; code?: string | number },
	response: Response,
	headers: Headers,
): Response {
	log.warn("SSE stream returned an error event", parsedError);
	logRequest("stream-error", {
		error: parsedError.message,
		type: parsedError.type,
		code: parsedError.code,
	});

	const jsonHeaders = new Headers(headers);
	jsonHeaders.set("content-type", "application/json; charset=utf-8");
	const status = response.status >= 400 ? response.status : 502;
	const payload = {
		error: {
			message: parsedError.message,
			type: parsedError.type ?? STREAM_ERROR_CODE,
			code: parsedError.code ?? STREAM_ERROR_CODE,
		},
	};

	return new Response(JSON.stringify(payload), {
		status,
		statusText: status === 502 ? "Bad Gateway" : response.statusText,
		headers: jsonHeaders,
	});
}

/**
 * Convert SSE stream response to JSON for generateText()
 * @param response - Fetch response with SSE stream
 * @param headers - Response headers
 * @returns Response with JSON body
 */
export async function convertSseToJson(
	response: Response,
	headers: Headers,
	options?: { streamStallTimeoutMs?: number },
): Promise<Response> {
	const result = await convertSseToJsonDetailed(response, headers, options);
	return result.response;
}

export async function convertSseToJsonDetailed(
	response: Response,
	headers: Headers,
	options?: { streamStallTimeoutMs?: number },
): Promise<SseConversionResult> {
	if (!response.body) {
		throw new Error('[openai-codex-plugin] Response has no body');
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let fullText = "";
	let parseBuffer = "";
	let parsedResult: ParsedSseResult | null = null;
	const streamStallTimeoutMs = Math.max(
		1_000,
		Math.floor(options?.streamStallTimeoutMs ?? DEFAULT_STREAM_STALL_TIMEOUT_MS),
	);

	try {
		// Consume stream incrementally and stop early once terminal event is parsed.
		while (true) {
			const { done, value } = await readWithTimeout(reader, streamStallTimeoutMs);
			const chunkText = done
				? decoder.decode()
				: decoder.decode(value, { stream: true });
			if (chunkText) {
				fullText += chunkText;
				parseBuffer += chunkText;
			}
			if (fullText.length > MAX_SSE_SIZE) {
				throw new Error(`SSE response exceeds ${MAX_SSE_SIZE} bytes limit`);
			}

			const consumed = consumeSseBuffer(parseBuffer, { flush: done });
			parseBuffer = consumed.remainder;
			if (consumed.parsed) {
				parsedResult = consumed.parsed;
				if (!done && typeof reader.cancel === "function") {
					await reader.cancel("terminal SSE event parsed").catch(() => {});
				}
				break;
			}
			if (done) break;
		}

		if (LOGGING_ENABLED) {
			logRequest("stream-full", { fullContent: fullText });
		}

		if (parsedResult?.kind === "error") {
			return {
				response: buildErrorResponse(parsedResult.error, response, headers),
				parsedResponse: undefined,
			};
		}

		const finalResponse =
			parsedResult?.kind === "response" ? parsedResult.response : null;

		if (!finalResponse) {
			log.warn("Could not find final response in SSE stream");

			logRequest("stream-error", { error: "No response.done event found" });

			// Return original stream if we can't parse
			return {
				response: new Response(fullText, {
					status: response.status,
					statusText: response.statusText,
					headers: headers,
				}),
				parsedResponse: undefined,
			};
		}

		// Return as plain JSON (not SSE)
		const jsonHeaders = new Headers(headers);
		jsonHeaders.set('content-type', 'application/json; charset=utf-8');

		return {
			response: new Response(JSON.stringify(finalResponse), {
				status: response.status,
				statusText: response.statusText,
				headers: jsonHeaders,
			}),
			parsedResponse: finalResponse,
		};

	} catch (error) {
		log.error("Error converting stream", { error: String(error) });
		logRequest("stream-error", { error: String(error) });
		if (typeof reader.cancel === "function") {
			await reader.cancel(String(error)).catch(() => {});
		}
		throw error;
	} finally {
		// Release the reader lock to prevent resource leaks
		reader.releaseLock();
	}
}

/**
 * Ensure response has content-type header
 * @param headers - Response headers
 * @returns Headers with content-type set
 */
export function ensureContentType(headers: Headers): Headers {
	const responseHeaders = new Headers(headers);

	if (!responseHeaders.has('content-type')) {
		responseHeaders.set('content-type', 'text/event-stream; charset=utf-8');
	}

	return responseHeaders;
}

async function readWithTimeout(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	timeoutMs: number,
): Promise<{ done: boolean; value?: Uint8Array }> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			reader.read(),
			new Promise<never>((_, reject) => {
				timeoutId = setTimeout(() => {
					reject(
						new Error(
							`SSE stream stalled for ${timeoutMs}ms while waiting for response.done`,
						),
					);
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
}

/**
 * Check if a non-streaming response is empty or malformed.
 * Returns true if the response body is empty, null, or lacks meaningful content.
 * @param body - Parsed JSON body from the response
 * @returns True if response should be considered empty/malformed
 */
export function isEmptyResponse(body: unknown): boolean {
	if (body === null || body === undefined) return true;
	if (typeof body === 'string' && body.trim() === '') return true;
	if (typeof body !== 'object') return false;

	const obj = body as Record<string, unknown>;

	if (Object.keys(obj).length === 0) return true;

	const hasOutput = 'output' in obj && obj.output !== null && obj.output !== undefined;
	const hasChoices = 'choices' in obj && Array.isArray(obj.choices) && 
		obj.choices.some(c => c !== null && c !== undefined && typeof c === 'object' && Object.keys(c as object).length > 0);
	const hasContent = 'content' in obj && obj.content !== null && obj.content !== undefined &&
		(typeof obj.content !== 'string' || obj.content.trim() !== '');

	if ('id' in obj || 'object' in obj || 'model' in obj) {
		return !hasOutput && !hasChoices && !hasContent;
	}

	return false;
}
