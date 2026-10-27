import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeBashWithOperations } from "../src/core/bash-executor.ts";
import { createDurableGoal } from "../src/core/durable-goal.ts";
import { DurableGoalStore } from "../src/core/durable-goal-store.ts";
import {
	EVIDENCE_REGISTRY_MAX,
	evidenceLifecycleObserveEnabled,
	listEvidenceArtifacts,
	registerEvidenceArtifact,
	resetEvidenceLifecycleForTest,
} from "../src/core/evidence-lifecycle.ts";
import { evidenceLifecycleReport } from "../src/core/evidence-lifecycle-report.ts";
import { EVIDENCE_UNATTRIBUTED, withEvidenceSession } from "../src/core/evidence-lifecycle-scope.ts";
import goalController from "../src/core/extensions/builtin/goal-controller.ts";
import type { ExtensionAPI, ExtensionCommandContext, RegisteredCommand } from "../src/core/extensions/types.ts";
import { deleteGoalRecallFiles, OutputArtifactWriter, outputRecallDir } from "../src/core/goal-output-recall.ts";
import { observeRecallBlockedExhausted, observeRecallRecheck } from "../src/core/goal-output-recall-evidence.ts";
import { spillTruncatedOutput } from "../src/core/tools/artifact-spill.ts";
import type { BashOperations } from "../src/core/tools/bash.ts";
import { OutputAccumulator } from "../src/core/tools/output-accumulator.ts";
import { DEFAULT_MAX_BYTES } from "../src/core/tools/truncate.ts";

const SECRET = "SECRET-RAW-OUTPUT-d1-7f3a";
const roots: string[] = [];
const cleanup: string[] = [];

function tempRoot(prefix: string): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	roots.push(root);
	return root;
}

function recall(cwd: string, goalId: string, text = `${SECRET}\nF821\n`) {
	const writer = OutputArtifactWriter.open({ cwd, goalId, round: 0, revision: 1 });
	writer?.write(Buffer.from(text));
	const artifact = writer?.finish();
	if (artifact === undefined) throw new Error("recall not written");
	return artifact;
}

function spill() {
	const result = spillTruncatedOutput({
		kind: "read",
		preview: "head",
		full: `${SECRET}\n`.repeat(10),
		truncated: true,
		path: "/x/file.txt.omk-spill.txt",
	});
	cleanup.push(dirname(result.path));
	return result;
}

function expectNoRawBytes(paths: readonly string[]): void {
	const serialized = JSON.stringify({ report: evidenceLifecycleReport(), records: listEvidenceArtifacts() });
	expect(serialized).not.toContain(SECRET);
	for (const path of paths) expect(serialized).not.toContain(path);
}

beforeEach(() => {
	resetEvidenceLifecycleForTest();
	vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "0"); // default is observe; flag-off cases opt out explicitly
	vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", undefined);
	vi.stubEnv("OMK_BASH_SANDBOX", "off");
	vi.stubEnv("OMK_GOAL_AUTONOMY", "0"); // pre-119 controller path; autonomy is default on
});

afterEach(() => {
	vi.unstubAllEnvs();
	resetEvidenceLifecycleForTest();
	for (const path of [...roots.splice(0), ...cleanup.splice(0)]) rmSync(path, { recursive: true, force: true });
});

describe("spec 106 D1 flag", () => {
	it("is on by default (observe); only 0/false/off opt out", () => {
		expect(evidenceLifecycleObserveEnabled({})).toBe(true);
		expect(evidenceLifecycleObserveEnabled({ OMK_EVIDENCE_LIFECYCLE: "1" })).toBe(true);
		for (const off of ["0", "false", " OFF "]) {
			expect(evidenceLifecycleObserveEnabled({ OMK_EVIDENCE_LIFECYCLE: off })).toBe(false);
		}
		expect(evidenceLifecycleObserveEnabled({ OMK_EVIDENCE_LIFECYCLE: "delete" })).toBe(true);
		expect(evidenceLifecycleObserveEnabled({ OMK_EVIDENCE_LIFECYCLE: "Delete" })).toBe(true);
		expect(evidenceLifecycleObserveEnabled({ OMK_EVIDENCE_LIFECYCLE: "observe" })).toBe(true);
	});

	it("flag off: producers register nothing and produce the same output", () => {
		const cwd = tempRoot("omk-d1-off-");
		const artifact = recall(cwd, "g");
		const spilled = spill();
		expect(registerEvidenceArtifact({ producer: "read-spill", path: spilled.path })).toBeUndefined();
		expect(listEvidenceArtifacts()).toEqual([]);
		expect(evidenceLifecycleReport().registered).toBe(0);
		expect(artifact.displayPath).toBe(".omk/goals/recall/acceptance-g-0-1-1.log");
		expect(readdirSync(dirname(spilled.path))).toHaveLength(1);
		expect(readdirSync(outputRecallDir(cwd)).sort()).toEqual([".gitignore", "acceptance-g-0-1-1.log"]);
	});
});

