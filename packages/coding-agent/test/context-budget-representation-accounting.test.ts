import { describe, expect, it } from "vitest";
import {
	type ContextBudgetItemV2,
	chooseHeadroomRepresentation,
	deriveRepresentationCandidates,
	fullTextTokens,
	heuristicTokenCount,
} from "../src/core/context-budget-headroom.ts";
import type { TokenCounterAdapter } from "../src/core/context-budget-token-counter.ts";
import { createPlannedItems } from "../src/core/context-budget-v2-planned-items.ts";
import { CONTEXT_BUDGET_SELECTION_POLICY_V2 } from "../src/core/context-budget-v2-types.ts";

/**
 * Representation accounting contract (audit F01, 2026-09-19).
 *
 * A derived representation is priced by counting the string it actually
 * materializes with the same counter the selector uses for full text. The
 * previous `ceil(0.15 * full) + 8` summary price was a compression target,
 * not a cost: a 100-character summary identical to its source was recorded
 * at 12 tokens against the source's 25, and the selector admitted it into a
 * 12-token budget. The invariant here is internal consistency of one
 * estimator, not agreement with any provider tokenizer.
 */

function item(over: Partial<ContextBudgetItemV2> & Pick<ContextBudgetItemV2, "id" | "text">): ContextBudgetItemV2 {
	return { tier: "history", priority: "medium", ...over };
}

const retrievable = {
	uri: "file:///workspace/src/very/long/path/to/some/module/with/many/segments/index.ts",
	symbol: "aVeryLongExportedSymbolNameThatTakesRoom",
	range: { startLine: 10, endLine: 250 },
	contentHash: "0123456789abcdef0123456789abcdef",
	retrievable: true,
} as const;

const inputs: ReadonlyArray<[label: string, text: string]> = [
	["empty", ""],
	["single", "x"],
	["40 ascii", "x".repeat(40)],
	["100 ascii", "x".repeat(100)],
	["159 ascii", "x".repeat(159)],
	["160 ascii", "x".repeat(160)],
	["161 ascii", "x".repeat(161)],
	["171 ascii", "x".repeat(171)],
	["long code", "export function f(a: number, b: number): number {\n\treturn a + b;\n}\n".repeat(30)],
	["korean", "컨텍스트 예산 정책은 표현 문자열의 실제 비용을 같은 계산기로 다시 세야 한다. ".repeat(12)],
	["emoji", "🚀🔥✨".repeat(120)],
];

describe("representation cost accounting", () => {
	describe.each(inputs)("%s", (_label, text) => {
		const plain = item({ id: "plain", text });
		const withRef = item({ id: "ref", text, sourceRef: retrievable });

		it("prices every derived representation by counting its materialized text", () => {
			for (const candidate of [
				...deriveRepresentationCandidates(plain),
				...deriveRepresentationCandidates(withRef),
			]) {
				if (candidate.kind === "full") {
					expect(candidate.estimatedTokens).toBe(fullTextTokens(plain));
					continue;
				}
				if (candidate.kind === "omit") continue;
				const recounted = heuristicTokenCount(candidate.text);
				// headroom-compressed keeps a conservative floor above its head text;
				// pointer and summary must match the counter exactly.
				if (candidate.kind === "headroom-compressed") {
					expect(candidate.estimatedTokens, candidate.kind).toBeGreaterThanOrEqual(recounted);
				} else {
					expect(candidate.estimatedTokens, candidate.kind).toBe(recounted);
				}
			}
		});

		it("never offers a non-full representation that saves nothing", () => {
			const full = fullTextTokens(plain);
			for (const candidate of [
				...deriveRepresentationCandidates(plain),
				...deriveRepresentationCandidates(withRef),
			]) {
				if (candidate.kind === "full" || candidate.kind === "omit") continue;
				expect(candidate.text, `${candidate.kind} text identical to source`).not.toBe(text);
				expect(candidate.estimatedTokens, `${candidate.kind} not cheaper than full`).toBeLessThan(full);
			}
		});
	});

	it.each([
		[100, 12],
		[160, 14],
		[161, 15],
	])("admits only text that fits the same counter at %i characters with budget %i", (length, budget) => {
		const chosen = chooseHeadroomRepresentation(item({ id: `admit-${length}`, text: "x".repeat(length) }), {
			tierUsedTokens: 0,
			tierCeilingTokens: budget,
			remainingGlobalTokens: budget,
		});
		expect(chosen.kind === "omit" || heuristicTokenCount(chosen.text) <= budget, chosen.kind).toBe(true);
	});

	it("still derives a real summary once the summarized text is genuinely shorter", () => {
		const text = "y".repeat(400);
		const summary = deriveRepresentationCandidates(item({ id: "long", text })).find((c) => c.kind === "summary");
		expect(summary).toBeDefined();
		expect(summary?.estimatedTokens).toBe(heuristicTokenCount(summary?.text ?? ""));
		expect(summary?.estimatedTokens).toBeLessThan(heuristicTokenCount(text));
	});

	it("prices derived representations with the injected counter, never a second estimator", () => {
		// A counter that disagrees wildly with chars/4 exposes any path that still
		// prices one representation with the heuristic while full text uses the adapter.
		const counted: string[] = [];
		const counter: TokenCounterAdapter = {
			id: "doubling-counter",
			priority: 10,
			isAvailable: () => true,
			supports: () => true,
			countText: (input, modelId) => {
				counted.push(input);
				return {
					tokens: input.length * 2,
					method: "exact",
					confidence: "high",
					adapterId: "doubling-counter",
					modelId,
					notes: [],
				};
			},
		};
		const text = "z".repeat(400);
		const [planned] = createPlannedItems([item({ id: "inj", text, sourceRef: retrievable })], counter, "model-x");
		expect(planned.fullTokens).toBe(800);
		expect(planned.candidates).toBeDefined();
		for (const candidate of planned.candidates ?? []) {
			if (candidate.kind === "omit") continue;
			expect(counted, `${candidate.kind} was not counted by the adapter`).toContain(candidate.text);
			if (candidate.kind !== "headroom-compressed")
				expect(candidate.estimatedTokens).toBe(candidate.text.length * 2);
		}
		expect(planned.admissibleTokens).toBe(
			Math.min(...(planned.candidates ?? []).filter((c) => c.kind !== "omit").map((c) => c.estimatedTokens)),
		);
	});

	it("bumps the selection policy token so cached plans priced under the old rule are not served", () => {
		expect(CONTEXT_BUDGET_SELECTION_POLICY_V2).not.toBe("sel-2");
	});
});
