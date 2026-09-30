import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyUsage, type SingleResult } from "../examples/extensions/subagent/subagent-runtime-types.ts";
import { createSubagentStream, SUBAGENT_OUTPUT_LIMITS } from "../examples/extensions/subagent/subagent-stream.ts";

const result = (): SingleResult => ({
	agent: "fixture",
	agentSource: "unknown",
	task: "test",
	exitCode: 0,
	messages: [],
	stderr: "",
	usage: emptyUsage(),
});
const delta = (text: unknown) =>
	`${JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } })}\n`;
const end = () =>
	`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "final" }] } })}\n`;

afterEach(() => vi.restoreAllMocks());

describe("bounded stream progress", () => {
	it("does not allocate a display preview when there is no observer", () => {
		const current = result();
		const stream = createSubagentStream(current);
		stream.stdout(delta("unobserved"));
		expect(current.progress).toBeUndefined();
		stream.stdout(end());
		expect(stream.finish(true)).toBeUndefined();
		expect(current.messages).toHaveLength(1);
	});
	it("shows the first delta immediately without counting it as a receipt", () => {
		const current = result();
		const update = vi.fn();
		const stream = createSubagentStream(current, update);
		stream.stdout(delta("partial"));
		expect(update).toHaveBeenCalledOnce();
		expect(current.progress?.text).toBe("partial");
		expect(current.messages).toEqual([]);
		expect(current.usage.turns).toBe(0);
		expect(stream.finish(true)).toBe("subagent.stream.missing_terminal_message");
		expect(current.progress).toBeUndefined();
	});

	it("coalesces deltas without timers, bounds the retained preview, and flushes message end", () => {
		let time = 0;
		vi.spyOn(performance, "now").mockImplementation(() => time);
		const current = result();
		const previews: string[] = [];
		const stream = createSubagentStream(current, () => previews.push(current.progress?.text ?? "terminal"));
		for (let i = 0; i < 100; i++) stream.stdout(delta("x".repeat(100)));
		expect(previews).toHaveLength(1);
		expect(current.progress?.text.length).toBeLessThanOrEqual(4096);
		time = 100;
		stream.stdout(delta("latest"));
		expect(previews).toHaveLength(2);
		expect(previews[1]).toMatch(/latest$/);
		stream.stdout(end());
		expect(previews).toHaveLength(3);
		expect(previews[2]).toBe("terminal");
		expect(current.messages).toHaveLength(1);
		expect(stream.finish(true)).toBeUndefined();
	});

	it("rejects malformed and post-terminal deltas", () => {
		const malformed = createSubagentStream(result(), () => {});
		expect(() => malformed.stdout(delta(42))).toThrow("invalid_delta");
		malformed.finish(false);
		const stream = createSubagentStream(result(), () => {});
		stream.stdout(end());
		stream.stdout('{"type":"prompt_settled","outcome":"completed"}\n');
		expect(() => stream.stdout(delta("late"))).toThrow("message_after_terminal");
		stream.finish(false);
	});

	it("drops abort/finished display updates without making partial text a terminal message", () => {
		const controller = new AbortController();
		const current = result();
		const update = vi.fn();
		const stream = createSubagentStream(current, update, controller.signal);
		stream.stdout(delta("first"));
		controller.abort();
		stream.stdout(delta("late"));
		stream.stdout(end());
		expect(update).toHaveBeenCalledOnce();
		expect(stream.finish(true)).toBeUndefined();
		expect(current.progress).toBeUndefined();
		expect(() => stream.stdout(delta("after finish"))).toThrow("stream.closed");
	});

	it("does not repeatedly scan the growing line for every tiny fragment", () => {
		const original = Buffer.byteLength;
		let scanned = 0;
		vi.spyOn(Buffer, "byteLength").mockImplementation((value, encoding) => {
			if (typeof value === "string") scanned += value.length;
			return original(value, encoding);
		});
		const stream = createSubagentStream(result(), () => {});
		const line = JSON.stringify({ type: "unknown", data: "x".repeat(8192) });
		for (const char of line) stream.stdout(char);
		stream.stdout("\n");
		expect(stream.finish(false)).toBeUndefined();
		expect(scanned).toBeLessThan(4 * line.length);
	});

	it("still enforces UTF8 line limits across fragments and resets at newline", () => {
		const stream = createSubagentStream(result(), () => {});
		const prefix = '{"type":"unknown","data":"';
		const unicode = "한".repeat(Math.floor((SUBAGENT_OUTPUT_LIMITS.lineBytes - prefix.length - 2) / 3));
		stream.stdout(`${prefix}${unicode}`);
		stream.stdout('"}\n');
		stream.stdout('{"type":"unknown"}\n');
		expect(stream.finish(false)).toBeUndefined();
		const overflow = createSubagentStream(result(), () => {});
		overflow.stdout(`${prefix}${unicode}`);
		expect(() => overflow.stdout("한한")).toThrow("line_limit");
		overflow.finish(false);
	});
});
