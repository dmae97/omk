import { describe, expect, it } from "vitest";
import { evaluateTask } from "../src/evaluation.ts";
import type { EvaluationInput, ExecutionAttempt, Observation, TaskSpec } from "../src/types.ts";

/**
 * T-EVID-F01 (audit §14.2): a pass observed for an earlier candidate must not
 * satisfy the final candidate's claim. When the attempt declares
 * `candidateHash`, observations recorded for a different candidate are
 * excluded from this attempt's evaluation.
 */

const NOW = "2026-09-15T00:00:00.000Z";

function makeAttempt(over: Partial<ExecutionAttempt> = {}): ExecutionAttempt {
	return {
		schemaVersion: "omk.run.v1",
		attemptId: "attempt-2",
		taskId: "task-1",
		sequence: 2,
		trigger: "retry",
		startedAt: NOW,
		finishedAt: NOW,
		executor: { kind: "test" },
		outcome: { kind: "completed" },
		...over,
	};
}

function makeTaskSpec(bindToCandidate?: boolean): TaskSpec {
	return {
		schemaVersion: "omk.run.v1",
		taskId: "task-1",
		goal: "ship it",
		createdAt: NOW,
		claims: [
			{
				claimId: "claim-1",
				statement: "tests passed",
				requirement: "required",
				condition: {
					kind: "observation",
					observationKind: "test.run",
					scope: "task",
					facts: { status: "passed" },
					...(bindToCandidate === undefined ? {} : { bindToCandidate }),
				},
			},
		],
	};
}

function makeObservation(candidate: string | undefined, status: string): Observation {
	return {
		schemaVersion: "omk.run.v1",
		observationId: `obs-${candidate ?? "none"}-${status}`,
		taskId: "task-1",
		attemptId: "attempt-1",
		observedAt: NOW,
		kind: "test.run",
		source: { kind: "verifier", id: "vitest" },
		facts: { status, ...(candidate === undefined ? {} : { candidate }) },
		evidenceRefs: [],
	};
}

function evaluate(input: Pick<EvaluationInput, "observations" | "attempt"> & { spec?: TaskSpec }) {
	return evaluateTask({
		evaluationId: "eval-1",
		evaluatedAt: NOW,
		taskSpec: input.spec ?? makeTaskSpec(),
		attempt: input.attempt,
		observations: input.observations,
	});
}

describe("evidence candidate binding (T-EVID-F01)", () => {
	it("an earlier candidate's pass does not satisfy the final candidate", () => {
		const result = evaluate({
			attempt: makeAttempt({ candidateHash: "sha-final" }),
			observations: [makeObservation("sha-old", "passed"), makeObservation("sha-final", "failed")],
		});
		expect(result.semanticVerdict).toBe("fail");
	});

	it("a matching candidate's pass still satisfies the claim", () => {
		const result = evaluate({
			attempt: makeAttempt({ candidateHash: "sha-final" }),
			observations: [makeObservation("sha-old", "failed"), makeObservation("sha-final", "passed")],
		});
		expect(result.semanticVerdict).toBe("pass");
	});

	it("a stale pass with no current-candidate evidence is inconclusive, not pass", () => {
		const result = evaluate({
			attempt: makeAttempt({ candidateHash: "sha-final" }),
			observations: [makeObservation("sha-old", "passed")],
		});
		expect(result.semanticVerdict).toBe("inconclusive");
	});

	it("explicit bindToCandidate requires the observation to name the candidate", () => {
		const result = evaluate({
			spec: makeTaskSpec(true),
			attempt: makeAttempt({ candidateHash: "sha-final" }),
			observations: [makeObservation(undefined, "passed")],
		});
		expect(result.semanticVerdict).toBe("inconclusive");
	});

	it("attempts without a candidateHash keep legacy task-scope semantics", () => {
		const result = evaluate({
			attempt: makeAttempt(),
			observations: [makeObservation("sha-old", "passed")],
		});
		expect(result.semanticVerdict).toBe("pass");
	});
});
