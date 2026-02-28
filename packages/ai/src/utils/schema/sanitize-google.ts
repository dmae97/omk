import { UNSUPPORTED_SCHEMA_FIELDS } from "./fields";

interface SanitizeSchemaOptions {
	insideProperties: boolean;
	normalizeTypeArrayToNullable: boolean;
	stripNullableKeyword: boolean;
}

function sanitizeSchemaImpl(value: unknown, options: SanitizeSchemaOptions): unknown {
	if (Array.isArray(value)) {
		return value.map(entry => sanitizeSchemaImpl(entry, options));
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	const obj = value as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const combiner of ["anyOf", "oneOf"] as const) {
		if (Array.isArray(obj[combiner])) {
			const variants = obj[combiner] as Record<string, unknown>[];
			const allHaveConst = variants.every(v => v && typeof v === "object" && "const" in v);
			if (allHaveConst && variants.length > 0) {
				result.enum = variants.map(v => v.const);
				const firstType = variants[0]?.type;
				if (firstType) {
					result.type = firstType;
				}
				// Copy description and other top-level fields (not the combiner)
				for (const [key, entry] of Object.entries(obj)) {
					if (key !== combiner && !(key in result)) {
						result[key] = sanitizeSchemaImpl(entry, {
							insideProperties: false,
							normalizeTypeArrayToNullable: options.normalizeTypeArrayToNullable,
							stripNullableKeyword: options.stripNullableKeyword,
						});
					}
				}
				return result;
			}
		}
	}
	// Regular field processing
	let constValue: unknown;
	for (const [key, entry] of Object.entries(obj)) {
		// Only strip unsupported schema keywords when NOT inside "properties" object
		// Inside "properties", keys are property names (e.g., "pattern") not schema keywords
		if (!options.insideProperties && UNSUPPORTED_SCHEMA_FIELDS.has(key)) continue;
		if (options.stripNullableKeyword && key === "nullable") continue;
		if (key === "const") {
			constValue = entry;
			continue;
		}
		if (key === "additionalProperties" && entry === false) continue;
		// When key is "properties", child keys are property names, not schema keywords
		result[key] = sanitizeSchemaImpl(entry, {
			insideProperties: key === "properties",
			normalizeTypeArrayToNullable: options.normalizeTypeArrayToNullable,
			stripNullableKeyword: options.stripNullableKeyword,
		});
	}
	// Normalize array-valued "type" (e.g. ["string", "null"]) to a single type + nullable.
	// Google's Schema proto expects type to be a single enum string, not an array.
	if (options.normalizeTypeArrayToNullable && Array.isArray(result.type)) {
		const types = result.type as string[];
		const nonNull = types.filter(t => t !== "null");
		if (types.includes("null") && !options.stripNullableKeyword) {
			result.nullable = true;
		}
		result.type = nonNull[0] ?? types[0];
	}
	if (constValue !== undefined) {
		// Convert const to enum, merging with existing enum if present
		const existingEnum = Array.isArray(result.enum) ? result.enum : [];
		if (!existingEnum.some(item => Object.is(item, constValue))) {
			existingEnum.push(constValue);
		}
		result.enum = existingEnum;
		if (!result.type) {
			result.type =
				typeof constValue === "string"
					? "string"
					: typeof constValue === "number"
						? "number"
						: typeof constValue === "boolean"
							? "boolean"
							: undefined;
		}
	}

	return result;
}

export function sanitizeSchemaForGoogle(value: unknown): unknown {
	return sanitizeSchemaImpl(value, {
		insideProperties: false,
		normalizeTypeArrayToNullable: true,
		stripNullableKeyword: false,
	});
}

/**
 * Sanitize schema for Cloud Code Assist Claude. Uses normalizeTypeArrayToNullable + stripNullableKeyword
 * so `type: ["string", "null"]` becomes `type: "string"` with no nullable marker — intentional because
 * CCA/Claude doesn't support nullable.
 */
export function sanitizeSchemaForCloudCodeAssistClaude(value: unknown): unknown {
	return sanitizeSchemaImpl(value, {
		insideProperties: false,
		normalizeTypeArrayToNullable: true,
		stripNullableKeyword: true,
	});
}
