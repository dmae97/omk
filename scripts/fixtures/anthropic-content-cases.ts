import type { ImageContent, TextContent, ToolCall } from "../../packages/ai/src/types.ts";

type Content = TextContent | ImageContent;
type History =
	| { role: "user"; content: Content[] }
	| { role: "assistant"; content: ToolCall[]; stopReason: "toolUse" | "error" }
	| { role: "toolResult"; toolCallId: string; content: Content[]; isError: boolean };
const text = (text: string): TextContent => ({ type: "text", text });
const image = (mimeType = "image/png", data = "c3ludGhldGlj"): ImageContent => ({ type: "image", mimeType, data });
const user = (content: Content[]): History => ({ role: "user", content });
const assistant = (stopReason: "toolUse" | "error" = "toolUse"): History => ({ role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }], stopReason });
const result = (content: Content[], toolCallId = "call_1"): History => ({ role: "toolResult", toolCallId, content, isError: false });
const userPlaceholder = "(image omitted: model does not support images)";
const toolPlaceholder = "(tool image omitted: model does not support images)";

export const scenarios: { id: string; history: History[] }[] = [
	{ id: "user-empty-array", history: [user([])] },
	{ id: "user-blank-array", history: [user([text(""), text(" \t\n\uFEFF")])] },
	{ id: "user-text-array", history: [user([text("First 한글"), text("Second 🌏")])] },
	{ id: "user-whitespace", history: [user([text(" Keep "), text(""), text("\n"), text(" Last ")])] },
	{ id: "user-ecma-whitespace", history: [user([text("\u0085"), text("\uFEFF"), text("\u2003")])] },
	{ id: "user-image", history: [user([image()])] },
	{ id: "user-adjacent-images", history: [user([image(), image("image/jpeg"), image("image/webp")])] },
	{ id: "user-separated-images", history: [user([image(), text("Middle"), image()])] },
	{ id: "user-placeholder-before", history: [user([text(userPlaceholder), image()])] },
	{ id: "user-placeholder-after", history: [user([image(), text(userPlaceholder), image()])] },
	{ id: "user-blank-between-images", history: [user([image(), text(""), image()])] },
	{ id: "user-mime-data-ignored", history: [user([image("application/synthetic", "not base64 🌏")])] },
	{ id: "tool-empty-array", history: [assistant(), result([])] },
	{ id: "tool-blank-array", history: [assistant(), result([text(""), text(" \t\n\uFEFF")])] },
	{ id: "tool-text-array", history: [assistant(), result([text("First"), text(""), text("Last 한글")])] },
	{ id: "tool-image", history: [assistant(), result([image()])] },
	{ id: "tool-adjacent-images", history: [assistant(), result([image(), image()])] },
	{ id: "tool-separated-images", history: [assistant(), result([image(), text("Middle"), image()])] },
	{ id: "tool-placeholder-before", history: [assistant(), result([text(toolPlaceholder), image()])] },
	{ id: "tool-placeholder-after", history: [assistant(), result([image(), text(toolPlaceholder), image()])] },
	{ id: "tool-blank-between-images", history: [assistant(), result([image(), text(""), image()])] },
	{ id: "tool-grouped-images", history: [assistant(), result([image()]), result([image(), text("Next")])] },
	{ id: "array-interrupts-tool", history: [assistant(), user([image()]), result([image()])] },
	{ id: "blank-array-separates-results", history: [assistant(), result([image()]), user([]), result([image()])] },
	{ id: "orphan-image", history: [result([image()], "orphan")] },
	{ id: "failed-assistant-image", history: [assistant("error"), result([image()])] },
];