describe("spec 106 D1 observe", () => {
	beforeEach(() => vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe"));

	it("spill: registered awaiting its consumers (spec 118 D3), 0 raw bytes, nothing would be deleted", () => {
		const spilled = spill();
		const [record] = listEvidenceArtifacts();
		expect(record).toMatchObject({
			producer: "read-spill",
			holds: ["awaiting-consumer"],
			status: "present",
			bytes: 260,
		});
		expect(record?.contentSha256).toMatch(/^[0-9a-f]{64}$/u);
		expect(record?.requiredConsumers).toEqual(["tool-result-commit", "turn-settled"]);
		const report = evidenceLifecycleReport();
		expect(report).toMatchObject({ registered: 1, present: 1, unknownHoldShare: 0, deletes: 0 });
		expect(report.wouldDelete.count).toBe(0);
		expect(existsSync(spilled.path)).toBe(true);
		expectNoRawBytes([spilled.path]);
	});

	it("recall: consumers and holds move with rechecks; a pass makes it a would-delete, the file stays", () => {
		const cwd = tempRoot("omk-d1-recall-");
		const artifact = recall(cwd, "g");
		expect(listEvidenceArtifacts()[0]).toMatchObject({
			producer: "goal-recall",
			requiredConsumers: ["repair-turn", "acceptance-recheck"],
			consumed: [],
			holds: ["goal-active", "awaiting-consumer"],
			contentSha256: artifact.sha256,
			bytes: artifact.bytes,
		});
		observeRecallRecheck("g", false);
		expect(listEvidenceArtifacts()[0]).toMatchObject({ holds: ["goal-active"], verified: false });
		observeRecallRecheck("other", true);
		expect(listEvidenceArtifacts()[0]?.holds).toEqual(["goal-active"]);
		observeRecallRecheck("g", true);
		const [record] = listEvidenceArtifacts();
		expect(record).toMatchObject({ holds: [], verified: true, status: "present" });
		const report = evidenceLifecycleReport();
		expect(report.wouldDelete).toEqual({ count: 1, bytes: artifact.bytes, artifactIds: [record?.artifactId] });
		expect(report.deletes).toBe(0);
		expect(existsSync(artifact.absolutePath)).toBe(true);
		expectNoRawBytes([artifact.absolutePath, cwd]);
	});

	it("unknown-hold share counts only present artifacts", () => {
		const cwd = tempRoot("omk-d1-share-");
		recall(cwd, "g");
		observeRecallRecheck("g", true);
		// `bash-spill` is the one unmapped producer left (spec 118 D3 decision 3).
		const bashSpill = spillTruncatedOutput({ kind: "bash", preview: "p", full: SECRET, truncated: true, path: "/b" });
		cleanup.push(dirname(bashSpill.path));
		const report = evidenceLifecycleReport();
		expect(report.present).toBe(2);
		expect(report.unknownHoldShare).toBe(0.5);
		expect(report.holdReasons).toEqual({ unknown: 1 });
		expect(report.byProducer).toEqual({ "goal-recall": 1, "bash-spill": 1 });
		expect(report.unknownHoldShareByProducer).toEqual({
			recall: { present: 1, unknown: 0, share: 0 },
			spill: { present: 1, unknown: 1, share: 1 },
			bash: { present: 0, unknown: 0, share: 0 },
			executor: { present: 0, unknown: 0, share: 0 },
		});
	});

	it("existing pruners still delete as before and are recorded as removed-by-existing-policy", () => {
		const cwd = tempRoot("omk-d1-prune-");
		const files = [1, 2, 3].map((n) => {
			const artifact = recall(cwd, "g");
			const at = new Date(Date.now() - (10 - n) * 1000);
			utimesSync(artifact.absolutePath, at, at);
			return artifact.absolutePath;
		});
		expect(files.every((file) => existsSync(file))).toBe(true);
		recall(cwd, "g");
		expect(existsSync(files[0] ?? "")).toBe(false);
		expect(listEvidenceArtifacts().filter((r) => r.status === "removed-by-existing-policy")).toHaveLength(1);
		deleteGoalRecallFiles(cwd, "g");
		const report = evidenceLifecycleReport();
		expect(report.present).toBe(0);
		expect(report.removedByExistingPolicy).toBe(4);
		expect(report.deletes).toBe(0);
	});

	it("tool-bash log and executor fullOutputPath register by bytes; ids are monotonic", async () => {
		const accumulator = new OutputAccumulator({ maxBytes: 16 });
		accumulator.append(Buffer.from(`${SECRET}\n`.repeat(4)));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		await accumulator.closeTempFile();
		if (snapshot.fullOutputPath) cleanup.push(snapshot.fullOutputPath);
		const ops: BashOperations = {
			exec: async (_command, _cwd, { onData }) => {
				onData(Buffer.from(`${SECRET}\n`.repeat(Math.ceil((DEFAULT_MAX_BYTES * 2) / SECRET.length))));
				return { exitCode: 0 };
			},
		};
		const result = await executeBashWithOperations("x", "/", ops);
		if (result.fullOutputPath) cleanup.push(result.fullOutputPath);
		const records = listEvidenceArtifacts();
		expect(records.map((r) => [r.artifactId, r.producer, r.holds])).toEqual([
			["ev-1", "tool-output-log", ["awaiting-consumer"]],
			["ev-2", "bash-executor-log", ["user-visible"]],
		]);
		expect(records.every((r) => r.bytes > 0)).toBe(true);
		expectNoRawBytes([snapshot.fullOutputPath ?? "", result.fullOutputPath ?? ""]);
	});

	it("blocked-exhausted goals keep their recall holds and are counted separately", () => {
		const cwd = tempRoot("omk-d1-blocked-");
		recall(cwd, "g");
		observeRecallRecheck("g", false);
		const before = listEvidenceArtifacts()[0]?.holds;
		observeRecallBlockedExhausted("g");
		const [record] = listEvidenceArtifacts();
		expect(record?.holds).toEqual(before);
		expect(record?.blockedExhausted).toBe(true);
		const report = evidenceLifecycleReport();
		expect(report.blockedExhausted).toBe(1);
		expect(report.wouldDelete.count).toBe(0);
	});

	it("artifacts are scoped by owning session; no context goes to the explicit unattributed bucket", () => {
		withEvidenceSession("s-a", () => spill());
		withEvidenceSession("s-b", () => {
			spill();
			spill();
		});
		spill();
		expect(listEvidenceArtifacts("s-a")).toHaveLength(1);
		expect(listEvidenceArtifacts("s-b").map((r) => r.artifactId)).toEqual(["ev-1", "ev-2"]);
		expect(evidenceLifecycleReport("s-a")).toMatchObject({ registered: 1, present: 1, unattributed: 1 });
		expect(evidenceLifecycleReport("s-b")).toMatchObject({ registered: 2, unattributed: 1 });
		expect(evidenceLifecycleReport(EVIDENCE_UNATTRIBUTED)).toMatchObject({ registered: 1, unattributed: 0 });
		expect(withEvidenceSession("s-a", () => evidenceLifecycleReport().registered)).toBe(1);
	});

	it("registry is bounded and counts overflow", () => {
		for (let i = 0; i < EVIDENCE_REGISTRY_MAX + 2; i++) {
			registerEvidenceArtifact({ producer: "bash-spill", path: `/none/${i}`, bytes: 1 });
		}
		expect(evidenceLifecycleReport()).toMatchObject({ registered: EVIDENCE_REGISTRY_MAX, overflow: 2 });
	});
});

function gitRepo(): string {
	const root = tempRoot("omk-d1-repo-");
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
	git("init", "-q");
	git("config", "user.email", "goal@test.invalid");
	git("config", "user.name", "goal");
	git("config", "commit.gpgsign", "false");
	git("commit", "-q", "--allow-empty", "-m", "init");
	return root;
}

const GOAL_SESSION = "goal-session";

async function failingGoalRound(maxRounds = 3, settles = 1) {
	const cwd = gitRepo();
	await new DurableGoalStore(join(cwd, ".omk", "goals", "current.json")).create(
		createDurableGoal({ id: "session", objective: "Ship", maxRounds, now: new Date().toISOString() }),
	);
	const commands = new Map<string, RegisteredCommand>();
	const handlers = new Map<string, (event: never, context: never) => unknown>();
	const entries: Array<{ readonly type: string; readonly data: Record<string, unknown> }> = [];
	const omk = {
		registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
		on: (event: string, handler: (event: never, context: never) => unknown) => handlers.set(event, handler),
		appendEntry: (type: string, data: Record<string, unknown>) => entries.push({ type, data }),
		sendUserMessage: () => {},
	} as unknown as ExtensionAPI;
	goalController(omk);
	const ctx = {
		cwd,
		signal: undefined,
		hasUI: false,
		ui: { notify: () => {}, confirm: async () => false },
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: { getSessionId: () => GOAL_SESSION },
	} as unknown as ExtensionCommandContext;
	// AgentSession runs prompts (and so the goal handlers) inside the owning session's evidence scope.
	await withEvidenceSession(GOAL_SESSION, async () => {
		await commands.get("goal")?.handler(`verify printf '${SECRET}\\n'; exit 4`, ctx);
		for (let i = 0; i < settles; i++) {
			await handlers.get("agent_settled")?.({ type: "agent_settled", messages: [] } as never, ctx as never);
		}
	});
	return { cwd, entries };
}

describe("spec 106 D1 goal trace", () => {
	it("flag off: goal_verification has no evidenceLifecycle key", async () => {
		vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "1");
		const { entries } = await failingGoalRound();
		expect(entries.length).toBeGreaterThan(0);
		for (const entry of entries) expect(entry.data).not.toHaveProperty("evidenceLifecycle");
	});

	it("flag observe: goal_verification carries a counts-only report with 0 deletes", async () => {
		vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "1");
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe");
		const { cwd, entries } = await failingGoalRound();
		const last = entries.at(-1)?.data.evidenceLifecycle as ReturnType<typeof evidenceLifecycleReport>;
		expect(last).toMatchObject({ mode: "observe", deletes: 0 });
		// The second run consumed the first recall; both are still on disk and still goal-held.
		expect(listEvidenceArtifacts(GOAL_SESSION).map((r) => r.holds)).toEqual([
			["goal-active"],
			["goal-active", "awaiting-consumer"],
		]);
		expect(readdirSync(outputRecallDir(cwd)).filter((n) => n.endsWith(".log"))).toHaveLength(2);
		expect(JSON.stringify(entries)).not.toContain(SECRET);
	});

	it("flag observe: a goal blocked with rounds exhausted classifies its recall, holds unchanged", async () => {
		vi.stubEnv("OMK_GOAL_OUTPUT_RECALL", "1");
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe");
		await failingGoalRound(1, 3);
		const records = listEvidenceArtifacts(GOAL_SESSION).filter((r) => r.status === "present");
		expect(records.length).toBeGreaterThan(0);
		expect(records.every((r) => r.blockedExhausted && r.holds.includes("goal-active"))).toBe(true);
		expect(evidenceLifecycleReport(GOAL_SESSION).blockedExhausted).toBe(records.length);
	});
});

