import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDurableGoal } from "../src/core/durable-goal.ts";
import { DurableGoalStore } from "../src/core/durable-goal-store.ts";
import goalController from "../src/core/extensions/builtin/goal-controller.ts";
import type { ExtensionAPI, ExtensionCommandContext, RegisteredCommand } from "../src/core/extensions/types.ts";
import {
	deleteGoalRecallFiles,
	goalOutputRecallEnabled,
	OUTPUT_RECALL_HEAD_BYTES,
	OUTPUT_RECALL_MAX_BYTES,
	OUTPUT_RECALL_PER_DIR,
	OUTPUT_RECALL_TAIL_BYTES,
	OutputArtifactWriter,
	outputRecallDir,
} from "../src/core/goal-output-recall.ts";
import { createLoadoutAccessPolicy, decideLoadoutAccess } from "../src/core/loadout-access-policy.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";

const roots: string[] = [];
const COMMAND = "verify printf 'line one\\nF821 undefined name x\\n'; exit 4";

function tempRoot(prefix: string): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	roots.push(root);
	return root;
}

function gitRepo(): string {
	const root = tempRoot("omk-098-repo-");
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

function harness(cwd: string) {
	const commands = new Map<string, RegisteredCommand>();
	const handlers = new Map<string, (event: never, context: never) => unknown>();
	const entries: Array<{ readonly type: string; readonly data: Record<string, unknown> }> = [];
	const messages: string[] = [];
	const omk = {
		registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
		on: (event: string, handler: (event: never, context: never) => unknown) => handlers.set(event, handler),
		appendEntry: (type: string, data: Record<string, unknown>) => entries.push({ type, data }),
		sendUserMessage: (message: string) => messages.push(message),
	} as unknown as ExtensionAPI;
	goalController(omk);
	const ctx = {
		cwd,
		signal: undefined,
		hasUI: false,
		ui: { notify: () => {}, confirm: async () => false },
		isIdle: () => true,
		hasPendingMessages: () => false,
	} as unknown as ExtensionCommandContext;
	return {
		entries,
		messages,
		handlers,
		goal: async (args: string) => commands.get("goal")?.handler(args, ctx),
		settle: async () =>
			handlers.get("agent_settled")?.({ type: "agent_settled", messages: [] } as never, ctx as never),
		toolCall: (toolName: string, input: Record<string, unknown>) =>
			handlers.get("tool_call")?.({ type: "tool_call", toolCallId: "t", toolName, input } as never, ctx as never),
	};
}

async function failingRound() {
	const cwd = gitRepo();
	await new DurableGoalStore(join(cwd, ".omk", "goals", "current.json")).create(
		createDurableGoal({ id: "session", objective: "Ship the app", maxRounds: 3, now: new Date().toISOString() }),
	);
	const h = harness(cwd);
	await h.goal(COMMAND);
	await h.settle();
	return { cwd, h };
}

function recallPath(message: string): string {
	return /Full output: (\S+) \(/u.exec(message)?.[1] ?? "";
}

beforeEach(() => {
	vi.stubEnv("OMK_BASH_SANDBOX", "off");
	vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "0"); // spec 098 naming/caps under the pre-106 path; lifecycle defaults to observe
	vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "0"); // default on; flag-off cases opt out
	vi.stubEnv("OMK_GOAL_AUTONOMY", "0"); // spec 098 wiring under the pre-119 controller; autonomy is default on
});

afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("spec 098 flag", () => {
	it("is default on; only 0/false/off opt out", () => {
		expect(goalOutputRecallEnabled({})).toBe(true);
		expect(goalOutputRecallEnabled({ OMK_GOAL_OUTPUT_RECALL: "0" })).toBe(false);
		expect(goalOutputRecallEnabled({ OMK_GOAL_OUTPUT_RECALL: "false" })).toBe(false);
		expect(goalOutputRecallEnabled({ OMK_GOAL_OUTPUT_RECALL: " OFF " })).toBe(false);
		expect(goalOutputRecallEnabled({ OMK_GOAL_OUTPUT_RECALL: "true" })).toBe(true);
		expect(goalOutputRecallEnabled({ OMK_GOAL_OUTPUT_RECALL: "1" })).toBe(true);
	});
});

