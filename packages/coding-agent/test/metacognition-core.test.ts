/**
 * Tests for the metacognition kernel modules: obligations (A), predictions
 * (B), verifier meta-evaluation (D), calibration/drift (E+G), and the
 * bounded checkpoint policy (F, §9.4/§14).
 */
import { describe, expect, it } from "vitest";
import {
	type ChangeAtom,
	conditionKeyHash,
	createCalibrationStore,
	demoteOnConditionChange,
	evaluateVerifier,
	instantiateObligations,
	isStagnant,
	type MutantRecord,
	mismatchBranch,
	mismatchSummary,
	netSwitchValue,
	type ObligationRule,
	obligationPriority,
	type Prediction,
	progressKey,
	recordOutcome,
	registerPrediction,
	resolvePrediction,
	retirePrediction,
	settleObligation,
} from "../src/metacognition/index.ts";

const atom = (over: Partial<ChangeAtom> = {}): ChangeAtom => ({
	id: "a1",
	targetId: "src/search.ts",
	operation: "mutate",
	trustBoundary: "ui-state",
	temporal: "async",
	externalEffect: "write",
	source: "host-observed",
	analyzerCoverage: "covered",
	...over,
});
const rule = (over: Partial<ObligationRule> = {}): ObligationRule => ({
	ruleId: "async-boundary",
	ruleVersion: "1",
	description: "async results must not overwrite newer state",
	match: { temporal: ["async", "concurrent"] },
	produce: [
		{
			obligationId: "ordering",
			statement: "late results must not overwrite newer state",
			kind: "postcondition",
			checkMethodId: "ordering-check",
			required: true,
			impact: 9,
		},
	],
	...over,
});

describe("algorithm A — obligation instantiation", () => {
	it("host-observed async write promotes a required obligation", () => {
		const report = instantiateObligations([atom()], [rule()], 1000);
		expect(report.required.length).toBe(1);
		expect(report.required[0]!.status).toBe("required");
		expect(report.required[0]!.checkMethodId).toBe("ordering-check");
	});
	it("model-hypothesized atoms produce candidates, never required obligations", () => {
		const report = instantiateObligations([atom({ source: "model-hypothesized" })], [rule()], 1000);
		expect(report.required.length).toBe(0);
		expect(report.candidates.length).toBe(1);
		expect(report.candidates[0]!.status).toBe("blocked-high-risk");
	});
	it("unmatched effects and unsupported coverage surface as gaps, not silence", () => {
		const report = instantiateObligations(
			[atom({ id: "a2", temporal: "synchronous", externalEffect: "network", analyzerCoverage: "unsupported" })],
			[rule()],
			1000,
		);
		expect(report.unmappedEffects).toContain("a2");
		expect(report.unsupportedSyntax).toContain("a2");
		expect(report.coverage).toBe("unknown");
	});
	it("obligation priority is an ordering key, not a probability", () => {
		const report = instantiateObligations([atom()], [rule()], 1000);
		const o = report.required[0]!;
		expect(obligationPriority(o)).toBeGreaterThan(0);
		expect(Number.isFinite(obligationPriority(o))).toBe(true);
	});
	it("settling an obligation records pass/fail only through the bound check", () => {
		const report = instantiateObligations([atom()], [rule()], 1000);
		const passed = settleObligation(report.required, report.required[0]!.id, "pass");
		expect(passed[0]!.status).toBe("satisfied");
		const failed = settleObligation(report.required, report.required[0]!.id, "fail");
		expect(failed[0]!.status).toBe("violated");
	});
});

const prediction = (over: Partial<Prediction> = {}): Omit<Prediction, "status"> => ({
	predictionId: "p1",
	operationId: "op1",
	taskId: "t1",
	stageId: "s1",
	kind: "check-outcome",
	candidateHash: "cand-1",
	environmentHash: "env-1",
	checkDefinitionHash: "check-1",
	policyVersion: "pol-1",
	modelRevision: "model-1",
	skillHashes: [],
	expectedOutcome: "check passes",
	expectedBinary: true,
	probability: 0.95,
	estimator: "uncalibrated-model-estimate",
	counterevidenceCondition: "check fails",
	hostSequence: 1,
	registeredAtMs: 100,
	...over,
});

