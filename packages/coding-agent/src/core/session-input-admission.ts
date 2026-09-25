import { randomUUID } from "node:crypto";
import type { AgentMessage, AgentState } from "omk-agent-core";
import type { Api, Model } from "omk-ai";
import { estimateProjectedContextTokens } from "./compaction/index.ts";
import type { SystemPromptContextBudgetOptions } from "./context-budget-system-prompt.ts";
import { createTokenCounterForMode, type TokenCounterAdapter } from "./context-budget-token-counter.ts";
import type { ContextBudgetCacheProviderV2 } from "./context-budget-v2-types.ts";
import {
	assertContextInputWithinModelWindow,
	computePromptTokenBudget,
	parseCommaSeparatedEnv,
	parsePositiveFloatEnv,
	parsePositiveIntegerEnv,
	parseTokenizerModeEnv,
} from "./prompt-budget.ts";
import { RunBudgetExceededError, RunBudgetPolicyError } from "./run-budget-policy.ts";
import { preflightFailureCause, terminationMessage } from "./session-failure-cause.ts";
import { classifySessionTermination, type SessionTerminationCause } from "./session-termination.ts";

export function transcriptHasImages(messages: AgentMessage[]): boolean {
	return messages.some((message) => {
		const content = (message as { content?: unknown }).content;
		return (
			Array.isArray(content) &&
			content.some(
				(part: unknown) =>
					typeof part === "object" && part !== null && (part as { type?: string }).type === "image",
			)
		);
	});
}

export function sessionContextBudgetOptions(
	model: Model<Api> | undefined,
	queryContext: string | undefined,
	enabled: () => boolean,
	getCache: () => ContextBudgetCacheProviderV2,
): SystemPromptContextBudgetOptions | undefined {
	const override = process.env.OMK_CONTEXT_GOVERNOR;
	if (override === "0" || (override !== "1" && !enabled())) return undefined;
	const budget = computePromptTokenBudget({
		contextWindow: model?.contextWindow ?? 0,
		modelMaxTokens: model?.maxTokens,
		envMaxPromptTokens: parsePositiveIntegerEnv("OMK_CONTEXT_GOVERNOR_MAX_PROMPT_TOKENS"),
		envResponseReserveTokens: parsePositiveIntegerEnv("OMK_CONTEXT_GOVERNOR_RESPONSE_RESERVE_TOKENS"),
		envPromptRatio: parsePositiveFloatEnv("OMK_CONTEXT_GOVERNOR_PROMPT_RATIO"),
		envResponseRatio: parsePositiveFloatEnv("OMK_CONTEXT_GOVERNOR_RESPONSE_RATIO"),
	});
	const cacheProvider = getCache();
	const tokenizerMode = parseTokenizerModeEnv(process.env.OMK_CONTEXT_GOVERNOR_TOKENIZER);
	return {
		...budget,
		modelId: model?.id ?? "unknown",
		tokenizerMode,
		tokenCounter: createTokenCounterForMode(tokenizerMode ?? "fallback"),
		activeSkillNames: parseCommaSeparatedEnv(process.env.OMK_CONTEXT_GOVERNOR_ACTIVE_SKILLS),
		queryContext,
		cacheProvider,
	};
}

export function assertSessionInputCapacity(input: {
	readonly model: Model<Api> | undefined;
	readonly state: Pick<AgentState, "systemPrompt" | "messages" | "tools">;
	readonly pending: AgentMessage[];
	readonly effectiveWindow: (window: number) => number;
	readonly counter: TokenCounterAdapter;
}): void {
	const { model, state, pending } = input;
	const sessionWindow = model?.contextWindow ?? 0;
	if (!model || !Number.isSafeInteger(sessionWindow) || sessionWindow <= 0) return;
	const contextWindow = input.effectiveWindow(sessionWindow);
	const configured = computePromptTokenBudget({
		contextWindow,
		modelMaxTokens: model.maxTokens,
		envMaxPromptTokens: parsePositiveIntegerEnv("OMK_CONTEXT_GOVERNOR_MAX_PROMPT_TOKENS"),
		envResponseReserveTokens: parsePositiveIntegerEnv("OMK_CONTEXT_GOVERNOR_RESPONSE_RESERVE_TOKENS"),
		envPromptRatio: parsePositiveFloatEnv("OMK_CONTEXT_GOVERNOR_PROMPT_RATIO"),
		envResponseRatio: parsePositiveFloatEnv("OMK_CONTEXT_GOVERNOR_RESPONSE_RATIO"),
	});
	assertContextInputWithinModelWindow({
		contextWindow,
		configuredMaxPromptTokens: configured.maxPromptTokens,
		modelMaxTokens: model.maxTokens,
		systemPrompt: state.systemPrompt,
		messages: [...state.messages, ...pending],
		tools: state.tools,
		modelId: model.id,
		tokenCounter: input.counter,
		projectedUsageTokens: estimateProjectedContextTokens(state.messages, pending).tokens,
	});
}

export function promptPreflightTermination(
	error: unknown,
	sessionId: string,
	model: Model<Api> | undefined,
	userAbort = false,
) {
	const rawMessage = error instanceof Error ? error.message : String(error);
	const cause: SessionTerminationCause =
		userAbort && error instanceof RunBudgetExceededError && error.code === "closed"
			? { area: "user", code: "abort" }
			: error instanceof RunBudgetExceededError
				? { area: "budget", code: error.code }
				: error instanceof RunBudgetPolicyError
					? { area: "configuration", code: "invalid" }
					: preflightFailureCause(rawMessage, Boolean(model));
	return classifySessionTermination({
		sessionId,
		runId: `preflight-${randomUUID()}`,
		timestamp: new Date().toISOString(),
		source: "observed",
		message: terminationMessage(rawMessage, "Prompt preflight failed."),
		cause,
		sideEffects: "none",
		...(model ? { provider: model.provider, model: model.id } : {}),
	});
}
