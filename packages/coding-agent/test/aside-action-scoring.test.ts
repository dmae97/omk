import { describe, expect, it } from "vitest";
import {
	scoreActionCandidate,
	selectActionCandidate,
	thresholdForRisk,
} from "../examples/extensions/aside-computer-use/action-scoring.ts";
import type { PlannedActionCandidate, RiskLevel } from "../examples/extensions/aside-computer-use/types.ts";

function candidate(
	kind: string,
	risk: RiskLevel,
	scores: Partial<Omit<PlannedActionCandidate, "action" | "risk">>,
): PlannedActionCandidate {
	return {
		action: { kind, description: kind, url: "http://localhost:3000/app" },
		risk,
		goalProgress: 0,
		observationSupport: 0,
		selectorCertainty: 0,
		policyFit: 0,
		reversibility: 0,
		toolReliability: 0,
		evidenceGain: 0,
		...scores,
	};
}

describe("action candidate scoring", () => {
	it("uses the exact configured formula weights", () => {
		const total = scoreActionCandidate(
			candidate("click_locator", "R1", {
				goalProgress: 0.9,
				observationSupport: 0.8,
				selectorCertainty: 0.7,
				policyFit: 0.6,
				reversibility: 0.5,
				toolReliability: 0.4,
				evidenceGain: 0.3,
				ambiguityPenalty: 0.05,
				repeatPenalty: 0.04,
				riskPenalty: 0.03,
			}),
		);
		expect(total).toBeCloseTo(0.58, 10);
	});

	it("clamps dimensions, penalties, and final totals into [0,1]", () => {
		expect(
			scoreActionCandidate(
				candidate("read_text", "R0", {
					goalProgress: 2,
					observationSupport: 2,
					selectorCertainty: 2,
					policyFit: 2,
					reversibility: 2,
					toolReliability: 2,
					evidenceGain: 2,
					ambiguityPenalty: -1,
				}),
			),
		).toBe(1);
		expect(scoreActionCandidate(candidate("read_text", "R0", { ambiguityPenalty: 2 }))).toBe(0);
	});

	it("requires inspection when no candidates are available", () => {
		const result = selectActionCandidate([]);
		expect(result.status).toBe("inspection_required");
		expect(result.reason).toContain("no action candidates");
	});

	it("accepts a low-risk R0 action at the 0.50 threshold", () => {
		expect(thresholdForRisk("R0")).toBe(0.5);
		const result = selectActionCandidate([candidate("read_text", "R0", { goalProgress: 1, observationSupport: 1 })]);
		expect(result.status).toBe("selected");
		expect(result.selected?.total).toBe(0.5);
		expect(result.selected?.candidate.action.kind).toBe("read_text");
	});

	it("rejects an R2 action below the 0.85 threshold", () => {
		expect(thresholdForRisk("R2")).toBe(0.85);
		const result = selectActionCandidate([
			candidate("submit", "R2", {
				goalProgress: 1,
				observationSupport: 1,
				selectorCertainty: 1,
				policyFit: 1,
				reversibility: 0.9,
			}),
		]);
		expect(result.status).toBe("inspection_required");
		expect(result.reason).toContain("threshold");
	});

	it("rejects ambiguous top two candidates", () => {
		const result = selectActionCandidate([
			candidate("click_primary", "R0", {
				goalProgress: 1,
				observationSupport: 1,
				selectorCertainty: 1,
				policyFit: 0.5,
			}),
			candidate("click_secondary", "R0", {
				goalProgress: 1,
				observationSupport: 1,
				selectorCertainty: 0.4,
				policyFit: 0.5,
			}),
		]);
		expect(result.status).toBe("inspection_required");
		expect(result.reason).toContain("ambiguous");
	});

	it("subtracts penalties from the weighted total", () => {
		const base = candidate("click_locator", "R1", {
			goalProgress: 1,
			observationSupport: 1,
			selectorCertainty: 1,
			policyFit: 1,
			reversibility: 1,
			toolReliability: 1,
			evidenceGain: 1,
		});
		const penalized = { ...base, ambiguityPenalty: 0.1, repeatPenalty: 0.2, riskPenalty: 0.3 };
		expect(scoreActionCandidate(base)).toBe(1);
		expect(scoreActionCandidate(penalized)).toBeCloseTo(0.4, 10);
	});

	it("selects deterministically for shuffled candidates", () => {
		const top = candidate("click_locator", "R1", {
			goalProgress: 1,
			observationSupport: 1,
			selectorCertainty: 1,
			policyFit: 1,
		});
		const read = candidate("read_text", "R0", {
			goalProgress: 1,
			observationSupport: 1,
			selectorCertainty: 0.5,
		});
		const inspect = candidate("inspect", "R0", {
			goalProgress: 1,
			observationSupport: 1,
			selectorCertainty: 0.5,
		});

		const orders = [
			[top, read, inspect],
			[inspect, top, read],
			[read, inspect, top],
		];
		const selectedKinds = orders.map((items) => selectActionCandidate(items).selected?.candidate.action.kind);
		expect(selectedKinds).toEqual(["click_locator", "click_locator", "click_locator"]);
	});
});