describe("spec 098 controller wiring", () => {
	it("flag off: the follow-up request text and the trace entry are byte-identical to main, no file, no handler", async () => {
		const { cwd, h } = await failingRound();

		expect(h.messages).toHaveLength(1);
		const receipt = /\(receipt ([0-9a-f]{8})\)/u.exec(h.messages[0] ?? "")?.[1];
		expect(receipt).toMatch(/^[0-9a-f]{8}$/u);
		// The exact string `main` (29933049fe) sends as the next request's user message.
		expect(h.messages[0]).toBe(
			"Continue the active goal (1/3): Ship the app\n\n" +
				"Acceptance check `printf 'line one\\nF821 undefined name x\\n'; exit 4` failed with exit code 4 " +
				`(receipt ${receipt}). Run it to see the output, fix the cause, and end your turn when it passes.`,
		);
		for (const entry of h.entries) {
			expect(Object.keys(entry.data).sort()).toEqual(
				["digest", "exitCode", "goalId", "goalRevision", "passed", "receiptId", "status", "trigger"].sort(),
			);
		}
		expect(existsSync(outputRecallDir(cwd))).toBe(false);
		expect(h.handlers.has("tool_call")).toBe(false);
	});

	it("flag on: points the model at the raw artifact and the trace keeps only a digest and counts", async () => {
		vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "1");
		const { cwd, h } = await failingRound();

		const message = h.messages[0] ?? "";
		expect(message).not.toContain("Run it to see the output");
		expect(message).toContain("Diagnostic hint (may be incomplete):\nline one\nF821 undefined name x");
		expect(message).toContain(
			// attempt 1 is the `/goal verify` run, attempt 2 the settled-turn run.
			"Full output: .omk/goals/recall/acceptance-session-0-1-2.log (2 lines, 31B; complete)",
		);
		expect(message).toContain("Read ranges with read(path, offset, limit) instead of re-running the check");
		const file = join(cwd, recallPath(message));
		expect(readFileSync(file, "utf8")).toBe("line one\nF821 undefined name x\n");
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(statSync(outputRecallDir(cwd)).mode & 0o777).toBe(0o700);
		expect(readFileSync(join(outputRecallDir(cwd), ".gitignore"), "utf8")).toBe("*\n");

		for (const entry of h.entries) expect(JSON.stringify(entry)).not.toContain("F821");
		expect(h.entries.at(-1)?.data.outputArtifact).toEqual({
			sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
			bytes: 31,
			lines: 2,
			complete: true,
			elidedBytes: 0,
			elidedRatio: 0,
		});
	});

	it("flag on: the real read tool opens the recall path, with and without a workspace-scoped loadout policy", async () => {
		vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "1");
		const { cwd, h } = await failingRound();
		const path = recallPath(h.messages[0] ?? "");
		const policy = createLoadoutAccessPolicy({ cwd, activeTools: ["read"], readSet: [{ path: "." }] });
		const scoped = (p: string) =>
			decideLoadoutAccess(policy, { operation: "read", toolName: "read", path: p }).allowed;
		for (const options of [{}, { canReadPath: scoped }]) {
			const read = createReadToolDefinition(cwd, options);
			const result = await read.execute(
				"r",
				{ path, offset: 2, limit: 1 },
				undefined,
				undefined,
				undefined as never,
			);
			expect(result.content[0]).toMatchObject({
				type: "text",
				text: expect.stringMatching(/^F821 undefined name x\n/u),
			});
		}
	});

	it("flag on: a re-run in the same round and revision keeps both files", async () => {
		vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "1");
		const cwd = gitRepo();
		const h = harness(cwd);
		await h.goal("Ship the app");
		await h.goal(COMMAND);
		await h.goal("verify");
		expect(readdirSync(outputRecallDir(cwd)).sort()).toEqual([
			".gitignore",
			"acceptance-session-0-1-1.log",
			"acceptance-session-0-1-2.log",
		]);
	});

	it("flag on: the next check records whether the model read the recall path (counts only)", async () => {
		vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "1");
		const { cwd, h } = await failingRound();
		const path = recallPath(h.messages[0] ?? "");
		h.toolCall("read", { path: "app.txt" });
		h.toolCall("read", { path, offset: 1, limit: 40 });
		h.toolCall("read", { path: join(cwd, path) });
		h.toolCall("bash", { command: `cat ${path}` });
		await h.settle();
		expect(h.entries.at(-1)?.data.priorRecall).toEqual({
			readAfterFollowUp: true,
			readCalls: 2,
			otherAccessCalls: 1,
		});
		await h.settle();
		expect(h.entries.at(-1)?.data.priorRecall).toEqual({
			readAfterFollowUp: false,
			readCalls: 0,
			otherAccessCalls: 0,
		});
	});

	it("flag on: grep/rg/cat/sed access is counted apart and never moves the read metric", async () => {
		vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "1");
		const { cwd, h } = await failingRound();
		const path = recallPath(h.messages[0] ?? "");
		h.toolCall("grep", { pattern: "F821", path });
		h.toolCall("bash", { command: `rg -n Error ${join(cwd, path)}` });
		h.toolCall("bash", { command: `sed -n '1,40p' '${path}'` });
		h.toolCall("bash", { command: `grep -n F821 ${path} | head` });
		// Not counted: other files, other commands on the path, grep tool on the directory.
		h.toolCall("bash", { command: "cat app.txt" });
		h.toolCall("bash", { command: `wc -l ${path}` });
		h.toolCall("grep", { pattern: "F821", path: ".omk/goals/recall" });
		await h.settle();
		expect(h.entries.at(-1)?.data.priorRecall).toEqual({
			readAfterFollowUp: false,
			readCalls: 0,
			otherAccessCalls: 4,
		});
		for (const entry of h.entries) expect(JSON.stringify(entry)).not.toContain("F821");
	});

	it("deleting the goal (clear, then a new goal) removes all its recall files", async () => {
		vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "1");
		const { cwd, h } = await failingRound();
		await h.goal("verify");
		const logs = () => readdirSync(outputRecallDir(cwd)).filter((name) => name.startsWith("acceptance-session-"));
		expect(logs().length).toBeGreaterThan(0);
		await h.goal("clear");
		expect(logs()).toEqual([]);

		await h.goal("Ship it again");
		await h.goal(COMMAND);
		expect(logs()).toHaveLength(1);
		await h.goal("clear");
		await h.goal("A replacement goal");
		expect(logs()).toEqual([]);
	});

	it("flag on: recall files leave `git status --porcelain` empty", async () => {
		vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "1");
		const cwd = gitRepo();
		// Ignore only the goal state main already writes; recall/ must be hidden by its own .gitignore.
		writeFileSync(join(cwd, ".gitignore"), ".omk/goals/current.json\n.omk/goals/evidence/\n");
		execFileSync("git", ["add", ".gitignore"], { cwd });
		execFileSync("git", ["commit", "-qm", "ignore goal state"], { cwd });
		const h = harness(cwd);
		await h.goal("Ship the app");
		await h.goal(COMMAND);
		await h.goal("verify");
		expect(readdirSync(outputRecallDir(cwd)).filter((name) => name.endsWith(".log"))).toHaveLength(2);
		const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--ignored=no"], {
			cwd,
			encoding: "utf8",
		});
		expect(status).toBe("");
	});

	it("flag on: a passing check leaves no artifact", async () => {
		vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "1");
		const cwd = gitRepo();
		const h = harness(cwd);
		await h.goal("Ship the app");
		await h.goal("verify grep -q v1 app.txt");
		expect(readdirSync(outputRecallDir(cwd)).filter((name) => name.endsWith(".log"))).toEqual([]);
		expect(h.entries.at(-1)?.data.outputArtifact).toBeUndefined();
	});
});

