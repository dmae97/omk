import type { StreamFn } from "omk-agent-core";
import type { AssistantMessage } from "omk-ai";
import type { AgentSession } from "../../core/agent-session.ts";
import { wrapBudgetStream } from "../../core/budget-stream.ts";
import {
	planSuggestion,
	type QuotaUsage,
	type RecordedMainRequest,
	requestNextSuggestion,
	USAGE_CHECK_TIMEOUT_MS,
} from "../../core/next-suggestion.ts";
import type { SuggestionCandidateSource } from "../../core/next-suggestion-accept-trace.ts";
import { isSuggestionCapsEnabled, suggestionBudgetFromEnv } from "../../core/next-suggestion-budget.ts";
import { collectSuggestionFacts, type SuggestionTurnOutcome } from "../../core/next-suggestion-facts.ts";
import {
	buildSuggestion,
	isWellFormedSuggestionPrompt,
	renderSuggestionPrompt,
	sanitizeModelTask,
	suggestionViolation,
} from "../../core/next-suggestion-prompt.ts";
import * as settlement from "../../core/next-suggestion-settlement.ts";
import { RunBudget } from "../../core/run-budget.ts";
import type { SubscriptionUsageReader } from "../../core/subscription-usage-reader.ts";
import type { NextSuggestionCandidate } from "./next-suggestion-candidate.ts";
import type { NextSuggestionOptions, SuggestionSessionPort } from "./next-suggestion-types.ts";

interface RunSettledSuggestionInput {
	readonly session: SuggestionSessionPort;
	readonly options: NextSuggestionOptions;
	readonly inner: StreamFn;
	readonly candidates: NextSuggestionCandidate;
	readonly outcome: string | undefined;
	readonly generation: number;
	readonly record: RecordedMainRequest | undefined;
	readonly finalAssistant: AssistantMessage | undefined;
	readonly parentTurnIndex: number;
	readonly isCurrent: () => boolean;
	readonly editorEmpty: () => boolean;
	readonly pendingOwner: { pending: AbortController | undefined };
	readonly show: (shown: ComposedSuggestion, timing: SuggestionShowTiming) => void;
}

export interface SuggestionShowTiming {
	readonly parentTurnIndex: number;
	readonly settledAtEpochMs: number;
	readonly quotaCheckedAtEpochMs: number;
}

/** A validated suggestion ready for the editor: `prompt` is both displayed and inserted on accept. */
export interface ComposedSuggestion {
	readonly title: string;
	readonly prompt: string;
	readonly source: SuggestionCandidateSource;
	/** The accepted model sentence, when one contributed. */
	readonly task?: string;
}

/** A selected model with credentials: otherwise the suggestion is "blocked" and names why. */
export function sessionCanSend(session: SuggestionSessionPort, options: NextSuggestionOptions): boolean {
	return session.model !== undefined && (options.modelUsable?.() ?? true);
}

export interface ComposeSuggestionInput {
	readonly session: SuggestionSessionPort;
	readonly canSend: boolean;
	readonly outcome: SuggestionTurnOutcome;
	/** Why model generation did not contribute; recorded in the evidence section. */
	readonly generation?: string;
	/** Raw model sentence; untrusted until `sanitizeModelTask` accepts it. */
	readonly modelText?: string;
	readonly cached?: boolean;
	readonly env?: NodeJS.ProcessEnv;
}

/**
 * Build the suggestion for the current session state. The host renderer owns the four-section
 * layout, so a missing, empty or malformed model reply degrades to the local suggestion instead
 * of an empty one. Returns undefined only if the host output itself breaks the contract.
 */
export function composeSuggestion(input: ComposeSuggestionInput): ComposedSuggestion | undefined {
	const facts = collectSuggestionFacts({
		messages: input.session.agent.state.messages,
		outcome: input.outcome,
		modelMissing: !input.canSend,
		generation: input.generation,
		env: input.env,
	});
	const task = sanitizeModelTask(input.modelText, facts);
	// A reply that fails validation is recorded as the reason no model sentence contributed.
	const rejected = input.modelText !== undefined && task === undefined;
	const suggestion = buildSuggestion(rejected ? { ...facts, generation: "invalid_output" } : facts, task);
	const prompt = renderSuggestionPrompt(suggestion);
	if (suggestionViolation(suggestion) !== undefined || !isWellFormedSuggestionPrompt(prompt)) return undefined;
	const source = suggestion.source === "local" ? "local" : input.cached ? "cache" : "generated";
	return { title: suggestion.title, prompt, source, ...(suggestion.source === "model" && task ? { task } : {}) };
}

/** Fail closed: an error, a timeout or a missing reader all count as unavailable. */
async function checkUsage(options: NextSuggestionOptions): Promise<QuotaUsage> {
	const read = options.quotaUsage;
	if (!read) return "unavailable";
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<QuotaUsage>((resolve) => {
		timer = setTimeout(() => resolve("unavailable"), options.usageTimeoutMs ?? USAGE_CHECK_TIMEOUT_MS);
	});
	try {
		return await Promise.race([read().catch((): QuotaUsage => "unavailable"), timeout]);
	} finally {
		clearTimeout(timer);
	}
}

