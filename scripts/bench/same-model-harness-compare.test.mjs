import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareSameModelHarnesses } from "./same-model-harness-compare.mjs";

const baseProvenance = {
	modelId: "claude-sonnet-4-6",
	reasoningEffort: "high",
	taskSetDigest: "a".repeat(64),
	timeoutMs: 300_000,
	budgetCapUsd: 2.0,
};

describe("P1-4: compareSameModelHarnesses", () => {
	it("computes paired pass@1, all-k-success, median tokens per solved task, p95 wall time, and cost deltas", () => {
		const report = compareSameModelHarnesses({
			baselineHarness: "competitor-cli",
			grader: { graderId: "tb-4.0-independent", independent: true },
			runs: [
				{
					harness: "competitor-cli",
					harnessVersion: "1.0.0",
					provenance: baseProvenance,
					trials: [
						{ taskId: "t1", attempt: 1, passed: true, tokens: 40_000, wallTimeMs: 12_000, costUsd: 0.4 },
						{ taskId: "t1", attempt: 2, passed: false, tokens: 50_000, wallTimeMs: 18_000, costUsd: 0.5 },
						{ taskId: "t2", attempt: 1, passed: false, tokens: 60_000, wallTimeMs: 25_000, costUsd: 0.6 },
						{ taskId: "t2", attempt: 2, passed: true, tokens: 48_000, wallTimeMs: 20_000, costUsd: 0.48 },
					],
				},
				{
					harness: "omk",
					harnessVersion: "3.0.0",
					provenance: baseProvenance,
					trials: [
						{ taskId: "t1", attempt: 1, passed: true, tokens: 30_000, wallTimeMs: 10_000, costUsd: 0.3 },
						{ taskId: "t1", attempt: 2, passed: true, tokens: 32_000, wallTimeMs: 11_000, costUsd: 0.32 },
						{ taskId: "t2", attempt: 1, passed: true, tokens: 36_000, wallTimeMs: 15_000, costUsd: 0.36 },
						{ taskId: "t2", attempt: 2, passed: true, tokens: 34_000, wallTimeMs: 14_000, costUsd: 0.34 },
					],
				},
			],
		});

		assert.equal(report.ok, true);
		assert.equal(report.provenance.modelId, "claude-sonnet-4-6");
		assert.equal(report.harnesses.omk.passAt1, 1);
		assert.equal(report.harnesses.omk.allKSuccess, 1);
		assert.equal(report.harnesses["competitor-cli"].passAt1, 0.5);
		assert.equal(report.harnesses["competitor-cli"].allKSuccess, 0);
		assert.ok(report.deltas.omk.deltaPassAt1Pp === 50);
		assert.ok(report.deltas.omk.deltaMedianTokensPct < 0);
		assert.match(report.claimBoundary, /self-measured/i);
	});

	it("rejects mismatched modelId or budgetCapUsd fail-closed", () => {
		assert.throws(
			() =>
				compareSameModelHarnesses({
					baselineHarness: "competitor-cli",
					grader: { graderId: "tb-4.0-independent", independent: true },
					runs: [
						{
							harness: "competitor-cli",
							harnessVersion: "1.0.0",
							provenance: baseProvenance,
							trials: [{ taskId: "t1", attempt: 1, passed: true, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
						{
							harness: "omk",
							harnessVersion: "3.0.0",
							provenance: { ...baseProvenance, modelId: "gpt-5.4" },
							trials: [{ taskId: "t1", attempt: 1, passed: true, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
					],
				}),
			/provenance mismatch/i,
		);
	});

	it("rejects mismatched task sets or duplicate attempts fail-closed", () => {
		assert.throws(
			() =>
				compareSameModelHarnesses({
					baselineHarness: "competitor-cli",
					grader: { graderId: "tb-4.0-independent", independent: true },
					runs: [
						{
							harness: "competitor-cli",
							harnessVersion: "1.0.0",
							provenance: baseProvenance,
							trials: [{ taskId: "t1", attempt: 1, passed: true, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
						{
							harness: "omk",
							harnessVersion: "3.0.0",
							provenance: baseProvenance,
							trials: [{ taskId: "t2", attempt: 1, passed: true, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
					],
				}),
			/task set mismatch/i,
		);
	});

	it("P0-08: tracks pinned harness versions, failed trial costs, and enforces independent grader metadata across OMK/Claude Code/OMO", () => {
		const report = compareSameModelHarnesses({
			baselineHarness: "claude-code",
			grader: { graderId: "tb-4.0-independent", independent: true },
			runs: [
				{
					harness: "claude-code",
					harnessVersion: "2.1.0",
					provenance: baseProvenance,
					trials: [
						{ taskId: "t1", attempt: 1, passed: false, tokens: 50_000, wallTimeMs: 15_000, costUsd: 0.5 },
						{ taskId: "t1", attempt: 2, passed: true, tokens: 40_000, wallTimeMs: 12_000, costUsd: 0.4 },
					],
				},
				{
					harness: "omo",
					harnessVersion: "1.4.2",
					provenance: baseProvenance,
					trials: [
						{ taskId: "t1", attempt: 1, passed: false, tokens: 60_000, wallTimeMs: 20_000, costUsd: 0.6 },
						{ taskId: "t1", attempt: 2, passed: false, tokens: 55_000, wallTimeMs: 18_000, costUsd: 0.55 },
					],
				},
				{
					harness: "omk",
					harnessVersion: "2.0.5",
					provenance: baseProvenance,
					trials: [
						{ taskId: "t1", attempt: 1, passed: true, tokens: 30_000, wallTimeMs: 9_000, costUsd: 0.3 },
						{ taskId: "t1", attempt: 2, passed: true, tokens: 28_000, wallTimeMs: 8_500, costUsd: 0.28 },
					],
				},
			],
		});
		assert.equal(report.harnesses.omk.harnessVersion, "2.0.5");
		assert.equal(report.harnesses["claude-code"].failedCostUsd, 0.5);
		assert.equal(report.harnesses["claude-code"].costPerSolvedTaskUsd, 0.9);
		assert.equal(report.harnesses.omo.failedTrialCount, 2);
		assert.equal(report.harnesses.omo.costPerSolvedTaskUsd, null);

		assert.throws(
			() =>
				compareSameModelHarnesses({
					baselineHarness: "claude-code",
					grader: { graderId: "self-eval", independent: false },
					runs: [
						{
							harness: "claude-code",
							provenance: baseProvenance,
							trials: [{ taskId: "t1", attempt: 1, passed: true, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
						{
							harness: "omk",
							provenance: baseProvenance,
							trials: [{ taskId: "t1", attempt: 1, passed: true, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
					],
				}),
			/independent grader/i,
		);
	});

	it("P0-5: rejects missing attempt 1 (never counts attempt 2 as pass@1) and rejects missing model, version, or grader metadata", () => {
		const validGrader = { graderId: "tb-4.0-independent", independent: true };
		// Missing attempt 1 with attempt 2 passed MUST fail closed (never inflate pass@1)
		assert.throws(
			() =>
				compareSameModelHarnesses({
					baselineHarness: "claude-code",
					grader: validGrader,
					runs: [
						{
							harness: "claude-code",
							harnessVersion: "2.1.0",
							provenance: baseProvenance,
							trials: [{ taskId: "t1", attempt: 1, passed: false, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
						{
							harness: "omk",
							harnessVersion: "3.0.0",
							provenance: baseProvenance,
							trials: [{ taskId: "t1", attempt: 2, passed: true, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
					],
				}),
			/attempt 1|contiguous/i,
		);

		// Missing modelId on both runs MUST be rejected (not silently equal undefined === undefined)
		const noModel = { ...baseProvenance };
		delete noModel.modelId;
		assert.throws(
			() =>
				compareSameModelHarnesses({
					baselineHarness: "claude-code",
					grader: validGrader,
					runs: [
						{
							harness: "claude-code",
							harnessVersion: "2.1.0",
							provenance: noModel,
							trials: [{ taskId: "t1", attempt: 1, passed: true, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
						{
							harness: "omk",
							harnessVersion: "3.0.0",
							provenance: noModel,
							trials: [{ taskId: "t1", attempt: 1, passed: true, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
					],
				}),
			/modelId/i,
		);

		// Missing harnessVersion MUST be rejected
		assert.throws(
			() =>
				compareSameModelHarnesses({
					baselineHarness: "claude-code",
					grader: validGrader,
					runs: [
						{
							harness: "claude-code",
							provenance: baseProvenance,
							trials: [{ taskId: "t1", attempt: 1, passed: true, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
						{
							harness: "omk",
							harnessVersion: "3.0.0",
							provenance: baseProvenance,
							trials: [{ taskId: "t1", attempt: 1, passed: true, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
					],
				}),
			/harnessVersion/i,
		);

		// Missing grader MUST be rejected
		assert.throws(
			() =>
				compareSameModelHarnesses({
					baselineHarness: "claude-code",
					runs: [
						{
							harness: "claude-code",
							harnessVersion: "2.1.0",
							provenance: baseProvenance,
							trials: [{ taskId: "t1", attempt: 1, passed: true, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
						{
							harness: "omk",
							harnessVersion: "3.0.0",
							provenance: baseProvenance,
							trials: [{ taskId: "t1", attempt: 1, passed: true, tokens: 1000, wallTimeMs: 100, costUsd: 0.01 }],
						},
					],
				}),
			/independent grader/i,
		);
	});
});
