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
	it("keeps context-sensitive timeouts lazy and preserves tool metadata", () => {
		let reads = 0;
		let timeout = 100;
		let stale = false;
		const original: AgentTool = {
			...tool(async () => {}),
			executionMode: "parallel",
			prepareArguments: () => ({}),
			resourceClaims: () => [],
			get timeoutMs() {
				reads += 1;
				if (stale) throw new Error("stale context");
				return timeout;
			},
		};
		const wrapped = new SessionPromptLifecycle().wrapTool(original);
		expect(reads).toBe(0);
		expect(wrapped.timeoutMs).toBe(100);
		timeout = 0;
		expect(wrapped.timeoutMs).toBe(0);
		stale = true;
		expect(() => wrapped.timeoutMs).toThrow("stale context");
		expect(wrapped.prepareArguments).toBe(original.prepareArguments);
		expect(wrapped.resourceClaims).toBe(original.resourceClaims);
		expect(wrapped.executionMode).toBe("parallel");
	});
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

	it("does not settle a new owner's waiters registered by the terminal callback", async () => {
		const lifecycle = new SessionPromptLifecycle();
		const first = lifecycle.begin("first");
		const firstIdle = lifecycle.waitForIdle();
		let next: ReturnType<SessionPromptLifecycle["begin"]> | undefined;
		let nextSettled = false;
		first.finish("completed", () => {
			next = lifecycle.begin("next");
			void lifecycle.waitForIdle().then(() => {
				nextSettled = true;
			});
		});
		await firstIdle;
		expect(nextSettled).toBe(false);
		next?.finish("completed", () => {});
		await Promise.resolve();
		expect(nextSettled).toBe(true);
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

	it("reports owner identity and resolves an already idle wait", async () => {
		const lifecycle = new SessionPromptLifecycle();
		expect(lifecycle.active).toBe(false);
		expect(lifecycle.activePromptRunId).toBeUndefined();
		await lifecycle.waitForIdle();
		const run = lifecycle.begin("identity");
		expect(lifecycle.active).toBe(true);
		expect(lifecycle.activePromptRunId).toBe("identity");
		run.finish("completed", () => {});
		expect(lifecycle.active).toBe(false);
		expect(lifecycle.activePromptRunId).toBeUndefined();
	});

	it.each(["noteDetachedChild", "noteDetachedShard"] as const)(
		"keeps %s ownership until both idempotent releases",
		(method) => {
			const lifecycle = new SessionPromptLifecycle();
			const idleRelease = lifecycle[method]();
			idleRelease();
			const run = lifecycle.begin("owned");
			const first = lifecycle[method]();
			const second = lifecycle[method]();
			const events: PromptSettledEvent[] = [];
			run.finish("aborted", (event) => events.push(event));
			expect(lifecycle.active).toBe(true);
			expect(events).toEqual([]);
			first();
			first();
			expect(events).toEqual([]);
			second();
			second();
			expect(events.map((event) => event.promptRunId)).toEqual(["owned"]);
			expect(lifecycle.active).toBe(false);
		},
	);

	it("waits for the default late audit before notifying a finished producer", async () => {
		const lifecycle = new SessionPromptLifecycle();
		const run = lifecycle.begin("audit");
		const gate = deferred();
		const pending = lifecycle.wrapTool(tool(() => gate.promise)).execute("call", {});
		const events: PromptSettledEvent[] = [];
		run.finish("aborted", (event) => events.push(event));
		gate.resolve();
		await pending;
		expect(events).toEqual([]);
		lifecycle.flush();
		expect(events.map((event) => event.outcome)).toEqual(["aborted"]);
	});

	it("allows idle wrapped tools and refuses them after disposal", async () => {
		const lifecycle = new SessionPromptLifecycle();
		let started = 0;
		const wrapped = lifecycle.wrapTool(
			tool(async () => {
				started += 1;
			}),
		);
		await wrapped.execute("idle", {});
		expect(started).toBe(1);
		lifecycle.dispose();
		await expect(wrapped.execute("disposed", {})).rejects.toThrow(PromptExecutionBusyError);
		expect(started).toBe(1);
	});

	it("releases idle waiters even when the terminal notification throws", async () => {
		const lifecycle = new SessionPromptLifecycle();
		const run = lifecycle.begin("throwing-notify");
		const idle = lifecycle.waitForIdle();
		expect(() =>
			run.finish("failed", () => {
				throw new Error("notify");
			}),
		).toThrow("notify");
		await idle;
		expect(lifecycle.active).toBe(false);
	});

	it("latches the first finish while real tool ownership is still active", async () => {
		const lifecycle = new SessionPromptLifecycle();
		const run = lifecycle.begin("latched");
		const gate = deferred();
		const pending = lifecycle.wrapTool(tool(() => gate.promise)).execute("call", {});
		const outcomes: string[] = [];
		run.finish("aborted", (event) => outcomes.push(event.outcome));
		run.finish("completed", (event) => outcomes.push(event.outcome));
		gate.resolve();
		await pending;
		lifecycle.flush();
		expect(outcomes).toEqual(["aborted"]);
	});

	it("keeps a recognizable busy error for callers and diagnostics", () => {
		const error = new PromptExecutionBusyError();
		expect(error.name).toBe("PromptExecutionBusyError");
		expect(error.message).toContain("actual termination");
	});
});
