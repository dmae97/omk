import { describe, expect, it } from "vitest";
import { evaluateTask } from "../src/evaluation.ts";
import type { EvaluationInput, Observation } from "../src/types.ts";

const now = "2026-09-17T00:00:00.000Z";
const binding = {
	taskId: "task",
	candidateHash: "candidate",
	contractDigest: "a".repeat(64),
	environmentDigest: "b".repeat(64),
	checkCodeDigest: "c".repeat(64),
	dependencyDigest: "d".repeat(64),
	generation: 1,
	verificationRound: 1,
};
function observation(id: string, passed: boolean): Observation {
	return {
		schemaVersion: "omk.run.v1",
		observationId: id,
		taskId: "task",
		attemptId: "attempt",
		observedAt: now,
		kind: "check",
		source: { kind: "host", id: "runner" },
		facts: { passed },
		evidenceRefs: [],
	};
}
const pass = observation("pass", true);
const fail = observation("fail", false);
const input: EvaluationInput = {
	evaluationId: "evaluation",
	evaluatedAt: now,
	taskSpec: {
		schemaVersion: "omk.run.v1",
		taskId: "task",
		goal: "check",
		createdAt: now,
		claims: [
			{
				claimId: "checks",
				statement: "passed",
				requirement: "required",
				condition: { kind: "observation", observationKind: "check", scope: "attempt", facts: { passed: true } },
			},
		],
	},
	attempt: {
		schemaVersion: "omk.run.v1",
		taskId: "task",
		attemptId: "attempt",
		sequence: 1,
		trigger: "initial",
		startedAt: now,
		finishedAt: now,
		executor: { kind: "host" },
		outcome: { kind: "completed" },
		candidateHash: "candidate",
	},
	observations: [pass, fail],
};

describe("strict evidence approval", () => {
	it("denies approval while the current verification round is still pending", () => {
		const strict = {
			...input,
			strictEvidence: {
				policy: "omk.strict-evidence.v1" as const,
				binding,
				requiredCheckIds: ["A"],
				pendingExecutionIds: ["run-2"],
				results: [
					{
						observationId: "pass",
						checkId: "A",
						binding,
						sequence: 1,
						executionId: "run-1",
						previousExecutionId: null,
						verdict: "passed" as const,
					},
				],
			},
		};
		const result = evaluateTask(strict);
		expect(result.semanticVerdict).toBe("inconclusive");
		expect(result.strictEvidence?.status).toBe("pending");
	});
	it("keeps the same verdict and evidence ID set when only observation order changes", () => {
		const strict = {
			...input,
			strictEvidence: {
				policy: "omk.strict-evidence.v1" as const,
				binding,
				requiredCheckIds: ["A"],
				pendingExecutionIds: [],
				results: [
					{
						observationId: "fail",
						checkId: "A",
						binding,
						sequence: 2,
						executionId: "run-2",
						previousExecutionId: "run-1",
						verdict: "failed" as const,
					},
					{
						observationId: "pass",
						checkId: "A",
						binding,
						sequence: 1,
						executionId: "run-1",
						previousExecutionId: null,
						verdict: "passed" as const,
					},
				],
			},
		};
		const base = evaluateTask(strict);
		const permuted = evaluateTask({ ...strict, observations: [...input.observations].reverse() });
		expect(permuted.semanticVerdict).toBe(base.semanticVerdict);
		expect(permuted.strictEvidence?.observationIds).toEqual(base.strictEvidence?.observationIds);
	});
	it("rejects a completion whose candidate disagrees with its observation facts", () => {
		const observed = { ...pass, facts: { passed: true, candidate: "different" } };
		const strict = {
			...input,
			taskSpec: { ...input.taskSpec, claims: [] },
			observations: [observed],
			strictEvidence: {
				policy: "omk.strict-evidence.v1" as const,
				binding,
				requiredCheckIds: ["A"],
				pendingExecutionIds: [],
				results: [
					{
						observationId: "pass",
						checkId: "A",
						binding,
						sequence: 1,
						executionId: "run-1",
						previousExecutionId: null,
						verdict: "passed" as const,
					},
				],
			},
		};
		expect(() => evaluateTask(strict)).toThrow(/binding/);
	});
	it("does not accept an earlier pass after the same check completed with failure", () => {
		const strict = {
			...input,
			strictEvidence: {
				policy: "omk.strict-evidence.v1" as const,
				binding,
				requiredCheckIds: ["A"],
				pendingExecutionIds: [],
				results: [
					{
						observationId: "pass",
						checkId: "A",
						binding,
						sequence: 1,
						executionId: "run-1",
						previousExecutionId: null,
						verdict: "passed" as const,
					},
					{
						observationId: "fail",
						checkId: "A",
						binding,
						sequence: 2,
						executionId: "run-2",
						previousExecutionId: "run-1",
						verdict: "failed" as const,
					},
				],
			},
		};
		expect(evaluateTask(strict).semanticVerdict).toBe("fail");
		expect(evaluateTask(input).semanticVerdict).toBe("pass");
	});
});
