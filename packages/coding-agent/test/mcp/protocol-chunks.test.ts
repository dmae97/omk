import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createLineDecoder,
	type DecodedLine,
	encodeMessage,
	MAX_MESSAGE_LINE_BYTES,
} from "../../src/core/mcp/protocol.ts";

function fragmented(frame: string, cap: number, size: number): DecodedLine[] {
	const decoder = createLineDecoder(cap);
	const out: DecodedLine[] = [];
	for (let offset = 0; offset < frame.length; offset += size) {
		out.push(...decoder.push(frame.slice(offset, offset + size)));
	}
	return out;
}

afterEach(() => vi.restoreAllMocks());

describe("MCP chunk-independent framing", () => {
	it("applies the raw byte limit to whitespace before trimming, at every split", () => {
		const frame = `${" ".repeat(80)}\n`;
		const expected = [{ error: "MCP frame exceeded 64 bytes" }];
		expect(createLineDecoder(64).push(frame)).toEqual(expected);
		for (let cut = 0; cut <= frame.length; cut++) {
			const decoder = createLineDecoder(64);
			expect([...decoder.push(frame.slice(0, cut)), ...decoder.push(frame.slice(cut))]).toEqual(expected);
		}
	});

	it("accepts exactly-sized Unicode frames even when surrogate pairs cross chunks", () => {
		const message = { jsonrpc: "2.0", id: 1, result: "한글🙂é".repeat(20) } as const;
		const frame = encodeMessage(message);
		const cap = Buffer.byteLength(frame) - 1;
		expect(fragmented(frame, cap, 1)).toEqual([{ message }]);
		for (let cut = 0; cut <= frame.length; cut++) {
			const decoder = createLineDecoder(cap);
			expect([...decoder.push(frame.slice(0, cut)), ...decoder.push(""), ...decoder.push(frame.slice(cut))]).toEqual(
				[{ message }],
			);
		}
		expect(fragmented(frame, cap - 1, 1)).toEqual([{ error: `MCP frame exceeded ${cap - 1} bytes` }]);
	});

	it("counts CRLF and unpaired surrogates consistently with raw UTF-8", () => {
		const message = { jsonrpc: "2.0", id: 2, result: "ok" } as const;
		const frame = `${encodeMessage(message).trimEnd()}\r\n`;
		const cap = Buffer.byteLength(frame) - 1;
		expect(fragmented(frame, cap, 1)).toEqual([{ message }]);
		expect(fragmented(frame, cap - 1, 1)).toEqual([{ error: `MCP frame exceeded ${cap - 1} bytes` }]);
		const unpaired = '{"jsonrpc":"2.0","id":2,"result":"\ud800x\udc00"}\n';
		expect(fragmented(unpaired, Buffer.byteLength(unpaired) - 1, 1)).toEqual([
			{ message: { ...message, result: "\ud800x\udc00" } },
		]);
	});

	it("reports overflow once, recovers in the same chunk, and resets both pending and discard state", () => {
		const message = { jsonrpc: "2.0", id: 9, result: true } as const;
		const decoder = createLineDecoder(64);
		expect(decoder.push("x".repeat(65))).toEqual([{ error: "MCP frame exceeded 64 bytes" }]);
		expect(decoder.push("x".repeat(1000))).toEqual([]);
		expect(decoder.push(`tail\n \r\n${encodeMessage(message)}{`)).toEqual([{ message }]);
		decoder.reset();
		expect(decoder.push(encodeMessage(message))).toEqual([{ message }]);
		decoder.push("x".repeat(65));
		decoder.reset();
		expect(decoder.push(encodeMessage(message))).toEqual([{ message }]);
	});

	it("preserves complete tools/list descriptors and message ordering", () => {
		const tools = Array.from({ length: 1600 }, (_, i) => ({
			name: `server_${i % 32}_tool_${i}`,
			description: `도구 ${i}`,
			inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
		}));
		const messages = [
			{ jsonrpc: "2.0", id: "catalog", result: { tools } },
			{ jsonrpc: "2.0", id: "next", result: null },
		] as const;
		expect(MAX_MESSAGE_LINE_BYTES).toBe(16 * 1024 * 1024);
		const frames = messages.map(encodeMessage).join("");
		for (const size of [317, 4095, 4096, 4097, frames.length]) {
			expect(fragmented(frames, MAX_MESSAGE_LINE_BYTES, size)).toEqual(messages.map((message) => ({ message })));
		}
	});

	it("scans new chunks rather than repeatedly searching the retained frame", () => {
		const message = { jsonrpc: "2.0", id: 1, result: "x".repeat(64 * 1024) } as const;
		const frame = encodeMessage(message);
		const indexOf = String.prototype.indexOf;
		let searchedChars = 0;
		const search = vi.spyOn(String.prototype, "indexOf").mockImplementation(function (
			this: string,
			needle: string,
			position = 0,
		) {
			if (needle === "\n") searchedChars += this.length - position;
			return indexOf.call(this, needle, position);
		});
		const out = fragmented(frame, MAX_MESSAGE_LINE_BYTES, 257);
		search.mockRestore();
		expect(out).toEqual([{ message }]);
		expect(searchedChars).toBeLessThanOrEqual(frame.length * 2);
	});
});
