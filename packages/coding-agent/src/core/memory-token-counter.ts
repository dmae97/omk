import type { TokenCounterAdapter, TokenCountResult } from "./context-budget-token-counter.ts";

/** Two immutable texts only; complete message/envelope counts remain exact and uncached. */
export function memoryTokenCounter(
	counter: TokenCounterAdapter,
	requestModelId: string,
	systemPrompt: string,
	toolSchemas: string,
): TokenCounterAdapter {
	const cache = new Map<string, TokenCountResult>();
	return {
		id: counter.id,
		priority: counter.priority,
		isAvailable: () => counter.isAvailable(),
		supports: (modelId) => counter.supports(modelId),
		countText(text, modelId) {
			if (modelId !== requestModelId || (text !== systemPrompt && text !== toolSchemas))
				return counter.countText(text, modelId);
			const existing = cache.get(text);
			if (existing) return existing;
			const counted = counter.countText(text, modelId);
			cache.set(text, counted);
			return counted;
		},
		countTextParts: counter.countTextParts?.bind(counter),
	};
}
