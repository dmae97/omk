/**
 * Spec 052: whether a system prompt changed by `before_agent_start` handlers
 * keeps the planned cache boundary. Text appended after the whole planned
 * prompt (finish-check's discipline, prompt presets) leaves the stable prefix
 * byte-identical, so the boundary still holds. Anything else (a replacement,
 * an edit, a prepend) may move bytes inside the prefix and drops it.
 */

export interface SystemPromptCachePlan {
	readonly prompt: string;
	readonly cacheBoundary: number | undefined;
}

export interface SystemPromptCacheState {
	readonly cacheBoundary: number | undefined;
	readonly bypass: boolean;
}

export function resolveExtendedSystemPromptCache(
	plan: SystemPromptCachePlan,
	systemPrompt: string,
): SystemPromptCacheState {
	if (systemPrompt === plan.prompt) return { cacheBoundary: plan.cacheBoundary, bypass: false };
	const boundary = plan.cacheBoundary;
	const validBoundary =
		boundary !== undefined && Number.isSafeInteger(boundary) && boundary > 0 && boundary <= plan.prompt.length;
	if (plan.prompt.length > 0 && validBoundary && systemPrompt.startsWith(plan.prompt)) {
		return { cacheBoundary: boundary, bypass: false };
	}
	return { cacheBoundary: undefined, bypass: true };
}
