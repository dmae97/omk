import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { Tool, ToolCall } from "../types";

// ============================================================================
// Type Coercion Utilities
// ============================================================================
//
// LLMs sometimes produce tool arguments where a value that should be a number,
// boolean, array, or object is instead passed as a JSON-encoded string. For
// example, an array parameter might arrive as `"[1, 2, 3]"` instead of `[1, 2, 3]`.
//
// Rather than rejecting these outright, we attempt automatic coercion:
//   1. AJV validates the arguments and reports type errors
//   2. For each type error where the actual value is a string, we check if
//      parsing it as JSON yields a value matching the expected type
//   3. If so, we replace the string with the parsed value and re-validate
//
// This is intentionally conservative: we only parse strings that look like
// valid JSON literals (objects, arrays, booleans, null, numbers) and only
// accept the result if it matches the schema's expected type.
// ============================================================================

/** Regex matching valid JSON number literals (integers, decimals, scientific notation) */
const JSON_NUMBER_PATTERN = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Regex matching numeric strings (allows leading zeros) */
const NUMERIC_STRING_PATTERN = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Normalizes AJV's `params.type` into a consistent string array.
 * AJV may report the expected type as a single string or an array of strings
 * (for union types like `["string", "null"]`).
 */
function normalizeExpectedTypes(typeParam: unknown): string[] {
	if (typeof typeParam === "string") return [typeParam];
	if (Array.isArray(typeParam)) {
		return typeParam.filter((entry): entry is string => typeof entry === "string");
	}
	return [];
}

/**
 * Checks if a value matches any of the expected JSON Schema types.
 * Used to verify that a parsed JSON value is actually what the schema wants.
 */
function matchesExpectedType(value: unknown, expectedTypes: string[]): boolean {
	return expectedTypes.some(type => {
		switch (type) {
			case "string":
				return typeof value === "string";
			case "number":
				return typeof value === "number" && Number.isFinite(value);
			case "integer":
				return typeof value === "number" && Number.isInteger(value);
			case "boolean":
				return typeof value === "boolean";
			case "null":
				return value === null;
			case "array":
				return Array.isArray(value);
			case "object":
				return value !== null && typeof value === "object" && !Array.isArray(value);
			default:
				return false;
		}
	});
}

function tryParseNumberString(value: string, expectedTypes: string[]): { value: unknown; changed: boolean } {
	if (!expectedTypes.includes("number") && !expectedTypes.includes("integer")) {
		return { value, changed: false };
	}

	const trimmed = value.trim();
	if (!trimmed || !NUMERIC_STRING_PATTERN.test(trimmed)) {
		return { value, changed: false };
	}

	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed)) {
		return { value, changed: false };
	}

	if (!matchesExpectedType(parsed, expectedTypes)) {
		return { value, changed: false };
	}

	return { value: parsed, changed: true };
}

/**
 * Attempts to parse a string as JSON if it looks like a JSON literal and
 * the parsed result matches one of the expected types.
 *
 * Only attempts parsing for strings that syntactically look like JSON:
 *   - Objects: `{...}`
 *   - Arrays: `[...]`
 *   - Literals: `true`, `false`, `null`, or numeric strings
 *
 * Returns `{ changed: true }` only if parsing succeeded AND the result
 * matches an expected type. This prevents false positives like parsing
 * the string `"123"` when the schema actually wants a string.
 */
function tryParseJsonForTypes(value: string, expectedTypes: string[]): { value: unknown; changed: boolean } {
	const trimmed = value.trim();
	if (!trimmed) return { value, changed: false };

	const numberCoercion = tryParseNumberString(trimmed, expectedTypes);
	if (numberCoercion.changed) {
		return numberCoercion;
	}

	// Quick syntactic checks to avoid unnecessary parse attempts
	const looksJsonObject = trimmed.startsWith("{") && trimmed.endsWith("}");
	const looksJsonArray = trimmed.startsWith("[") && trimmed.endsWith("]");
	const looksJsonLiteral =
		trimmed === "true" || trimmed === "false" || trimmed === "null" || JSON_NUMBER_PATTERN.test(trimmed);

	if (!looksJsonObject && !looksJsonArray && !looksJsonLiteral) {
		return { value, changed: false };
	}

	try {
		const parsed = JSON.parse(trimmed) as unknown;
		// Only accept if the parsed type matches what the schema expects
		if (matchesExpectedType(parsed, expectedTypes)) {
			return { value: parsed, changed: true };
		}
	} catch {
		// Invalid JSON - leave as-is
		return { value, changed: false };
	}

	return { value, changed: false };
}

