import type { Context } from "omk-ai";
import { boundedAdmissionJson, representationLimit } from "./request-admission-json.ts";
import type { RequestAdmissionPolicy } from "./request-admission-policy.ts";

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new TypeError("admission.invalid_shape");
	return value as Record<string, unknown>;
}
/** Projection bounds guard-owned allocations, not memory already owned by the caller. */
export function projectRequestForAdmission(
	context: Context,
	policy: RequestAdmissionPolicy,
): {
	system: string;
	messages: string;
	tools: string;
	imageCount: number;
} {
	if (
		!Array.isArray(context.messages) ||
		context.messages.length > policy.maxMessages ||
		(context.tools !== undefined && (!Array.isArray(context.tools) || context.tools.length > policy.maxTools))
	)
		representationLimit();
	const system = context.systemPrompt ?? "";
	if (typeof system !== "string") throw new TypeError("admission.invalid_system_prompt");
	if (system.length > policy.maxSerializedChars) representationLimit();
	const budget = { remaining: policy.maxSerializedChars - system.length, nodes: 0 };
	let imageCount = 0,
		projectedNodes = 0;
	const visit = (): void => {
		if (++projectedNodes > 100000) representationLimit();
	};
	function content(value: unknown): unknown {
		if (typeof value === "string") return value;
		if (!Array.isArray(value) || value.length > 100000) representationLimit();
		return value.map((raw) => {
			visit();
			const part = record(raw);
			if (part.type === "text") {
				if (typeof part.text !== "string") throw new TypeError("admission.invalid_text");
				return { type: "text", text: part.text };
			}
			if (part.type !== "image") throw new TypeError("admission.invalid_content");
			imageCount++;
			// Never copy or tokenize base64 image data.
			return { type: "image", mimeType: part.mimeType, estimatedTokens: policy.imageTokens };
		});
	}
	const messages = context.messages.map((raw) => {
		visit();
		const message = record(raw);
		switch (message.role) {
			case "user":
				return { role: "user", content: content(message.content) };
			case "toolResult":
				return {
					role: "toolResult",
					toolCallId: message.toolCallId,
					toolName: message.toolName,
					isError: message.isError,
					content: content(message.content),
				};
			case "assistant": {
				if (!Array.isArray(message.content) || message.content.length > 100000) representationLimit();
				return {
					role: "assistant",
					content: message.content.map((rawPart) => {
						visit();
						const part = record(rawPart);
						if (part.type === "text") {
							if (typeof part.text !== "string") throw new TypeError("admission.invalid_text");
							return { type: "text", text: part.text };
						}
						if (part.type === "thinking") return { type: "thinking", thinking: part.thinking };
						if (part.type !== "toolCall") throw new TypeError("admission.invalid_tool_call");
						return { type: "toolCall", id: part.id, name: part.name, arguments: part.arguments };
					}),
				};
			}
			default:
				throw new TypeError("admission.invalid_role");
		}
	});
	const messageText = boundedAdmissionJson(messages, budget);
	const tools = (context.tools ?? []).map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	}));
	return { system, messages: messageText, tools: boundedAdmissionJson(tools, budget), imageCount };
}
