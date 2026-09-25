import type { AgentMessage, AgentTool } from "omk-agent-core";
import { estimateTokens } from "./compaction/compaction.ts";
import type { ContextBudgetTokenizerMode, TokenCounterAdapter } from "./context-budget-token-counter.ts";
import { canonicalizeMessagesForContextAdmission, convertToLlm } from "./messages.ts";

const RESPONSE_RESERVE_RATIO = 0.2;
const MAX_RESPONSE_RESERVE_RATIO = 0.25;
const SAFETY_MARGIN_RATIO = 0.1;
const MIN_PROMPT_TOKENS = 4000;
const LEGACY_MAX_PROMPT_TOKENS = 60_000;
const LEGACY_RESPONSE_RESERVE_TOKENS = 8_192;

export interface PromptTokenBudgetInput {
	readonly contextWindow: number;
	readonly modelMaxTokens?: number;
	readonly envMaxPromptTokens?: number;
	readonly envResponseReserveTokens?: number;
	readonly envPromptRatio?: number;
	readonly envResponseRatio?: number;
}

export interface PromptTokenBudget {
	readonly maxPromptTokens: number;
	readonly responseReserveTokens: number;
}

export interface ContextInputEstimateInput {
	readonly systemPrompt: string;
	readonly messages: readonly AgentMessage[];
	readonly tools: readonly AgentTool[];
	readonly modelId: string;
	readonly tokenCounter: TokenCounterAdapter;
	readonly projectedUsageTokens?: number;
}

export interface ContextInputTokenEstimate {
	readonly systemPromptTokens: number;
	readonly messageTokens: number;
	readonly toolTokens: number;
	readonly localTokens: number;
	readonly providerUsageTokens: number;
	readonly totalTokens: number;
	readonly imageCount: number;
	readonly basis: "local" | "provider_usage";
}

export interface HardPromptInputLimitInput {
	readonly contextWindow: number;
	readonly configuredMaxPromptTokens: number;
	readonly modelMaxTokens?: number;
}

export interface HardPromptInputLimit {
	readonly contextWindow: number;
	readonly responseReserveTokens: number;
	readonly safetyMarginTokens: number;
	readonly physicalInputTokens: number;
	readonly maxInputTokens: number;
}

export interface ContextInputModelAdmissionInput extends ContextInputEstimateInput {
	readonly contextWindow: number;
	readonly configuredMaxPromptTokens: number;
	readonly modelMaxTokens?: number;
}

export interface ContextInputModelAdmissionResult {
	readonly estimate: ContextInputTokenEstimate;
	readonly limit: HardPromptInputLimit;
}

