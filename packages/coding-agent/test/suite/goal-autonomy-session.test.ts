import { readFileSync } from "node:fs";
import { join } from "node:path";
import { takeToolTerminalCause } from "omk-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDurableGoal } from "../../src/core/durable-goal.ts";
import { DurableGoalStore } from "../../src/core/durable-goal-store.ts";
import goalController from "../../src/core/extensions/builtin/goal-controller.ts";
import { createBashTool } from "../../src/core/tools/bash.ts";
import { createHarness, getUserTexts, type Harness } from "./harness.ts";

const store = (h: Harness) => new DurableGoalStore(join(h.tempDir, ".omk", "goals", "current.json"));

async function idle(h: Harness): Promise<void> {
	await vi.waitFor(
		async () => {
			await h.session.agent.waitForIdle();
			expect(h.session.isStreaming).toBe(false);
			expect(h.session.getRunBudgetSnapshot()?.closed ?? true).toBe(true);
			expect(h.session.pendingMessageCount).toBe(0);
		},
		{ timeout: 20_000, interval: 50 },
	);
	await h.session.agent.waitForIdle();
}

function toolResults(h: Harness): Array<{ toolCallId: string; details?: { omk?: unknown } }> {
	return h.session.messages.filter((m) => m.role === "toolResult") as never;
}

