import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";
import { acquireSessionOwnerLeaseSync } from "../src/core/session-owner-lease.ts";
import { journalPath } from "../src/core/verified-run/journal.ts";
import * as recoveryClock from "../src/core/verified-run/recovery-clock.ts";
import { collectVerifiedRuns, parseRetention } from "../src/core/verified-run/run-gc.ts";

const DAY = 86_400_000;
let root: string;
let stateRoot: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "run-gc-"));
	stateRoot = join(root, "state");
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

async function run(runId: string, writer: string[], signal?: AbortSignal) {
	const workspace = join(root, `workspace-${runId}`);
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input"), "original");
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId,
		goal: "copy",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["output"],
		writer,
		checks: [{ claimId: "copy", argv: ["/bin/cat", "output"], stdout: "original" }],
		budget: {
			workMs: 30000,
			verifyMs: 10000,
			cleanupMs: 15000,
			maxOutputBytes: 4096,
			maxFiles: 100,
			maxBytes: 65536,
		},
		apply: "artifact-only",
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	const plan = planVerifiedRun(contract);
	const coordinator = new RunCoordinator(stateRoot);
	const state = await coordinator.start(
		contract,
		{
			schemaVersion: "omk.verified-command.v1",
			kind: "start",
			runId,
			commandId: "start",
			expectedRevision: 0,
			expectedGeneration: 0,
			contractDigest: plan.contractDigest,
		},
		{ approvedContractDigest: plan.contractDigest, ...(signal ? { signal } : {}) },
	);
	return { coordinator, state, runPath: join(stateRoot, runId) };
}

function age(runPath: string, ms: number): void {
	const at = new Date(Date.now() - ms);
	utimesSync(journalPath(runPath), at, at);
}