/** Last assistant message in a session snapshot, if the final message is an assistant message. */
export function lastAssistant(messages: readonly unknown[]): AssistantMessage | undefined {
	const last = messages.at(-1) as { role?: string } | undefined;
	return last?.role === "assistant" ? (last as AssistantMessage) : undefined;
}

/** Highest used percent across the active provider's quota windows. */
export async function activeQuotaUsage(session: AgentSession, reader: SubscriptionUsageReader): Promise<QuotaUsage> {
	const snapshot = await reader.read(session.state.model?.provider ?? "");
	if (snapshot === undefined) return "no_quota";
	const used = snapshot.windows
		.map((window) => window.usedPercent)
		.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
	return used.length > 0 ? Math.max(...used) : "unavailable";
}

/** Outcome of the newest turn in a snapshot nobody settled in front of this controller (startup, resume). */
export function snapshotOutcome(messages: readonly unknown[]): SuggestionTurnOutcome {
	if (messages.length === 0) return "idle";
	const stop = lastAssistant(messages)?.stopReason;
	return stop === "aborted" ? "aborted" : stop === "error" ? "failed" : "completed";
}

/**
 * One settled-turn suggestion pipeline; the controller owns UI and cancellation state.
 *
 * A local suggestion is shown first, before any await, so the editor never waits on a
 * provider. A model sentence then refines it when the plan admits a request and the reply
 * validates; every skip, empty reply, timeout and provider error leaves the local one in
 * place. An aborted turn is an explicit cancel: nothing is shown and nothing is requested.
 */
export async function runSettledSuggestion(input: RunSettledSuggestionInput): Promise<void> {
	const { session, options, record, finalAssistant, parentTurnIndex } = input;
	const now = options.now ?? Date.now;
	const settledAtEpochMs = Date.now();
	const capsOn = isSuggestionCapsEnabled(options.env);
	const outcome = input.outcome === "completed" || input.outcome === "aborted" ? input.outcome : "failed";
	const makePlan = (usage: QuotaUsage) =>
		planSuggestion({
			record,
			outcome,
			finalAssistant,
			currentModel: session.model,
			nowMs: now(),
			usage,
			...(capsOn ? { caps: { budget: options.budget ?? suggestionBudgetFromEnv(options.env) } } : {}),
		});
	let quotaCheckedAtEpochMs = settledAtEpochMs;
	const show = (extra: Pick<ComposeSuggestionInput, "generation" | "modelText" | "cached">): string | undefined => {
		if (outcome === "aborted" || !input.isCurrent() || !input.editorEmpty()) return undefined;
		const canSend = sessionCanSend(session, options);
		const composed = composeSuggestion({ session, outcome, canSend, env: options.env, ...extra });
		if (composed) input.show(composed, { parentTurnIndex, settledAtEpochMs, quotaCheckedAtEpochMs });
		return composed?.task;
	};
	let plan = makePlan("no_quota");
	if (plan.kind !== "request") {
		options.onPlan?.(plan);
		if (capsOn) options.settle?.(settlement.skipSettlement(plan, session.model, parentTurnIndex));
		show({ generation: plan.reason });
		return;
	}
	const cached = input.candidates.get(record, finalAssistant, session.model);
	if (cached && input.editorEmpty()) {
		show({ modelText: cached, cached: true });
		return;
	}
	show({});
	const usage = await checkUsage(options);
	quotaCheckedAtEpochMs = Date.now();
	if (!input.isCurrent()) return;
	plan = makePlan(usage);
	options.onPlan?.(plan);
	if (plan.kind !== "request") {
		if (capsOn) options.settle?.(settlement.skipSettlement(plan, session.model, parentTurnIndex));
		show({ generation: plan.reason });
		return;
	}
	const controller = new AbortController();
	input.pendingOwner.pending = controller;
	const startedAtEpochMs = Date.now();
	const scope = new RunBudget(undefined, () => {});
	const result = await (async () => {
		try {
			return await requestNextSuggestion(
				wrapBudgetStream(input.inner, scope),
				plan.record,
				plan.finalAssistant,
				controller.signal,
				{
					caps: plan.caps,
					now: options.now,
					timeoutSignal: options.timeoutSignal,
				},
			);
		} finally {
			// The wrapper retains any unresolved terminal reservation; closing never refunds it.
			scope.close();
		}
	})();
	const { provider, id } = plan.record.model;
	const caps = plan.caps ? { caps: { reasoningCapped: plan.caps.reasoningCapped } } : {};
	options.settle?.({ result, provider, model: id, parentTurnIndex, startedAtEpochMs, ...caps });
	if (!input.isCurrent() || controller.signal.aborted) return;
	input.pendingOwner.pending = undefined;
	const current = session.model;
	if (plan.caps && (current?.provider !== provider || current?.id !== id)) return;
	// No retry: one request per settled turn, then the local suggestion stands with the reason attached.
	const task = show(
		result.text ? { modelText: result.text } : { generation: result.outcome === "shown" ? "empty" : result.outcome },
	);
	if (task) input.candidates.store(plan.record, plan.finalAssistant, task);
}