export function parsePositiveIntegerEnv(name: string): number | undefined {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return undefined;
	const value = Number.parseInt(raw, 10);
	return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function parsePositiveFloatEnv(name: string): number | undefined {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return undefined;
	const value = Number.parseFloat(raw);
	return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function parseTokenizerModeEnv(value: string | undefined): ContextBudgetTokenizerMode {
	switch (value) {
		case "fallback":
		case "openai-js":
		case "openai-wasm":
		case "auto":
			return value;
		default:
			return "fallback";
	}
}

export function parseCommaSeparatedEnv(value: string | undefined): string[] {
	if (value === undefined || value.trim() === "") return [];
	return Array.from(
		new Set(
			value
				.split(",")
				.map((item) => item.trim())
				.filter((item) => item.length > 0),
		),
	);
}

export class PromptInputCapacityError extends Error {
	readonly code = "context_input_capacity_exceeded";
	readonly estimatedTokens: number;
	readonly maxInputTokens: number;

	constructor(estimatedTokens: number, maxInputTokens: number) {
		super(
			`Prompt input exceeds the safe model context window (estimated=${estimatedTokens}, limit=${maxInputTokens}).`,
		);
		this.name = "PromptInputCapacityError";
		this.estimatedTokens = estimatedTokens;
		this.maxInputTokens = maxInputTokens;
	}
}

/** Response reserve prefers the model's own maxTokens, else a window ratio with the legacy floor. */
export function computeResponseReserveTokens(
	contextWindow: number,
	modelMaxTokens?: number,
	overrideRatio?: number,
): number {
	if (modelMaxTokens !== undefined && modelMaxTokens > 0 && modelMaxTokens < contextWindow) return modelMaxTokens;
	return Math.max(
		Math.floor(contextWindow * (overrideRatio ?? RESPONSE_RESERVE_RATIO)),
		LEGACY_RESPONSE_RESERVE_TOKENS,
	);
}

/** Prompt budget for the soft system-resource planner. */
export function computePromptTokenBudget(input: PromptTokenBudgetInput): PromptTokenBudget {
	let maxPromptTokens: number;
	let responseReserveTokens: number;
	if (input.envMaxPromptTokens !== undefined) {
		maxPromptTokens = input.envMaxPromptTokens;
		responseReserveTokens =
			input.envResponseReserveTokens ?? computeResponseReserveTokens(input.contextWindow, input.modelMaxTokens);
	} else if (input.contextWindow > 0) {
		responseReserveTokens =
			input.envResponseReserveTokens ??
			computeResponseReserveTokens(input.contextWindow, input.modelMaxTokens, input.envResponseRatio);
		const safetyMargin = Math.floor(input.contextWindow * SAFETY_MARGIN_RATIO);
		maxPromptTokens =
			input.envPromptRatio !== undefined && input.envPromptRatio > 0 && input.envPromptRatio < 1
				? Math.floor(input.contextWindow * input.envPromptRatio)
				: input.contextWindow - responseReserveTokens - safetyMargin;
	} else {
		maxPromptTokens = LEGACY_MAX_PROMPT_TOKENS;
		responseReserveTokens = input.envResponseReserveTokens ?? LEGACY_RESPONSE_RESERVE_TOKENS;
	}
	if (maxPromptTokens < MIN_PROMPT_TOKENS) maxPromptTokens = MIN_PROMPT_TOKENS;
	if (responseReserveTokens >= maxPromptTokens) {
		responseReserveTokens = Math.max(Math.floor(maxPromptTokens / 4), LEGACY_RESPONSE_RESERVE_TOKENS);
	}
	return { maxPromptTokens, responseReserveTokens };
}

/** Final full-request limit, capped so the legacy soft-planner floor cannot exceed a tiny model window. */
export function computeHardPromptInputLimit(input: HardPromptInputLimitInput): HardPromptInputLimit {
	assertPositiveSafeInteger(input.contextWindow, "contextWindow");
	assertNonNegativeSafeInteger(input.configuredMaxPromptTokens, "configuredMaxPromptTokens");
	if (
		input.modelMaxTokens !== undefined &&
		(!Number.isSafeInteger(input.modelMaxTokens) || input.modelMaxTokens < 0)
	) {
		throw new TypeError("modelMaxTokens must be a nonnegative safe integer");
	}
	const preferredReserve =
		input.modelMaxTokens && input.modelMaxTokens > 0
			? input.modelMaxTokens
			: Math.floor(input.contextWindow * RESPONSE_RESERVE_RATIO);
	const responseReserveTokens = Math.min(
		input.contextWindow,
		preferredReserve,
		Math.floor(input.contextWindow * MAX_RESPONSE_RESERVE_RATIO),
	);
	const safetyMarginTokens = Math.floor(input.contextWindow * SAFETY_MARGIN_RATIO);
	const physicalInputTokens = Math.max(0, input.contextWindow - responseReserveTokens - safetyMarginTokens);
	return {
		contextWindow: input.contextWindow,
		responseReserveTokens,
		safetyMarginTokens,
		physicalInputTokens,
		maxInputTokens: Math.min(input.configuredMaxPromptTokens, physicalInputTokens),
	};
}

export function estimateContextInputTokens(input: ContextInputEstimateInput): ContextInputTokenEstimate {
	if (input.projectedUsageTokens !== undefined)
		assertNonNegativeSafeInteger(input.projectedUsageTokens, "projectedUsageTokens");
	const messages = convertToLlm([...input.messages]);
	const canonical = canonicalizeMessagesForContextAdmission(messages);
	const systemPromptTokens = countText(input.tokenCounter, input.systemPrompt, input.modelId);
	const heuristicMessageTokens = messages.reduce((sum, message) => sum + estimateTokens(message as AgentMessage), 0);
	const messageTokens = Math.max(countText(input.tokenCounter, canonical.text, input.modelId), heuristicMessageTokens);
	const toolTokens = countText(input.tokenCounter, stringify(input.tools, "tool definitions"), input.modelId);
	const localTokens = addTokens(
		addTokens(systemPromptTokens, messageTokens, "system+message"),
		toolTokens,
		"local total",
	);
	const providerUsageTokens = input.projectedUsageTokens ?? 0;
	const useProviderUsage = providerUsageTokens > localTokens;
	return {
		systemPromptTokens,
		messageTokens,
		toolTokens,
		localTokens,
		providerUsageTokens,
		totalTokens: useProviderUsage ? providerUsageTokens : localTokens,
		imageCount: canonical.imageCount,
		basis: useProviderUsage ? "provider_usage" : "local",
	};
}

export function assertContextInputWithinCapacity(
	input: ContextInputEstimateInput & { readonly maxInputTokens: number },
): ContextInputTokenEstimate {
	assertNonNegativeSafeInteger(input.maxInputTokens, "maxInputTokens");
	const estimate = estimateContextInputTokens(input);
	if (estimate.totalTokens > input.maxInputTokens)
		throw new PromptInputCapacityError(estimate.totalTokens, input.maxInputTokens);
	return estimate;
}

export function assertContextInputWithinModelWindow(
	input: ContextInputModelAdmissionInput,
): ContextInputModelAdmissionResult {
	const limit = computeHardPromptInputLimit({
		contextWindow: input.contextWindow,
		configuredMaxPromptTokens: input.configuredMaxPromptTokens,
		modelMaxTokens: input.modelMaxTokens,
	});
	return { limit, estimate: assertContextInputWithinCapacity({ ...input, maxInputTokens: limit.maxInputTokens }) };
}

function countText(counter: TokenCounterAdapter, input: string, modelId: string): number {
	const result = counter.countText(input, modelId);
	assertNonNegativeSafeInteger(result.tokens, `tokenCounter(${counter.id}).tokens`);
	return result.tokens;
}

function stringify(value: unknown, label: string): string {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		throw new TypeError(`${label} are not JSON-serializable`);
	}
}

function addTokens(left: number, right: number, label: string): number {
	const total = left + right;
	if (!Number.isSafeInteger(total)) throw new RangeError(`${label} exceeds safe integer precision`);
	return total;
}

function assertPositiveSafeInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer`);
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a nonnegative safe integer`);
}