describe("algorithm B — prediction ledger", () => {
	it("registers an immutable pre-execution prediction", () => {
		const ledger = registerPrediction([], prediction());
		expect(ledger.length).toBe(1);
		expect(ledger[0]!.status).toBe("registered");
		expect(() => registerPrediction(ledger, prediction())).toThrow();
	});
	it("resolution binds to candidate/environment/check hashes", () => {
		const ledger = registerPrediction([], prediction());
		expect(() =>
			resolvePrediction(ledger, "p1", {
				candidateHash: "other",
				environmentHash: "env-1",
				checkDefinitionHash: "check-1",
				outcome: "check passes",
				binaryOutcome: true,
				observedAtMs: 200,
			}),
		).toThrow();
		expect(() =>
			resolvePrediction(ledger, "p1", {
				candidateHash: "cand-1",
				environmentHash: "env-1",
				checkDefinitionHash: "check-1",
				outcome: "check passes",
				binaryOutcome: true,
				observedAtMs: 50,
			}),
		).toThrow();
	});
	it("unexpected failure at 0.95 produces high Brier and surprise", () => {
		const ledger = registerPrediction([], prediction());
		const { scored } = resolvePrediction(ledger, "p1", {
			candidateHash: "cand-1",
			environmentHash: "env-1",
			checkDefinitionHash: "check-1",
			outcome: "check failed",
			binaryOutcome: false,
			observedAtMs: 200,
		});
		expect(scored.mismatch).toBe("unexpected-fail");
		expect(scored.brier).toBeCloseTo(0.9025, 4);
		expect(scored.surprise).toBeCloseTo(Math.log(20), 3);
	});
	it("superseded and unobserved predictions are never scored as code results", () => {
		let ledger = registerPrediction([], prediction());
		ledger = retirePrediction(ledger, "p1", "superseded");
		expect(ledger[0]!.status).toBe("superseded");
		expect(() =>
			resolvePrediction(ledger, "p1", {
				candidateHash: "cand-1",
				environmentHash: "env-1",
				checkDefinitionHash: "check-1",
				outcome: "check passes",
				binaryOutcome: true,
				observedAtMs: 200,
			}),
		).toThrow();
	});
	it("mismatch summary aggregates kinds and exposes surprising predictions", () => {
		let ledger = registerPrediction([], prediction());
		ledger = resolvePrediction(ledger, "p1", {
			candidateHash: "cand-1",
			environmentHash: "env-1",
			checkDefinitionHash: "check-1",
			outcome: "check failed",
			binaryOutcome: false,
			observedAtMs: 200,
		}).ledger;
		const summary = mismatchSummary(ledger);
		expect(summary.byKind["unexpected-fail"]).toBe(1);
		expect(summary.meanBrier).toBeCloseTo(0.9025, 4);
		expect(mismatchBranch("unexpected-fail")).toBe("cause-hypothesis-discrimination");
	});
});

const mutant = (over: Partial<MutantRecord> = {}): MutantRecord => ({
	mutantId: "m1",
	obligationId: "o1",
	classification: "killed-intended",
	intendedViolation: true,
	...over,
});

