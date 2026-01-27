export interface ToolFunction {
	name: string;
	description?: string;
	parameters?: {
		type: "object";
		properties?: Record<string, unknown>;
		required?: string[];
		[key: string]: unknown;
	};
}

export interface Tool {
	type: "function";
	function: ToolFunction;
}

/**
 * Cleans up tool definitions to ensure strict JSON Schema compliance.
 *
 * Implements "require" logic:
 * 1. Filters 'required' array to remove properties that don't exist in 'properties'.
 *    (Fixes "property is not defined" errors from strict validators)
 * 2. Injects a placeholder property for empty parameter objects if needed.
 * 3. Handles nested object schemas recursively.
 *
 * @param tools - Array of tool definitions
 * @returns Cleaned array of tool definitions
 */
export function cleanupToolDefinitions(tools: unknown): unknown {
	if (!Array.isArray(tools)) return tools;

	return tools.map((tool) => {
		if (tool?.type !== "function" || !tool.function) {
			return tool;
		}

		// Clone to avoid mutating original
		const cleanedTool = JSON.parse(JSON.stringify(tool));
		if (cleanedTool.function.parameters) {
			cleanupSchema(cleanedTool.function.parameters);
		}

		return cleanedTool;
	});
}

/**
 * Recursively cleans up a JSON schema object
 */
function cleanupSchema(schema: Record<string, unknown>): void {
	if (!schema || typeof schema !== "object") return;

	// 1. Filter 'required' array
	if (
		Array.isArray(schema.required) &&
		schema.properties &&
		typeof schema.properties === "object"
	) {
		const properties = schema.properties as Record<string, unknown>;
		const required = schema.required as string[];

		const validRequired = required.filter((key: string) =>
			Object.prototype.hasOwnProperty.call(properties, key),
		);

		if (validRequired.length === 0) {
			delete schema.required;
		} else if (validRequired.length !== required.length) {
			schema.required = validRequired;
		}
	}

	// 2. Handle empty object parameters (Claude/Gemini compatibility)
	// If properties is empty but type is object, some models fail.
	// We inject a placeholder to make it a valid non-empty object.
	if (
		schema.type === "object" &&
		(!schema.properties || Object.keys(schema.properties as object).length === 0)
	) {
		schema.properties = {
			_placeholder: {
				type: "boolean",
				description: "This property is a placeholder and should be ignored.",
			},
		};
		// Ideally we shouldn't make it required unless necessary, but some validators want it.
		// For now, we'll leave it optional to avoid forcing the model to generate it.
	}

	// 3. Recurse into properties
	if (schema.properties && typeof schema.properties === "object") {
		const props = schema.properties as Record<string, Record<string, unknown>>;
		for (const key in props) {
			cleanupSchema(props[key]);
		}
	}

	// 4. Recurse into array items
	if (schema.items && typeof schema.items === "object") {
		cleanupSchema(schema.items as Record<string, unknown>);
	}
}
