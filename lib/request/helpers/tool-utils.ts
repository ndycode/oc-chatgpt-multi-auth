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

const cleanedToolCache = new WeakMap<object, Tool>();
const cleanedToolArrayCache = new WeakMap<readonly unknown[], unknown>();

function cloneJsonLike(value: unknown): unknown {
	if (value === null) return null;
	if (value === undefined) return undefined;
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map((item) => {
			const cloned = cloneJsonLike(item);
			return cloned === undefined ? null : cloned;
		});
	}

	if (typeof value === "object") {
		const withJson = value as { toJSON?: () => unknown };
		if (typeof withJson.toJSON === "function") {
			return cloneJsonLike(withJson.toJSON());
		}
		const output: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			const cloned = cloneJsonLike(item);
			if (cloned !== undefined) {
				output[key] = cloned;
			}
		}
		return output;
	}

	return undefined;
}

/**
 * Cleans up tool definitions to ensure strict JSON Schema compliance.
 *
 * Implements "require" logic and advanced normalization:
 * 1. Filters 'required' array to remove properties that don't exist in 'properties'.
 * 2. Injects a placeholder property for empty parameter objects.
 * 3. Flattens 'anyOf' with 'const' values into 'enum'.
 * 4. Normalizes nullable types (array types) to single type + description.
 * 5. Removes unsupported keywords (additionalProperties, const, etc.).
 *
 * @param tools - Array of tool definitions
 * @returns Cleaned array of tool definitions
 */
export function cleanupToolDefinitions(tools: unknown): unknown {
	if (!Array.isArray(tools)) return tools;

	const cachedArray = cleanedToolArrayCache.get(tools);
	if (cachedArray) {
		return cachedArray;
	}

	const cleaned = tools.map((tool) => {
		if (tool?.type !== "function" || !tool.function) {
			return tool;
		}

		const cachedTool = cleanedToolCache.get(tool);
		if (cachedTool) {
			return cachedTool;
		}

		// Clone to avoid mutating original
		const cloned = cloneJsonLike(tool);
		if (!cloned || typeof cloned !== "object") {
			return tool;
		}
		const cleanedTool = cloned as Tool;
		if (cleanedTool.function.parameters) {
			cleanupSchema(cleanedTool.function.parameters);
		}
		cleanedToolCache.set(tool, cleanedTool);

		return cleanedTool;
	});
	cleanedToolArrayCache.set(tools, cleaned);
	return cleaned;
}

/**
 * Recursively cleans up a JSON schema object
 */
function cleanupSchema(schema: Record<string, unknown>): void {
	if (!schema || typeof schema !== "object") return;

	// 1. Flatten Unions (anyOf -> enum)
	if (Array.isArray(schema.anyOf)) {
		const anyOf = schema.anyOf as Record<string, unknown>[];
		const allConst = anyOf.every((opt) => "const" in opt);
		if (allConst && anyOf.length > 0) {
			const enumValues = anyOf.map((opt) => opt.const);
			schema.enum = enumValues;
			delete schema.anyOf;

			// Infer type from first value if missing
			if (!schema.type) {
				const firstVal = enumValues[0];
				if (typeof firstVal === "string") schema.type = "string";
				else if (typeof firstVal === "number") schema.type = "number";
				else if (typeof firstVal === "boolean") schema.type = "boolean";
			}
		}
	}

	// 2. Flatten Nullable Types (["string", "null"] -> "string")
	if (Array.isArray(schema.type)) {
		const types = schema.type as string[];
		const isNullable = types.includes("null");
		const nonNullTypes = types.filter((t) => t !== "null");

		if (nonNullTypes.length > 0) {
			// Use the first non-null type (most strict models expect a single string type)
			schema.type = nonNullTypes[0];
			if (isNullable) {
				const desc = (schema.description as string) || "";
				// Only append if not already present
				if (!desc.toLowerCase().includes("nullable")) {
					schema.description = desc ? `${desc} (nullable)` : "(nullable)";
				}
			}
		}
	}

	// 3. Filter 'required' array
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

	// 4. Handle empty object parameters
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
	}

	// 5. Remove unsupported keywords
	delete schema.additionalProperties;
	delete schema.const;
	delete schema.title;
	delete schema.$schema;

	// 6. Recurse into properties
	if (schema.properties && typeof schema.properties === "object") {
		const props = schema.properties as Record<string, Record<string, unknown>>;
		for (const key in props) {
			const prop = props[key];
			// istanbul ignore next -- JSON.stringify at line 39 strips undefined values
			if (prop !== undefined) {
				cleanupSchema(prop);
			}
		}
	}

	// 7. Recurse into array items
	if (schema.items && typeof schema.items === "object") {
		cleanupSchema(schema.items as Record<string, unknown>);
	}
}
