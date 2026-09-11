import type { AgentTool } from "omk-agent-core";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { PromptSettledEvent } from "../src/core/prompt-settlement.ts";
import { PromptExecutionBusyError, SessionPromptLifecycle } from "../src/core/session-prompt-lifecycle.ts";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function tool(execute: () => Promise<void>): AgentTool {
	return {
		name: "owned",
		label: "Owned",
		description: "Test execution ownership",
		parameters: Type.Object({}),
		execute: async () => {
			await execute();
			return { content: [{ type: "text", text: "done" }], details: {} };
		},
	};
}

describe("prompt execution ownership", () => {
	it("keeps two executions distinct even when the model reuses the same toolCallId", async () => {
		const lifecycle = new SessionPromptLifecycle();
		const run = lifecycle.begin("first");
		const firstGate = deferred();
		const secondGate = deferred();
		const first = lifecycle.wrapTool(tool(() => firstGate.promise)).execute("same", {});
		const second = lifecycle.wrapTool(tool(() => secondGate.promise)).execute("same", {});
		const events: PromptSettledEvent[] = [];
		run.finish("failed", (event) => {
			events.push(event);
		});
		firstGate.resolve();
		await first;
		lifecycle.flush();
		lifecycle.flush();
		expect(events).toEqual([]);
		expect(() => lifecycle.begin("competing")).toThrow(PromptExecutionBusyError);
		secondGate.resolve();
		await second;
		lifecycle.flush();
		lifecycle.flush();
		expect(events.map((event) => event.promptRunId)).toEqual(["first"]);
		const next = lifecycle.begin("next");
		run.finish("completed", () => {
			throw new Error("stale callback");
		});
		expect(() => lifecycle.begin("third")).toThrow(PromptExecutionBusyError);
		next.finish("completed", (event) => {
			events.push(event);
		});
		expect(events.map((event) => event.outcome)).toEqual(["failed", "completed"]);
	});

	it("rejects new execution after the root seals admission", async () => {
		const lifecycle = new SessionPromptLifecycle();
		const run = lifecycle.begin("run");
		const gate = deferred();
		let starts = 0;
		const wrapped = lifecycle.wrapTool(
			tool(async () => {
				starts += 1;
				await gate.promise;
			}),
		);
		const pending = wrapped.execute("first", {});
		run.finish("aborted", () => {});
		await expect(wrapped.execute("late", {})).rejects.toThrow(PromptExecutionBusyError);
		expect(starts).toBe(1);
		gate.resolve();
		await pending;
		lifecycle.flush();
	});

	it("returns execution ownership on rejection without replacing the failed outcome", async () => {
		const lifecycle = new SessionPromptLifecycle();
		const run = lifecycle.begin("run");
		const wrapped = lifecycle.wrapTool(
			tool(async () => {
				throw new Error("failure");
			}),
		);
		await expect(wrapped.execute("call", {})).rejects.toThrow("failure");
		const events: PromptSettledEvent[] = [];
		run.finish("failed", (event) => {
			events.push(event);
		});
		expect(events[0]?.outcome).toBe("failed");
	});

	it("retains open producers and suppresses callbacks after disposal", () => {
		let ready = false;
		const lifecycle = new SessionPromptLifecycle({ canSettle: () => ready });
		const run = lifecycle.begin("run");
		const events: PromptSettledEvent[] = [];
		lifecycle.flush();
		run.finish("completed", (event) => {
			events.push(event);
		});
		expect(events).toEqual([]);
		lifecycle.dispose();
		ready = true;
		lifecycle.flush();
		expect(events).toEqual([]);
		expect(() => lifecycle.begin("after-dispose")).toThrow(PromptExecutionBusyError);
	});

	it("settles after real termination when late audit is explicitly disabled", async () => {
		const lifecycle = new SessionPromptLifecycle({ auditsLateSettlement: () => false });
		const run = lifecycle.begin("run");
		const gate = deferred();
		const pending = lifecycle.wrapTool(tool(() => gate.promise)).execute("call", {});
		const events: PromptSettledEvent[] = [];
		run.finish("aborted", (event) => {
			events.push(event);
		});
		expect(events).toEqual([]);
		gate.resolve();
		await pending;
		expect(events[0]?.outcome).toBe("aborted");
	});
});
