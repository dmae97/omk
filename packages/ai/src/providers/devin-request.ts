import { createHash } from "node:crypto";
import type { Context, Message, Model, StreamOptions } from "../types.ts";
import { doubleField, field } from "./devin-protobuf.ts";
import { transformMessages } from "./transform-messages.ts";

function messageId(sessionId: string, index: number): string {
	const hash = createHash("sha256").update(`${sessionId}\0${index}`).digest("hex");
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function prompt(message: Message, id: string, model: Model<"devin-agent">): Buffer {
	const fields: Buffer[] = [];
	let text = "";
	let thinking = "";
	let signature = "";
	if (typeof message.content === "string") {
		text = message.content;
	} else {
		for (const block of message.content) {
			switch (block.type) {
				case "text":
					text += block.text;
					break;
				case "image":
					throw new Error("Devin SWE-2 image input has not been enabled; provide text instead");
				case "thinking":
					thinking += block.thinking;
					if (
						message.role === "assistant" &&
						message.api === model.api &&
						message.provider === model.provider &&
						message.model === model.id
					)
						signature ||= block.thinkingSignature ?? "";
					break;
				case "toolCall":
					fields.push(
						field(
							6,
							Buffer.concat([
								field(1, block.id),
								field(2, block.name),
								field(3, JSON.stringify(block.arguments)),
							]),
						),
					);
					break;
			}
		}
	}
	const native =
		message.role === "assistant" &&
		message.api === model.api &&
		message.provider === model.provider &&
		message.model === model.id;
	const nativeId = native ? message.responseId : undefined;
	fields.push(
		field(1, nativeId ?? (message.role === "assistant" ? `bot-${id}` : id)),
		field(2, message.role === "user" ? 1 : message.role === "assistant" ? 2 : 4),
		field(3, text),
	);
	if (thinking) fields.push(field(11, thinking));
	if (signature) fields.push(field(12, signature));
	if (message.role === "toolResult") fields.push(field(7, message.toolCallId), field(9, message.isError));
	return Buffer.concat(fields);
}

/** Metadata is appended after the payload hook so observers never receive auth secrets. */
export function buildDevinRequest(
	model: Model<"devin-agent">,
	context: Context,
	uid: string,
	sessionId: string,
	maxTokens: number,
	options: StreamOptions,
): Buffer {
	// Native Devin CLI 3000.6.2 completion settings (oh-my-pi #10234 / mitmproxy).
	// No synthetic stops; protobuf topP is field 8, while field 6 is firstTemperature.
	const temperature = options.temperature ?? 1;
	const configuration = Buffer.concat([
		field(1, 1),
		field(2, maxTokens),
		field(3, 400),
		doubleField(5, temperature),
		field(7, 40),
		doubleField(8, 0.95),
	]);
	return Buffer.concat([
		field(2, context.systemPrompt ?? ""),
		...transformMessages(context.messages, model).map((message, index) =>
			field(3, prompt(message, messageId(sessionId, index), model)),
		),
		field(7, 5),
		field(8, configuration),
		...(context.tools ?? []).map((tool) =>
			field(
				10,
				Buffer.concat([field(1, tool.name), field(2, tool.description), field(3, JSON.stringify(tool.parameters))]),
			),
		),
		field(11, true),
		field(12, field(1, "auto")),
		...(options.cacheRetention === "none" ? [] : [field(13, field(1, 1))]),
		field(16, sessionId),
		field(20, 1),
		field(21, uid),
		field(22, crypto.randomUUID()),
	]);
}