describe("algorithm D — verifier meta-evaluation", () => {
	it("detection rate counts only intended kills over valid mutants", () => {
		const evaluation = evaluateVerifier(
			"o1",
			[
				mutant(),
				mutant({ mutantId: "m2", classification: "survived" }),
				mutant({ mutantId: "m3", classification: "equivalent", intendedViolation: false }),
				mutant({ mutantId: "m4", classification: "environment-failure", intendedViolation: false }),
			],
			true,
		);
		expect(evaluation.detectionRate).toBeCloseTo(0.5, 12);
		expect(evaluation.excluded["environment-failure"]).toBe(1);
		expect(evaluation.survivingMutantIds).toEqual(["m2"]);
		expect(evaluation.blindSpots).toContain("undetected-violation:m2");
	});
	it("empty valid-mutant denominator is unknown, never a score", () => {
		expect(evaluateVerifier("o1", [], true).detectionRate).toBe("unknown");
		expect(
			evaluateVerifier("o1", [mutant({ classification: "invalid-compile", intendedViolation: false })], true)
				.detectionRate,
		).toBe("unknown");
	});
	it("stagnation counts repetitions with no new evidence", () => {
		const key = {
			goalScope: "g",
			candidateFamily: "c",
			errorClass: "e",
			approach: "a",
			checkMethod: "t",
			sourceFamily: "s",
		};
		const history = [
			{ key: progressKey(key), newEvidence: false, resolvedObligations: 0, newValidChecks: 0 },
			{ key: progressKey(key), newEvidence: false, resolvedObligations: 0, newValidChecks: 0 },
		];
		expect(isStagnant(key, history, 2)).toBe(true);
		expect(
			isStagnant(key, [{ key: progressKey(key), newEvidence: true, resolvedObligations: 0, newValidChecks: 0 }], 2),
		).toBe(false);
	});
	it("net switch value subtracts both action and switch cost", () => {
		expect(netSwitchValue(2, 0.5, 0.3)).toBeCloseTo(1.2, 12);
		expect(netSwitchValue(0.5, 0.5, 0.3)).toBeCloseTo(-0.3, 12);
	});
});

describe("algorithms E+G — conditional calibration and demotion", () => {
	const store = () =>
		createCalibrationStore({
			minSamples: 3,
			priorAlpha: 1,
			priorBeta: 1,
			referenceMean: 0.2,
			slack: 0.1,
			threshold: 2,
		});
	const key = (over = {}) => ({
		modelRevision: "m1",
		skillHashes: ["s1"],
		toolchain: "tc1",
		taskBand: "ui",
		checkKind: "types",
		checkHealth: "healthy" as const,
		budgetBand: "std",
		policyVersion: "p1",
		...over,
	});
	it("insufficient-data until minSamples, then active with posterior mean", () => {
		let s = store();
		s = recordOutcome(s, key(), "success", 0);
		expect(s.buckets[conditionKeyHash(key())]!.state).toBe("insufficient-data");
		s = recordOutcome(s, key(), "success", 0);
		s = recordOutcome(s, key(), "success", 0);
		const bucket = s.buckets[conditionKeyHash(key())]!;
		expect(bucket.state).toBe("active");
		expect(bucket.successes).toBe(3);
	});
	it("drift past threshold demotes the bucket", () => {
		let s = store();
		for (let i = 0; i < 5; i++) s = recordOutcome(s, key(), "failure", 1.0);
		expect(s.buckets[conditionKeyHash(key())]!.state).toBe("demoted");
		expect(s.buckets[conditionKeyHash(key())]!.demotedReason).toBe("drift-threshold");
	});
	it("explicit condition changes demote immediately, not after statistics", () => {
		let s = store();
		for (let i = 0; i < 3; i++) s = recordOutcome(s, key(), "success", 0);
		s = demoteOnConditionChange(s, { modelRevision: "m2" });
		expect(s.buckets[conditionKeyHash(key())]!.state).toBe("demoted");
		expect(s.buckets[conditionKeyHash(key())]!.demotedReason).toBe("condition-change");
	});
	it("demoted buckets stop accumulating", () => {
		let s = store();
		for (let i = 0; i < 5; i++) s = recordOutcome(s, key(), "failure", 1.0);
		const before = s.buckets[conditionKeyHash(key())]!.failures;
		s = recordOutcome(s, key(), "failure", 1.0);
		expect(s.buckets[conditionKeyHash(key())]!.failures).toBe(before);
	});
});
