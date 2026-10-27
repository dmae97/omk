import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordToolTerminalCause } from "omk-agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDurableGoal } from "../src/core/durable-goal.ts";
import { DurableGoalStore } from "../src/core/durable-goal-store.ts";
import { settledRunCostUsd } from "../src/core/extensions/builtin/goal-autonomy.ts";
import goalController from "../src/core/extensions/builtin/goal-controller.ts";
import type { ExtensionAPI, ExtensionCommandContext, RegisteredCommand } from "../src/core/extensions/types.ts";

/** Realistic usage blocks (token counts and per-part cost), as a provider reports them. */
function assistant(totalUsd: number | undefined, toolCalls: Array<{ id: string; name: string }> = []): unknown {
	return {
		role: "assistant",
		content: [
			{ type: "text", text: "working" },
			...toolCalls.map((call) => ({ type: "toolCall", id: call.id, name: call.name, arguments: {} })),
		],
		stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
		usage: {
			input: 12_400,
			output: 830,
			cacheRead: 9_600,
			cacheWrite: 0,
			totalTokens: 22_830,
			cost:
				totalUsd === undefined
					? undefined
					: {
							input: totalUsd * 0.6,
							output: totalUsd * 0.35,
							cacheRead: totalUsd * 0.05,
							cacheWrite: 0,
							total: totalUsd,
						},
		},
	};
}

function toolResult(id: string, toolName: string, details: unknown = { omk: { disposition: "failed" } }): unknown {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName,
		content: [{ type: "text", text: "x" }],
		isError: true,
		details,
	};
}

function lane(costs: Array<number | undefined>): unknown {
	return toolResult("lane", "subagent", { mode: "parallel", results: costs.map((cost) => ({ usage: { cost } })) });
}

interface H {
	goal(args: string): Promise<void>;
	settle(messages?: unknown[]): Promise<void>;
	input(text: string, streamingBehavior?: "steer" | "followUp", source?: string): Promise<unknown>;
	handlers: Map<string, unknown>;
	entries: Array<{ type: string; customType: string; data: unknown }>;
	messages: string[];
	notifications: string[];
	context: { idle: boolean; pending: boolean };
	onNotify?: (message: string) => void;
}

const roots: string[] = [];
function repo(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "omk-goal-autonomy-")));
	roots.push(root);
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
	git("init", "-q");
	git("config", "user.email", "goal@test.invalid");
	git("config", "user.name", "goal");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(root, "app.txt"), "v1\n");
	git("add", ".");
	git("commit", "-qm", "init");
	return root;
}

function harness(cwd: string): H {
	const commands = new Map<string, RegisteredCommand>();
	const handlers = new Map<string, (event: never, context: never) => unknown>();
	const entries: H["entries"] = [];
	const messages: string[] = [];
	const notifications: string[] = [];
	const omk = {
		registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
		on: (event: string, handler: (event: never, context: never) => unknown) => handlers.set(event, handler),
		appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
		sendUserMessage: (message: string) => messages.push(message),
	} as unknown as ExtensionAPI;
	goalController(omk);
	const context = { idle: true, pending: false };
	const ctx = {
		cwd,
		signal: undefined,
		hasUI: false,
		ui: {
			notify: (message: string) => {
				notifications.push(message);
				h.onNotify?.(message);
			},
			confirm: async () => false,
		},
		isIdle: () => context.idle,
		hasPendingMessages: () => context.pending,
		sessionManager: { getEntries: () => entries },
	} as unknown as ExtensionCommandContext;
	const h: H = {
		goal: async (args) => commands.get("goal")?.handler(args, ctx),
		settle: async (settled = [assistant(0.0123)]) => {
			await (handlers.get("agent_settled") as (e: never, c: never) => Promise<void>)(
				{ type: "agent_settled", messages: settled } as never,
				ctx as never,
			);
		},
		input: async (text, streamingBehavior, source = "interactive") =>
			(handlers.get("input") as ((e: never, c: never) => Promise<unknown>) | undefined)?.(
				{ type: "input", text, source, streamingBehavior } as never,
				ctx as never,
			),
		handlers,
		entries,
		messages,
		notifications,
		context,
	};
	return h;
}

