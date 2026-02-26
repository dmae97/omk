import { type TUnsafe, Type } from "@sinclair/typebox";

/**
 * Creates a string enum schema compatible with Google's API and other providers
 * that don't support anyOf/const patterns.
 *
 * @example
 * const OperationSchema = StringEnum(["add", "subtract", "multiply", "divide"], {
 *   description: "The operation to perform"
 * });
 *
 * type Operation = Static<typeof OperationSchema>; // "add" | "subtract" | "multiply" | "divide"
 */
export function StringEnum<const T extends readonly string[]>(
	values: T,
	options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
	return Type.Unsafe<T[number]>({
		type: "string",
		enum: values as unknown as string[],
		...(options?.description && { description: options.description }),
		...(options?.default && { default: options.default }),
	});
}

export const NO_STRICT = Bun.env.PI_NO_STRICT === "1";

const NON_STRUCTURAL_SCHEMA_KEYS = new Set([
	"format",
	"pattern",
	"minLength",
	"maxLength",
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"minItems",
	"maxItems",
	"uniqueItems",
	"multipleOf",
	"$schema",
	"examples",
	"default",
	"title",
	"$comment",
	"if",
	"then",
	"else",
	"not",
	"prefixItems",
	"unevaluatedProperties",
	"unevaluatedItems",
	"patternProperties",
	"$dynamicRef",
	"$dynamicAnchor",
]);

const COMBINATOR_KEYS = ["anyOf", "allOf", "oneOf"] as const;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeSchemaForStrictMode(schema: Record<string, unknown>): Record<string, unknown> {
	const typeValue = schema.type;
	if (Array.isArray(typeValue)) {
		const typeVariants = typeValue.filter((entry): entry is string => typeof entry === "string");
		const schemaWithoutType = { ...schema };
		delete schemaWithoutType.type;

		const sanitizedWithoutType = sanitizeSchemaForStrictMode(schemaWithoutType);
		if (typeVariants.length === 0) {
			return sanitizedWithoutType;
		}

		const variants = typeVariants.map(variantType => {
			const variantSchema: Record<string, unknown> = { ...sanitizedWithoutType, type: variantType };
			if (variantType !== "object") {
				delete variantSchema.properties;
				delete variantSchema.required;
				delete variantSchema.additionalProperties;
			}
			if (variantType !== "array") {
				delete variantSchema.items;
			}
			return sanitizeSchemaForStrictMode(variantSchema);
		});

		if (variants.length === 1) {
			return variants[0] as Record<string, unknown>;
		}

		return {
			anyOf: variants,
		};
	}

	const sanitized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema)) {
		if (NON_STRUCTURAL_SCHEMA_KEYS.has(key) || key === "type" || key === "const") {
			continue;
		}

		if (key === "properties" && isObjectRecord(value)) {
			const properties = Object.fromEntries(
				Object.entries(value).map(([propertyName, propertySchema]) => [
					propertyName,
					isObjectRecord(propertySchema) ? sanitizeSchemaForStrictMode(propertySchema) : propertySchema,
				]),
			);
			sanitized.properties = properties;
			continue;
		}

		if (key === "items") {
			if (isObjectRecord(value)) {
				sanitized.items = sanitizeSchemaForStrictMode(value);
			} else if (Array.isArray(value)) {
				sanitized.items = value.map(entry => (isObjectRecord(entry) ? sanitizeSchemaForStrictMode(entry) : entry));
			} else {
				sanitized.items = value;
			}
			continue;
		}

		if (COMBINATOR_KEYS.includes(key as (typeof COMBINATOR_KEYS)[number]) && Array.isArray(value)) {
			sanitized[key] = value.map(entry => (isObjectRecord(entry) ? sanitizeSchemaForStrictMode(entry) : entry));
			continue;
		}

		if ((key === "$defs" || key === "definitions") && isObjectRecord(value)) {
			sanitized[key] = Object.fromEntries(
				Object.entries(value).map(([definitionName, definitionSchema]) => [
					definitionName,
					isObjectRecord(definitionSchema) ? sanitizeSchemaForStrictMode(definitionSchema) : definitionSchema,
				]),
			);
			continue;
		}

		if (key === "additionalProperties" && isObjectRecord(value)) {
			sanitized.additionalProperties = sanitizeSchemaForStrictMode(value);
			continue;
		}

		sanitized[key] = value;
	}

	if (Object.hasOwn(schema, "const")) {
		sanitized.enum = [schema.const];
	}

	if (typeof typeValue === "string") {
		sanitized.type = typeValue;
	}

	if (sanitized.type === undefined && isObjectRecord(sanitized.properties)) {
		sanitized.type = "object";
	}

	return sanitized;
}

/**
 * Recursively enforces JSON Schema constraints required by OpenAI/Codex strict mode:
 *   - `additionalProperties: false` on every object node
 *   - every key in `properties` present in `required`
 *
 * Properties absent from the original `required` array were TypeBox-optional.
 * They are made nullable (`anyOf: [T, { type: "null" }]`) so the model can
 * signal omission by outputting null rather than omitting the key entirely.
 */
export function enforceStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
	const result = { ...schema };
	const typeDescriptor = result.type;
	const isObjectType =
		typeDescriptor === "object" ||
		(Array.isArray(typeDescriptor) && typeDescriptor.some(value => value === "object"));
	if (isObjectType) {
		result.additionalProperties = false;
		const propertiesValue = result.properties;
		const props =
			propertiesValue != null && typeof propertiesValue === "object" && !Array.isArray(propertiesValue)
				? (propertiesValue as Record<string, unknown>)
				: {};
		const originalRequired = new Set(
			Array.isArray(result.required)
				? result.required.filter((value): value is string => typeof value === "string")
				: [],
		);
		const strictProperties = Object.fromEntries(
			Object.entries(props).map(([key, value]) => {
				const processed =
					value != null && typeof value === "object" && !Array.isArray(value)
						? enforceStrictSchema(value as Record<string, unknown>)
						: value;
				// Optional property — wrap as nullable so strict mode accepts it
				if (!originalRequired.has(key)) {
					return [key, { anyOf: [processed, { type: "null" }] }];
				}
				return [key, processed];
			}),
		);
		result.properties = strictProperties;
		result.required = Object.keys(strictProperties);
	}
	if (result.items != null && typeof result.items === "object" && !Array.isArray(result.items)) {
		result.items = enforceStrictSchema(result.items as Record<string, unknown>);
	}
	for (const key of COMBINATOR_KEYS) {
		if (Array.isArray(result[key])) {
			result[key] = (result[key] as unknown[]).map(entry =>
				entry != null && typeof entry === "object" && !Array.isArray(entry)
					? enforceStrictSchema(entry as Record<string, unknown>)
					: entry,
			);
		}
	}
	return result;
}
