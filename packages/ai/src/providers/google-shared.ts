/**
 * Shared utilities for Google Generative AI and Google Cloud Code Assist providers.
 */
import { type Content, FinishReason, FunctionCallingConfigMode, type Part } from "@google/genai";
import type { AnySchema } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import type { Context, ImageContent, Model, StopReason, TextContent, Tool } from "../types";
import { sanitizeSurrogates } from "../utils/sanitize-unicode";
import { transformMessages } from "./transform-messages";

type GoogleApiType = "google-generative-ai" | "google-gemini-cli" | "google-vertex";

/**
 * Determines whether a streamed Gemini `Part` should be treated as "thinking".
 *
 * Protocol note (Gemini / Vertex AI thought signatures):
 * - `thought: true` is the definitive marker for thinking content (thought summaries).
 * - `thoughtSignature` is an encrypted representation of the model's internal thought process
 *   used to preserve reasoning context across multi-turn interactions.
 * - `thoughtSignature` can appear on ANY part type (text, functionCall, etc.) - it does NOT
 *   indicate the part itself is thinking content.
 * - For non-functionCall responses, the signature appears on the last part for context replay.
 * - When persisting/replaying model outputs, signature-bearing parts must be preserved as-is;
 *   do not merge/move signatures across parts.
 *
 * See: https://ai.google.dev/gemini-api/docs/thought-signatures
 */
export function isThinkingPart(part: Pick<Part, "thought" | "thoughtSignature">): boolean {
	return part.thought === true;
}

/**
 * Retain thought signatures during streaming.
 *
 * Some backends only send `thoughtSignature` on the first delta for a given part/block; later deltas may omit it.
 * This helper preserves the last non-empty signature for the current block.
 *
 * Note: this does NOT merge or move signatures across distinct response parts. It only prevents
 * a signature from being overwritten with `undefined` within the same streamed block.
 */
export function retainThoughtSignature(existing: string | undefined, incoming: string | undefined): string | undefined {
	if (typeof incoming === "string" && incoming.length > 0) return incoming;
	return existing;
}

// Thought signatures must be base64 for Google APIs (TYPE_BYTES).
const base64SignaturePattern = /^[A-Za-z0-9+/]+={0,2}$/;

function isValidThoughtSignature(signature: string | undefined): boolean {
	if (!signature) return false;
	if (signature.length % 4 !== 0) return false;
	return base64SignaturePattern.test(signature);
}

/**
 * Only keep signatures from the same provider/model and with valid base64.
 */
function resolveThoughtSignature(isSameProviderAndModel: boolean, signature: string | undefined): string | undefined {
	return isSameProviderAndModel && isValidThoughtSignature(signature) ? signature : undefined;
}

/**
 * Claude models via Google APIs require explicit tool call IDs in function calls/responses.
 */
export function requiresToolCallId(modelId: string): boolean {
	return modelId.startsWith("claude-");
}

function isGemini3Model(modelId: string): boolean {
	return modelId.includes("gemini-3");
}

/**
 * Convert internal messages to Gemini Content[] format.
 */
