import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createReverifyStage,
	FINISH_CHECK_VERIFY_ENTRY,
	type FinishCheckBudget,
} from "../src/core/extensions/builtin/finish-check-reverify-stage.ts";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import {
	FINISH_CHECK_REVERIFY_BLOCK_REASON,
	FINISH_CHECK_REVERIFY_MARKER,
	FINISH_CHECK_REVERIFY_MAX_TOOL_CALLS,
	FINISH_CHECK_REVERIFY_WRAP_UP_MESSAGE,
} from "../src/core/finish-check-reverify.ts";

// spec 032 requirement 3: guards and caps of the verifier turn.

type Handler = (event: unknown, ctx?: unknown) => unknown;
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
	const cwd = mkdtempSync(join(tmpdir(), "omk-reverify-stage-"));
	dirs.push(cwd);
	writeFileSync(join(cwd, "out.txt"), "v1");
	const handlers = new Map<string, Handler[]>();
	const sent: { text: string; deliverAs?: string }[] = [];
	const entries: { type: string; data: Record<string, unknown> }[] = [];
	const omk = {
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		sendUserMessage: (text: string, options?: { deliverAs?: string }) =>
			sent.push({ text, deliverAs: options?.deliverAs }),
		appendEntry: (type: string, data: Record<string, unknown>) => entries.push({ type, data }),
	} as unknown as ExtensionAPI;
	const fire = async (name: string, event: unknown) => {
		const results: unknown[] = [];
		for (const handler of handlers.get(name) ?? []) results.push(await handler(event, {}));
		return results.find((result) => result !== undefined);
	};
	let budget: FinishCheckBudget | undefined = { budgetMs: 900_000, elapsedMs: 180_000, elapsedFraction: 0.2 };
	const setElapsed = (ms: number) => {
		budget = { budgetMs: 900_000, elapsedMs: ms, elapsedFraction: ms / 900_000 };
	};
	const stage = createReverifyStage(omk, () => budget);
	const wraps = () => sent.filter((message) => message.text === FINISH_CHECK_REVERIFY_WRAP_UP_MESSAGE);
	return { cwd, stage, fire, sent, entries, setElapsed, wraps };
}

const startInput = (cwd: string) => ({ task: "Write /app/out.txt", requirements: [], unmeasured: [], cwd });

describe("finish-check reverify stage", () => {
	it("sends the instruction with the deliverables written before it, and blocks write/edit only while active", async () => {
		const run = setup();
		await run.fire("tool_execution_start", { toolName: "write", args: { path: "out.txt" } });
		expect(await run.fire("tool_call", { toolName: "write", input: {} })).toBeUndefined();
		await run.stage.start(startInput(run.cwd));
		expect(run.sent).toHaveLength(1);
		expect(run.sent[0]).toMatchObject({ deliverAs: "followUp" });
		expect(run.sent[0].text.startsWith(FINISH_CHECK_REVERIFY_MARKER)).toBe(true);
		expect(run.sent[0].text).toContain("- out.txt");
		for (const toolName of ["write", "edit"]) {
			expect(await run.fire("tool_call", { toolName, input: {} })).toEqual({
				block: true,
				reason: FINISH_CHECK_REVERIFY_BLOCK_REASON,
			});
		}
		expect(FINISH_CHECK_REVERIFY_BLOCK_REASON).toContain("/tmp/omk-verify/");
		expect(await run.fire("tool_call", { toolName: "bash", input: {} })).toBeUndefined();
		await run.stage.finish([], "VERDICT: PASS");
		expect(await run.fire("tool_call", { toolName: "write", input: {} })).toBeUndefined();
	});

	it("filters the model input only while the verifier runs", async () => {
		const run = setup();
		const messages = [
			{ role: "user", content: "task" },
			{ role: "assistant", content: [{ type: "text", text: "earlier reasoning" }] },
			{ role: "user", content: `${FINISH_CHECK_REVERIFY_MARKER}\nverify` },
		];
		expect(await run.fire("context", { messages })).toBeUndefined();
		await run.stage.start(startInput(run.cwd));
		expect(await run.fire("context", { messages })).toEqual({ messages: messages.slice(2) });
		await run.stage.finish([], "");
		expect(await run.fire("context", { messages })).toBeUndefined();
	});

	it("wraps up once at the tool cap", async () => {
		const run = setup();
		await run.stage.start(startInput(run.cwd));
		for (let i = 1; i < FINISH_CHECK_REVERIFY_MAX_TOOL_CALLS; i++)
			await run.fire("tool_execution_end", { toolName: "bash" });
		expect(run.wraps()).toHaveLength(0);
		await run.fire("tool_execution_end", { toolName: "bash" });
		await run.fire("tool_execution_end", { toolName: "bash" });
		expect(run.wraps()).toEqual([{ text: FINISH_CHECK_REVERIFY_WRAP_UP_MESSAGE, deliverAs: "steer" }]);
	});

	it("wraps up once after 15% of the budget inside the verifier, whichever cap comes first", async () => {
		const run = setup();
		await run.stage.start(startInput(run.cwd));
		run.setElapsed(180_000 + 134_000);
		await run.fire("message_end", { message: { role: "assistant" } });
		expect(run.wraps()).toHaveLength(0);
		run.setElapsed(180_000 + 135_000);
		await run.fire("message_end", { message: { role: "assistant" } });
		for (let i = 0; i < 12; i++) await run.fire("tool_execution_end", { toolName: "bash" });
		expect(run.wraps()).toHaveLength(1);
	});

	it("records the verdict, findings, caps and cost, and voids a verifier that changed a deliverable", async () => {
		const run = setup();
		await run.fire("tool_execution_start", { toolName: "write", args: { path: "out.txt" } });
		await run.stage.start(startInput(run.cwd));
		writeFileSync(join(run.cwd, "out.txt"), "changed by the verifier");
		const reply = "VERIFY 1: FAIL - parse new ELF; expected 0x401000; got 0x400000\nVERDICT: FAIL";
		const usage = { input: 10, output: 5, totalTokens: 15, cost: { total: 0.5 } };
		const outcome = await run.stage.finish([{ role: "assistant", content: [], usage }], reply);
		expect(outcome).toMatchObject({ verdict: "void", mutated: true, failing: [], ledger: [] });
		expect(outcome.findings).toHaveLength(1);
		expect(run.entries).toEqual([
			{
				type: FINISH_CHECK_VERIFY_ENTRY,
				data: expect.objectContaining({
					verdict: "void",
					mutated: true,
					changed: ["out.txt"],
					paths: ["out.txt"],
					toolCalls: 0,
					costUsd: 0.5,
					totalTokens: 15,
				}),
			},
		]);
	});

	it("counts FAIL findings when nothing changed, and forgets written paths for a new task", async () => {
		const run = setup();
		await run.fire("tool_execution_start", { toolName: "write", args: { path: "out.txt" } });
		await run.stage.start(startInput(run.cwd));
		const outcome = await run.stage.finish([], "VERIFY 1: FAIL - x; expected 1; got 2");
		expect(outcome).toMatchObject({ verdict: "fail", mutated: false, failing: [{ id: 1, status: "fail" }] });
		expect(run.stage.started).toBe(true);
		run.stage.reset();
		expect(run.stage.started).toBe(false);
		await run.stage.start({ ...startInput(run.cwd), task: "other" });
		expect(run.sent.at(-1)?.text).not.toContain("- out.txt");
	});
});
