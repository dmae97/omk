/**
 * Hashes of the cacheable request prefix (spec 051).
 *
 * Provider prompt caches (Anthropic, xAI, OpenAI) reuse work only while the
 * system prompt, the tool list and the earlier messages of a request are
 * byte-identical to the previous request. These helpers hash exactly those
 * parts of a `Context`, so a test or a run log can tell which part changed.
 *
 * Node-only (`node:crypto`), so it is a separate entry (`omk-ai/prompt-hash`)
 * and not part of the browser-safe package index.
 *
 * Nothing is normalized: tool parameters are serialized with their own key
 * order, so a schema whose key order changes between calls shows up as a
 * changed hash instead of being hidden.
 */
import { createHash } from "node:crypto";
import type { Context, Message } from "./types.ts";

function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

/** sha256 hex of the system prompt string as UTF-8; the empty string when there is none. */
export function systemHash(context: Pick<Context, "systemPrompt">): string {
	return sha256(context.systemPrompt ?? "");
}

/** The tool list as hashed by {@link toolsHash}: `[{name, description, parameters}]` in the order given. */
export function serializePromptTools(context: Pick<Context, "tools">): string {
	return JSON.stringify(
		(context.tools ?? []).map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		})),
	);
}

/** sha256 hex of {@link serializePromptTools}: names, descriptions and schemas, in sent order, keys as given. */
export function toolsHash(context: Pick<Context, "tools">): string {
	return sha256(serializePromptTools(context));
}

/**
 * One message as it reaches a provider: role, content and the tool-result
 * fields. Local bookkeeping (timestamp, usage, stopReason, model ids) is left
 * out because providers do not send it.
 */
export function serializePromptMessage(message: Message): string {
	if (message.role === "toolResult") {
		return JSON.stringify({
			role: message.role,
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			isError: message.isError,
			content: message.content,
		});
	}
	return JSON.stringify({ role: message.role, content: message.content });
}

/** sha256 hex over the first `count` messages (default all), each serialized by {@link serializePromptMessage}. */
export function messagesPrefixHash(context: Pick<Context, "messages">, count = context.messages.length): string {
	const hash = createHash("sha256");
	for (const message of context.messages.slice(0, count)) {
		hash.update(serializePromptMessage(message), "utf8");
		hash.update("\n", "utf8");
	}
	return hash.digest("hex");
}
