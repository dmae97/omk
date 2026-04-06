import { parse as partialParse } from "partial-json";

/**
 * Attempts to parse potentially incomplete JSON during streaming.
 * Always returns a valid object, even if the JSON is incomplete.
 *
 * @param partialJson The partial JSON string from streaming
 * @returns Parsed object or empty object if parsing fails
 */
export function parseStreamingJson<T = any>(partialJson: string | undefined): T {
	if (!partialJson || partialJson.trim() === "") {
		return {} as T;
	}

	// Try standard parsing first (fastest for complete JSON)
	try {
		return coerceNullStrings(JSON.parse(partialJson) as T);
	} catch {
		// Try partial-json for incomplete JSON
		try {
			const result = partialParse(partialJson);
			return coerceNullStrings((result ?? {}) as T);
		} catch {
			// If all parsing fails, return empty object
			return {} as T;
		}
	}
}

/**
 * Recursively replace the literal string `"null"` with `null` in parsed
 * tool-call arguments. Many models serialize optional fields as the four
 * character string `null` instead of the JSON keyword `null`, which
 * downstream code sees as a truthy non-empty string.
 */
export function coerceNullStrings<T>(value: T): T {
	if (value === null || value === undefined) return value;
	if (typeof value === "string") {
		return (value === "null" ? null : value) as T;
	}
	if (Array.isArray(value)) {
		return value.map(coerceNullStrings) as T;
	}
	if (typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = coerceNullStrings(v);
		}
		return out as T;
	}
	return value;
}
