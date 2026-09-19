import { describe, expect, it } from "vitest";
import {
	type ContextBudgetItemV2,
	chooseHeadroomRepresentation,
	DEFAULT_HEADROOM_QUALITY_POLICY,
	deriveRepresentationCandidates,
	type HeadroomQualityPolicyV2,
} from "../src/core/context-budget-headroom.ts";

/**
 * Semantic-difference tests for {@link HeadroomQualityPolicyV2} (audit F07,
 * 2026-09-19): every field that is kept must change some decision for some
 * input, and a field that changes nothing must not be part of the policy's
 * documented contract.
 */

function item(over: Partial<ContextBudgetItemV2> & Pick<ContextBudgetItemV2, "id" | "text">): ContextBudgetItemV2 {
	return { tier: "history", priority: "medium", ...over };
}

const ref = { uri: "file:///w/a.ts", contentHash: "h", retrievable: true } as const;
const loose = { tierUsedTokens: 0, tierCeilingTokens: 10_000, remainingGlobalTokens: 10_000 };
const tight = { tierUsedTokens: 0, tierCeilingTokens: 60, remainingGlobalTokens: 60 };

function withPolicy(over: Partial<HeadroomQualityPolicyV2>): HeadroomQualityPolicyV2 {
	return { ...DEFAULT_HEADROOM_QUALITY_POLICY, ...over };
}

describe("quality policy fields change decisions", () => {
	it("preferPointerForRetrievable: off makes a tight retrievable item fall back instead of pointing", () => {
		const target = item({ id: "ptr", tier: "current-files", text: "code ".repeat(200), sourceRef: ref });
		const withPointer = chooseHeadroomRepresentation(
			target,
			tight,
			withPolicy({ preferPointerForRetrievable: true }),
		);
		const without = chooseHeadroomRepresentation(target, tight, withPolicy({ preferPointerForRetrievable: false }));
		expect(withPointer.kind).toBe("pointer");
		expect(without.kind).not.toBe("pointer");
	});

	it("allowOmit: off removes the omit candidate entirely", () => {
		const target = item({ id: "omit", text: "text ".repeat(50) });
		const kinds = (policy: HeadroomQualityPolicyV2) =>
			deriveRepresentationCandidates(target, policy).map((c) => c.kind);
		expect(kinds(withPolicy({ allowOmit: true }))).toContain("omit");
		expect(kinds(withPolicy({ allowOmit: false }))).not.toContain("omit");
	});

	it("summaryMaxAgeTurns: a fresh non-history item gains a summary only once it is older than the limit", () => {
		const target = item({ id: "age", tier: "current-files", text: "detail ".repeat(60), ageTurns: 3 });
		const kinds = (policy: HeadroomQualityPolicyV2) =>
			deriveRepresentationCandidates(target, policy).map((c) => c.kind);
		expect(kinds(withPolicy({ summaryMaxAgeTurns: 4 }))).not.toContain("summary");
		expect(kinds(withPolicy({ summaryMaxAgeTurns: 3 }))).toContain("summary");
	});

	it("headroomThresholdTokens: lowering it offers headroom compression for a mid-sized retrievable item", () => {
		const target = item({ id: "hr", tier: "current-files", text: "line ".repeat(200), sourceRef: ref });
		const kinds = (policy: HeadroomQualityPolicyV2) =>
			deriveRepresentationCandidates(target, policy).map((c) => c.kind);
		expect(kinds(withPolicy({ headroomThresholdTokens: 400 }))).not.toContain("headroom-compressed");
		expect(kinds(withPolicy({ headroomThresholdTokens: 100 }))).toContain("headroom-compressed");
	});
});

describe("deprecated preferFullForHighPriority", () => {
	it("is not part of the default policy and flipping it changes no candidate or choice", () => {
		expect("preferFullForHighPriority" in DEFAULT_HEADROOM_QUALITY_POLICY).toBe(false);
		const items = [
			item({ id: "hi", priority: "high", text: "evidence ".repeat(80), ageTurns: 10, sourceRef: ref }),
			item({ id: "hi-plain", priority: "high", tier: "current-files", text: "code ".repeat(80) }),
			item({ id: "med", priority: "medium", text: "note ".repeat(80), ageTurns: 10, sourceRef: ref }),
		];
		for (const target of items) {
			for (const budget of [loose, tight]) {
				const on = withPolicy({ preferFullForHighPriority: true });
				const off = withPolicy({ preferFullForHighPriority: false });
				expect(deriveRepresentationCandidates(target, on)).toEqual(deriveRepresentationCandidates(target, off));
				expect(chooseHeadroomRepresentation(target, budget, on)).toEqual(
					chooseHeadroomRepresentation(target, budget, off),
				);
			}
		}
	});
});
