import { logRequest, LOGGING_ENABLED } from "./logger.mjs";

/**
 * Parse SSE stream to extract final response
 * @param {string} sseText - Complete SSE stream text
 * @returns {object|null} Final response object or null if not found
 */
function parseSseStream(sseText) {
	const lines = sseText.split('\n');

	for (const line of lines) {
		if (line.startsWith('data: ')) {
			try {
				const data = JSON.parse(line.substring(6));

				// Look for response.done event with final data
				if (data.type === 'response.done' || data.type === 'response.completed') {
					return data.response;
				}
			} catch (e) {
				// Skip malformed JSON
			}
		}
	}

	return null;
}

/**
 * Convert SSE stream response to JSON for generateText()
 * @param {Response} response - Fetch response with SSE stream
 * @param {Headers} headers - Response headers
 * @returns {Promise<Response>} Response with JSON body
 */
export async function convertSseToJson(response, headers) {
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let fullText = '';

	try {
		// Consume the entire stream
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			fullText += decoder.decode(value, { stream: true });
		}

		if (LOGGING_ENABLED) {
			logRequest("stream-full", { fullContent: fullText });
		}

		// Parse SSE events to extract the final response
		const finalResponse = parseSseStream(fullText);

		if (!finalResponse) {
			console.error('[openai-codex-plugin] Could not find final response in SSE stream');
			logRequest("stream-error", { error: "No response.done event found" });

			// Return original stream if we can't parse
			return new Response(fullText, {
				status: response.status,
				statusText: response.statusText,
				headers: headers,
			});
		}

		// Return as plain JSON (not SSE)
		const jsonHeaders = new Headers(headers);
		jsonHeaders.set('content-type', 'application/json; charset=utf-8');

		return new Response(JSON.stringify(finalResponse), {
			status: response.status,
			statusText: response.statusText,
			headers: jsonHeaders,
		});

	} catch (error) {
		console.error('[openai-codex-plugin] Error converting stream:', error);
		logRequest("stream-error", { error: String(error) });
		throw error;
	}
}

/**
 * Ensure response has content-type header
 * @param {Headers} headers - Response headers
 * @returns {Headers} Headers with content-type set
 */
export function ensureContentType(headers) {
	const responseHeaders = new Headers(headers);

	if (!responseHeaders.has('content-type')) {
		responseHeaders.set('content-type', 'text/event-stream; charset=utf-8');
	}

	return responseHeaders;
}
