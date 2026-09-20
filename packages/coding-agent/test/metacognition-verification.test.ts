/**
 * Time-aware independent verification — Jev audit algorithm A7 (finding F07).
 *
 * F07 is the confusion between "each condition was satisfied at some point" and
 * "they hold together now". Splitting the two lets a run keep valid history
 * without letting stale evidence stand in for the current state.
 *
 * The other rule here is that `unknown` is not `false`. A missing field or an
 * incomplete collection scope is absent evidence; binary logic that negates it
 * into `true` manufactures a verification that never happened.
 */

import { describe, expect, it } from "vitest";
import {
	type ConditionObservation,
	completeCurrent,
	completeEver,
	evidenceStrength,
	independentEvidenceGroups,
	strongestEvidence,
	verifierQuality,
} from "../src/metacognition/verification.ts";

function obs(
	snapshotId: string,
	values: Record<string, "true" | "false" | "unknown">,
	generation = 1,
): ConditionObservation {
	return { snapshotId, generation, values };
}

describe("three-valued conditions", () => {
	it("requires every current condition to hold in one snapshot", () => {
		const snapshot = obs("s1", { loggedIn: "true", cartEmpty: "true" });
		expect(completeCurrent(["loggedIn", "cartEmpty"], snapshot)).toEqual({ complete: true });
	});

	it("never treats unknown as satisfied", () => {
		const snapshot = obs("s1", { loggedIn: "true", cartEmpty: "unknown" });
		expect(completeCurrent(["loggedIn", "cartEmpty"], snapshot)).toEqual({
			complete: false,
			unsatisfied: [{ condition: "cartEmpty", value: "unknown" }],
		});
	});

	it("never treats unknown as refuted either", () => {
		const snapshot = obs("s1", { flag: "unknown" });
		const result = completeCurrent(["flag"], snapshot);
		expect(result.complete).toBe(false);
		if (!result.complete) expect(result.unsatisfied[0]?.value).toBe("unknown");
	});

	it("treats a missing condition as unknown rather than false", () => {
		const result = completeCurrent(["absent"], obs("s1", {}));
		expect(result.complete).toBe(false);
		if (!result.complete) expect(result.unsatisfied[0]?.value).toBe("unknown");
	});

	it("rejects an empty current condition set instead of vacuously passing", () => {
		expect(() => completeCurrent([], obs("s1", {}))).toThrow();
	});
});

describe("current versus ever (F07)", () => {
	const history = [
		obs("s1", { emailVerified: "true", cartEmpty: "true" }),
		obs("s2", { emailVerified: "false", cartEmpty: "false" }),
	];

	it("satisfies an ever-condition from any valid historical snapshot", () => {
		expect(completeEver(["emailVerified"], history)).toEqual({ complete: true });
	});

	it("does not let history satisfy a current condition", () => {
		const now = history[1]!;
		expect(completeCurrent(["emailVerified"], now).complete).toBe(false);
		expect(completeEver(["emailVerified"], history).complete).toBe(true);
	});

	it("reports which ever-conditions were never observed true", () => {
		const result = completeEver(["neverSeen"], history);
		expect(result.complete).toBe(false);
		if (!result.complete) expect(result.unsatisfied.map((u) => u.condition)).toEqual(["neverSeen"]);
	});

	it("rejects an empty history rather than claiming the condition never held", () => {
		expect(() => completeEver(["x"], [])).toThrow();
	});
});

describe("evidence strength ordering", () => {
	it("ranks an authoritative query above a page success message", () => {
		expect(evidenceStrength("authoritative-query")).toBeGreaterThan(evidenceStrength("page-success-text"));
		expect(evidenceStrength("authoritative-query")).toBeGreaterThan(evidenceStrength("independent-ui"));
		expect(evidenceStrength("structured-remote-linked")).toBeGreaterThan(evidenceStrength("independent-ui"));
		expect(evidenceStrength("independent-ui")).toBeGreaterThan(evidenceStrength("model-completion-claim"));
	});

	it("labels the achieved level by the strongest evidence actually held", () => {
		expect(strongestEvidence(["page-success-text", "independent-ui"])).toBe("UI_VERIFIED");
		expect(strongestEvidence(["authoritative-query"])).toBe("REMOTE_EFFECT_VERIFIED");
		expect(strongestEvidence(["structured-remote-linked"])).toBe("REMOTE_EFFECT_VERIFIED");
		expect(strongestEvidence(["model-completion-claim"])).toBe("CLAIMED_ONLY");
	});

	it("does not promote a UI check to a remote-effect claim", () => {
		expect(strongestEvidence(["independent-ui", "page-success-text"])).not.toBe("REMOTE_EFFECT_VERIFIED");
	});

	it("rejects an empty evidence set", () => {
		expect(() => strongestEvidence([])).toThrow();
	});
});

describe("correlated evidence does not multiply", () => {
	it("collapses many readings of one DOM into a single independent group", () => {
		const groups = independentEvidenceGroups([
			{ id: "e1", sourceGroup: "dom@s1" },
			{ id: "e2", sourceGroup: "dom@s1" },
			{ id: "e3", sourceGroup: "dom@s1" },
		]);
		expect(groups.independentCount).toBe(1);
		expect(groups.byGroup["dom@s1"]).toBe(3);
	});

	it("counts a genuinely separate source as independent", () => {
		const groups = independentEvidenceGroups([
			{ id: "e1", sourceGroup: "dom@s1" },
			{ id: "e2", sourceGroup: "backend-query" },
		]);
		expect(groups.independentCount).toBe(2);
	});

	it("rejects evidence without a declared source group", () => {
		expect(() => independentEvidenceGroups([{ id: "e1", sourceGroup: "" }])).toThrow();
	});
});

describe("verifier quality is measured before success rate", () => {
	it("reports false positive, false negative and unknown rates", () => {
		const quality = verifierQuality([
			{ verdict: "true", truth: "true" },
			{ verdict: "true", truth: "false" },
			{ verdict: "false", truth: "true" },
			{ verdict: "unknown", truth: "true" },
		]);
		expect(quality.falsePositiveRate).toBeCloseTo(1 / 1, 12);
		expect(quality.falseNegativeRate).toBeCloseTo(1 / 3, 12);
		expect(quality.unknownRate).toBeCloseTo(0.25, 12);
		expect(quality.samples).toBe(4);
	});

	it("leaves a rate undefined when its denominator is empty", () => {
		const quality = verifierQuality([{ verdict: "true", truth: "true" }]);
		expect(quality.falsePositiveRate).toBeUndefined();
		expect(quality.falseNegativeRate).toBeCloseTo(0, 12);
	});

	it("rejects an empty sample set", () => {
		expect(() => verifierQuality([])).toThrow();
	});
});