export function convertMessages<T extends GoogleApiType>(model: Model<T>, context: Context): Content[] {
	const contents: Content[] = [];
	const normalizeToolCallId = (id: string): string => {
		if (!requiresToolCallId(model.id)) return id;
		return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
	};

	const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);

	for (const msg of transformedMessages) {
		if (msg.role === "user" || msg.role === "developer") {
			if (typeof msg.content === "string") {
				// Skip empty user messages
				if (!msg.content || msg.content.trim() === "") continue;
				contents.push({
					role: "user",
					parts: [{ text: sanitizeSurrogates(msg.content) }],
				});
			} else {
				const parts: Part[] = msg.content.map(item => {
					if (item.type === "text") {
						return { text: sanitizeSurrogates(item.text) };
					} else {
						return {
							inlineData: {
								mimeType: item.mimeType,
								data: item.data,
							},
						};
					}
				});
				// Filter out images if model doesn't support them, and empty text blocks
				let filteredParts = !model.input.includes("image") ? parts.filter(p => p.text !== undefined) : parts;
				filteredParts = filteredParts.filter(p => {
					if (p.text !== undefined) {
						return p.text.trim().length > 0;
					}
					return true; // Keep non-text parts (images)
				});
				if (filteredParts.length === 0) continue;
				contents.push({
					role: "user",
					parts: filteredParts,
				});
			}
		} else if (msg.role === "assistant") {
			const parts: Part[] = [];
			// Check if message is from same provider and model - only then keep thinking blocks
			const isSameProviderAndModel = msg.provider === model.provider && msg.model === model.id;

			for (const block of msg.content) {
				if (block.type === "text") {
					// Skip empty text blocks - they can cause issues with some models (e.g. Claude via Antigravity)
					if (!block.text || block.text.trim() === "") continue;
					const thoughtSignature = resolveThoughtSignature(isSameProviderAndModel, block.textSignature);
					parts.push({
						text: sanitizeSurrogates(block.text),
						...(thoughtSignature && { thoughtSignature }),
					});
				} else if (block.type === "thinking") {
					// Skip empty thinking blocks
					if (!block.thinking || block.thinking.trim() === "") continue;
					// Only keep as thinking block if same provider AND same model
					// Otherwise convert to plain text (no tags to avoid model mimicking them)
					if (isSameProviderAndModel) {
						const thoughtSignature = resolveThoughtSignature(isSameProviderAndModel, block.thinkingSignature);
						parts.push({
							thought: true,
							text: sanitizeSurrogates(block.thinking),
							...(thoughtSignature && { thoughtSignature }),
						});
					} else {
						parts.push({
							text: sanitizeSurrogates(block.thinking),
						});
					}
				} else if (block.type === "toolCall") {
					const thoughtSignature = resolveThoughtSignature(isSameProviderAndModel, block.thoughtSignature);
					if (isGemini3Model(model.id) && !thoughtSignature) {
						const params = Object.entries(block.arguments ?? {})
							.map(([key, value]) => {
								const valueStr = typeof value === "string" ? value : JSON.stringify(value, null, 2);
								return `<parameter name="${key}">${valueStr}</parameter>`;
							})
							.join("\n");

						parts.push({
							text: sanitizeSurrogates(
								`<call_record tool="${block.name}">
<critical>Historical context only. You cannot invoke tools this way—use proper function calling.</critical>
${params}
</call_record>`,
							),
						});
						continue;
					}

					const part: Part = {
						functionCall: {
							name: block.name,
							args: block.arguments ?? {},
							...(requiresToolCallId(model.id) ? { id: block.id } : {}),
						},
					};
					if (model.provider === "google-vertex" && part?.functionCall?.id) {
						delete part.functionCall.id; // Vertex AI does not support 'id' in functionCall
					}
					if (thoughtSignature) {
						part.thoughtSignature = thoughtSignature;
					}
					parts.push(part);
				}
			}

			if (parts.length === 0) continue;
			contents.push({
				role: "model",
				parts,
			});
		} else if (msg.role === "toolResult") {
			// Extract text and image content
			const textContent = msg.content.filter((c): c is TextContent => c.type === "text");
			const textResult = textContent.map(c => c.text).join("\n");
			const imageContent = model.input.includes("image")
				? msg.content.filter((c): c is ImageContent => c.type === "image")
				: [];

			const hasText = textResult.length > 0;
			const hasImages = imageContent.length > 0;

			// Gemini 3 supports multimodal function responses with images nested inside functionResponse.parts
			// See: https://ai.google.dev/gemini-api/docs/function-calling#multimodal
			// Older models don't support this, so we put images in a separate user message.
			const supportsMultimodalFunctionResponse = model.id.includes("gemini-3");

			// Use "output" key for success, "error" key for errors as per SDK documentation
			const responseValue = hasText ? sanitizeSurrogates(textResult) : hasImages ? "(see attached image)" : "";

			const imageParts: Part[] = imageContent.map(imageBlock => ({
				inlineData: {
					mimeType: imageBlock.mimeType,
					data: imageBlock.data,
				},
			}));

			const includeId = requiresToolCallId(model.id);
			const functionResponsePart: Part = {
				functionResponse: {
					name: msg.toolName,
					response: msg.isError ? { error: responseValue } : { output: responseValue },
					// Nest images inside functionResponse.parts for Gemini 3
					...(hasImages && supportsMultimodalFunctionResponse && { parts: imageParts }),
					...(includeId ? { id: msg.toolCallId } : {}),
				},
			};

			if (model.provider === "google-vertex" && functionResponsePart.functionResponse?.id) {
				delete functionResponsePart.functionResponse.id; // Vertex AI does not support 'id' in functionResponse
			}

			// Cloud Code Assist API requires all function responses to be in a single user turn.
			// Check if the last content is already a user turn with function responses and merge.
			const lastContent = contents[contents.length - 1];
			if (lastContent?.role === "user" && lastContent.parts?.some(p => p.functionResponse)) {
				lastContent.parts.push(functionResponsePart);
			} else {
				contents.push({
					role: "user",
					parts: [functionResponsePart],
				});
			}

			// For older models, add images in a separate user message
			if (hasImages && !supportsMultimodalFunctionResponse) {
				contents.push({
					role: "user",
					parts: [{ text: "Tool result image:" }, ...imageParts],
				});
			}
		}
	}

	return contents;
}

