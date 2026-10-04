import { describe, expect, it, vi } from "vitest";
import { adjudicate } from "../src/adjudicator.ts";
import { createVerifierRegistry } from "../src/adjudicator-registry.ts";
import { mapToB2C } from "../src/b2c-mapper.ts";
import { createInMemoryAdaptOrchClient } from "../src/in-memory-adaptorch.ts";
import { projectVerdictToDisposition } from "../src/loop.ts";
import type { WorkPacket } from "../src/types.ts";

// Synthetic payload permutations, independent of any production run set.
const evidence = { artifacts: [{ path: "synthetic.md", size_bytes: 1 }], traces: [{ kind: "write" }] };
const registry = createVerifierRegistry([]);
// Projection only uses retry_count and must escalate even when retries remain.
const packet = { retry_count: 0 } as WorkPacket;
const baseRun = { run_id: "uncertain", status: "SUCCEEDED" };
const unverifiedRuns = [
	{ ...baseRun, correctness_wall: { verdict: "BLOCKED", blockers: ["capability-unavailable"] } },
	{ ...baseRun, result_status: "DEGRADED" },
	{ ...baseRun, correctness_wall: { verdict: "INCONCLUSIVE" } },
	baseRun,
];

describe("mixed-run action eligibility", () => {
	it.each(["QUEUED", "RUNNING", "FUTURE_STATUS", undefined, null])(
		"preserves an explicit block before lifecycle parsing (%s)",
		async (status) => {
			const run = { ...unverifiedRuns[0], status };
			const client = createInMemoryAdaptOrchClient({ uncertain: { run, ...evidence } });
			const result = await adjudicate(
				{ dispatch_record_id: "d", kind: "review", run_ids: ["uncertain"] },
				client,
				registry,
			);
			expect(result.verdict).toBe("INDETERMINATE");
			expect(result.reason_code).toBe("SEMANTIC_BLOCKED");
			expect(result.per_run[0].evidence_refs).toEqual({ run });
		},
	);

	it.each(unverifiedRuns)("does not retry any unverified sibling: %j", async (run) => {
		for (const sibling of [
			{ run: { run_id: "other", status: "FAILED" }, ...evidence },
			{ run: { run_id: "other", status: "SUCCEEDED" }, ...evidence, traces: [{ level: "error" }] },
		]) {
			for (const run_ids of [
				["uncertain", "other"],
				["other", "uncertain"],
			]) {
				const client = createInMemoryAdaptOrchClient({ uncertain: { run, ...evidence }, other: sibling });
				const result = await adjudicate({ dispatch_record_id: "d", kind: "review", run_ids }, client, registry);
				expect(result.per_run.find((item) => item.run_id === "uncertain")?.verdict).toBe("INDETERMINATE");
				expect(await projectVerdictToDisposition(result, packet)).toEqual({
					targetState: "DECLINED",
					nextActionKind: "escalate",
				});
				const b2c = mapToB2C({
					kind: "review",
					runIds: run_ids,
					previewOnly: false,
					policyFlags: [],
					diffPaths: ["synthetic.md"],
					adjudication: result,
				});
				expect(b2c.receipt.canApply).toBe(false);
				expect(b2c.receipt.shouldSubmit).toBe(false);
				if ("correctness_wall" in run && run.correctness_wall?.verdict === "BLOCKED")
					expect(b2c.verdictCard.verdict).toBe("BLOCKED");
			}
		}
	});

	it("never invokes augmentation hooks for explicit blocks, including mixed failure records", async () => {
		const build_augmented_payload = vi.fn(() => {
			throw new Error("synthetic builder must not run");
		});
		for (const run_ids of [["uncertain"], ["uncertain", "other"], ["other", "uncertain"]]) {
			const run = unverifiedRuns[0];
			const result = await adjudicate(
				{ dispatch_record_id: "d", kind: "review", run_ids },
				createInMemoryAdaptOrchClient({
					uncertain: { run, ...evidence },
					other: { run: { run_id: "other", status: "FAILED" }, ...evidence },
				}),
				createVerifierRegistry([{ kind: "review", build_augmented_payload }]),
			);
			expect(result.per_run.find((item) => item.run_id === "uncertain")?.reason_code).toBe("SEMANTIC_BLOCKED");
			expect(result.per_run.find((item) => item.run_id === "uncertain")?.evidence_refs).toEqual({ run });
			expect(result.augmented_payload).toBeUndefined();
			expect(await projectVerdictToDisposition(result, packet)).toEqual({
				targetState: "DECLINED",
				nextActionKind: "escalate",
			});
		}
		expect(build_augmented_payload).not.toHaveBeenCalled();
	});

	it("does not trust a contradictory caller aggregate that labels unverified children CONFIRMED", async () => {
		const result = {
			verdict: "CONFIRMED" as const,
			reason_code: "ALL_CHECKS_PASSED" as const,
			reason: "synthetic inconsistent caller",
			per_run: [
				{
					run_id: "uncertain",
					verdict: "INDETERMINATE" as const,
					reason_code: "EVIDENCE_EMPTY" as const,
					reason: "missing",
					evidence_refs: {},
				},
			],
		};
		expect(await projectVerdictToDisposition(result, packet)).toEqual({
			targetState: "DECLINED",
			nextActionKind: "escalate",
		});
		const b2c = mapToB2C({
			kind: "review",
			runIds: ["uncertain"],
			previewOnly: false,
			policyFlags: [],
			diffPaths: ["synthetic.md"],
			adjudication: result,
		});
		expect(b2c.verdictCard.verdict).toBe("INCONCLUSIVE");
		expect(b2c.receipt.canApply).toBe(false);
		expect(b2c.receipt.shouldSubmit).toBe(false);
	});
});