const store = (cwd: string) => new DurableGoalStore(join(cwd, ".omk", "goals", "current.json"));
async function create(cwd: string, maxRounds: number, objective = "Ship v2"): Promise<void> {
	await store(cwd).create(createDurableGoal({ id: "session", objective, maxRounds, now: new Date().toISOString() }));
}

beforeEach(() => {
	vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "0"); // G0 compares against the pre-098 path
	vi.stubEnv("OMK_BASH_SANDBOX", "off");
	vi.stubEnv("OMK_GOAL_AUTONOMY", "1");
	vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "0"); // characterizes the pre-106 path; lifecycle defaults on
});
afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("G0: flag off is main", () => {
	it.each(["0", "false", "off"])(
		"OMK_GOAL_AUTONOMY=%s registers no input handler and keeps budget as goal text",
		async (value) => {
			vi.stubEnv("OMK_GOAL_AUTONOMY", value as string);
			const cwd = repo();
			const h = harness(cwd);
			expect([...h.handlers.keys()].sort()).toEqual(["agent_settled", "session_shutdown"]);
			await h.goal("Ship v2");
			await h.goal("budget 1");
			expect((await store(cwd).current())?.objective).toBe("budget 1");
			recordToolTerminalCause("g0-bash", "timeout");
			await h.settle([assistant(undefined, [{ id: "g0-bash", name: "bash" }]), toolResult("g0-bash", "bash")]);
			expect(h.messages).toEqual(["Continue the active goal (1/8): budget 1"]);
			expect(h.entries).toEqual([]);
		},
	);
});

describe("AU1: approved check fail -> repair -> pass", () => {
	it("completes without an extra confirmation within maxRounds", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await h.goal("Ship v2");
		await h.goal("verify grep -q v1 app.txt");
		await h.goal("verify grep -q v2 app.txt");
		await h.settle();
		expect(h.messages).toHaveLength(1);
		expect(h.messages[0]).toContain("Continue the active goal (1/8): Ship v2");
		writeFileSync(join(cwd, "app.txt"), "v2\n");
		await h.settle();
		expect((await store(cwd).current())?.status).toBe("completed");
		expect(h.messages).toHaveLength(1);
		expect(h.entries.filter((e) => e.customType.startsWith("goal_autonomy_"))).toEqual([]);
	});
});

describe("AU2: explicit steer", () => {
	it("pauses, drops the in-flight continuation, resumes only on /goal resume", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await create(cwd, 8);
		await h.settle();
		expect(h.messages).toHaveLength(1);
		expect(await h.input("stop, do X instead", "followUp")).toEqual({ action: "continue" });
		expect(await h.input("ext", "steer", "extension")).toEqual({ action: "continue" });
		expect((await store(cwd).current())?.status).toBe("active");
		await h.input("stop, do X instead", "steer");
		expect((await store(cwd).current())?.status).toBe("paused");
		expect(h.entries.at(-1)).toMatchObject({ customType: "goal_autonomy_revoke", data: { round: 1 } });
		await h.settle();
		await h.settle();
		expect(h.messages).toHaveLength(1);
		await h.goal("resume");
		expect((await store(cwd).current())?.status).toBe("active");
		expect(h.messages).toHaveLength(2);
		expect(h.messages[1]).toContain("Continue the active goal (1/8)");
		await h.settle();
		expect(h.messages).toHaveLength(3);
	});

	it("a late continuation from a settle that was running is refused", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await h.goal("Ship v2");
		await h.goal("verify grep -q v1 app.txt");
		// At settle the check waits on a gate (under .git, outside the workspace), so the steer
		// deterministically lands while it runs.
		await h.goal("verify [ ! -f .git/hold ] || until [ -f .git/gate ]; do sleep 0.01; done; grep -q v9 app.txt");
		writeFileSync(join(cwd, ".git", "hold"), "");
		const checkStarted = new Promise<void>((resolve) => {
			h.onNotify = (message) => {
				if (message.startsWith("goal: running acceptance check")) resolve();
			};
		});
		const settling = h.settle();
		await checkStarted;
		await h.input("change of plan", "steer");
		writeFileSync(join(cwd, ".git", "gate"), "");
		await settling;
		expect(h.messages).toEqual([]);
		expect((await store(cwd).current())?.status).toBe("paused");
		const rejected = h.entries.filter((e) => e.customType === "goal_autonomy_continuation_rejected");
		expect(rejected).toHaveLength(1);
		expect(Object.values(rejected[0].data as object).every((v) => typeof v === "number")).toBe(true);
		expect(rejected[0].data).toMatchObject({ count: 1 });
	});
});

