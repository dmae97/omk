import {
	type ContextBudgetItemV2,
	type PromptContextBudgetInputV2,
	planPromptContextBudgetV2,
} from "../src/core/context-budget-governor-v2.ts";

export function makeContextBudgetItem(
	over: Partial<ContextBudgetItemV2> & Pick<ContextBudgetItemV2, "id" | "tier" | "text">,
): ContextBudgetItemV2 {
	const { id, tier, text, ...rest } = over;
	return { priority: "medium", ...rest, id, tier, text };
}

export function planContextBudgetWith(
	items: readonly ContextBudgetItemV2[],
	over: Partial<PromptContextBudgetInputV2> = {},
): ReturnType<typeof planPromptContextBudgetV2> {
	return planPromptContextBudgetV2({
		maxTokens: 4000,
		responseReserveTokens: 0,
		safetyMarginTokens: 0,
		items,
		...over,
	});
}