const UNSUPPORTED_SCHEMA_FIELDS = new Set([
	"$schema",
	"$ref",
	"$defs",
	"$dynamicRef",
	"$dynamicAnchor",
	"examples",
	"prefixItems",
	"unevaluatedProperties",
	"unevaluatedItems",
	"patternProperties",
	"additionalProperties",
	"minItems",
	"maxItems",
	"minLength",
	"maxLength",
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"pattern",
	"format",
]);

interface SanitizeSchemaOptions {
	insideProperties: boolean;
	normalizeTypeArrayToNullable: boolean;
	stripNullableKeyword: boolean;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
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

function mergeCompatibleEnumSchemas(existing: unknown, incoming: unknown): JsonObject | null {
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
		if (!mergedEnum.some(existingValue => Object.is(existingValue, enumValue))) {
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

function mergePropertySchemas(existing: unknown, incoming: unknown): unknown {
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
		if (types.includes("null")) {
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

export function sanitizeSchemaForCloudCodeAssistClaude(value: unknown): unknown {
	return sanitizeSchemaImpl(value, {
		insideProperties: false,
		normalizeTypeArrayToNullable: false,
		stripNullableKeyword: true,
	});
}

/**
 * Claude via Cloud Code Assist (`parameters` path) can reject schemas that keep
 * object variant combiners, so flatten object-only unions into one object shape.
 */
function mergeObjectCombinerVariants(schema: JsonObject, combiner: "anyOf" | "oneOf"): JsonObject {
	const variantsRaw = schema[combiner];
	if (!Array.isArray(variantsRaw) || variantsRaw.length === 0) {
		return schema;
	}

	const variants: JsonObject[] = [];
	for (const entry of variantsRaw) {
		if (!isJsonObject(entry)) {
			return schema;
		}
		const variantType = entry.type;
		if (variantType !== undefined && variantType !== "object") {
			return schema;
		}
		if (entry.properties !== undefined && !isJsonObject(entry.properties)) {
			return schema;
		}
		variants.push(entry);
	}

	const mergedProperties: JsonObject = {};
	const ownProperties = isJsonObject(schema.properties) ? schema.properties : {};
	for (const [name, propertySchema] of Object.entries(ownProperties)) {
		mergedProperties[name] = propertySchema;
	}

	for (const variant of variants) {
		const properties = isJsonObject(variant.properties) ? variant.properties : {};
		for (const [name, propertySchema] of Object.entries(properties)) {
			const existingSchema = mergedProperties[name];
			mergedProperties[name] =
				existingSchema === undefined ? propertySchema : mergePropertySchemas(existingSchema, propertySchema);
		}
	}

	const nextSchema: JsonObject = {};
	for (const [key, entry] of Object.entries(schema)) {
		if (key === combiner) continue;
		nextSchema[key] = entry;
	}

	nextSchema.type = "object";
	nextSchema.properties = mergedProperties;
	return nextSchema;
}

const CLOUD_CODE_ASSIST_TYPE_SPECIFIC_KEYS: Record<string, ReadonlySet<string>> = {
	array: new Set([
		"items",
		"prefixItems",
		"contains",
		"minContains",
		"maxContains",
		"minItems",
		"maxItems",
		"uniqueItems",
		"unevaluatedItems",
	]),
	object: new Set([
		"properties",
		"required",
		"additionalProperties",
		"patternProperties",
		"propertyNames",
		"minProperties",
		"maxProperties",
		"dependentRequired",
		"dependentSchemas",
		"unevaluatedProperties",
	]),
	string: new Set(["minLength", "maxLength", "pattern", "format", "contentEncoding", "contentMediaType"]),
	number: new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]),
	integer: new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]),
	boolean: new Set(),
	null: new Set(),
};

const CLOUD_CODE_ASSIST_SHARED_SCHEMA_KEYS = new Set([
	"title",
	"description",
	"default",
	"examples",
	"deprecated",
	"readOnly",
	"writeOnly",
	"$comment",
]);
function collapseMixedTypeCombinerVariants(schema: JsonObject, combiner: "anyOf" | "oneOf"): JsonObject {
	const variantsRaw = schema[combiner];
	if (!Array.isArray(variantsRaw) || variantsRaw.length === 0) {
		return schema;
	}

	const seenTypes = new Set<string>();
	const variantTypes: string[] = [];
	const mergedVariantFields: JsonObject = {};
	for (const entry of variantsRaw) {
		if (!isJsonObject(entry) || typeof entry.type !== "string") {
			return schema;
		}

		const variantType = entry.type;
		if (seenTypes.has(variantType)) {
			return schema;
		}

		const allowedKeys = CLOUD_CODE_ASSIST_TYPE_SPECIFIC_KEYS[variantType];
		if (!allowedKeys) {
			return schema;
		}

		for (const [key, variantValue] of Object.entries(entry)) {
			if (key === "type") continue;
			if (!allowedKeys.has(key) && !CLOUD_CODE_ASSIST_SHARED_SCHEMA_KEYS.has(key)) {
				return schema;
			}

			const existingValue = mergedVariantFields[key];
			if (existingValue !== undefined && !areJsonValuesEqual(existingValue, variantValue)) {
				return schema;
			}
			mergedVariantFields[key] = variantValue;
		}

		seenTypes.add(variantType);
		variantTypes.push(variantType);
	}

	if (variantTypes.length < 2 || variantTypes.every(type => type === "object")) {
		return schema;
	}

	const nextSchema: JsonObject = {};
	for (const [key, entry] of Object.entries(schema)) {
		if (key === combiner) continue;
		nextSchema[key] = entry;
	}

	nextSchema.type = variantTypes;
	for (const [key, value] of Object.entries(mergedVariantFields)) {
		const existingValue = nextSchema[key];
		if (existingValue !== undefined && !areJsonValuesEqual(existingValue, value)) {
			return schema;
		}
		if (existingValue === undefined) {
			nextSchema[key] = value;
		}
	}
	return nextSchema;
}

function normalizeSchemaForCloudCodeAssistClaude(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(entry => normalizeSchemaForCloudCodeAssistClaude(entry));
	}
	if (!isJsonObject(value)) {
		return value;
	}

