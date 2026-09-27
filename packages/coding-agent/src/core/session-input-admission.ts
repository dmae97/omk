import { randomUUID } from "node:crypto";
import type { AgentMessage, AgentState } from "omk-agent-core";
import type { Api, Model } from "omk-ai";
import { estimateNextTurnContextTokens, estimateProjectedContextTokens } from "./compaction/index.ts";
import type { SystemPromptContextBudgetOptions } from "./context-budget-system-prompt.ts";
import { createTokenCounterForMode, type TokenCounterAdapter } from "./context-budget-token-counter.ts";
import type { ContextBudgetCacheProviderV2 } from "./context-budget-v2-types.ts";
import {
	assertContextInputWithinCapacity,
	type ContextInputTokenEstimate,
	computeHardPromptInputLimit,
	computePromptTokenBudget,
	estimateContextInputTokens,
	PromptInputCapacityError,
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

function projectedUsageAfterCompaction(
	messages: AgentMessage[],
	pending: AgentMessage[],
	latestCompactionTimestamp?: string,
): number {
	return (
		estimateNextTurnContextTokens(messages, pending, latestCompactionTimestamp) ??
		estimateProjectedContextTokens(messages, pending, latestCompactionTimestamp)
	).tokens;
}

/** Hard input ceiling that prompt admission enforces; threshold compaction must fire below it. */
export function sessionInputTokenLimit(
	model: Pick<Model<Api>, "maxTokens"> | undefined,
	contextWindow: number,
): number | undefined {
	if (!model || !Number.isSafeInteger(contextWindow) || contextWindow <= 0) return undefined;
	const configured = computePromptTokenBudget({
		contextWindow,
		modelMaxTokens: model.maxTokens,
		envMaxPromptTokens: parsePositiveIntegerEnv("OMK_CONTEXT_GOVERNOR_MAX_PROMPT_TOKENS"),
		envResponseReserveTokens: parsePositiveIntegerEnv("OMK_CONTEXT_GOVERNOR_RESPONSE_RESERVE_TOKENS"),
		envPromptRatio: parsePositiveFloatEnv("OMK_CONTEXT_GOVERNOR_PROMPT_RATIO"),
		envResponseRatio: parsePositiveFloatEnv("OMK_CONTEXT_GOVERNOR_RESPONSE_RATIO"),
	});
	return computeHardPromptInputLimit({
		contextWindow,
		configuredMaxPromptTokens: configured.maxPromptTokens,
		modelMaxTokens: model.maxTokens,
	}).maxInputTokens;
}

export interface SessionInputCapacityInput {
	readonly model: Model<Api> | undefined;
	readonly state: Pick<AgentState, "systemPrompt" | "messages" | "tools">;
	readonly pending: AgentMessage[];
	readonly effectiveWindow: (window: number) => number;
	readonly counter: TokenCounterAdapter;
	readonly latestCompactionTimestamp?: string;
}

/** Capacity rejection raised after an automatic compaction already rewrote the retained history. */
export class CompactedPromptInputCapacityError extends PromptInputCapacityError {
	constructor(rejection: PromptInputCapacityError) {
		super(rejection.estimatedTokens, rejection.maxInputTokens);
		this.name = "CompactedPromptInputCapacityError";
		this.message = `Prompt input still exceeds the safe model context window after automatic compaction (estimated=${rejection.estimatedTokens}, limit=${rejection.maxInputTokens}).`;
	}
}

function sessionInputLimit(
	input: SessionInputCapacityInput,
): { readonly model: Model<Api>; readonly maxInputTokens: number } | undefined {
	const sessionWindow = input.model?.contextWindow ?? 0;
	if (!input.model || !Number.isSafeInteger(sessionWindow) || sessionWindow <= 0) return undefined;
	const maxInputTokens = sessionInputTokenLimit(input.model, input.effectiveWindow(sessionWindow));
	return maxInputTokens === undefined ? undefined : { model: input.model, maxInputTokens };
}

export function assertSessionInputCapacity(input: SessionInputCapacityInput): void {
	const limit = sessionInputLimit(input);
	if (!limit) return;
	const { state, pending } = input;
	assertContextInputWithinCapacity({
		maxInputTokens: limit.maxInputTokens,
		systemPrompt: state.systemPrompt,
		messages: [...state.messages, ...pending],
		tools: state.tools,
		modelId: limit.model.id,
		tokenCounter: input.counter,
		projectedUsageTokens: projectedUsageAfterCompaction(state.messages, pending, input.latestCompactionTimestamp),
	});
}

function capacityRejection(input: SessionInputCapacityInput): PromptInputCapacityError | undefined {
	try {
		assertSessionInputCapacity(input);
		return undefined;
	} catch (error) {
		if (error instanceof PromptInputCapacityError) return error;
		throw error;
	}
}

/** Input compaction cannot shrink: it only rewrites history, never the system prompt, tools or pending turn. */
function fixedInputEstimate(input: SessionInputCapacityInput): ContextInputTokenEstimate | undefined {
	const limit = sessionInputLimit(input);
	if (!limit) return undefined;
	return estimateContextInputTokens({
		systemPrompt: input.state.systemPrompt,
		messages: input.pending,
		tools: input.state.tools,
		modelId: limit.model.id,
		tokenCounter: input.counter,
	});
}

/** Names the overhead compaction cannot shrink, so a rejection says what actually fills the window. */
function withFixedOverhead(
	error: PromptInputCapacityError,
	fixed: ContextInputTokenEstimate | undefined,
): PromptInputCapacityError {
	if (!fixed) return error;
	const historyTokens = Math.max(0, error.maxInputTokens - fixed.totalTokens);
	error.message += ` Compaction cannot shrink the system prompt (${fixed.systemPromptTokens} tokens), tool schemas (${fixed.toolTokens}) or latest input (${fixed.messageTokens}); ${historyTokens} tokens remain for history.`;
	return error;
}

/**
 * Hard input admission with one bounded recovery: when retained history overflows the ceiling,
 * compact once and re-check before rejecting. `compact` is absent when auto-compaction is off.
 */
export async function admitSessionInput(
	buildInput: () => SessionInputCapacityInput,
	compact: (() => Promise<void>) | undefined,
): Promise<void> {
	const before = buildInput();
	const rejection = capacityRejection(before);
	if (!rejection) return;
	const fixed = fixedInputEstimate(before);
	if (!compact || (fixed !== undefined && fixed.totalTokens > rejection.maxInputTokens)) {
		throw withFixedOverhead(rejection, fixed);
	}
	await compact();
	const after = buildInput();
	const retry = capacityRejection(after);
	if (!retry) return;
	const compacted = after.latestCompactionTimestamp !== before.latestCompactionTimestamp;
	throw withFixedOverhead(compacted ? new CompactedPromptInputCapacityError(retry) : retry, fixedInputEstimate(after));
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
		sideEffects: error instanceof CompactedPromptInputCapacityError ? "confirmed" : "none",
		...(model ? { provider: model.provider, model: model.id } : {}),
	});
}
