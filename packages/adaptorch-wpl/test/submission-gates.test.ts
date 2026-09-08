import { describe, expect, it } from "vitest";
import type { AdjudicationResult } from "../src/adjudicator.ts";
import { type MapToB2CInput, mapToB2C } from "../src/b2c-mapper.ts";
import { evaluateCorrectnessWall } from "../src/evaluate-correctness-wall.ts";
import { createInMemoryAdaptOrchClient } from "../src/in-memory-adaptorch.ts";
import { POLICY_FLAG } from "../src/policy-wall.ts";

const input: MapToB2CInput = {
	kind: "code-edit",
	runIds: ["run-local"],
	previewOnly: false,
	policyFlags: [],
	diffPaths: ["src/example.ts"],
};
const confirmed: AdjudicationResult = {
	verdict: "CONFIRMED",
	reason_code: "ALL_CHECKS_PASSED",
	reason: "Fixture checks passed",
	per_run: [],
};
const diffText = "--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new";

function confirmedClient() {
	return createInMemoryAdaptOrchClient({
		"run-local": {
			run: { run_id: "run-local", status: "completed" },
			artifacts: [{ path: "out.md", size_bytes: 42 }],
			traces: [{ kind: "write", level: "info" }],
		},
	});
}

describe("WPL submission evidence gate", () => {
	it("keeps local apply separate from submission when no adjudication exists", () => {
		const { receipt } = mapToB2C(input);
		expect(receipt.canApply).toBe(true);
		expect(receipt.shouldSubmit).toBe(false);
	});

	it("does not submit a preview even when a caller supplies confirmed adjudication", () => {
		const { receipt } = mapToB2C({ ...input, previewOnly: true, adjudication: confirmed });
		expect(receipt.shouldSubmit).toBe(false);
	});

	it("does not submit when the confirmed result has no run identity", () => {
		const { receipt } = mapToB2C({ ...input, runIds: [], adjudication: confirmed });
		expect(receipt.shouldSubmit).toBe(false);
	});

	it("allows submission only when non-preview evidence confirms an applicable change", () => {
		const { receipt } = mapToB2C({ ...input, adjudication: confirmed });
		expect(receipt.canApply).toBe(true);
		expect(receipt.shouldSubmit).toBe(true);
	});

	it.each([
		{ verdict: "CORROBORATED-FAILURE", reason_code: "FAILURE_REPORTED" },
		{ verdict: "CONTRADICTED", reason_code: "CONTENT_CHECK_FAILED" },
		{ verdict: "INDETERMINATE", reason_code: "EVIDENCE_EMPTY" },
		{ verdict: "VERIFIER-ERROR", reason_code: "RUN_FETCH_FAILED" },
	] as const)("does not submit when adjudication is $verdict", ({ verdict, reason_code }) => {
		const adjudication: AdjudicationResult = { verdict, reason_code, reason: "Fixture outcome", per_run: [] };
		const { receipt } = mapToB2C({ ...input, adjudication });
		expect(receipt.shouldSubmit).toBe(false);
	});

	it.each([
		POLICY_FLAG.NON_NEGOTIABLE_BLOCKING,
		POLICY_FLAG.SECRET_SUSPECT,
		POLICY_FLAG.CANDIDATE_LEAK_SUSPECT,
		POLICY_FLAG.EVIDENCE_DAG_INCOMPLETE,
	])("does not submit confirmed evidence when policy flag %s remains", (flag) => {
		const { receipt } = mapToB2C({ ...input, adjudication: confirmed, policyFlags: [flag] });
		expect(receipt.shouldSubmit).toBe(false);
	});
});

describe("Correctness Wall submission integration", () => {
	it("does not submit when the diff is empty", async () => {
		const { receipt } = await evaluateCorrectnessWall({ kind: "code-edit", diffText: "", previewOnly: true });
		expect(receipt.shouldSubmit).toBe(false);
	});

	it("does not submit when a run id has no evidence transport", async () => {
		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			diffText,
			runIds: ["run-local"],
			previewOnly: false,
		});
		expect(verdictCard.verdict).toBe("INCONCLUSIVE");
		expect(receipt.shouldSubmit).toBe(false);
	});

	it("submits when real in-memory adjudication confirms the change", async () => {
		const { receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			diffText,
			approvedWriteScope: ["src/**"],
			runIds: ["run-local"],
			previewOnly: false,
			client: confirmedClient(),
		});
		expect(receipt.adjudicationVerdict).toBe("CONFIRMED");
		expect(receipt.shouldSubmit).toBe(true);
	});

	it("withholds submission when an explicitly requested deep check is unavailable", async () => {
		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			diffText,
			runIds: ["run-local"],
			previewOnly: false,
			client: confirmedClient(),
			deepWall: true,
		});
		expect(receipt.deepWallStatus).toBe("unavailable");
		expect(verdictCard.limits.requiresHumanReview).toBe(true);
		expect(receipt.shouldSubmit).toBe(false);
	});
});
