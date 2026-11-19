import type { Context, Model } from "../../packages/ai/src/types.ts";

export const model: Model<"anthropic-messages"> = {
	id: "synthetic-anthropic", name: "Synthetic Anthropic", api: "anthropic-messages", provider: "anthropic",
	baseUrl: "https://synthetic.invalid", reasoning: false, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 64,
};
export const context: Context = {
	systemPrompt: "Synthetic system 한글", messages: [{ role: "user", content: "Hello 🌍", timestamp: 0 }],
};
const frame = (data: Record<string, unknown>) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
const start = frame({ type: "message_start", message: { id: "msg_synthetic", usage: {
	input_tokens: 12, output_tokens: 0, cache_read_input_tokens: 3, cache_creation_input_tokens: 2,
} } });
const textStart = frame({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
const textDelta = frame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "안녕 🌍" } });
const stop = frame({ type: "content_block_stop", index: 0 });
const end = (reason: string) => frame({ type: "message_delta", delta: { stop_reason: reason }, usage: { output_tokens: 5 } }) + frame({ type: "message_stop" });
const text = start + textStart + textDelta + stop;
const tool = start + frame({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_synthetic", name: "read", input: {} } }) +
	frame({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":' } }) +
	frame({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"한글/🌍.txt"}' } }) + stop + end("tool_use");

export const cases = [
	{ id: "unicode", wire: text + end("end_turn"), width: 4096 },
	{ id: "bytewise", wire: text + end("end_turn"), width: 1 },
	{ id: "crlf", wire: (text + end("end_turn")).replaceAll("\n", "\r\n"), width: 7 },
	{ id: "crlf-intact", wire: (text + end("end_turn")).replaceAll("\n", "\r\n"), width: 4096 },
	{ id: "trailing-frame", wire: (text + end("end_turn")).trimEnd(), width: 5 },
	{ id: "refusal-empty", wire: start + end("refusal"), width: 4096 },
	{ id: "thinking", wire: start +
		frame({ type: "content_block_start", index: 1, content_block: { type: "thinking", thinking: "" } }) +
		frame({ type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "합성 reasoning" } }) +
		frame({ type: "content_block_delta", index: 1, delta: { type: "signature_delta", signature: "synthetic-signature" } }) +
		frame({ type: "content_block_stop", index: 1 }) + textStart + textDelta + stop + end("end_turn"), width: 3 },
	{ id: "cancel-mid", wire: text + end("end_turn"), width: new TextEncoder().encode(start + textStart + textDelta).length, abortAfterChunks: 1 },
	{ id: "tool", wire: tool, width: 3, tool: true },
	{ id: "length", wire: text + end("max_tokens"), width: 13 },
	{ id: "refusal-text", wire: text + end("refusal"), width: 19 },
	{ id: "eof", wire: text, width: 5 },
	{ id: "empty", wire: "", width: 1 },
	{ id: "unknown", wire: text + end("end_turn") + "event: proxy.stats\ndata: not json\n\n", width: 11 },
	{ id: "error", wire: start + 'event: error\ndata: {"type":"overloaded_error","message":"synthetic overload"}\n\n', width: 23 },
	{ id: "cancel", wire: text + end("end_turn"), width: 17, abort: true },
] as const;
