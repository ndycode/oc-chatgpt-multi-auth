import { TOOL_REMAP_MESSAGE } from "./codex.mjs";

/**
 * Normalize model name to Codex-supported variants
 * @param {string} model - Original model name
 * @returns {string} Normalized model name
 */
export function normalizeModel(model) {
	if (!model) return "gpt-5";

	if (model.includes("codex")) {
		return "gpt-5-codex";
	}
	if (model.includes("gpt-5")) {
		return "gpt-5";
	}

	return "gpt-5"; // Default fallback
}

/**
 * Configure reasoning parameters based on model variant
 * @param {string} originalModel - Original model name before normalization
 * @returns {object} Reasoning configuration
 */
export function getReasoningConfig(originalModel) {
	const isLightweight =
		originalModel?.includes("nano") || originalModel?.includes("mini");

	return {
		effort: isLightweight ? "minimal" : "high",
		summary: "detailed", // Only supported value for gpt-5
	};
}

/**
 * Filter input array to remove stored conversation history references
 * @param {Array} input - Original input array
 * @returns {Array} Filtered input array
 */
export function filterInput(input) {
	if (!Array.isArray(input)) return input;

	return input.filter((item) => {
		// Keep items without IDs (new messages)
		if (!item.id) return true;
		// Remove items with response/result IDs (rs_*)
		if (item.id?.startsWith("rs_")) return false;
		return true;
	});
}

/**
 * Add tool remapping message to input if tools are present
 * @param {Array} input - Input array
 * @param {boolean} hasTools - Whether tools are present in request
 * @returns {Array} Input array with tool remap message prepended if needed
 */
export function addToolRemapMessage(input, hasTools) {
	if (!hasTools || !Array.isArray(input)) return input;

	const toolRemapMessage = {
		type: "message",
		role: "developer",
		content: [
			{
				type: "input_text",
				text: TOOL_REMAP_MESSAGE,
			},
		],
	};

	return [toolRemapMessage, ...input];
}

/**
 * Transform request body for Codex API
 * @param {object} body - Original request body
 * @param {string} codexInstructions - Codex system instructions
 * @returns {object} Transformed request body
 */
export function transformRequestBody(body, codexInstructions) {
	const originalModel = body.model;

	// Normalize model name
	body.model = normalizeModel(body.model);

	// Codex required fields
	body.store = false;
	body.stream = true;
	body.instructions = codexInstructions;

	// Filter and transform input
	if (body.input && Array.isArray(body.input)) {
		body.input = filterInput(body.input);
		body.input = addToolRemapMessage(body.input, !!body.tools);
	}

	// Configure reasoning
	const reasoningConfig = getReasoningConfig(originalModel);
	body.reasoning = {
		...body.reasoning,
		...reasoningConfig,
	};

	// Configure text verbosity
	body.text = {
		...body.text,
		verbosity: "medium",
	};

	// Remove unsupported parameters
	body.max_output_tokens = undefined;
	body.max_completion_tokens = undefined;

	return body;
}
