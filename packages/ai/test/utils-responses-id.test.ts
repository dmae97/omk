import { describe, expect, it } from "bun:test";
import { normalizeResponsesToolCallId } from "../src/utils";

describe("normalizeResponsesToolCallId", () => {
	it("preserves existing item prefix when truncating oversized ids", () => {
		const callId = `call_${"a".repeat(80)}`;
		const itemId = `fcr_${"b".repeat(120)}`;

		const normalized = normalizeResponsesToolCallId(`${callId}|${itemId}`);

		expect(normalized.callId.startsWith("call_")).toBe(true);
		expect(normalized.callId.length).toBeLessThanOrEqual(64);
		expect(normalized.itemId.startsWith("fcr_")).toBe(true);
		expect(normalized.itemId.length).toBeLessThanOrEqual(64);
	});

	it("keeps valid responses item ids unchanged", () => {
		const normalized = normalizeResponsesToolCallId("call_abc|fcr_12345");

		expect(normalized.callId).toBe("call_abc");
		expect(normalized.itemId).toBe("fcr_12345");
	});

	it("uses fc-prefixed item id for single-part tool call ids", () => {
		const normalized = normalizeResponsesToolCallId("call_gemini_123");

		expect(normalized.callId.startsWith("call_")).toBe(true);
		expect(normalized.itemId.startsWith("fc_")).toBe(true);
		expect(normalized.itemId).not.toStartWith("item_");
	});

	it("rehashes non-fc item ids to fc-prefixed ids", () => {
		const normalized = normalizeResponsesToolCallId("call_abc|item_legacy");

		expect(normalized.callId).toBe("call_abc");
		expect(normalized.itemId.startsWith("fc_")).toBe(true);
		expect(normalized.itemId).not.toBe("item_legacy");
	});
});
