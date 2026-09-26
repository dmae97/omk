import { randomUUID } from "node:crypto";
import type { AgentMessage, AgentState } from "omk-agent-core";
import type { Api, Model } from "omk-ai";
import { estimateProjectedContextTokens } from "./compaction/index.ts";
import type { SystemPromptContextBudgetOptions } from "./context-budget-system-prompt.ts";
import { createTokenCounterForMode, type TokenCounterAdapter } from "./context-budget-token-counter.ts";
import type { ContextBudgetCacheProviderV2 } from "./context-budget-v2-types.ts";
import {
	assertContextInputWithinModelWindow,
	computeHardPromptInputLimit,
	computePromptTokenBudget,
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

/** Keeps the emergency ratio strictly below the refusal line it must beat. */
const EMERGENCY_ADMISSION_MARGIN = 0.95;

/**
 * Highest input ratio the local admission gate still admits for this window:
 * the hard prompt-input limit over the window, after the response reserve and
 * safety margin `assertSessionInputCapacity` applies. Any threshold that has to
 * act before the refusal must sit below this ratio.
 */
function admissionCapacityRatio(model: Model<Api> | undefined, contextWindow: number): number | undefined {
	if (!model || !Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;
	const budget = computePromptTokenBudget({
		contextWindow,
		modelMaxTokens: model.maxTokens,
		envMaxPromptTokens: parsePositiveIntegerEnv("OMK_CONTEXT_GOVERNOR_MAX_PROMPT_TOKENS"),
		envResponseReserveTokens: parsePositiveIntegerEnv("OMK_CONTEXT_GOVERNOR_RESPONSE_RESERVE_TOKENS"),
		envPromptRatio: parsePositiveFloatEnv("OMK_CONTEXT_GOVERNOR_PROMPT_RATIO"),
		envResponseRatio: parsePositiveFloatEnv("OMK_CONTEXT_GOVERNOR_RESPONSE_RATIO"),
	});
	const limit = computeHardPromptInputLimit({
		contextWindow,
		configuredMaxPromptTokens: budget.maxPromptTokens,
		modelMaxTokens: model.maxTokens,
	});
	return Math.min(1, limit.maxInputTokens / limit.contextWindow);
}

/**
 * Emergency ratio for the compaction hysteresis.
 *
 * The emergency branch is the only one that compacts a *disarmed* hysteresis,
 * and the admission gate refuses every turn above the capacity ratio — so the
 * 0.98 default sat above the refusal line and could never fire: a disarmed
 * session pinned at "context limit reached" had no automatic way out. Clamp it
 * just under capacity, preserving the emergency ≥ trigger invariant.
 */
export function emergencyCompactionRatio(
	triggerRatio: number,
	configuredEmergencyRatio: number | undefined,
	model: Model<Api> | undefined,
	contextWindow: number,
): number {
	const configured = configuredEmergencyRatio ?? 0.98;
	const capacity = admissionCapacityRatio(model, contextWindow);
	// No known capacity to stay under: keep the configured value as before.
	if (capacity === undefined) return Math.max(triggerRatio, configured);
	return Math.max(triggerRatio, Math.min(configured, capacity * EMERGENCY_ADMISSION_MARGIN));
}

export interface SessionInputCapacityInput {
	readonly model: Model<Api> | undefined;
	readonly state: Pick<AgentState, "systemPrompt" | "messages" | "tools">;
	readonly pending: AgentMessage[];
	/** The pending list is passed back so a caller need not capture it in a narrowing const. */
	readonly effectiveWindow: (window: number, pending: AgentMessage[]) => number;
	readonly counter: TokenCounterAdapter;
}

/**
 * Admission gate with one overflow recovery.
 *
 * The gate refuses a turn before any provider call, and the compaction decision
 * reads a different estimator than the gate — so a session can sit in the
 * refusal band with no automatic way out: prompts keep failing while the
 * decision path sees room. When the input is over capacity, run the caller's
 * recovery once (bounded by the caller) and re-check; an input that is still
 * over keeps the refusal, now with the post-recovery numbers.
 */
export async function admitSessionInputOrRecover(
	input: SessionInputCapacityInput & { readonly recover: () => Promise<boolean> | boolean },
): Promise<void> {
	let refusal: PromptInputCapacityError;
	try {
		assertSessionInputCapacity(input);
		return;
	} catch (error) {
		if (!(error instanceof PromptInputCapacityError)) throw error;
		refusal = error;
	}
	if (!(await input.recover())) throw refusal;
	assertSessionInputCapacity(input);
}

export function assertSessionInputCapacity(input: SessionInputCapacityInput): void {
	const { model, state, pending } = input;
	const sessionWindow = model?.contextWindow ?? 0;
	if (!model || !Number.isSafeInteger(sessionWindow) || sessionWindow <= 0) return;
	const contextWindow = input.effectiveWindow(sessionWindow, input.pending);
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
