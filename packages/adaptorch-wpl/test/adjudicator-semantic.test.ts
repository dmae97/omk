import { describe, expect, it } from "vitest";
import { adjudicate } from "../src/adjudicator.ts";
import { createVerifierRegistry } from "../src/adjudicator-registry.ts";
import { evaluateCorrectnessWall } from "../src/evaluate-correctness-wall.ts";
import { createInMemoryAdaptOrchClient } from "../src/in-memory-adaptorch.ts";

// Synthetic schema-shaped regression cases; these are not recovered production runs.
const request = { dispatch_record_id: "synthetic-dispatch", kind: "code-review", run_ids: ["synthetic-run"] };
const registry = createVerifierRegistry([]);
const baseRun = {
	run_id: "synthetic-run",
	status: "SUCCEEDED",
	result_status: "OK",
	evaluation_status: "COMPLETE",
	score_validity_status: "VALID",
	correctness_wall: { verdict: "PASS", blockers: [], advisories: [] },
};
function clientFor(run: unknown) {
	return createInMemoryAdaptOrchClient({
		"synthetic-run": {
			run,
			artifacts: [{ path: "review.md", size_bytes: 42 }],
			traces: [{ kind: "write", severity: "info" }],
		},
	});
}

describe("adjudicator semantic boundary (synthetic)", () => {
	it.each([
		["degraded result", { result_status: "DEGRADED" }, "RESULT_DEGRADED"],
		["failed result", { result_status: "FAILED" }, "RESULT_FAILED"],
		[
			"blocked wall",
			{ correctness_wall: { verdict: "BLOCKED", blockers: ["capability-unavailable"] } },
			"SEMANTIC_BLOCKED",
		],
		["inconclusive wall", { correctness_wall: { verdict: "INCONCLUSIVE" } }, "SEMANTIC_INCONCLUSIVE"],
		["advisory wall", { correctness_wall: { verdict: "ADVISORY" } }, "SEMANTIC_INCONCLUSIVE"],
		[
			"uncorroborated",
			{ diagnostics: { corroboration: { candidates: 1, cross_candidate_evidence: false } } },
			"CORROBORATION_INSUFFICIENT",
		],
		[
			"engine nested uncorroborated",
			{ diagnostics: { verification: { corroboration: { candidates: 1, cross_candidate_evidence: false } } } },
			"CORROBORATION_INSUFFICIENT",
		],
		["evaluation error", { evaluation_status: "ERROR" }, "EVALUATION_INCOMPLETE"],
		[
			"verifier infrastructure error",
			{
				diagnostics: {
					verification: { selected: { passed: false, total_commands: 0, failure_category: "verifier_error" } },
				},
			},
			"VERIFICATION_REPORTED_FAILURE",
		],
		["partial scores", { score_validity_status: "PARTIAL" }, "EVALUATION_INCOMPLETE"],
		["unknown result", { result_status: "FUTURE_STATUS" }, "SEMANTIC_STATUS_UNRECOGNIZED"],
	] as const)("does not confirm %s after successful transport", async (_label, overrides, code) => {
		const run = { ...baseRun, ...overrides };
		const result = await adjudicate(request, clientFor(run), registry);
		expect(result.verdict).toBe("INDETERMINATE");
		expect(result.reason_code).toBe(code);
		expect(result.per_run[0].evidence_refs).toMatchObject({ run });
	});

	it.each([
		{ run_id: "synthetic-run", status: "completed" },
		baseRun,
		{ ...baseRun, consistency: 0.1 },
		{ ...baseRun, diagnostics: { corroboration: { candidates: 2, cross_candidate_evidence: true } } },
		{ ...baseRun, evidence: { checks: [{ name: "run", status: "PASSED" }] } },
		{ ...baseRun, diagnostics: { verification: { selected: { passed: true, pass_rate: 1 } } } },
		{ ...baseRun, output: "FINAL:PASS", consistency: 1, candidates: ["FINAL:PASS", "FINAL:PASS"] },
	])("does not treat structural success or model agreement as execution proof", async (run) => {
		const result = await adjudicate(request, clientFor(run), registry);
		expect(result.verdict).toBe("INDETERMINATE");
		expect(result.reason_code).toBe("VERIFICATION_UNAVAILABLE");
	});

	it("keeps a policy/capability block distinct from contradiction and closes B2C gates", async () => {
		const { receipt, verdictCard } = await evaluateCorrectnessWall({
			kind: request.kind,
			runIds: request.run_ids,
			client: clientFor({
				...baseRun,
				correctness_wall: { verdict: "BLOCKED", blockers: ["capability-unavailable"] },
			}),
			diffText: "--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n+// synthetic",
			approvedWriteScope: ["example.ts"],
		});
		expect(receipt.adjudicationVerdict).toBe("INDETERMINATE");
		expect(verdictCard.verdict).toBe("BLOCKED");
		expect(receipt.canApply).toBe(false);
		expect(receipt.shouldSubmit).toBe(false);
	});
});
