import { describe, expect, it, vi } from "vitest";
import { encodeMessage, type JsonRpcRequest } from "../../src/core/mcp/protocol.ts";
import { McpStdioTransport } from "../../src/core/mcp/stdio-transport.ts";

const request: JsonRpcRequest = { jsonrpc: "2.0", id: 7, method: "ping", params: {} };
const frameBytes = Buffer.byteLength(encodeMessage(request), "utf8");

function fixture(maxPendingWriteBytes: number) {
	const transport = new McpStdioTransport(
		{ command: process.execPath, maxPendingWriteBytes },
		{ onMessage: () => {}, onExit: () => {} },
	);
	const callbacks: Array<() => void> = [];
	const stdin = {
		writable: true,
		writableLength: 0,
		write: vi.fn((_frame: string): boolean => true),
		once: vi.fn((event: string, callback: () => void) => {
			if (event === "drain") callbacks.push(callback);
		}),
	};
	(transport as unknown as { child: { stdin: typeof stdin } }).child = { stdin };
	return { transport, stdin, callbacks };
}

describe("MCP stdio outbound admission", () => {
	it("counts bytes queued by earlier successful writes before accepting another frame", () => {
		const { transport, stdin } = fixture(frameBytes + 10);
		stdin.writableLength = 11;
		expect(transport.send(request)).toBe(false);
		expect(stdin.write).not.toHaveBeenCalled();
		stdin.writableLength = 10;
		expect(transport.send(request)).toBe(true);
		expect(stdin.write).toHaveBeenCalledTimes(1);
	});

	it("matches a seeded byte-budget oracle across different frame and queue sizes", () => {
		let seed = 0x4f4d4b;
		const next = () => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed;
		};
		for (let trial = 0; trial < 200; trial++) {
			const message: JsonRpcRequest = {
				jsonrpc: "2.0",
				id: trial,
				method: "tools/call",
				params: { text: "x".repeat(next() % 120) },
			};
			const queued = next() % 256;
			const cap = next() % 512;
			const { transport, stdin } = fixture(cap);
			stdin.writableLength = queued;
			const expected = queued + Buffer.byteLength(encodeMessage(message), "utf8") <= cap;
			expect(transport.send(message), `trial ${trial}`).toBe(expected);
			expect(stdin.write).toHaveBeenCalledTimes(Number(expected));
		}
	});

	it("does not double-count a backpressured frame and resumes after drain", () => {
		const { transport, stdin, callbacks } = fixture(frameBytes * 2);
		stdin.write.mockImplementation(() => {
			stdin.writableLength += frameBytes;
			return false;
		});
		expect(transport.send(request)).toBe(true);
		expect(transport.send(request)).toBe(true);
		expect(transport.send(request)).toBe(false);
		expect(stdin.write).toHaveBeenCalledTimes(2);
		stdin.writableLength = 0;
		expect(callbacks).toHaveLength(1);
		callbacks[0]();
		expect(transport.send(request)).toBe(true);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5])(
		"rejects an invalid byte cap %s before starting a server",
		(maxPendingWriteBytes) => {
			expect(
				() =>
					new McpStdioTransport(
						{ command: process.execPath, maxPendingWriteBytes },
						{ onMessage: () => {}, onExit: () => {} },
					),
			).toThrow(RangeError);
		},
	);

	it("keeps zero as a closed outbound queue and refuses invalid byte observations", () => {
		const { transport } = fixture(0);
		expect(transport.send(request)).toBe(false);
		const observed = fixture(frameBytes * 2);
		observed.stdin.writableLength = Number.NaN;
		expect(observed.transport.send(request)).toBe(false);
	});
});