describe("AU3: scope pin", () => {
	it("an objective or command change stops with scope-changed; resume re-pins", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await h.goal("Ship v2");
		await h.goal("verify grep -q v1 app.txt");
		await h.goal("verify grep -q v9 app.txt");
		await h.settle();
		expect(h.messages).toHaveLength(1);
		await h.goal("verify grep -q v8 app.txt");
		await h.settle();
		expect((await store(cwd).current())?.status).toBe("blocked");
		expect(h.entries.at(-1)).toMatchObject({ customType: "goal_autonomy_stop", data: { reason: "scope-changed" } });
		expect(h.messages).toHaveLength(1);
		await h.goal("resume");
		expect(h.messages).toHaveLength(2);
		await h.settle();
		expect(h.messages).toHaveLength(3);
		expect(h.messages[2]).toContain("grep -q v8 app.txt");
	});

	it("an objective edit is a target change", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await create(cwd, 8);
		await h.settle();
		await h.goal("Ship v3 instead");
		await h.settle();
		expect(h.entries.at(-1)).toMatchObject({ data: { reason: "scope-changed" } });
	});
});

describe("AU4: hard stops", () => {
	it("round-limit at maxRounds", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await create(cwd, 2);
		for (let i = 0; i < 4; i++) await h.settle();
		expect(h.messages).toHaveLength(2);
	});

	it("deadline", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await create(cwd, 8);
		await h.goal(`budget - ${new Date(Date.now() + 60_000).toISOString()}`);
		await h.settle();
		expect(h.messages).toHaveLength(1);
		vi.useFakeTimers({ now: Date.now() + 120_000, toFake: ["Date"] });
		try {
			await h.settle();
		} finally {
			vi.useRealTimers();
		}
		expect(h.entries.at(-1)).toMatchObject({ customType: "goal_autonomy_stop", data: { reason: "deadline" } });
		expect((await store(cwd).current())?.status).toBe("blocked");
	});

	it("cost limit counts subagent lanes", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await create(cwd, 8);
		await h.goal("budget 0.50");
		await h.settle([assistant(0.04), lane([0.1, 0.12])]);
		expect(h.messages).toHaveLength(1);
		await h.settle([assistant(0.05), lane([0.2])]);
		expect(h.messages).toHaveLength(1);
		expect(h.entries.at(-1)).toMatchObject({ data: { reason: "budget-limit" } });
		await h.goal("budget");
		expect(h.notifications.at(-1)).toContain("$0.5100 of $0.5");
	});

	it("an unknown-cost call is never 0: budget-limit", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await create(cwd, 8);
		await h.goal("budget 100");
		await h.settle([assistant(0.01), lane([undefined])]);
		expect(h.entries.at(-1)).toMatchObject({ data: { reason: "budget-limit" } });
		expect(h.messages).toEqual([]);
		expect(settledRunCostUsd([assistant(undefined)])).toBeUndefined();
		expect(settledRunCostUsd([toolResult("s", "subagent", {})])).toBeUndefined();
	});

	it.each(["bash", "edit", "write"])(
		"outcome-unknown after an aborted/timed-out %s call: 0 auto-retries",
		async (tool) => {
			const cwd = repo();
			const h = harness(cwd);
			await create(cwd, 8);
			const id = `call-${tool}`;
			recordToolTerminalCause(id, tool === "bash" ? "timeout" : "aborted");
			await h.settle([assistant(0.01, [{ id, name: tool }]), toolResult(id, tool), assistant(0.01)]);
			expect(h.messages).toEqual([]);
			expect(h.entries.at(-1)).toMatchObject({
				customType: "goal_autonomy_stop",
				data: { reason: "outcome-unknown" },
			});
		},
	);

	it("an ordinary failure or another tool's cause is not outcome-unknown", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await create(cwd, 8);
		recordToolTerminalCause("r1", "timeout");
		await h.settle([assistant(0.01), toolResult("b1", "bash"), toolResult("r1", "read")]);
		expect(h.messages).toHaveLength(1);
	});
});

