import type { JsonObject } from "./types";
import { isJsonObject } from "./types";

export function areJsonValuesEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}
		for (let i = 0; i < left.length; i += 1) {
			if (!areJsonValuesEqual(left[i], right[i])) {
				return false;
			}
		}
		return true;
	}
	if (!isJsonObject(left) || !isJsonObject(right)) {
		return false;
	}
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}
	for (const key of leftKeys) {
		if (!(key in right) || !areJsonValuesEqual(left[key], right[key])) {
			return false;
		}
	}
	return true;
}

export function mergeCompatibleEnumSchemas(existing: unknown, incoming: unknown): JsonObject | null {
	if (!isJsonObject(existing) || !isJsonObject(incoming)) {
		return null;
	}
	const existingEnum = Array.isArray(existing.enum) ? existing.enum : null;
	const incomingEnum = Array.isArray(incoming.enum) ? incoming.enum : null;
	if (!existingEnum || !incomingEnum) {
		return null;
	}
	if (!areJsonValuesEqual(existing.type, incoming.type)) {
		return null;
	}
	const existingKeys = Object.keys(existing).filter(key => key !== "enum");
	const incomingKeys = Object.keys(incoming).filter(key => key !== "enum");
	if (existingKeys.length !== incomingKeys.length) {
		return null;
	}
	for (const key of existingKeys) {
		if (!(key in incoming) || !areJsonValuesEqual(existing[key], incoming[key])) {
			return null;
		}
	}

	const mergedEnum = [...existingEnum];
	for (const enumValue of incomingEnum) {
		if (!mergedEnum.some(existingValue => areJsonValuesEqual(existingValue, enumValue))) {
			mergedEnum.push(enumValue);
		}
	}
	return {
		...existing,
		enum: mergedEnum,
	};
}

function getAnyOfVariants(schema: unknown): unknown[] {
	if (isJsonObject(schema) && Array.isArray(schema.anyOf)) {
		return schema.anyOf;
	}
	return [schema];
}

export function mergePropertySchemas(existing: unknown, incoming: unknown): unknown {
	if (areJsonValuesEqual(existing, incoming)) {
		return existing;
	}
	const mergedEnumSchema = mergeCompatibleEnumSchemas(existing, incoming);
	if (mergedEnumSchema !== null) {
		return mergedEnumSchema;
	}

	const mergedAnyOf = [...getAnyOfVariants(existing)];
	for (const variant of getAnyOfVariants(incoming)) {
		if (!mergedAnyOf.some(existingVariant => areJsonValuesEqual(existingVariant, variant))) {
			mergedAnyOf.push(variant);
		}
	}
	return mergedAnyOf.length === 1 ? mergedAnyOf[0] : { anyOf: mergedAnyOf };
}
