/**
 * Shared utilities for Google Generative AI and Google Cloud Code Assist providers.
 */

import { type Content, FinishReason, FunctionCallingConfigMode, type Part, type Schema } from "@google/genai";
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
	const transformedMessages = transformMessages(context.messages, model);

	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				contents.push({
					role: "user",
					parts: [{ text: sanitizeSurrogates(msg.content) }],
				});
			} else {
				const parts: Part[] = msg.content.map((item) => {
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
				const filteredParts = !model.input.includes("image") ? parts.filter((p) => p.text !== undefined) : parts;
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
						const argsStr = JSON.stringify(block.arguments, null, 2);
						parts.push({
							text: sanitizeSurrogates(
								`[Historical context: a different model called tool "${block.name}" with arguments: ${argsStr}. Do not mimic this format - use proper function calling.]`,
							),
						});
						continue;
					}

					const part: Part = {
						functionCall: {
							name: block.name,
							args: block.arguments,
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
			const textResult = textContent.map((c) => c.text).join("\n");
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

			const imageParts: Part[] = imageContent.map((imageBlock) => ({
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
			if (lastContent?.role === "user" && lastContent.parts?.some((p) => p.functionResponse)) {
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
	"format",
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

function sanitizeSchemaImpl(value: unknown, isInsideProperties: boolean): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => sanitizeSchemaImpl(entry, isInsideProperties));
	}

	if (!value || typeof value !== "object") {
		return value;
	}

	const obj = value as Record<string, unknown>;
	const result: Record<string, unknown> = {};

	// Collapse anyOf/oneOf of const values into enum
	for (const combiner of ["anyOf", "oneOf"] as const) {
		if (Array.isArray(obj[combiner])) {
			const variants = obj[combiner] as Record<string, unknown>[];

			// Check if ALL variants have a const field
			const allHaveConst = variants.every((v) => v && typeof v === "object" && "const" in v);

			if (allHaveConst && variants.length > 0) {
				// Extract all const values into enum
				result.enum = variants.map((v) => v.const);

				// Inherit type from first variant if present
				const firstType = variants[0]?.type;
				if (firstType) {
					result.type = firstType;
				}

				// Copy description and other top-level fields (not the combiner)
				for (const [key, entry] of Object.entries(obj)) {
					if (key !== combiner && !(key in result)) {
						result[key] = sanitizeSchemaImpl(entry, false);
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
		if (!isInsideProperties && UNSUPPORTED_SCHEMA_FIELDS.has(key)) continue;
		if (key === "const") {
			constValue = entry;
			continue;
		}
		if (key === "additionalProperties" && entry === false) continue;
		// When key is "properties", child keys are property names, not schema keywords
		result[key] = sanitizeSchemaImpl(entry, key === "properties");
	}

	if (constValue !== undefined) {
		// Convert const to enum, merging with existing enum if present
		const existingEnum = Array.isArray(result.enum) ? result.enum : [];
		if (!existingEnum.some((item) => Object.is(item, constValue))) {
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
	return sanitizeSchemaImpl(value, false);
}

function sanitizeToolForGoogle(tool: Tool): Tool {
	return {
		name: tool.name,
		description: tool.description,
		parameters: sanitizeSchemaForGoogle(tool.parameters) as any,
	};
}

/**
 * Convert tools to Gemini function declarations format.
 */
export function convertTools(
	tools: Tool[],
	_model: Model<"google-generative-ai" | "google-gemini-cli" | "google-vertex">,
): { functionDeclarations: { name: string; description?: string; parameters: Schema }[] }[] | undefined {
	if (tools.length === 0) return undefined;
	return [{ functionDeclarations: tools.map(sanitizeToolForGoogle) }];
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
