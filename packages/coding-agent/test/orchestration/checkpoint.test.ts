import { describe, expect, it } from "vitest";
import {
	type AuthoritativeCheckpointSource,
	type Checkpoint,
	deriveResumePlan,
	enforceCheckpointBudget,
	renderCheckpointMarkdown,
	validateCheckpoint,
} from "../../src/core/orchestration/checkpoint.ts";

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
	return {
		schemaVersion: "omk.checkpoint.v1",
		checkpointId: "cp-1",
		runId: "run-1",
		timestamp: "2026-06-21T00:00:00.000Z",
		currentGoal: { summary: "Implement durable orchestration", status: "running" },
		constraints: ["preserve user changes"],
		decisions: [{ id: "D1", summary: "Use node:sqlite", artifactHashes: ["h-decision"] }],
		openTasks: [{ id: "T1", summary: "Implement scheduler", priority: 2 }],
		blockers: [],
		files: { read: ["foundation.md"], modified: ["scheduler-state.ts"] },
		commands: [{ command: "npm run check", exitCode: 0, outputHash: "h-cmd" }],
		artifacts: [{ path: "result.md", sha256: "h-artifact", kind: "result" }],
		failedApproaches: [{ summary: "direct package adoption", reason: "supply-chain risk" }],
		resumeAction: { summary: "continue with scheduler tests", targetTaskId: "T1" },
		...overrides,
	};
}

function authoritative(overrides: Partial<AuthoritativeCheckpointSource> = {}): AuthoritativeCheckpointSource {
	return {
		commands: [{ command: "npm run check", exitCode: 0, outputHash: "h-cmd" }],
		blockerIds: [],
		filePaths: ["foundation.md", "scheduler-state.ts"],
		artifacts: [{ path: "result.md", sha256: "h-artifact" }],
		...overrides,
	};
}

describe("renderCheckpointMarkdown", () => {
	it("renders required fields and artifact hashes deterministically", () => {
		const markdown = renderCheckpointMarkdown(checkpoint());
		expect(markdown).toContain("Implement durable orchestration");
		expect(markdown).toContain("Use node:sqlite");
		expect(markdown).toContain("npm run check");
		expect(markdown).toContain("h-cmd");
		expect(markdown).toContain("h-artifact");
		expect(markdown).toContain("continue with scheduler tests");
	});
});

describe("validateCheckpoint", () => {
	it("passes when checkpoint matches authoritative source", () => {
		expect(validateCheckpoint(checkpoint(), authoritative())).toEqual({ valid: true, errors: [] });
	});

	it("catches fabricated command exitCode", () => {
		const cp = checkpoint({ commands: [{ command: "npm run check", exitCode: 1, outputHash: "h-cmd" }] });
		expect(validateCheckpoint(cp, authoritative()).errors[0]).toContain("exitCode");
	});

	it("catches fabricated command outputHash", () => {
		const cp = checkpoint({ commands: [{ command: "npm run check", exitCode: 0, outputHash: "fake" }] });
		expect(validateCheckpoint(cp, authoritative()).errors[0]).toContain("outputHash");
	});

	it("catches fabricated blocker ids", () => {
		const cp = checkpoint({ blockers: [{ id: "B1", summary: "blocked", severity: "high" }] });
		expect(validateCheckpoint(cp, authoritative()).errors[0]).toContain("blocker");
	});

	it("catches fabricated file paths", () => {
		const cp = checkpoint({ files: { read: ["foundation.md"], modified: ["unexpected.ts"] } });
		expect(validateCheckpoint(cp, authoritative()).errors[0]).toContain("file");
	});

	it("catches fabricated artifact hashes", () => {
		const cp = checkpoint({ artifacts: [{ path: "result.md", sha256: "fake", kind: "result" }] });
		expect(validateCheckpoint(cp, authoritative()).errors[0]).toContain("artifact");
	});
});

describe("deriveResumePlan", () => {
	it("prioritizes high severity blockers over open tasks", () => {
		const plan = deriveResumePlan(
			checkpoint({ blockers: [{ id: "B1", summary: "resolve in_doubt merge", severity: "high" }] }),
		);
		expect(plan.kind).toBe("blocker");
		expect(plan.summary).toContain("resolve in_doubt merge");
	});

	it("uses the highest-priority open task when there is no blocker", () => {
		const plan = deriveResumePlan(
			checkpoint({
				openTasks: [
					{ id: "T-low", summary: "later", priority: 10 },
					{ id: "T-high", summary: "now", priority: 1 },
				],
			}),
		);
		expect(plan.kind).toBe("task");
		expect(plan.targetId).toBe("T-high");
	});

	it("falls back to resumeAction when there are no blockers or tasks", () => {
		const plan = deriveResumePlan(checkpoint({ openTasks: [] }));
		expect(plan.kind).toBe("resumeAction");
		expect(plan.summary).toContain("continue with scheduler tests");
	});
});

describe("enforceCheckpointBudget", () => {
	it("keeps current goal, hashes marker, and resume action under a character budget", () => {
		const markdown = renderCheckpointMarkdown(
			checkpoint({ constraints: Array.from({ length: 30 }, (_, i) => `constraint-${i}`) }),
		);
		const compact = enforceCheckpointBudget(markdown, 260);
		expect(compact.length).toBeLessThanOrEqual(260);
		expect(compact).toContain("Implement durable orchestration");
		expect(compact).toContain("Evidence hashes preserved");
		expect(compact).toContain("continue with scheduler tests");
	});
});
