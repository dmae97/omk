import type { Api, Model, SimpleStreamOptions, ThinkingBudgets } from "omk-ai";
import { addsThinkingBudgetToMaxTokens, adjustMaxTokensForThinking, DEFAULT_THINKING_BUDGETS } from "omk-ai";

/** The suggestion request differs from the main request only in this output cap. */
export const SUGGESTION_MAX_TOKENS = 128;

/**
 * Output cap for the suggestion request. Providers that add thinking headroom
 * receive the base cap and resolve the effective ceiling themselves.
 */
export function suggestionMaxTokens(model: Model<Api>, options: SimpleStreamOptions | undefined): number {
	const level = options?.reasoning;
	if (!level || addsThinkingBudgetToMaxTokens(model)) return SUGGESTION_MAX_TOKENS;
	const key: keyof ThinkingBudgets = level === "xhigh" || level === "max" || level === "ultra" ? "high" : level;
	const budget = options?.thinkingBudgets?.[key] ?? DEFAULT_THINKING_BUDGETS[key];
	return budget + SUGGESTION_MAX_TOKENS;
}

/** The provider-resolved output ceiling used by cost admission, including thinking headroom and model clamps. */
export function suggestionEffectiveMaxTokens(model: Model<Api>, options: SimpleStreamOptions | undefined): number {
	const maxTokens = suggestionMaxTokens(model, options);
	const reasoning = options?.reasoning;
	if (!reasoning || !addsThinkingBudgetToMaxTokens(model)) return maxTokens;
	return adjustMaxTokensForThinking(maxTokens, model.maxTokens, reasoning, options.thinkingBudgets).maxTokens;
}
