import { afterEach, expect, it, vi } from "vitest";
import { emptyUsage, type SingleResult } from "../examples/extensions/subagent/subagent-runtime-types.ts";
import { createSubagentStream } from "../examples/extensions/subagent/subagent-stream.ts";

afterEach(() => vi.restoreAllMocks());

it("keeps UTF8 byte accounting linear for a fragmented large JSON message", () => {
	const result: SingleResult = {
		agent: "fixture",
		agentSource: "project",
		task: "fragmented output",
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
	};
	const text = "한글😀".repeat(40_000);
	const line = `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } })}\n`;
	const byteLength = Buffer.byteLength;
	const lineBytes = byteLength(line);
	let measuredBytes = 0;
	vi.spyOn(Buffer, "byteLength").mockImplementation((value, encoding) => {
		const bytes = byteLength(value, encoding);
		measuredBytes += bytes;
		return bytes;
	});
	const stream = createSubagentStream(result, () => {});
	// Keep surrogate pairs intact, as Node's setEncoding("utf8") guarantees.
	for (let offset = 0; offset < line.length; ) {
		let end = Math.min(line.length, offset + 1024);
		const last = line.charCodeAt(end - 1);
		if (last >= 0xd800 && last <= 0xdbff) end--;
		stream.stdout(line.slice(offset, end));
		offset = end;
	}
	expect(stream.finish(true)).toBeUndefined();
	expect(result.messages[0].content).toEqual([{ type: "text", text }]);
	expect(result.stream?.stdoutBytes).toBe(lineBytes);
	// A byte counter must scan each incoming fragment, not the accumulated prefix.
	expect(measuredBytes).toBeLessThanOrEqual(lineBytes * 3);
});
