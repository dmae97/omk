import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { makeContextBudgetItem, planContextBudgetWith } from "./context-budget-test-helpers.ts";

const cacheHashUrl = new URL("../src/core/context-budget-v2-cache-hash.ts", import.meta.url).href;
const planHashUrl = new URL("../src/core/context-budget-v2-plan-hash.ts", import.meta.url).href;
const cacheKeyUrl = new URL("../src/core/context-budget-v2-plan-cache-keys.ts", import.meta.url).href;

function hashesUnderLocale(locale: string): { ordering: number; canonical: string; plan: string; cacheKey: string } {
	const code = `
		import { sha256Canonical } from ${JSON.stringify(cacheHashUrl)};
		import { computePlanHash } from ${JSON.stringify(planHashUrl)};
		import { buildContextBudgetPlanCacheKeyV2 } from ${JSON.stringify(cacheKeyUrl)};
		const collator = new Intl.Collator(${JSON.stringify(locale)}).compare;
		String.prototype.localeCompare = function (other) { return collator(String(this), String(other)); };
		const planned = ["ä", "z"].map((id) => ({
			item: { id, tier: "history", priority: "medium" },
			contentHash: id, fullTokens: 1, baseScore: 1, effectiveScore: 1, redundancyPenalty: 0,
		}));
		process.stdout.write(JSON.stringify({
			ordering: "ä".localeCompare("z"),
			canonical: sha256Canonical({ z: 1, "ä": 2 }),
			plan: computePlanHash({ policyVersion: "p", planned, selection: new Map(), allocations: [], omittedItemIds: [] }),
			cacheKey: buildContextBudgetPlanCacheKeyV2({
				keyBase: { modelId: "m", policyVersion: "p", selectionPolicyVersion: "sel-4-codeunit" },
				planned, maxTokens: 20, availableTokens: 20, responseReserveTokens: 0, safetyMarginTokens: 0,
				tierPolicy: {}, qualityPolicy: {},
			}),
		}));
	`;
	return JSON.parse(
		execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", code], {
			encoding: "utf8",
		}),
	) as ReturnType<typeof hashesUnderLocale>;
}

describe("context budget locale-independent IDs and hashes", () => {
	it("produces identical cache and plan digests under opposite ICU collation orders", () => {
		const en = hashesUnderLocale("en-US");
		const sv = hashesUnderLocale("sv-SE");
		expect(en.ordering).toBeLessThan(0);
		expect(sv.ordering).toBeGreaterThan(0);
		expect(en.canonical).toBe(sv.canonical);
		expect(en.plan).toBe(sv.plan);
		expect(en.cacheKey).toBe(sv.cacheKey);
	});

	it("returns selected representations in the same code-unit ID order used by ranking", () => {
		const plan = planContextBudgetWith(
			["ä", "z"].map((id) => makeContextBudgetItem({ id, tier: "history", text: "same-size evidence" })),
		);
		expect(plan.selectedRepresentations.map((entry) => entry.itemId)).toEqual(["z", "ä"]);
	});
});
