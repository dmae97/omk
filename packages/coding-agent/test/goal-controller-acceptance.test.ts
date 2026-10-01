import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDurableGoal, nextDurableGoalTimestamp } from "../src/core/durable-goal.ts";
import { DurableGoalStore } from "../src/core/durable-goal-store.ts";
import goalController, { type GoalControllerOptions } from "../src/core/extensions/builtin/goal-controller.ts";
import type { ExtensionAPI, ExtensionCommandContext, RegisteredCommand } from "../src/core/extensions/types.ts";
import { GoalVerifier } from "../src/core/goal-verification.ts";
import { createWorkspaceSandboxPolicy } from "../src/core/sandbox/default-policy.ts";

interface Harness {
	readonly goal: (args: string) => Promise<void>;
	readonly settle: () => Promise<void>;
	readonly notifications: Array<{ readonly message: string; readonly level: string }>;
	readonly entries: Array<{ readonly type: string; readonly data: unknown }>;
	readonly messages: string[];
	readonly context: { idle: boolean; signal: AbortSignal | undefined; pending: boolean };
}

const roots: string[] = [];

function gitRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "omk-goal-accept-"));
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

function harness(cwd: string, options: GoalControllerOptions = {}): Harness {
	const commands = new Map<string, RegisteredCommand>();
	const handlers = new Map<string, (event: never, context: never) => unknown>();
	const notifications: Harness["notifications"] = [];
	const entries: Harness["entries"] = [];
	const messages: string[] = [];
	const omk = {
		registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
		on: (event: string, handler: (event: never, context: never) => unknown) => handlers.set(event, handler),
		appendEntry: (type: string, data: unknown) => entries.push({ type, data }),
		sendUserMessage: (message: string) => messages.push(message),
	} as unknown as ExtensionAPI;
	goalController(omk, options);
	const context: Harness["context"] = { idle: true, signal: undefined, pending: false };
	const ctx = {
		cwd,
		get signal() {
			return context.signal;
		},
		hasUI: false,
		ui: {
			notify: (message: string, level: string) => notifications.push({ message, level }),
			confirm: async () => false,
		},
		isIdle: () => context.idle,
		hasPendingMessages: () => context.pending,
	} as unknown as ExtensionCommandContext;
	return {
		goal: async (args) => {
			const command = commands.get("goal");
			if (!command) throw new Error("goal command missing");
			await command.handler(args, ctx);
		},
		settle: async () => {
			const handler = handlers.get("agent_settled");
			if (!handler) throw new Error("agent_settled handler missing");
			await handler({ type: "agent_settled", messages: [] } as never, ctx as never);
		},
		notifications,
		entries,
		messages,
		context,
	};
}

function lastNotice(h: Harness): string {
	return h.notifications.at(-1)?.message ?? "";
}

function store(cwd: string): DurableGoalStore {
	return new DurableGoalStore(join(cwd, ".omk", "goals", "current.json"));
}

beforeEach(() => {
	vi.stubEnv("OMK_BASH_SANDBOX", "off");
});

afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("/goal acceptance checks", () => {
	it("attaches a passing check as evidence and completes on it", async () => {
		const cwd = gitRepo();
		const h = harness(cwd);
		await h.goal("Ship the app");

		await h.goal("verify grep -q v1 app.txt");

		const verified = await store(cwd).current();
		expect(verified?.evidence).toHaveLength(1);
		expect(lastNotice(h)).toContain("acceptance check passed");
		expect(h.entries).toEqual([
			{
				type: "goal_verification",
				data: expect.objectContaining({ passed: true, status: "passed", exitCode: 0, trigger: "command" }),
			},
		]);

		await h.goal("complete");
		expect((await store(cwd).current())?.status).toBe("completed");
	});

	it("refuses completion once the workspace changed after the passing check", async () => {
		const cwd = gitRepo();
		const h = harness(cwd);
		await h.goal("Ship the app");
		await h.goal("verify grep -q v1 app.txt");

		writeFileSync(join(cwd, "extra.txt"), "late edit\n");
		await h.goal("");
		expect(lastNotice(h)).toContain("evidence: the workspace changed after the acceptance check passed");
		await h.goal("complete");

		expect(lastNotice(h)).toContain("the workspace changed after the acceptance check passed; run /goal verify");
		expect((await store(cwd).current())?.status).toBe("active");
	});

	it("reports a failing check with its output tail and attaches nothing", async () => {
		const cwd = gitRepo();
		const h = harness(cwd);
		await h.goal("Ship the app");

		await h.goal("verify echo missing-feature; exit 4");

		expect((await store(cwd).current())?.evidence).toEqual([]);
		expect(h.notifications.at(-1)).toEqual({
			message: expect.stringMatching(/failed with exit code 4 \(receipt [0-9a-f]{8}\)\nmissing-feature/),
			level: "warning",
		});
	});

	it("refuses to run a check without an open goal, while busy, or when command safety blocks it", async () => {
		const cwd = gitRepo();
		const h = harness(cwd);

		await h.goal("verify true");
		expect(lastNotice(h)).toBe("no open durable goal to verify");

		await h.goal("Ship the app");
		await h.goal("verify");
		expect(lastNotice(h)).toContain("no acceptance check is approved in this session");

		h.context.idle = false;
		await h.goal("verify true");
		expect(lastNotice(h)).toContain("wait for the agent to finish");
		h.context.idle = true;

		await h.goal("verify rm -rf /");
		expect(lastNotice(h)).toContain("command safety blocked the acceptance check");
		expect(h.entries).toEqual([]);
	});

	it("does not trust an approval from an earlier process", async () => {
		const cwd = gitRepo();
		const first = harness(cwd);
		await first.goal("Ship the app");
		await first.goal("verify grep -q v1 app.txt");

		const restarted = harness(cwd);
		await restarted.goal("verify");
		expect(lastNotice(restarted)).toContain("no acceptance check is approved in this session");

		await restarted.settle();
		expect(restarted.entries).toEqual([]);
		expect(restarted.messages).toEqual(["Continue the active goal (1/8): Ship the app"]);
	});

	it("forgets the approval when the goal is cleared and replaced", async () => {
		const cwd = gitRepo();
		const h = harness(cwd);
		await h.goal("Ship the app");
		await h.goal("verify true");
		await h.goal("clear");
		await h.goal("Ship the next app");

		await h.goal("verify");

		expect(lastNotice(h)).toContain("no acceptance check is approved in this session");
	});

	it("keeps goal transitions ordered after the wall clock steps back", async () => {
		const cwd = gitRepo();
		const ahead = new Date(Date.now() + 60_000).toISOString();
		await store(cwd).create(
			createDurableGoal({ id: "session", objective: "Ship the app", maxRounds: 2, now: ahead }),
		);
		const h = harness(cwd);

		await h.goal("verify grep -q v1 app.txt");
		expect(lastNotice(h)).toContain("acceptance check passed");
		await h.settle();

		const goal = await store(cwd).current();
		expect(goal?.status).toBe("completed");
		expect(Date.parse(goal?.updatedAt ?? "")).toBeGreaterThanOrEqual(Date.parse(ahead));
	});

	it("continues a goal without a check after the wall clock steps back", async () => {
		const cwd = gitRepo();
		const ahead = new Date(Date.now() + 60_000).toISOString();
		await store(cwd).create(
			createDurableGoal({ id: "session", objective: "Ship the app", maxRounds: 2, now: ahead }),
		);
		const h = harness(cwd);

		await h.settle();

		expect(h.messages).toEqual(["Continue the active goal (1/2): Ship the app"]);
		expect((await store(cwd).current())?.completedRounds).toBe(1);
	});

	it("stops the check with the settling run's abort and leaves the goal active", async () => {
		const cwd = gitRepo();
		const h = harness(cwd);
		await h.goal("Ship the app");
		await h.goal("verify grep -q v1 app.txt");
		const aborted = new AbortController();
		aborted.abort();
		h.context.signal = aborted.signal;

		await h.settle();

		const goal = await store(cwd).current();
		expect(goal?.status).toBe("active");
		expect(goal?.completedRounds).toBe(0);
		expect(h.messages).toEqual([]);
		expect(h.entries.at(-1)).toEqual({
			type: "goal_verification",
			data: expect.objectContaining({ status: "aborted", passed: false, trigger: "turn" }),
		});
	});

	it("leaves the next turn to a message queued while the check ran", async () => {
		const cwd = gitRepo();
		const holder: { harness?: Harness } = {};
		const h = harness(cwd, {
			createVerifier: (options) => {
				const verifier = new GoalVerifier(options);
				const run = verifier.run.bind(verifier);
				verifier.run = async (command, signal) => {
					const result = await run(command, signal);
					if (holder.harness) holder.harness.context.pending = true;
					return result;
				};
				return verifier;
			},
		});
		await h.goal("Ship the app");
		await h.goal("verify grep -q v2 app.txt");
		holder.harness = h;

		await h.settle();

		expect(h.messages).toEqual([]);
		const goal = await store(cwd).current();
		expect(goal?.status).toBe("active");
		expect(goal?.completedRounds).toBe(0);
	});

	it("reports a goal changed during the check instead of throwing from the settled turn", async () => {
		const cwd = gitRepo();
		const h = harness(cwd, {
			createVerifier: (options) => {
				const verifier = new GoalVerifier(options);
				const run = verifier.run.bind(verifier);
				verifier.run = async (command, signal) => {
					const result = await run(command, signal);
					const current = await store(cwd).current();
					if (current) {
						await store(cwd).transition({ kind: "pause", ref: current.ref }, nextDurableGoalTimestamp(current));
					}
					return result;
				};
				return verifier;
			},
		});
		await h.goal("Ship the app");
		await h.goal("verify grep -q v2 app.txt");
		await h.goal("resume");

		await expect(h.settle()).resolves.toBeUndefined();

		expect(lastNotice(h)).toBe("goal reference is stale");
		expect(h.messages).toEqual([]);
	});

	it("does not approve a command the receipt path cannot run", async () => {
		const cwd = gitRepo();
		const h = harness(cwd);
		await h.goal("Ship the app");

		await h.goal('verify test "$(cat app.txt)" = v1');
		expect(lastNotice(h)).toContain(
			"acceptance check could not run, so it was not approved: shell command is dynamic or malformed",
		);
		await h.goal("verify");

		expect(lastNotice(h)).toContain("no acceptance check is approved in this session");
		expect((await store(cwd).current())?.status).toBe("active");
	});

	it("blocks the goal when its approved check can no longer run under the sandbox", async () => {
		const cwd = gitRepo();
		let runs = 0;
		const h = harness(cwd, {
			createVerifier: (options) =>
				new GoalVerifier({
					...options,
					sandboxPreflight: () =>
						runs++ === 0
							? undefined
							: {
									policy: createWorkspaceSandboxPolicy(cwd, "enforce"),
									backend: { platform: "linux", backendAvailable: false },
								},
				}),
		});
		await h.goal("Ship the app");
		await h.goal("verify true");
		expect(lastNotice(h)).toContain("acceptance check passed");

		await h.settle();

		const goal = await store(cwd).current();
		expect(goal?.status).toBe("blocked");
		expect(goal?.blockedReason).toMatch(/acceptance check could not run: .*sandbox\.backend_missing/);
		expect(h.messages).toEqual([]);
	});
});
