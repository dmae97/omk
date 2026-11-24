import type { ImageContent, TextContent, ToolCall } from "../../packages/ai/src/types.ts";

type Content = TextContent | ImageContent;
type History =
	| { role: "user"; content: Content[] }
	| { role: "assistant"; content: ToolCall[]; stopReason: "toolUse" | "error" }
	| { role: "toolResult"; toolCallId: string; content: Content[]; isError: boolean };
const image = (data: string, mimeType = "image/png"): ImageContent => ({ type: "image", data, mimeType });
const text = (text: string): TextContent => ({ type: "text", text });
const png = (width: number, height: number) => {
	const b = Buffer.alloc(24); b.set([0x89, 0x50, 0x4e, 0x47]); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20); return b;
};
const gif = (width: number, height: number) => {
	const b = Buffer.alloc(10); b.write("GIF89a"); b.writeUInt16LE(width, 6); b.writeUInt16LE(height, 8); return b;
};
const jpeg = (width: number, height: number, marker = 0xc0) => {
	const b = Buffer.from([0xff, 0xd8, 0xff, marker, 0, 10, 8, 0, 0, 0, 0, 0]); b.writeUInt16BE(height, 7); b.writeUInt16BE(width, 9); return b;
};
const webp = (kind: string, width: number, height: number) => {
	const b = Buffer.alloc(30); b.write("RIFF"); b.write("WEBP", 8); b.write(kind, 12);
	if (kind === "VP8X") { b.writeUIntLE(width - 1, 24, 3); b.writeUIntLE(height - 1, 27, 3); }
	if (kind === "VP8 ") { b.writeUInt16LE(width | 0xc000, 26); b.writeUInt16LE(height | 0xc000, 28); }
	if (kind === "VP8L") { const w = width - 1; const h = height - 1; b[21] = w & 255; b[22] = ((w >> 8) & 63) | ((h & 3) << 6); b[23] = (h >> 2) & 255; b[24] = (h >> 10) & 15; }
	return b;
};
const windowJpeg = (sofOffset: number) => {
	const b = Buffer.alloc(sofOffset + 10); b.set([0xff, 0xd8, 0xff, 0xe1]); b.writeUInt16BE(sofOffset - 4, 4); b.set(jpeg(1901, 1).subarray(2), sofOffset); return b;
};
const encoded = (b: Buffer) => b.toString("base64");
const oversized = encoded(png(1901, 1));
export const images: { id: string; data: string; mimeType: string }[] = [
	{ id: "png-limit", data: encoded(png(1900, 1900)), mimeType: "image/png" },
	{ id: "png-wide", data: oversized, mimeType: "image/png" },
	{ id: "png-tall", data: encoded(png(1, 1901)), mimeType: "image/png" },
	{ id: "png-u32", data: encoded(png(0xffffffff, 2)), mimeType: "image/png" },
	{ id: "png-short", data: encoded(png(1901, 1).subarray(0, 23)), mimeType: "image/png" },
	{ id: "gif-limit", data: encoded(gif(1900, 1900)), mimeType: "image/gif" },
	{ id: "gif-wide", data: encoded(gif(65535, 1)), mimeType: "image/gif" },
	{ id: "gif-short", data: encoded(gif(1901, 1).subarray(0, 9)), mimeType: "image/gif" },
	{ id: "jpeg-limit", data: encoded(jpeg(1900, 1900)), mimeType: "image/jpeg" },
	{ id: "jpeg-wide", data: encoded(jpeg(1901, 1)), mimeType: "image/jpeg" },
	{ id: "jpeg-app", data: encoded(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 4, 0, 0]), jpeg(1, 1901).subarray(2)])), mimeType: "image/jpeg" },
	{ id: "jpeg-no-sof", data: encoded(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0])), mimeType: "image/jpeg" },
	{ id: "jpeg-excluded-marker", data: encoded(jpeg(1901, 1, 0xc4)), mimeType: "image/jpeg" },
	{ id: "jpeg-noise", data: encoded(Buffer.concat([Buffer.from([0xff, 0xd8, 0]), jpeg(1901, 1).subarray(2)])), mimeType: "image/jpeg" },
	{ id: "jpeg-short", data: encoded(jpeg(1901, 1).subarray(0, 11)), mimeType: "image/jpeg" },
	{ id: "webp-x-limit", data: encoded(webp("VP8X", 1900, 1900)), mimeType: "image/webp" },
	{ id: "webp-x-wide", data: encoded(webp("VP8X", 1901, 1)), mimeType: "image/webp" },
	{ id: "webp-x-u24", data: encoded(webp("VP8X", 0x1000000, 1)), mimeType: "image/webp" },
	{ id: "webp-lossy-flags", data: encoded(webp("VP8 ", 1900, 1900)), mimeType: "image/webp" },
	{ id: "webp-l-limit", data: encoded(webp("VP8L", 1900, 1900)), mimeType: "image/webp" },
	{ id: "webp-l-wide", data: encoded(webp("VP8L", 1901, 1)), mimeType: "image/webp" },
	{ id: "webp-unknown", data: encoded(webp("NONE", 1901, 1)), mimeType: "image/webp" },
	{ id: "webp-short", data: encoded(webp("VP8L", 1901, 1).subarray(0, 29)), mimeType: "image/webp" },
	{ id: "unknown-format", data: encoded(Buffer.alloc(12)), mimeType: "application/synthetic" },
	{ id: "empty-data", data: "", mimeType: "image/png" },
	{ id: "invalid-base64", data: "!not base64!", mimeType: "image/png" },
	{ id: "base64-whitespace", data: oversized.replaceAll(/(.{4})/g, "$1 \n"), mimeType: "image/png" },
	{ id: "base64-url", data: encoded(jpeg(1901, 1)).replaceAll("/", "_").replaceAll("+", "-"), mimeType: "image/jpeg" },
	{ id: "base64-unpadded", data: encoded(gif(1901, 1)).replaceAll("=", ""), mimeType: "image/gif" },
	{ id: "base64-padding-stop", data: `${encoded(gif(1901, 1))}ignored`, mimeType: "image/gif" },
	{ id: "base64-punctuation", data: oversized.replaceAll(/(.{4})/g, "$1!"), mimeType: "image/png" },
	{ id: "jpeg-beyond-window", data: encoded(windowJpeg(65539)), mimeType: "image/jpeg" },
	{ id: "jpeg-window-edge", data: encoded(windowJpeg(65528)), mimeType: "image/jpeg" },
	{ id: "base64-unicode", data: `한글🌏${oversized}`, mimeType: "image/png" },
	{ id: "mime-sniff", data: oversized, mimeType: "image/gif" },
];
const small = image(images[0].data);
const large = image(oversized);
const user = (content: Content[]): History => ({ role: "user", content });
const assistant = (stopReason: "toolUse" | "error" = "toolUse"): History => ({ role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }], stopReason });
const result = (content: Content[], toolCallId = "call_1"): History => ({ role: "toolResult", toolCallId, content, isError: false });
export const scenarios: { id: string; history: History[] }[] = [
	...images.map((entry) => ({ id: entry.id, history: [user([image(entry.data, entry.mimeType)])] })),
	{ id: "tool-only-image", history: [assistant(), result([small])] },
	{ id: "tool-empty-text-image", history: [assistant(), result([text(""), small])] },
	{ id: "tool-mixed", history: [assistant(), result([text("First 한글"), small, text("Last 🌏")])] },
	{ id: "tool-two-images", history: [assistant(), result([small, small])] },
	{ id: "tool-oversize-only", history: [assistant(), result([large])] },
	{ id: "tool-oversize-and-image", history: [assistant(), result([large, small])] },
	{ id: "tool-adjacent-oversize", history: [assistant(), result([large, large])] },
	{ id: "tool-empty-array", history: [assistant(), result([])] },
	{ id: "user-adjacent-images", history: [user([small, small])] },
	{ id: "user-blank-oversize", history: [user([text("\uFEFF"), large, text("")])] },
	{ id: "tool-grouped-images", history: [assistant(), result([small]), result([large, small])] },
	{ id: "user-interrupts-tool", history: [assistant(), user([small]), result([small])] },
	{ id: "orphan-oversize", history: [result([large], "orphan")] },
	{ id: "failed-assistant-image", history: [assistant("error"), result([small])] },
	{ id: "vision-text-array", history: [user([text("First"), text(""), text("Last")])] },
];