describe("spec 098 artifact writer", () => {
	const target = (cwd: string, goalId = "g", round = 0) => ({ cwd, goalId, round, revision: 1 });

	it("keeps the first 1 MiB and the last 3 MiB around one elision line past 4 MiB", () => {
		const cwd = tempRoot("omk-098-w-");
		const writer = OutputArtifactWriter.open(target(cwd));
		const chunk = 256 * 1024;
		const total = OUTPUT_RECALL_MAX_BYTES + 3 * chunk + 5;
		const all = Buffer.alloc(total);
		for (let i = 0; i < total; i++) all[i] = 97 + (i % 26);
		for (let at = 0; at < total; at += chunk) writer?.write(all.subarray(at, at + chunk));
		const artifact = writer?.finish();
		const elided = total - OUTPUT_RECALL_MAX_BYTES;
		expect(artifact).toMatchObject({
			complete: false,
			elidedBytes: elided,
			elidedRatio: Math.round((elided / total) * 10_000) / 10_000,
		});
		const content = readFileSync(artifact?.absolutePath ?? "");
		const marker = Buffer.from(`\n[omk: ${elided} bytes elided]\n`);
		const head = OUTPUT_RECALL_HEAD_BYTES;
		expect(content.subarray(0, head).equals(all.subarray(0, head))).toBe(true);
		expect(content.subarray(head, head + marker.byteLength).equals(marker)).toBe(true);
		expect(content.subarray(head + marker.byteLength).equals(all.subarray(-OUTPUT_RECALL_TAIL_BYTES))).toBe(true);
		expect(artifact?.bytes).toBe(content.byteLength);
	});

	it("discard deletes the partial file", () => {
		const cwd = tempRoot("omk-098-w-");
		const writer = OutputArtifactWriter.open(target(cwd));
		writer?.write(Buffer.from("partial"));
		writer?.discard();
		expect(readdirSync(outputRecallDir(cwd))).toEqual([".gitignore"]);
		expect(writer?.finish()).toBeUndefined();
	});

	it("keeps the newest 3 per goal and 20 per dir; attempt numbers are never reused", () => {
		const cwd = tempRoot("omk-098-w-");
		const dir = outputRecallDir(cwd);
		let stamp = 1;
		const run = (goalId: string, round: number) => {
			const artifact = OutputArtifactWriter.open(target(cwd, goalId, round))?.finish();
			if (artifact && existsSync(artifact.absolutePath)) utimesSync(artifact.absolutePath, stamp, stamp);
			stamp += 1;
		};
		for (let attempt = 0; attempt < 5; attempt++) run("a", 0);
		const logs = () => readdirSync(dir).filter((name) => name.endsWith(".log"));
		expect(logs().sort()).toEqual(["acceptance-a-0-1-3.log", "acceptance-a-0-1-4.log", "acceptance-a-0-1-5.log"]);
		for (let goal = 0; goal < 10; goal++) for (let round = 0; round < 3; round++) run(`g${goal}`, round);
		expect(logs()).toHaveLength(OUTPUT_RECALL_PER_DIR);
		expect(logs().some((name) => name.startsWith("acceptance-a-"))).toBe(false);
	});

	it("goals `a` and `a-1` never delete or trim each other's files (clear and caps)", () => {
		const cwd = tempRoot("omk-098-w-");
		const dir = outputRecallDir(cwd);
		let stamp = 1;
		const run = (goalId: string, round: number) => {
			const artifact = OutputArtifactWriter.open(target(cwd, goalId, round))?.finish();
			if (artifact) utimesSync(artifact.absolutePath, stamp, stamp);
			stamp += 1;
		};
		const of = (goalId: string) =>
			readdirSync(dir)
				.filter(
					(name) =>
						name.startsWith(`acceptance-${goalId}-`) &&
						/^\d+-\d+-\d+\.log$/u.test(name.slice(`acceptance-${goalId}-`.length)),
				)
				.sort();
		// `a-1` round 0 first, so the oldest files overall belong to `a-1`.
		for (let attempt = 0; attempt < 3; attempt++) run("a-1", 0);
		for (let attempt = 0; attempt < 4; attempt++) run("a", 1);
		expect(of("a-1")).toEqual(["acceptance-a-1-0-1-1.log", "acceptance-a-1-0-1-2.log", "acceptance-a-1-0-1-3.log"]);
		expect(of("a")).toEqual(["acceptance-a-1-1-2.log", "acceptance-a-1-1-3.log", "acceptance-a-1-1-4.log"]);
		for (let attempt = 0; attempt < 2; attempt++) run("a-1", 2);
		expect(of("a")).toHaveLength(3);
		expect(of("a-1")).toEqual(["acceptance-a-1-0-1-3.log", "acceptance-a-1-2-1-1.log", "acceptance-a-1-2-1-2.log"]);

		deleteGoalRecallFiles(cwd, "a");
		expect(of("a")).toEqual([]);
		expect(of("a-1")).toHaveLength(3);
		run("a", 1);
		deleteGoalRecallFiles(cwd, "a-1");
		expect(of("a-1")).toEqual([]);
		expect(of("a")).toEqual(["acceptance-a-1-1-1.log"]);
	});
});
