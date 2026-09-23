import { parseRunContract, parseRunStartCommand, parseRunWriterRestartCommand } from "omk-protocol";
import { describe, expect, it } from "vitest";
import { projectRun, type RunEvent } from "../src/core/verified-run/events.ts";
import { anchorRunBudget } from "../src/core/verified-run/recovery-clock.ts";
import { digestObject } from "../src/core/verified-run/storage.ts";

const bootId = "00000000-0000-0000-0000-000000000001";
function restarted(): RunEvent[] {
	const contract = parseRunContract({
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-scripted-agent-v1",
		runId: "run",
		goal: "step",
		workspace: { root: "/workspace", baseDigest: "a".repeat(64) },
		writablePaths: ["output"],
		writer: { kind: "scripted-agent", steps: [["/bin/true"]], maxRequests: 5 },
		checks: [{ claimId: "check", argv: ["/bin/true"], stdout: "" }],
		budget: { workMs: 5000, verifyMs: 5000, cleanupMs: 15000, maxOutputBytes: 1024, maxFiles: 10, maxBytes: 1024 },
		apply: "artifact-only",
	});
	const command = parseRunStartCommand({
		schemaVersion: "omk.verified-command.v1",
		kind: "start",
		runId: "run",
		commandId: "start",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: digestObject(contract),
	});
	const events: RunEvent[] = [
		{ kind: "created", contract, command },
		{
			kind: "budget_anchored",
			budget: anchorRunBudget(contract.budget, { bootId, nowMs: 0 }),
			environmentDigest: "b".repeat(64),
			driver: "linux-pidns-gate-v1",
		},
		{ kind: "input_checkpoint", digest: contract.workspace.baseDigest },
		{ kind: "writer_opened" },
		{ kind: "model_request", requestId: "old-request" },
	];
	events.push(
		{
			kind: "writer_restarted",
			command: parseRunWriterRestartCommand({
				schemaVersion: "omk.verified-command.v1",
				kind: "restart_writer",
				runId: "run",
				commandId: "restart",
				expectedRevision: events.length,
				expectedGeneration: 1,
				contractDigest: digestObject(contract),
				baseDigest: contract.workspace.baseDigest,
			}),
			observedMs: 100,
			reconciledExecutionIds: [],
		},
		{ kind: "writer_opened" },
	);
	return events;
}

describe("writer attempt accounting", () => {
	it("does not count an old request as the new attempt's final model turn", () => {
		const events: RunEvent[] = [
			...restarted(),
			{ kind: "model_request", requestId: "new-request" },
			{ kind: "dispatch", executionId: "new-exec", role: "writer", claimId: null },
			{
				kind: "process_ready",
				executionId: "new-exec",
				identity: { pid: 123, startTicks: "1", namespace: "pid:[1]", bootId },
			},
			{ kind: "exited", executionId: "new-exec", failure: null },
		];
		expect(() => projectRun([...events, { kind: "writer_closed", completed: true }])).toThrow(/integrity/);
		expect(
			projectRun([
				...events,
				{ kind: "model_request", requestId: "final-request" },
				{ kind: "writer_closed", completed: true },
			]),
		).toMatchObject({ generation: 2, writerOpen: false, modelRequests: 3 });
	});
	it("keeps old request IDs fenced across generation changes", () => {
		expect(() => projectRun([...restarted(), { kind: "model_request", requestId: "old-request" }])).toThrow(
			/model_request_limit/,
		);
	});
});
