import { describe, expect, it } from "vitest";
import { createLineDecoder, isJsonRpcResponse } from "../../src/core/mcp/protocol.ts";

/**
 * Required framing/response contracts from the 1.0 readiness audit
 * (T-MCP-F01..F04, T-MCP-J01..J02). The unit under test is byte length of the
 * raw frame, enforced before JSON parsing and independent of chunk splitting.
 */

function response(payload: string): string {
	return JSON.stringify({ jsonrpc: "2.0", id: 1, result: payload });
}

describe("MCP frame byte limit (required contracts)", () => {
	it("rejects a completed frame that exceeds the byte limit before parsing (T-MCP-F01)", () => {
		const decoder = createLineDecoder(64);
		const out = decoder.push(`${response("x".repeat(128))}\n`);
		expect(out.some((entry) => entry.message !== undefined)).toBe(false);
		expect(out.some((entry) => entry.error !== undefined)).toBe(true);
	});

	it("enforces the limit regardless of how the frame is split (T-MCP-F02)", () => {
		const frame = `${response("x".repeat(128))}\n`;
		for (let cut = 1; cut < frame.length; cut++) {
			const decoder = createLineDecoder(64);
			const first = decoder.push(frame.slice(0, cut));
			const second = decoder.push(frame.slice(cut));
			const all = [...first, ...second];
			expect(
				all.some((entry) => entry.message !== undefined),
				`split at ${cut} accepted a frame`,
			).toBe(false);
			expect(
				all.some((entry) => entry.error !== undefined),
				`split at ${cut} produced no error`,
			).toBe(true);
		}
	});

	it("measures the limit in UTF-8 bytes, not JS string length (T-MCP-F03)", () => {
		// "가" is 3 UTF-8 bytes; 30 of them are 90 bytes over a 64-byte cap.
		const decoder = createLineDecoder(64);
		expect(decoder.push("가".repeat(30)).some((entry) => entry.error !== undefined)).toBe(true);
	});

	it("does not retain the payload while discarding an oversized line (T-MCP-F04)", () => {
		const decoder = createLineDecoder(64);
		const first = decoder.push("x".repeat(200)); // no newline: overflow begins
		expect(first.some((entry) => entry.error !== undefined)).toBe(true);
		// Subsequent unterminated chunks are dropped without being stored; only
		// the resynchronization newline ends the discard. No extra errors and no
		// retained payload — verified by recovery of the next real frame.
		expect(decoder.push("y".repeat(500))).toEqual([]);
		const out = decoder.push('end-of-discarded\n{"jsonrpc":"2.0","id":9,"result":null}\n');
		expect(out).toHaveLength(1);
		expect(out[0].message).toMatchObject({ id: 9 });
	});

	it("reports the overflow once and resynchronizes at the next newline", () => {
		const decoder = createLineDecoder(64);
		const out = decoder.push(`${response("x".repeat(128))}\n${response("ok")}\n`);
		expect(out.filter((entry) => entry.error !== undefined)).toHaveLength(1);
		expect(out.filter((entry) => entry.message !== undefined)).toHaveLength(1);
	});

	it("validates maxLineBytes instead of guessing at invalid values", () => {
		for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
			expect(() => createLineDecoder(bad)).toThrow(RangeError);
		}
	});
});

describe("MCP JSON-RPC response shape (required contracts)", () => {
	it("rejects a response carrying both result and error (T-MCP-J01)", () => {
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: 1, error: { code: -1, message: "failure" } })).toBe(
			false,
		);
	});

	it("rejects error: null while preserving valid result values (T-MCP-J02)", () => {
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, error: null })).toBe(false);
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: null })).toBe(true);
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: false })).toBe(true);
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: 0 })).toBe(true);
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: [] })).toBe(true);
	});

	it("rejects malformed error objects and result-less responses", () => {
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, error: [] })).toBe(false);
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, error: { message: "x" } })).toBe(false);
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, error: { code: -1 } })).toBe(false);
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, error: { code: "x", message: "x" } })).toBe(false);
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1 })).toBe(false);
	});
});