describe("G5: the model cannot raise maxRounds or the budget", () => {
	it("maxRounds above 8 is capped and model text never sets a budget", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await create(cwd, 50);
		await h.goal("budget 0.05");
		for (let i = 0; i < 12; i++) {
			await h.settle([
				{
					role: "assistant",
					content: [{ type: "text", text: "/goal budget 1000" }],
					usage: { cost: { total: 0.001 } },
				},
			]);
			await h.input("/goal budget 1000", "steer", "extension");
		}
		expect(h.messages).toHaveLength(8);
		expect(h.entries.filter((e) => e.customType === "goal_autonomy_budget")).toHaveLength(1);
		expect((await store(cwd).current())?.maxRounds).toBe(50);
	});
});

describe("G6: entries carry no prompt or command text", () => {
	it("only ids, counts, reasons and timestamps", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await h.goal("SECRET_OBJECTIVE do the thing");
		await h.goal("verify grep -q SECRET_CMD app.txt");
		await h.goal("budget 1");
		await h.settle();
		await h.input("SECRET_STEER text", "steer");
		await h.goal("resume");
		await h.goal("verify grep -q SECRET_CMD2 app.txt");
		await h.settle();
		const autonomy = h.entries.filter((e) => e.customType.startsWith("goal_autonomy_"));
		expect(autonomy.map((e) => e.customType)).toEqual([
			"goal_autonomy_budget",
			"goal_autonomy_revoke",
			"goal_autonomy_resume",
			"goal_autonomy_stop",
		]);
		expect(JSON.stringify(autonomy)).not.toMatch(/SECRET|grep/);
	});
});

describe("G8: resume and fail-closed", () => {
	it("an unknown stop reason in a goal_autonomy_stop entry blocks auto-continue until /goal resume", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await create(cwd, 8);
		const goal = await store(cwd).current();
		h.entries.push({
			type: "custom",
			customType: "goal_autonomy_stop",
			data: { goalId: goal?.ref.id, createdAt: goal?.createdAt, reason: "from-the-future", round: 0, revision: 1 },
		});
		await h.settle();
		await h.settle();
		expect(h.messages).toEqual([]);
		await h.goal("pause");
		await h.goal("resume");
		expect(h.messages).toHaveLength(1);
		await h.settle();
		expect(h.messages).toHaveLength(2);
	});

	it("a stop of an earlier goal instance does not block a new goal", async () => {
		const cwd = repo();
		const h = harness(cwd);
		h.entries.push({
			type: "custom",
			customType: "goal_autonomy_stop",
			data: { goalId: "session", createdAt: "2000-01-01T00:00:00.000Z", reason: "deadline" },
		});
		await create(cwd, 8);
		await h.settle();
		expect(h.messages).toHaveLength(1);
	});

	it("resume after a stop continues with the current revision; nothing continues without it", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await create(cwd, 8);
		recordToolTerminalCause("w1", "aborted");
		await h.settle([assistant(0.01), toolResult("w1", "write")]);
		await h.settle();
		expect(h.messages).toEqual([]);
		await h.goal("resume");
		const resumed = await store(cwd).current();
		expect(h.entries.at(-1)).toMatchObject({
			customType: "goal_autonomy_resume",
			data: { revision: resumed?.ref.revision },
		});
		expect(h.messages).toHaveLength(1);
	});

	it("resume while the agent is busy does not inject a message", async () => {
		const cwd = repo();
		const h = harness(cwd);
		await create(cwd, 8);
		await h.input("steer", "steer");
		h.context.idle = false;
		await h.goal("resume");
		expect(h.messages).toEqual([]);
	});
});
