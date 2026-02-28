import { areJsonValuesEqual } from "./equality";
import { UNSUPPORTED_SCHEMA_FIELDS } from "./fields";

interface SanitizeSchemaOptions {
	insideProperties: boolean;
	normalizeTypeArrayToNullable: boolean;
	stripNullableKeyword: boolean;
	unsupportedFields: ReadonlySet<string>;
	seen: WeakSet<object>;
}

function inferJsonSchemaTypeFromValue(value: unknown): string | undefined {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	switch (typeof value) {
		case "string":
			return "string";
		case "number":
			return "number";
		case "boolean":
			return "boolean";
		case "object":
			return "object";
		default:
			return undefined;
	}
}

function pushEnumValue(values: unknown[], value: unknown): void {
	if (!values.some(existing => areJsonValuesEqual(existing, value))) {
		values.push(value);
	}
}

function sanitizeSchemaImpl(value: unknown, options: SanitizeSchemaOptions): unknown {
	if (Array.isArray(value)) {
		if (options.seen.has(value)) return [];
		options.seen.add(value);
		return value.map(entry => sanitizeSchemaImpl(entry, options));
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	if (options.seen.has(value as object)) return {};
	options.seen.add(value as object);
	const obj = value as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const combiner of ["anyOf", "oneOf"] as const) {
		if (Array.isArray(obj[combiner])) {
			const variants = obj[combiner] as Record<string, unknown>[];
			const allHaveConst = variants.every(v => v && typeof v === "object" && "const" in v);
			if (allHaveConst && variants.length > 0) {
				const dedupedEnum: unknown[] = [];
				for (const variant of variants) {
					pushEnumValue(dedupedEnum, variant.const);
				}
				result.enum = dedupedEnum;

				const explicitTypes = variants
					.map(variant => variant.type)
					.filter((variantType): variantType is string => typeof variantType === "string");
				const allHaveSameExplicitType =
					explicitTypes.length === variants.length &&
					explicitTypes.every(variantType => variantType === explicitTypes[0]);
				if (allHaveSameExplicitType && explicitTypes[0]) {
					result.type = explicitTypes[0];
				} else {
					const inferredTypes = dedupedEnum
						.map(enumValue => inferJsonSchemaTypeFromValue(enumValue))
						.filter((inferredType): inferredType is string => inferredType !== undefined);
					const inferredTypeSet = new Set(inferredTypes);
					if (inferredTypeSet.size === 1) {
						result.type = inferredTypes[0];
					} else {
						const nonNullInferredTypes = inferredTypes.filter(inferredType => inferredType !== "null");
						const nonNullTypeSet = new Set(nonNullInferredTypes);
						if (inferredTypes.includes("null") && nonNullTypeSet.size === 1) {
							result.type = nonNullInferredTypes[0];
							if (!options.stripNullableKeyword) {
								result.nullable = true;
							}
						}
					}
				}

				// Copy description and other top-level fields (not the combiner)
				for (const [key, entry] of Object.entries(obj)) {
					if (key !== combiner && !(key in result)) {
						result[key] = sanitizeSchemaImpl(entry, {
							...options,
							insideProperties: key === "properties",
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
		if (!options.insideProperties && options.unsupportedFields.has(key)) continue;
		if (options.stripNullableKeyword && key === "nullable") continue;
		if (key === "const") {
			constValue = entry;
			continue;
		}
		// When key is "properties", child keys are property names, not schema keywords
		result[key] = sanitizeSchemaImpl(entry, {
			...options,
			insideProperties: key === "properties",
		});
	}
	// Normalize array-valued "type" (e.g. ["string", "null"]) to a single type + nullable.
	// Google's Schema proto expects type to be a single enum string, not an array.
	if (options.normalizeTypeArrayToNullable && Array.isArray(result.type)) {
		const types = (result.type as unknown[]).filter((t): t is string => typeof t === "string");
		const nonNull = types.filter(t => t !== "null");
		if (types.includes("null") && !options.stripNullableKeyword) {
			result.nullable = true;
		}
		result.type = nonNull[0] ?? types[0];
	}
	if (constValue !== undefined) {
		// Convert const to enum, merging with existing enum if present
		const existingEnum = Array.isArray(result.enum) ? result.enum : [];
		pushEnumValue(existingEnum, constValue);
		result.enum = existingEnum;
		if (!result.type) {
			result.type = inferJsonSchemaTypeFromValue(constValue);
		}
	}

	// Ensure object schemas have a properties field (some LLM providers require it)
	if (result.type === "object" && !("properties" in result)) {
		result.properties = {};
	}

	return result;
}

/**
 * Sanitize a JSON Schema for Google's generative AI APIs by stripping unsupported
 * JSON Schema keywords and normalizing representable nullable/type patterns.
 *
 * **Prerequisite:** The input schema must be fully dereferenced — all `$ref`
 * pointers resolved inline — before calling this function. `$ref` is silently
 * stripped as an unsupported keyword; unresolved references will produce an
 * incomplete schema with no warning.
 */
export function sanitizeSchemaForGoogle(value: unknown): unknown {
	return sanitizeSchemaImpl(value, {
		insideProperties: false,
		normalizeTypeArrayToNullable: true,
		stripNullableKeyword: false,
		unsupportedFields: UNSUPPORTED_SCHEMA_FIELDS,
		seen: new WeakSet(),
	});
}

/**
 * Sanitize a JSON Schema for Cloud Code Assist Claude.
 * Starts from Google sanitizer behavior, then strips `nullable` markers.
 *
 * **Prerequisite:** The input schema must be fully dereferenced — all `$ref`
 * pointers resolved inline — before calling this function. `$ref` is silently
 * stripped as an unsupported keyword; unresolved references will produce an
 * incomplete schema with no warning.
 */
export function sanitizeSchemaForCCA(value: unknown): unknown {
	return sanitizeSchemaImpl(value, {
		insideProperties: false,
		normalizeTypeArrayToNullable: true,
		stripNullableKeyword: true,
		unsupportedFields: UNSUPPORTED_SCHEMA_FIELDS,
		seen: new WeakSet(),
	});
}

/**
 * Fields stripped for MCP/AJV compatibility.
 * Only `$schema` — AJV throws on unrecognised meta-schema URIs
 * (e.g. draft 2020-12 emitted by schemars 1.x / rmcp 0.15+).
 */
const MCP_UNSUPPORTED_SCHEMA_FIELDS = new Set(["$schema"]);

/**
 * Sanitize a JSON Schema for MCP tool parameter validation (AJV compatibility).
 *
 * Strips only the minimal set of fields that cause AJV validation errors:
 * - `$schema`: AJV throws on unknown meta-schema URIs.
 * - `nullable`: OpenAPI 3.0 extension, not standard JSON Schema.
 *
 * Unlike the Google/CCA sanitizers this preserves validation keywords
 * (`pattern`, `format`, `additionalProperties`, etc.) and `$ref`/`$defs`.
 */
export function sanitizeSchemaForMCP(value: unknown): unknown {
	return sanitizeSchemaImpl(value, {
		insideProperties: false,
		normalizeTypeArrayToNullable: false,
		stripNullableKeyword: true,
		unsupportedFields: MCP_UNSUPPORTED_SCHEMA_FIELDS,
		seen: new WeakSet(),
	});
}
