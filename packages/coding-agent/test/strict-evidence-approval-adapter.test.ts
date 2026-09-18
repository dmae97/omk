import type { ExecutionAttempt, StrictEvidenceBinding, TaskSpec } from "omk-protocol";
import { describe, expect, it } from "vitest";
import { evidenceReceiptToObservation } from "../src/guardrails/evidence-protocol.ts";
import {
	computeEvidenceReceiptCoreSha256,
	createEvidenceReceipt,
	parseSha256Hex,
} from "../src/guardrails/evidence-receipt.ts";
import { createStrictEvidenceApprovalAdapter } from "../src/guardrails/strict-evidence-approval-adapter.ts";
import { computeWorkspaceManifestSha256 } from "../src/guardrails/workspace-fingerprint.ts";
import type { EvidenceReceipt } from "../src/types/evidence.ts";

const now = "2026-09-17T00:00:00.000Z";
const binding: StrictEvidenceBinding = {
	taskId: "task",
	candidateHash: receipt("candidate").core.workspaceAfter.manifestSha256,
	contractDigest: "a".repeat(64),
	environmentDigest: "b".repeat(64),
	checkCodeDigest: "c".repeat(64),
	dependencyDigest: "d".repeat(64),
	generation: 1,
	verificationRound: 1,
};
const taskSpec: TaskSpec = {
	schemaVersion: "omk.run.v1",
	taskId: "task",
	goal: "verify",
	createdAt: now,
	claims: [
		{
			claimId: "checks",
			statement: "passed",
			requirement: "required",
			condition: {
				kind: "observation",
				observationKind: "evidence_receipt.v3",
				scope: "attempt",
				facts: { exitCode: 0, timedOut: false, aborted: false },
			},
		},
	],
};
const attempt: ExecutionAttempt = {
	schemaVersion: "omk.run.v1",
	taskId: "task",
	attemptId: "attempt",
	sequence: 1,
	trigger: "initial",
	startedAt: now,
	finishedAt: now,
	executor: { kind: "host" },
	outcome: { kind: "completed" },
	candidateHash: binding.candidateHash,
};
function receipt(id: string, passed = true): EvidenceReceipt {
	const scope = { root: "/workspace", artifactPaths: ["result.txt"] };
	const artifacts = [{ path: "result.txt", state: "file" as const, sha256: parseSha256Hex("0".repeat(64)), size: 1 }];
	const workspace = {
		kind: "artifact-set" as const,
		scope,
		artifacts,
		manifestSha256: computeWorkspaceManifestSha256(scope, artifacts),
	};
	return createEvidenceReceipt({
		receiptId: id,
		goalId: "task",
		claim: "checks",
		command: { kind: "argv", executable: "/bin/true", argv: [] },
		cwd: "/workspace",
		timeoutMs: 1000,
		startedAt: now,
		finishedAt: now,
		durationMs: 0,
		workspaceBefore: workspace,
		workspaceAfter: workspace,
		executor: "internal",
		alreadyRedactedOutput: { redactionPolicyId: "test", stdout: new Uint8Array(), stderr: new Uint8Array() },
		...(passed ? ({ status: "passed", exitCode: 0 } as const) : ({ status: "failed", exitCode: 1 } as const)),
	});
}
function admitted(
	id: string,
	sequence: number,
	passed = true,
	checkId = "A",
	previousExecutionId: string | null = null,
) {
	return {
		receipt: receipt(id, passed),
		completion: {
			observationId: `evidence-receipt:${id}`,
			binding,
			checkId,
			sequence,
			executionId: id,
			previousExecutionId,
			verdict: passed ? ("passed" as const) : ("failed" as const),
		},
	};
}
function approve(entries: ReturnType<typeof admitted>[], requiredCheckIds = ["A"], pendingExecutionIds: string[] = []) {
	const adapter = createStrictEvidenceApprovalAdapter({ taskSpec, attempt, binding, requiredCheckIds }, () => ({
		entries,
		pendingExecutionIds,
	}));
	return adapter.evaluate({ evaluationId: "evaluation", evaluatedAt: now });
}

describe("strict evidence public approval adapter", () => {
	it("rejects receipt workspace mismatch instead of relabelling it as the pinned candidate", () => {
		const entry = admitted("wrong", 1);
		entry.completion.binding = { ...binding, candidateHash: "e".repeat(64) };
		expect(() => approve([entry])).toThrow(/workspace/);
	});
	it("rejects conflicting receipt cores even when projected facts are identical", () => {
		const original = admitted("same", 1);
		const core = { ...original.receipt.core, command: { kind: "argv" as const, executable: "/bin/false", argv: [] } };
		const conflict = {
			...original,
			receipt: { core, envelope: { coreSha256: computeEvidenceReceiptCoreSha256(core) } },
		};
		expect(() => approve([original, conflict])).toThrow(/identity/);
	});

	it("preserves explicit candidate-bound claims through the real receipt projection", () => {
		const projected = evidenceReceiptToObservation(receipt("pass"), attempt.attemptId);
		expect(projected.facts).not.toHaveProperty("candidate");
		const bound = structuredClone(taskSpec);
		const claim = bound.claims[0];
		if (claim.condition.kind !== "observation") throw new Error("fixture");
		const adapter = createStrictEvidenceApprovalAdapter(
			{
				taskSpec: { ...bound, claims: [{ ...claim, condition: { ...claim.condition, bindToCandidate: true } }] },
				attempt,
				binding,
				requiredCheckIds: ["A"],
			},
			() => ({ entries: [admitted("pass", 1)], pendingExecutionIds: [] }),
		);
		expect(adapter.evaluate({ evaluationId: "e", evaluatedAt: now }).semanticVerdict).toBe("pass");
	});
	it("invokes the real receipt projection and evaluator rather than accepting stale receipt success", () => {
		const result = approve([admitted("pass", 1), admitted("fail", 2, false, "A", "pass")]);
		expect(result.semanticVerdict).toBe("fail");
		expect(result.strictEvidence?.acceptance).toBe("denied");
		expect(approve([admitted("pass", 1)]).strictEvidence?.acceptance).toBe("passed_by_checks");
	});
});