describe("spec 119 through a live AgentSession", () => {
	const harnesses: Harness[] = [];
	beforeEach(() => {
		vi.stubEnv("OMK_BASH_SANDBOX", "off");
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "0"); // characterizes the pre-106 path; lifecycle defaults on
		// Default on since flags-default-on: G0 arms opt out explicitly; ON arms stub "1".
		vi.stubEnv("OMK_GOAL_AUTONOMY", "0");
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function make(withGoal: boolean): Promise<Harness> {
		const h = await createHarness({
			persistSession: true,
			tools: [createBashTool(process.cwd())],
			...(withGoal ? { extensionFactories: [goalController] } : {}),
		});
		harnesses.push(h);
		return h;
	}

	it("does not report idle while a prompt is still in preflight before streaming", async () => {
		let entered!: () => void;
		let release!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const h = await createHarness({
			extensionFactories: [
				(omk) => {
					omk.on("before_agent_start", async () => {
						entered();
						await gate;
					});
				},
			],
		});
		harnesses.push(h);
		h.setResponses([fauxAssistantMessage("done")]);
		const run = h.session.prompt("go");
		await started;
		const waiting = idle(h);
		try {
			expect(
				await Promise.race([
					waiting.then(() => "idle"),
					new Promise<string>((resolve) => setImmediate(() => resolve("busy"))),
				]),
			).toBe("busy");
		} finally {
			release();
			await run;
			await waiting;
		}
	});

	it("G0: flag off, a bash timeout keeps the main envelope; the cause stays in memory only", async () => {
		const h = await make(false);
		h.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 5", timeout: 1 }, { id: "bt-off" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await h.session.prompt("run it");
		await idle(h);
		const [result] = toolResults(h);
		expect(result.details?.omk).toEqual({
			schema: "tool-result/v2",
			synthetic: false,
			disposition: "failed",
			executionStarted: true,
		});
		const file = h.sessionManager.getSessionFile();
		expect(file).toBeDefined();
		const text = readFileSync(file as string, "utf8");
		expect(text).toContain("Command timed out after 1 seconds");
		expect(text).not.toMatch(/terminalCause|ToolTerminalError|goal_autonomy/);
		expect(JSON.stringify(h.events)).not.toMatch(/terminalCause/);
		// Flag off: the boundary does not record a cause at all.
		expect(takeToolTerminalCause("bt-off")).toBeUndefined();
	});

	it("flag on: bash abort through the session records an in-memory aborted cause, read once", async () => {
		vi.stubEnv("OMK_GOAL_AUTONOMY", "1");
		const h = await make(false);
		h.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 10" }, { id: "ba-off" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("after"),
		]);
		const run = h.session.prompt("run it");
		await vi.waitFor(() => expect(h.events.some((e) => e.type === "tool_execution_start")).toBe(true), {
			timeout: 10_000,
		});
		await h.session.abort();
		await run.catch(() => undefined);
		await idle(h);
		expect(takeToolTerminalCause("ba-off")).toBe("aborted");
		expect(takeToolTerminalCause("ba-off")).toBeUndefined();
	});

	it("AU4: flag on, a timed-out bash call stops the goal with outcome-unknown and no retry", async () => {
		vi.stubEnv("OMK_GOAL_AUTONOMY", "1");
		const h = await make(true);
		await store(h).create(
			createDurableGoal({ id: "session", objective: "Fix it", maxRounds: 8, now: new Date().toISOString() }),
		);
		h.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 5", timeout: 1 }, { id: "bt-on" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
			fauxAssistantMessage("must not run"),
		]);
		await h.session.prompt("go");
		await idle(h);
		expect(getUserTexts(h)).toEqual(["go"]);
		expect((await store(h).current())?.status).toBe("blocked");
		const entries = h.sessionManager.getEntries().filter((e) => e.type === "custom") as Array<{
			customType: string;
			data: unknown;
		}>;
		expect(entries.at(-1)).toMatchObject({ customType: "goal_autonomy_stop", data: { reason: "outcome-unknown" } });
		expect(h.getPendingResponseCount()).toBe(1);
	});

	it("AU2/G8: an explicit steer mid-goal pauses it; only /goal resume continues", async () => {
		vi.stubEnv("OMK_GOAL_AUTONOMY", "1");
		const h = await make(true);
		await store(h).create(
			createDurableGoal({
				id: "session",
				objective: "Write the report",
				maxRounds: 8,
				now: new Date().toISOString(),
			}),
		);
		h.setResponses([
			async () => {
				await h.session.prompt("actually, change direction", { streamingBehavior: "steer" });
				return fauxAssistantMessage("first");
			},
			fauxAssistantMessage("ack steer"),
			...Array.from({ length: 9 }, (_, i) => fauxAssistantMessage(`round ${i}`)),
		]);
		await h.session.prompt("go");
		await idle(h);
		expect((await store(h).current())?.status).toBe("paused");
		expect(getUserTexts(h)).toEqual(["go", "actually, change direction"]);

		let resolveSettled!: () => void;
		const settled = new Promise<void>((resolve) => {
			resolveSettled = resolve;
		});
		const unsubscribe = h.session.subscribe((event) => {
			if (event.type === "prompt_settled") resolveSettled();
		});
		try {
			await h.session.prompt("/goal resume");
			// Observe the owning run's terminal event, not a partially delivered continuation queue.
			await settled;
			await idle(h);
		} finally {
			unsubscribe();
		}
		expect(getUserTexts(h)).toHaveLength(11);
		expect(getUserTexts(h).slice(2)).toEqual([
			"Continue the active goal (0/8): Write the report",
			...Array.from({ length: 8 }, (_, i) => `Continue the active goal (${i + 1}/8): Write the report`),
		]);
		expect((await store(h).current())?.completedRounds).toBe(8);
	});

	it("AU2: an RPC steer() pauses the goal through the input hook; no late continuation of the revoked round", async () => {
		vi.stubEnv("OMK_GOAL_AUTONOMY", "1");
		const h = await make(true);
		await h.session.prompt("/goal Fix the file");
		await h.session.prompt("/goal verify sleep 3; false");
		let answered = false;
		h.setResponses([
			() => {
				answered = true;
				return fauxAssistantMessage("tried");
			},
			fauxAssistantMessage("answers the steer"),
		]);
		const run = h.session.prompt("go");
		// The settled run's acceptance check is sleeping; the RPC steer lands while it runs.
		await vi.waitFor(() => expect(answered).toBe(true), { timeout: 10_000, interval: 20 });
		await new Promise((resolve) => setTimeout(resolve, 500));
		await h.session.steer("stop, change direction");
		await run;
		await idle(h);
		await vi.waitFor(
			() => {
				const types = (h.sessionManager.getEntries() as Array<{ type: string; customType?: string }>)
					.filter((e) => e.type === "custom")
					.map((e) => e.customType);
				expect(types).toContain("goal_autonomy_revoke");
			},
			{ timeout: 10_000, interval: 50 },
		);
		expect((await store(h).current())?.status).toBe("paused");
		expect(getUserTexts(h).filter((t) => t.startsWith("Continue the active goal"))).toEqual([]);
	});

	it("G0: flag off, an RPC steer() does not pause the goal", async () => {
		const h = await make(true);
		await store(h).create(
			createDurableGoal({ id: "session", objective: "Fix", maxRounds: 8, now: new Date().toISOString() }),
		);
		h.setResponses([
			async () => {
				await h.session.steer("change");
				return fauxAssistantMessage("first");
			},
			...Array.from({ length: 10 }, () => fauxAssistantMessage("ok")),
		]);
		await h.session.prompt("go");
		await idle(h);
		expect((await store(h).current())?.status).toBe("active");
		expect(JSON.stringify(h.sessionManager.getEntries())).not.toContain("goal_autonomy");
	});
});