// ============================================================================
// JSON Pointer Utilities (RFC 6901)
// ============================================================================
//
// AJV reports error locations using JSON Pointer syntax (e.g., `/foo/0/bar`).
// These utilities allow reading and writing values at those paths.
// ============================================================================

/**
 * Decodes a JSON Pointer string into path segments.
 * Handles RFC 6901 escape sequences: ~1 -> /, ~0 -> ~
 */
function decodeJsonPointer(pointer: string): string[] {
	if (!pointer) return [];
	return pointer
		.split("/")
		.slice(1) // Remove leading empty segment from initial "/"
		.map(segment => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * Retrieves a value from a nested object/array structure using a JSON Pointer.
 * Returns undefined if the path doesn't exist or traversal fails.
 */
function getValueAtPointer(root: unknown, pointer: string): unknown {
	if (!pointer) return root;
	const segments = decodeJsonPointer(pointer);
	let current: unknown = root;

	for (const segment of segments) {
		if (current === null || current === undefined) return undefined;
		if (Array.isArray(current)) {
			const index = Number(segment);
			if (!Number.isInteger(index)) return undefined;
			current = current[index];
			continue;
		}
		if (typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[segment];
	}

	return current;
}

/**
 * Sets a value in a nested object/array structure using a JSON Pointer.
 * Mutates the structure in-place. Returns the root (possibly unchanged if
 * the path was invalid).
 */
function setValueAtPointer(root: unknown, pointer: string, value: unknown): unknown {
	if (!pointer) return value;
	const segments = decodeJsonPointer(pointer);
	let current: unknown = root;

	// Navigate to the parent of the target location
	for (let index = 0; index < segments.length - 1; index += 1) {
		const segment = segments[index];
		if (current === null || current === undefined) return root;
		if (Array.isArray(current)) {
			const arrayIndex = Number(segment);
			if (!Number.isInteger(arrayIndex)) return root;
			current = current[arrayIndex];
			continue;
		}
		if (typeof current !== "object") return root;
		current = (current as Record<string, unknown>)[segment];
	}

	// Set the value at the final segment
	const lastSegment = segments[segments.length - 1];
	if (Array.isArray(current)) {
		const arrayIndex = Number(lastSegment);
		if (!Number.isInteger(arrayIndex)) return root;
		current[arrayIndex] = value;
		return root;
	}

	if (typeof current !== "object" || current === null) return root;
	(current as Record<string, unknown>)[lastSegment] = value;
	return root;
}

/**
 * Deep clones a JSON-serializable value.
 * Uses structuredClone when available (faster), falls back to JSON round-trip.
 */
function cloneJsonValue<T>(value: T): T {
	if (typeof structuredClone === "function") {
		return structuredClone(value);
	}
	return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeOptionalNullsForSchema(schema: unknown, value: unknown): { value: unknown; changed: boolean } {
	if (value === null || value === undefined) return { value, changed: false };
	if (schema === null || typeof schema !== "object") return { value, changed: false };

	const schemaObject = schema as Record<string, unknown>;

	const normalizeAnyOfLike = (keyword: "anyOf" | "oneOf"): { value: unknown; changed: boolean } => {
		const branches = schemaObject[keyword];
		if (!Array.isArray(branches)) return { value, changed: false };

		let changedCandidate: { value: unknown; changed: true } | null = null;

		for (const branch of branches) {
			const normalized = normalizeOptionalNullsForSchema(branch, value);
			if (!normalized.changed) continue;

			try {
				const validateBranch = ajv.compile(branch);
				if (validateBranch(normalized.value)) {
					return normalized;
				}
			} catch {
				// Ignore branch-level compilation/validation errors and keep scanning.
			}

			if (!changedCandidate) {
				changedCandidate = { value: normalized.value, changed: true };
			}
		}

		return changedCandidate ?? { value, changed: false };
	};

	const anyOfNormalization = normalizeAnyOfLike("anyOf");
	if (anyOfNormalization.changed) return anyOfNormalization;

	const oneOfNormalization = normalizeAnyOfLike("oneOf");
	if (oneOfNormalization.changed) return oneOfNormalization;

	if (Array.isArray(schemaObject.allOf)) {
		let changed = false;
		let nextValue: unknown = value;
		for (const branch of schemaObject.allOf) {
			const normalized = normalizeOptionalNullsForSchema(branch, nextValue);
			if (!normalized.changed) continue;
			nextValue = normalized.value;
			changed = true;
		}
		if (changed) return { value: nextValue, changed: true };
	}

	if (Array.isArray(value)) {
		const itemSchema = schemaObject.items;
		if (itemSchema === null || typeof itemSchema !== "object" || Array.isArray(itemSchema)) {
			return { value, changed: false };
		}

		let changed = false;
		let nextValue = value;
		for (let i = 0; i < value.length; i += 1) {
			const normalized = normalizeOptionalNullsForSchema(itemSchema, value[i]);
			if (!normalized.changed) continue;
			if (!changed) {
				nextValue = [...value];
				changed = true;
			}
			nextValue[i] = normalized.value;
		}
		return { value: changed ? nextValue : value, changed };
	}

	// Coerce string → number/integer when the schema branch declares those types.
	// This fixes anyOf:[{type:"number"},{type:"null"}] (i.e. Optional<number>) where
	// AJV reports an "anyOf" error rather than a "type" error, bypassing
	// coerceArgsFromErrors which only handles keyword:"type" errors.
	if ((schemaObject.type === "number" || schemaObject.type === "integer") && typeof value === "string") {
		return tryParseNumberString(value, [schemaObject.type as string]);
	}

	if (schemaObject.type !== "object") return { value, changed: false };
	if (typeof value !== "object" || value === null) return { value, changed: false };
	if (Array.isArray(value)) return { value, changed: false };
	if (schemaObject.properties === null || typeof schemaObject.properties !== "object") {
		return { value, changed: false };
	}

	const properties = schemaObject.properties as Record<string, unknown>;
	const required = new Set(Array.isArray(schemaObject.required) ? (schemaObject.required as string[]) : []);

	let changed = false;
	let nextValue = value as Record<string, unknown>;

	for (const [key, propertySchema] of Object.entries(properties)) {
		if (!(key in nextValue)) continue;
		const currentValue = nextValue[key];

		if (currentValue === null && !required.has(key)) {
			if (!changed) {
				nextValue = { ...nextValue };
				changed = true;
			}
			delete nextValue[key];
			continue;
		}

		const normalized = normalizeOptionalNullsForSchema(propertySchema, currentValue);
		if (!normalized.changed) continue;

		if (!changed) {
			nextValue = { ...nextValue };
			changed = true;
		}
		nextValue[key] = normalized.value;
	}

	return { value: changed ? nextValue : value, changed };
}

/**
 * Attempts to fix type errors by parsing JSON-encoded strings.
 *
 * When AJV reports type errors, this function checks if the offending values
 * are strings that contain valid JSON matching the expected type. If so, it
 * returns a new args object with those strings replaced by their parsed values.
 *
 * The function is designed to be safe and conservative:
 *   - Only processes "type" errors (not format, pattern, etc.)
 *   - Only attempts coercion on string values
 *   - Only accepts parsed results that match the expected type
 *   - Clones the args object before mutation (copy-on-write)
 */
function coerceArgsFromErrors(
	args: unknown,
	errors: Array<{ keyword?: string; instancePath?: string; params?: { type?: unknown } }> | null | undefined,
): { value: unknown; changed: boolean } {
	if (!errors || errors.length === 0) return { value: args, changed: false };

	let changed = false;
	let nextArgs: unknown = args;

	for (const error of errors) {
		// Only handle type mismatch errors
		if (error.keyword !== "type") continue;

		const instancePath = error.instancePath ?? "";
		const expectedTypes = normalizeExpectedTypes(error.params?.type);
		if (expectedTypes.length === 0) continue;

		// Get the current value at the error location
		const currentValue = getValueAtPointer(nextArgs, instancePath);
		if (typeof currentValue !== "string") continue;

		// Try to parse the string as JSON
		const result = tryParseJsonForTypes(currentValue, expectedTypes);
		if (!result.changed) continue;

		// Clone on first modification (copy-on-write)
		if (!changed) {
			nextArgs = cloneJsonValue(nextArgs);
			changed = true;
		}
		nextArgs = setValueAtPointer(nextArgs, instancePath, result.value);
	}

	return { value: changed ? nextArgs : args, changed };
}

// Create a singleton AJV instance with formats (only if not in browser extension)
// AJV requires 'unsafe-eval' CSP which is not allowed in Manifest V3
const ajv = new Ajv({
	allErrors: true,
	strict: false,
});
addFormats(ajv);

const MAX_TYPE_COERCION_PASSES = 5;

/**
 * Finds a tool by name and validates the tool call arguments against its TypeBox schema
 * @param tools Array of tool definitions
 * @param toolCall The tool call from the LLM
 * @returns The validated arguments
 * @throws Error if tool is not found or validation fails
 */
export function validateToolCall(tools: Tool[], toolCall: ToolCall): any {
	const tool = tools.find(t => t.name === toolCall.name);
	if (!tool) {
		throw new Error(`Tool "${toolCall.name}" not found`);
	}
	return validateToolArguments(tool, toolCall);
}

/**
 * Validates tool call arguments against the tool's TypeBox schema
 * @param tool The tool definition with TypeBox schema
 * @param toolCall The tool call from the LLM
 * @returns The validated arguments
 * @throws Error with formatted message if validation fails
 */
export function validateToolArguments(tool: Tool, toolCall: ToolCall): any {
	const originalArgs = toolCall.arguments;

	// Compile the schema
	const validate = ajv.compile(tool.parameters);

	// Validate the arguments
	if (validate(originalArgs)) {
		return originalArgs;
	}

	let normalizedArgs: unknown = originalArgs;
	let changed = false;

	const optionalNullNormalization = normalizeOptionalNullsForSchema(tool.parameters, normalizedArgs);
	if (optionalNullNormalization.changed) {
		normalizedArgs = optionalNullNormalization.value;
		changed = true;
		if (validate(normalizedArgs)) {
			return normalizedArgs;
		}
	}

	for (let pass = 0; pass < MAX_TYPE_COERCION_PASSES; pass += 1) {
		const coercion = coerceArgsFromErrors(normalizedArgs, validate.errors);
		if (!coercion.changed) break;

		normalizedArgs = coercion.value;
		changed = true;

		const nullNormalization = normalizeOptionalNullsForSchema(tool.parameters, normalizedArgs);
		if (nullNormalization.changed) {
			normalizedArgs = nullNormalization.value;
		}

		if (validate(normalizedArgs)) {
			return normalizedArgs;
		}
	}

	// Format validation errors nicely
	const errors =
		validate.errors
			?.map((err: any) => {
				const path = err.instancePath ? err.instancePath.substring(1) : err.params.missingProperty || "root";
				return `  - ${path}: ${err.message}`;
			})
			.join("\n") || "Unknown validation error";

	const receivedArgs = changed
		? {
				original: originalArgs,
				normalized: normalizedArgs,
			}
		: originalArgs;

	const errorMessage = `Validation failed for tool "${
		toolCall.name
	}":\n${errors}\n\nReceived arguments:\n${JSON.stringify(receivedArgs, null, 2)}`;

	throw new Error(errorMessage);
}
