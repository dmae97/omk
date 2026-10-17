/** Spec 076 #1 stage 1: the outer timeout result keeps the text the tool streamed. */
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_BYTES } from "../src/harness/utils/truncate.ts";
import { runToolCallWithTimeout } from "../src/tool-timeout.ts";
import type { AgentToolResult, AgentToolUpdateCallback } from "../src/types.ts";

const NOTICE = 'Tool "echo" timed out after 20ms. Cancellation was requested; execution may still be running.';

function run(stream: (onUpdate: AgentToolUpdateCallback<any>) => void) {
	return runToolCallWithTimeout({
		toolCallId: "t1",
		toolName: "echo",
		timeoutMs: 20,
		signal: undefined,
		start: (_signal, onUpdate) => {
			stream(onUpdate);
			return new Promise<AgentToolResult<any>>(() => {});
		},
		emitUpdate: () => {},
		emitLateSettlement: () => {},
		toErrorResult: (e) => ({ content: [{ type: "text", text: String(e) }], details: {} }),
	});
}

function text(result: AgentToolResult<any>): string {
	return result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

describe("timeout result with streamed output", () => {
	it("prepends the last streamed text to the unchanged notice", async () => {
		const outcome = await run((onUpdate) => {
			onUpdate({ content: [{ type: "text", text: "first\n" }], details: undefined });
			onUpdate({ content: [{ type: "text", text: "first\nsecond\n" }], details: undefined });
		});
		expect(outcome.terminalDisposition).toBe("timeout");
		expect(outcome.result.content).toEqual([{ type: "text", text: `first\nsecond\n\n\n${NOTICE}` }]);
		expect(outcome.result.details.omk.disposition).toBe("timeout");
	});

	it("is byte-identical to the plain notice when nothing was streamed", async () => {
		const outcome = await run((onUpdate) => onUpdate({ content: [], details: undefined }));
		expect(outcome.result.content).toEqual([{ type: "text", text: NOTICE }]);
	});

	it("names the full output file when the partial carries one", async () => {
		const outcome = await run((onUpdate) =>
			onUpdate({ content: [{ type: "text", text: "tail" }], details: { fullOutputPath: "/tmp/omk-bash-x.log" } }),
		);
		expect(text(outcome.result)).toBe(`tail\n\n${NOTICE}\nFull output: /tmp/omk-bash-x.log`);
	});

	it("caps streamed text with the default tail limits", async () => {
		const big = `${"x".repeat(100)}\n`.repeat(2000);
		const outcome = await run((onUpdate) =>
			onUpdate({ content: [{ type: "text", text: `${big}LAST` }], details: {} }),
		);
		const body = text(outcome.result).slice(0, -(NOTICE.length + 2));
		expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
		expect(body.endsWith("LAST")).toBe(true);
	});

	it("ignores updates that arrive after the timeout won", async () => {
		let late: AgentToolUpdateCallback<any> | undefined;
		const outcome = await run((onUpdate) => {
			late = onUpdate;
		});
		late?.({ content: [{ type: "text", text: "too late" }], details: undefined });
		expect(outcome.result.content).toEqual([{ type: "text", text: NOTICE }]);
	});
});