	const normalized: JsonObject = {};
	for (const [key, entry] of Object.entries(value)) {
		normalized[key] = normalizeSchemaForCloudCodeAssistClaude(entry);
	}

	const mergedAnyOf = mergeObjectCombinerVariants(normalized, "anyOf");
	const collapsedAnyOf = collapseMixedTypeCombinerVariants(mergedAnyOf, "anyOf");
	const mergedOneOf = mergeObjectCombinerVariants(collapsedAnyOf, "oneOf");
	return collapseMixedTypeCombinerVariants(mergedOneOf, "oneOf");
}

let cloudCodeAssistSchemaValidator: Ajv2020 | null = null;
function getCloudCodeAssistSchemaValidator(): Ajv2020 {
	if (cloudCodeAssistSchemaValidator) {
		return cloudCodeAssistSchemaValidator;
	}

	cloudCodeAssistSchemaValidator = new Ajv2020({
		allErrors: true,
		strict: false,
		validateSchema: true,
	});
	return cloudCodeAssistSchemaValidator;
}

/**
 * Keep validation synchronous in this request path.
 */
function isValidCloudCodeAssistClaudeSchema(schema: unknown): boolean {
	try {
		const result = getCloudCodeAssistSchemaValidator().validateSchema(schema as AnySchema);
		return typeof result === "boolean" ? result : false;
	} catch {
		return false;
	}
}

