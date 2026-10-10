import fc from "fast-check";
import { parseRunContract } from "omk-protocol";
import { describe, expect, it } from "vitest";
import {
	type CheckObservation,
	closesRunClaims,
	evaluateRunClaims,
	parseCheckObservations,
} from "../src/core/verified-run/evidence-binding.ts";
import { digestBytes } from "../src/core/verified-run/storage.ts";

const contract = parseRunContract({
	schemaVersion: "omk.verified-run.v1",
	profile: "linux-command-v1",
	runId: "evidence-binding",
	goal: "Two exact checks",
	workspace: { root: "/tmp/evidence-binding-input", baseDigest: "a".repeat(64) },
	writablePaths: ["out"],
	writer: ["/bin/true"],
	checks: [
		{ claimId: "left", argv: ["/bin/true"], stdout: "ok" },
		{ claimId: "right", argv: ["/bin/true"], stdout: "ok" },
	],
	budget: { workMs: 1000, verifyMs: 1000, cleanupMs: 1000, maxOutputBytes: 4096, maxFiles: 10, maxBytes: 65536 },
	apply: "artifact-only",
});
const checks: readonly CheckObservation[] = contract.checks.map((check, index) => ({
	claimId: check.claimId,
	executionId: `execution-${index}`,
	stdoutDigest: digestBytes("ok"),
	stderrDigest: digestBytes(""),
	exitCode: 0,
	failure: null,
	receiptCoreDigest: "b".repeat(64),
}));
const binding = { candidate: "c".repeat(64), environment: "d".repeat(64) };

const closes = (observations: readonly CheckObservation[]) =>
	closesRunClaims(contract, { ...binding, checks: observations });