describe("verified-run artifact GC", () => {
	it("prunes only derived workspaces of an old terminal run and keeps its evidence usable", async () => {
		const { coordinator, state, runPath } = await run("old", ["/bin/cp", "input", "output"]);
		expect(state.verification).toBe("verified");
		age(runPath, 8 * DAY);
		const before = readdirSync(runPath).sort();
		expect(before).toEqual(expect.arrayContaining(["candidate", "writer", "blobs", "candidates", "receipts"]));

		const dry = collectVerifiedRuns(stateRoot, { olderThanMs: 7 * DAY, execute: false });
		expect(dry.runs).toEqual([
			expect.objectContaining({ runId: "old", action: "prunable", reason: null, paths: ["candidate", "writer"] }),
		]);
		expect(dry.runs[0].bytes).toBeGreaterThan(0);
		expect(readdirSync(runPath).sort()).toEqual(before);

		const done = collectVerifiedRuns(stateRoot, { olderThanMs: 7 * DAY, execute: true });
		expect(done.runs[0]).toMatchObject({ runId: "old", action: "pruned", paths: ["candidate", "writer"] });
		expect(done.prunedBytes).toBe(dry.runs[0].bytes);
		expect(existsSync(join(runPath, "writer"))).toBe(false);
		expect(existsSync(join(runPath, "candidate"))).toBe(false);
		expect(coordinator.evidence("old")).toMatchObject({ verified: true });
		if (!state.candidateDigest) throw new Error("missing candidate");
		expect(coordinator.artifact("old", state.candidateDigest, "output").toString()).toBe("original");
		expect(coordinator.status("old")).toMatchObject({ lifecycle: "accepted" });

		const again = collectVerifiedRuns(stateRoot, { olderThanMs: 7 * DAY, execute: true });
		expect(again.runs[0]).toMatchObject({ action: "kept", reason: "already_pruned", paths: [] });
	});

	it("keeps recent and owned runs", async () => {
		await run("recent", ["/bin/cp", "input", "output"]);
		const owned = await run("owned", ["/bin/cp", "input", "output"]);
		age(owned.runPath, 8 * DAY);
		const lease = acquireSessionOwnerLeaseSync(journalPath(owned.runPath));
		try {
			const report = collectVerifiedRuns(stateRoot, { olderThanMs: 7 * DAY, execute: true });
			const byId = Object.fromEntries(report.runs.map((entry) => [entry.runId, entry]));
			expect(byId.recent).toMatchObject({ action: "kept", reason: "recent" });
			expect(byId.owned).toMatchObject({ action: "kept", reason: "owner_live" });
			expect(existsSync(join(owned.runPath, "writer"))).toBe(true);
		} finally {
			lease.release();
		}
	});

	it("keeps a cancelled run inside its budget and collects it once the budget cap has passed", async () => {
		const controller = new AbortController();
		const pending = run("cancelled", ["/bin/sh", "-c", "cp input output && sleep 30"], controller.signal);
		const deadline = Date.now() + 20000;
		while (!existsSync(join(stateRoot, "cancelled", "writer", "output"))) {
			if (Date.now() > deadline) throw new Error("writer never started");
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		controller.abort();
		const { state, runPath } = await pending;
		expect(state).toMatchObject({ execution: "paused", failure: "cancelled" });
		age(runPath, 8 * DAY);
		const inside = collectVerifiedRuns(stateRoot, { olderThanMs: 7 * DAY, execute: false });
		expect(inside.runs[0]).toMatchObject({ runId: "cancelled", action: "kept", reason: "recoverable" });

		if (!state.budget) throw new Error("missing budget");
		vi.spyOn(recoveryClock, "readRunClock").mockReturnValue({
			bootId: state.budget.bootId,
			nowMs: state.budget.verifyCapMs + 1,
		});
		const expired = collectVerifiedRuns(stateRoot, { olderThanMs: 7 * DAY, execute: false });
		expect(expired.runs[0]).toMatchObject({ runId: "cancelled", action: "prunable", paths: ["writer"] });

		// A clock the recovery rules cannot interpret keeps the run instead of aborting the whole GC.
		vi.mocked(recoveryClock.readRunClock).mockReturnValue({ bootId: state.budget.bootId, nowMs: 0 });
		const undecided = collectVerifiedRuns(stateRoot, { olderThanMs: 7 * DAY, execute: true });
		expect(undecided.runs[0]).toMatchObject({ runId: "cancelled", action: "kept", reason: "clock_unknown" });
		expect(existsSync(join(runPath, "writer"))).toBe(true);
	});

	it("ignores non-run entries and never follows symlinks out of the state root", async () => {
		const { runPath } = await run("linked", ["/bin/cp", "input", "output"]);
		age(runPath, 8 * DAY);
		const outside = join(root, "outside");
		mkdirSync(outside);
		writeFileSync(join(outside, "keep"), "precious");
		symlinkSync(outside, join(runPath, "writer-9"));
		// A sandboxed writer can leave symlinks inside its own workspace; removal must not follow them.
		symlinkSync(outside, join(runPath, "writer", "escape"));
		symlinkSync(runPath, join(stateRoot, "alias"));
		writeFileSync(join(stateRoot, "notes.txt"), "not a run");
		mkdirSync(join(stateRoot, "not a run id"));
		const report = collectVerifiedRuns(stateRoot, { olderThanMs: 7 * DAY, execute: true });
		expect(report.runs.map((entry) => entry.runId)).toEqual(["linked"]);
		expect(report.runs[0]).toMatchObject({ action: "pruned", paths: ["candidate", "writer"] });
		expect(existsSync(join(outside, "keep"))).toBe(true);
		expect(existsSync(join(runPath, "writer"))).toBe(false);
		expect(existsSync(join(runPath, "writer-9"))).toBe(true);
	});

	it("reports an empty state root without creating it", () => {
		const report = collectVerifiedRuns(stateRoot, { olderThanMs: DAY, execute: true });
		expect(report).toMatchObject({ runs: [], prunedBytes: 0, prunableBytes: 0 });
		expect(existsSync(stateRoot)).toBe(false);
	});
});

describe("retention parsing", () => {
	const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: DAY } as const;

	it("accepts an integer with one unit and nothing else", () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 100_000 }), fc.constantFrom("ms", "s", "m", "h", "d"), (n, u) => {
				expect(parseRetention(`${n}${u}`)).toBe(n * unit[u as keyof typeof unit]);
			}),
		);
		for (const bad of ["", "7", "d", "-1d", "1.5h", "7 d", "7dd", "1e3s", "07x", "99999999999999999d"])
			expect(() => parseRetention(bad)).toThrow(/usage/);
	});
});
