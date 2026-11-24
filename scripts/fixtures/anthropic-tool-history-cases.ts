import type { AssistantMessage, TextContent, ToolCall } from "../../packages/ai/src/types.ts";

type Thinking = { type: "thinking"; thinking: string; thinkingSignature?: string; redacted?: boolean };
export type History =
	| { role: "user"; text: string }
	| { role: "assistant"; content: (TextContent | ToolCall | Thinking)[]; stopReason?: AssistantMessage["stopReason"] }
	| { role: "toolResult"; toolCallId: string; content: TextContent[]; isError: boolean };
const text = (value: string): TextContent => ({ type: "text", text: value });
const call = (id = "call_1", args: Record<string, unknown> = { path: "한글/🌍.txt" }): ToolCall => ({ type: "toolCall", id, name: "read", arguments: args });
const assistant = (content: (TextContent | ToolCall | Thinking)[], stopReason?: AssistantMessage["stopReason"]): History => ({ role: "assistant", content, ...(stopReason ? { stopReason } : {}) });
const result = (toolCallId = "call_1", content = [text("Synthetic result")], isError = false): History => ({ role: "toolResult", toolCallId, content, isError });
const calls = () => assistant([text("Reading"), call(), call("call_2", { path: "second.txt" })], "toolUse");

export const scenarios: { id: string; history: History[]; user?: string }[] = [
	{ id: "single-tool", history: [assistant([call()], "toolUse"), result()] },
	{ id: "parallel-tools", history: [calls(), result(), result("call_2")] },
	{ id: "reverse-results", history: [calls(), result("call_2"), result()] },
	{ id: "missing-all-results", history: [calls()] },
	{ id: "missing-one-result", history: [calls(), result("call_2")] },
	{ id: "missing-at-eof", history: [calls()], user: "" },
	{ id: "interrupted-by-user", history: [calls(), { role: "user", text: "Interrupt" }, result()] },
	{ id: "interrupted-by-assistant", history: [calls(), assistant([text("Next assistant")]), result()] },
	{ id: "orphan-results", history: [result("unknown"), result("")] },
	{ id: "error-assistant", history: [assistant([call(), text("Incomplete")], "error"), result()] },
	{ id: "aborted-assistant", history: [assistant([call()], "aborted"), result()] },
	{ id: "error-flushes-pending", history: [calls(), assistant([call("failed")], "error"), result("failed")] },
	{ id: "trim-result-id", history: [assistant([call()], "toolUse"), result(" \tcall_1\uFEFF")] },
	{ id: "same-model-id-unchanged", history: [assistant([call("call|🌍")], "toolUse"), result("call|🌍")] },
	{ id: "duplicate-results", history: [assistant([call()], "toolUse"), result(), result()] },
	{ id: "empty-tool-result", history: [assistant([call()], "toolUse"), result("call_1", [])] },
	{ id: "multiblock-error-result", history: [assistant([call()], "toolUse"), result("call_1", [text("First"), text(""), text("Last\n🌏")], true)] },
	{ id: "argument-key-order", history: [assistant([call("call_1", { z: 1, a: { second: [null, false, 0.25], first: "quote: \" slash: \\ nul: \0" }, "10": 10, "2": 2 })], "toolUse"), result()] },
	{ id: "signed-thinking", history: [assistant([{ type: "thinking", thinking: "Reasoning 한글", thinkingSignature: "synthetic-signature" }, call()], "toolUse"), result()] },
	{ id: "unsigned-thinking", history: [assistant([{ type: "thinking", thinking: "Unsigned reasoning" }, text("Reply")])] },
	{ id: "blank-signature", history: [assistant([{ type: "thinking", thinking: "Reasoning", thinkingSignature: " \t" }])] },
	{ id: "empty-thinking", history: [assistant([{ type: "thinking", thinking: "\uFEFF ", thinkingSignature: "synthetic-signature" }])] },
	{ id: "redacted-thinking", history: [assistant([{ type: "thinking", thinking: "", thinkingSignature: "synthetic-opaque", redacted: true }, text("Reply")])] },
	{ id: "blank-blocks", history: [assistant([text(" \t"), text("\u0085"), text(" Keep ")])] },
	{ id: "two-tool-turns", history: [assistant([call()], "toolUse"), result(), assistant([call("call_2")], "toolUse"), result("call_2"), assistant([text("Done")])] },
];