const CLOUD_CODE_ASSIST_CLAUDE_FALLBACK_SCHEMA = {
	type: "object",
	properties: {},
} as const;

/**
 * Prepare schema for Claude on Cloud Code Assist:
 * sanitize -> normalize union objects -> validate -> fallback.
 *
 * Fallback is per-tool and fail-open to avoid rejecting the entire request when
 * one tool schema is invalid.
 */
export function prepareSchemaForCloudCodeAssistClaude(value: unknown): unknown {
	const sanitized = sanitizeSchemaForCloudCodeAssistClaude(value);
	const normalized = normalizeSchemaForCloudCodeAssistClaude(sanitized);
	if (isValidCloudCodeAssistClaudeSchema(normalized)) {
		return normalized;
	}
	return CLOUD_CODE_ASSIST_CLAUDE_FALLBACK_SCHEMA;
}

/**
 * Convert tools to Gemini function declarations format.
 *
 * We prefer `parametersJsonSchema` (full JSON Schema: anyOf/oneOf/const/etc.).
 *
 * Claude models via Cloud Code Assist require the legacy `parameters` field; the API
 * translates it into Anthropic's `input_schema`. When using that path, we sanitize the
 * schema to remove Google-unsupported JSON Schema keywords.
 */
export function convertTools(
	tools: Tool[],
	model: Model<"google-generative-ai" | "google-gemini-cli" | "google-vertex">,
): { functionDeclarations: Record<string, unknown>[] }[] | undefined {
	if (tools.length === 0) return undefined;

	/**
	 * Claude models on Cloud Code Assist need the legacy `parameters` field;
	 * the API translates it into Anthropic's `input_schema`.
	 */
	const useParameters = model.id.startsWith("claude-");

	return [
		{
			functionDeclarations: tools.map(tool => ({
				name: tool.name,
				description: tool.description || "",
				...(useParameters
					? { parameters: prepareSchemaForCloudCodeAssistClaude(tool.parameters) }
					: { parametersJsonSchema: tool.parameters }),
			})),
		},
	];
}

/**
 * Map tool choice string to Gemini FunctionCallingConfigMode.
 */
export function mapToolChoice(choice: string): FunctionCallingConfigMode {
	switch (choice) {
		case "auto":
			return FunctionCallingConfigMode.AUTO;
		case "none":
			return FunctionCallingConfigMode.NONE;
		case "any":
			return FunctionCallingConfigMode.ANY;
		default:
			return FunctionCallingConfigMode.AUTO;
	}
}

/**
 * Map Gemini FinishReason to our StopReason.
 */
export function mapStopReason(reason: FinishReason): StopReason {
	switch (reason) {
		case FinishReason.STOP:
			return "stop";
		case FinishReason.MAX_TOKENS:
			return "length";
		case FinishReason.BLOCKLIST:
		case FinishReason.PROHIBITED_CONTENT:
		case FinishReason.SPII:
		case FinishReason.SAFETY:
		case FinishReason.IMAGE_SAFETY:
		case FinishReason.IMAGE_PROHIBITED_CONTENT:
		case FinishReason.IMAGE_RECITATION:
		case FinishReason.IMAGE_OTHER:
		case FinishReason.RECITATION:
		case FinishReason.FINISH_REASON_UNSPECIFIED:
		case FinishReason.OTHER:
		case FinishReason.LANGUAGE:
		case FinishReason.MALFORMED_FUNCTION_CALL:
		case FinishReason.UNEXPECTED_TOOL_CALL:
		case FinishReason.NO_IMAGE:
			return "error";
		default: {
			const _exhaustive: never = reason;
			throw new Error(`Unhandled stop reason: ${_exhaustive}`);
		}
	}
}

/**
 * Map string finish reason to our StopReason (for raw API responses).
 */
export function mapStopReasonString(reason: string): StopReason {
	switch (reason) {
		case "STOP":
			return "stop";
		case "MAX_TOKENS":
			return "length";
		default:
			return "error";
	}
}