describe("one observed execution per approved check", () => {
	it("accepts the complete independent execution set, independent of arrival order", () => {
		expect(closes(checks)).toBe(true);
		expect(closes([...checks].reverse())).toBe(true);
	});

	it("does not count the same execution as two approved checks", () => {
		expect(closes(checks.map((check) => ({ ...check, executionId: "same-execution" })))).toBe(false);
	});

	it.each([
		{ name: "replicated execution", observations: checks.map((check) => ({ ...check, executionId: "same" })) },
		{ name: "empty execution", observations: [{ ...checks[0], executionId: "" }, checks[1]] },
		{ name: "whitespace execution", observations: [{ ...checks[0], executionId: "   " }, checks[1]] },
		{ name: "duplicate claim", observations: [...checks, { ...checks[0], executionId: "extra" }] },
		{ name: "foreign claim", observations: [...checks, { ...checks[0], claimId: "foreign", executionId: "extra" }] },
	])("rejects $name consistently in explanation and completion", ({ observations }) => {
		expect(closes(observations)).toBe(false);
		expect(() => evaluateRunClaims(contract, { ...binding, checks: observations })).toThrow(/integrity/);
	});

	it("explains absent and partial check sets without claiming verified closure", () => {
		for (const partial of [[], checks.slice(0, 1)]) {
			const proof = evaluateRunClaims(contract, { ...binding, checks: partial });
			expect(proof.verdict).toBe("inconclusive");
			expect(proof.blockingClaimIds).toContain("right");
			expect(closes(partial)).toBe(false);
		}
	});

	it("retains violated checks and unresolved effects in both projections", () => {
		const failed = [{ ...checks[0], failure: "cancelled" }, checks[1]];
		expect(evaluateRunClaims(contract, { ...binding, checks: failed }).verdict).toBe("violated");
		const live = { ...binding, checks, unresolvedEffectIds: ["live-execution"] };
		expect(evaluateRunClaims(contract, live)).toMatchObject({
			verdict: "inconclusive",
			unresolvedEffectIds: ["live-execution"],
		});
		expect(closesRunClaims(contract, live)).toBe(false);
	});

	it("never closes with empty execution identities even before receipt parsing", () => {
		expect(closes([{ ...checks[0], executionId: "" }, checks[1]])).toBe(false);
		expect(closes([{ ...checks[0], executionId: "   " }, checks[1]])).toBe(false);
	});

	it("does not close from extra, foreign, missing or duplicated check identities", () => {
		expect(closes([...checks, { ...checks[0], executionId: "extra" }])).toBe(false);
		expect(closes([...checks, { ...checks[0], claimId: "foreign", executionId: "foreign" }])).toBe(false);
		expect(closes(checks.slice(0, 1))).toBe(false);
		expect(closes([checks[0], { ...checks[0], executionId: "duplicate-claim" }])).toBe(false);
	});

	it.each(["claimId", "executionId"] as const)("rejects duplicate %s at the attestation parser", (field) => {
		expect(() => parseCheckObservations([checks[0], { ...checks[1], [field]: checks[0][field] }], true)).toThrow(
			/integrity/,
		);
	});

	it.each(["claimId", "executionId"] as const)("rejects empty %s before issuing evidence", (field) => {
		expect(() => parseCheckObservations([{ ...checks[0], [field]: "" }], true)).toThrow(/integrity/);
	});

	it("retains the legacy receipt field-omission contract", () => {
		const legacy = checks.map(({ receiptCoreDigest: _native, ...check }) => check);
		expect(parseCheckObservations(legacy, false)).toEqual(legacy);
		expect(() => parseCheckObservations(checks, false)).toThrow(/integrity/);
	});

	it("rejects contradictory outcomes despite matching stdout", () => {
		for (const outcome of [
			{ exitCode: 1, failure: null },
			{ exitCode: 0, failure: "cancelled" },
			{ exitCode: null, failure: null },
		])
			expect(closes([{ ...checks[0], ...outcome }, checks[1]])).toBe(false);
	});

	it("does not turn replicated successful witnesses into completion over 500 collision variants", () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 1000000 }), fc.boolean(), (suffix, reverse) => {
				const collision = checks.map((check) => ({ ...check, executionId: `same-${suffix}` }));
				const observations = reverse ? collision.reverse() : collision;
				expect(closes(observations)).toBe(false);
				expect(() => evaluateRunClaims(contract, { ...binding, checks: observations })).toThrow(/integrity/);
			}),
			{ seed: 0x20261009, numRuns: 500 },
		);
	});

	it("keeps both verdicts equivalent across 500 partial, failed, scope and effect combinations", () => {
		const outcomes = fc.array(fc.constantFrom("missing", "pass", "failed", "cancelled", "no-exit", "wrong-stdout"), {
			minLength: 2,
			maxLength: 2,
		});
		fc.assert(
			fc.property(outcomes, fc.boolean(), fc.boolean(), fc.boolean(), (values, incompleteScope, live, reverse) => {
				const observed = checks.flatMap((check, index) => {
					const outcome = values[index];
					if (outcome === "missing") return [];
					return [
						{
							...check,
							exitCode: outcome === "failed" ? 1 : outcome === "no-exit" ? null : 0,
							failure: outcome === "cancelled" ? "cancelled" : null,
							stdoutDigest: outcome === "wrong-stdout" ? digestBytes("wrong") : check.stdoutDigest,
						},
					];
				});
				const context = {
					...binding,
					checks: reverse ? observed.reverse() : observed,
					workspaceCompleteness: incompleteScope ? ("unknown" as const) : ("complete" as const),
					unresolvedEffectIds: live ? ["live-execution"] : [],
				};
				const before = JSON.stringify(context);
				const proof = evaluateRunClaims(contract, context);
				const expected = values.some((value) => value !== "missing" && value !== "pass")
					? "violated"
					: values.every((value) => value === "pass") && !incompleteScope && !live
						? "verified"
						: "inconclusive";
				expect(proof.verdict).toBe(expected);
				expect(closesRunClaims(contract, context)).toBe(expected === "verified");
				expect(evaluateRunClaims(contract, { ...context, checks: [...context.checks].reverse() })).toEqual(proof);
				expect(JSON.stringify(context)).toBe(before);
			}),
			{ seed: 0x20261009, numRuns: 500 },
		);
	});
});
