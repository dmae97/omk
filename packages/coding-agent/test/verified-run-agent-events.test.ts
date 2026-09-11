import { parseRunContract, parseRunStartCommand } from "omk-protocol";
import { describe, expect, it } from "vitest";
import { projectRun, type RunEvent } from "../src/core/verified-run/events.ts";
import { digestObject } from "../src/core/verified-run/storage.ts";

function prefix(): RunEvent[] {
	const contract = parseRunContract({
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-scripted-agent-v1",
		runId: "agent",
		goal: "copy",
		workspace: { root: "/workspace", baseDigest: "a".repeat(64) },
		writablePaths: ["output"],
		writer: { kind: "scripted-agent", steps: [["/bin/true"]], maxRequests: 2 },
		checks: [{ claimId: "result", argv: ["/bin/true"], stdout: "" }],
		budget: { workMs: 1000, verifyMs: 1000, cleanupMs: 1000, maxOutputBytes: 1024, maxFiles: 10, maxBytes: 1024 },
		apply: "artifact-only",
	});
	const command = parseRunStartCommand({
		schemaVersion: "omk.verified-command.v1",
		kind: "start",
		runId: contract.runId,
		commandId: "start",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: digestObject(contract),
	});
	return [
		{ kind: "created", contract, command },
		{ kind: "writer_opened" },
		{ kind: "model_request", requestId: "request-1" },
		{ kind: "dispatch", role: "writer", executionId: "execution-1", claimId: null },
		{ kind: "exited", executionId: "execution-1", failure: null },
	];
}

describe("scripted writer producer ownership", () => {
	it("keeps settlement open after a child closes while AgentSession still produces work", () => {
		expect(projectRun(prefix())).toMatchObject({ writerOpen: true, settlement: "open", activeExecutionIds: [] });
	});

	it("cannot freeze a candidate or close a producer before the final model turn", () => {
		expect(() => projectRun([...prefix(), { kind: "candidate", digest: "b".repeat(64) }])).toThrow(/integrity/);
		expect(() => projectRun([...prefix(), { kind: "writer_closed", completed: true }])).toThrow(/integrity/);
	});

	it("rejects duplicate requests, an exhausted cap, and late reopening", () => {
		expect(() => projectRun([...prefix(), { kind: "model_request", requestId: "request-1" }])).toThrow(
			/model_request_limit/,
		);
		const ready: RunEvent[] = [...prefix(), { kind: "model_request", requestId: "request-2" }];
		expect(() => projectRun([...ready, { kind: "model_request", requestId: "request-3" }])).toThrow(
			/model_request_limit/,
		);
		expect(() =>
			projectRun([...ready, { kind: "writer_closed", completed: true }, { kind: "writer_opened" }]),
		).toThrow(/integrity/);
	});

	it("settles the completed producer before candidate admission", () => {
		const events: RunEvent[] = [
			...prefix(),
			{ kind: "model_request", requestId: "request-2" },
			{ kind: "writer_closed", completed: true },
			{ kind: "candidate", digest: "b".repeat(64) },
		];
		expect(projectRun(events)).toMatchObject({
			writerOpen: false,
			settlement: "settled",
			candidateDigest: "b".repeat(64),
			modelRequests: 2,
		});
	});

	it("preserves an open producer on unreconciled failure", () => {
		expect(projectRun([...prefix(), { kind: "failed", code: "unsettled" }])).toMatchObject({
			writerOpen: true,
			settlement: "quarantined",
		});
	});
});
