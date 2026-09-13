import type { Model } from "../src/types.ts";

/** Logical model only. The authenticated CLI catalog supplies each effort's actual wire UID. */
export function devinModels(): Model<"devin-agent">[] {
	return [{
		id: "swe-2", name: "SWE-2 (Devin CLI)", api: "devin-agent", provider: "devin",
		baseUrl: "https://server.codeium.com", reasoning: true, input: ["text"],
		thinkingLevelMap: { off: null, minimal: null, low: null, medium: "medium", high: "high", xhigh: null, max: "max", ultra: null },
		// Local budgets, not published vendor limits or subscription pricing. A 1,000,000-token
		// budget asks the account catalog for the family's 1M-context lane when it declares one;
		// a lane that declares a smaller window fails the request instead of silently shrinking.
		contextWindow: 1_000_000, maxTokens: 16_384,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	}];
}
