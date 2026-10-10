import type { AgentTool } from "omk-agent-core";
import { type Context, fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import finishCheck from "../src/core/extensions/builtin/finish-check.ts";
import { FINISH_CHECK_REVERIFY_BLOCK_REASON, FINISH_CHECK_REVERIFY_MARKER } from "../src/core/finish-check-reverify.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

// spec 032 AC6 and AC7 through a real session: the verifier's model input and its read-only guard.

const TASK = "Write the symbol table to out.txt.";

function writeTool(runs: string[]): AgentTool {
	return {
		name: "write",
		label: "Write",
		description: "Write a file",
		parameters: Type.Object({ path: Type.String() }),
		execute: async (_toolCallId, params) => {
			runs.push(String((params as { path: string }).path));
			return { content: [{ type: "text", text: "ok" }], details: {} };
		},
	};
}

function texts(context: Context): string[] {
	return context.messages.map((message) => {
		const content = (message as { content: unknown }).content;
		if (typeof content === "string") return content;
		return (content as { type: string; text?: string }[]).map((part) => part.text ?? "").join("");
	});
}

describe("finish-check reverify in a session", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("shows the verifier only its instruction, blocks write, and gives the fix turn the full history", async () => {
		const runs: string[] = [];
		const seen: string[][] = [];
		const capture = (context: Context) => seen.push(texts(context));
		const harness = await createHarness({
			tools: [writeTool(runs)],
			extensionFactories: [
				(omk) =>
					finishCheck(omk, {
						env: {
							OMK_FINISH_CHECK_REVERIFY: "on",
							OMK_FINISH_CHECK_EXTRA_TURN: "on",
							OMK_TIME_BUDGET_SEC: "900",
						},
						now: () => 0,
					}),
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "out.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done: earlier reasoning about 0x400000"),
			fauxAssistantMessage("check turn summary QX7"),
			(context) => {
				capture(context);
				return fauxAssistantMessage([fauxToolCall("write", { path: "out.txt" })], { stopReason: "toolUse" });
			},
			(context) => {
				capture(context);
				return fauxAssistantMessage("VERIFY 1: FAIL - new input; expected 3 symbols; got 2\nVERDICT: FAIL");
			},
			(context) => {
				capture(context);
				return fauxAssistantMessage("fixed");
			},
		]);

		await harness.session.prompt(TASK);

		expect(harness.faux.state.callCount).toBe(6);
		const [verifierStart, verifierAfterTool, fixTurn] = seen;
		expect(verifierStart).toHaveLength(1);
		expect(verifierStart[0].startsWith(FINISH_CHECK_REVERIFY_MARKER)).toBe(true);
		expect(verifierStart[0]).toContain(TASK);
		for (const view of [verifierStart, verifierAfterTool]) {
			expect(view.join("\n")).not.toContain("earlier reasoning");
			expect(view.join("\n")).not.toContain("QX7");
		}
		// The verifier's own round-trip is kept, and its write was blocked.
		expect(verifierAfterTool).toHaveLength(3);
		expect(verifierAfterTool[2]).toContain(FINISH_CHECK_REVERIFY_BLOCK_REASON);
		expect(runs).toEqual(["out.txt"]);
		// The fix turn sees the whole conversation again, plus the findings.
		expect(fixTurn.join("\n")).toContain("earlier reasoning");
		expect(fixTurn.at(-1)).toContain("VERIFY 1: FAIL - new input; expected 3 symbols; got 2");
		expect(harness.session.isStreaming).toBe(false);
	});
});