describe("spec 106 EV11 recall path reuse", () => {
	it("flag off: names are unchanged (attempt numbers only)", () => {
		const cwd = tempRoot("omk-ev11-off-");
		expect(recall(cwd, "g").displayPath).toBe(".omk/goals/recall/acceptance-g-0-1-1.log");
	});

	it("flag observe: after every file of a goal/round/revision is removed, the next path is new", () => {
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe");
		const cwd = tempRoot("omk-ev11-on-");
		const seen = new Set<string>();
		for (let cycle = 0; cycle < 3; cycle++) {
			const artifact = recall(cwd, "g");
			expect(artifact.displayPath).toMatch(/^\.omk\/goals\/recall\/acceptance-g-0-1-1-[0-9a-f]{8}\.log$/u);
			expect(seen.has(artifact.absolutePath)).toBe(false);
			seen.add(artifact.absolutePath);
			deleteGoalRecallFiles(cwd, "g");
			expect(existsSync(artifact.absolutePath)).toBe(false);
		}
	});

	it("flag observe: caps and goal-id scoping still apply to nonce names", () => {
		vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", "observe");
		const cwd = tempRoot("omk-ev11-caps-");
		for (let i = 0; i < 5; i++) recall(cwd, "a");
		for (let i = 0; i < 2; i++) recall(cwd, "a-1");
		const logs = () => readdirSync(outputRecallDir(cwd)).filter((n) => n.endsWith(".log"));
		expect(logs().filter((n) => n.startsWith("acceptance-a-0-"))).toHaveLength(3);
		expect(
			logs()
				.filter((n) => n.startsWith("acceptance-a-0-"))
				.map((n) => n.split("-")[4])
				.sort(),
		).toEqual(["3", "4", "5"]);
		deleteGoalRecallFiles(cwd, "a");
		expect(logs()).toHaveLength(2);
		expect(logs().every((n) => n.startsWith("acceptance-a-1-0-1-"))).toBe(true);
	});

	it("spec 118 G0: 0 and observe write no counter sidecar or deletion log; a pass deletes nothing", () => {
		for (const flag of ["0", "observe"]) {
			vi.stubEnv("OMK_EVIDENCE_LIFECYCLE", flag);
			const cwd = tempRoot("omk-g0-");
			const artifact = recall(cwd, "g");
			observeRecallRecheck("g", true);
			expect(existsSync(artifact.absolutePath)).toBe(true);
			expect(readdirSync(outputRecallDir(cwd)).sort()).toEqual([".gitignore", basename(artifact.absolutePath)]);
			if (flag === "observe") expect(evidenceLifecycleReport()).toMatchObject({ mode: "observe", deletes: 0 });
			if (flag === "observe") expect(evidenceLifecycleReport()).not.toHaveProperty("deletion");
		}
	});
});
