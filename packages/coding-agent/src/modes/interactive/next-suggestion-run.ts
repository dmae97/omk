import type { StreamFn } from "omk-agent-core";
import type { AssistantMessage } from "omk-ai";
import type { AgentSession } from "../../core/agent-session.ts";
import { wrapBudgetStream } from "../../core/budget-stream.ts";
import {
	MAX_SUGGESTION_CHARS,
	planSuggestion,
	type QuotaUsage,
	type RecordedMainRequest,
	requestNextSuggestion,
	USAGE_CHECK_TIMEOUT_MS,
} from "../../core/next-suggestion.ts";
import type { SuggestionCandidateSource } from "../../core/next-suggestion-accept-trace.ts";
import {
	isSuggestionCapsEnabled,
	quotaPercentFromSnapshot,
	suggestionBudgetFromEnv,
} from "../../core/next-suggestion-budget.ts";
import type { ClearReason, DisplayReporter } from "../../core/next-suggestion-display-log.ts";
import { collectSuggestionFacts, type SuggestionTurnOutcome } from "../../core/next-suggestion-facts.ts";
import { sanitizeModelTask } from "../../core/next-suggestion-prompt.ts";
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
	readonly cancelReason?: () => ClearReason | undefined;
	readonly isCurrent: () => boolean;
	readonly editorEmpty: () => boolean;
	readonly pendingOwner: { pending: AbortController | undefined };
	readonly show: (shown: ComposedSuggestion, timing: SuggestionShowTiming) => void;
}

export interface SuggestionShowTiming {
	readonly parentTurnIndex: number;
	readonly settledAtEpochMs: number;
	readonly report?: DisplayReporter;
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
 * V1 displays only a model-generated request; unavailable generation leaves the editor unchanged.
 * U4: the next open task of the latest todo snapshot wins over model text, and a fresh passing
 * check suppresses the suggestion until another edit or failure.
 */
export function composeSuggestion(input: ComposeSuggestionInput): ComposedSuggestion | undefined {
	if (!input.canSend) return undefined;
	const facts = collectSuggestionFacts({
		messages: input.session.agent.state.messages,
		outcome: input.outcome,
		modelMissing: false,
		generation: input.generation,
		env: input.env,
	});
	if (facts.outcome === "completed" && !facts.failedTools.length) {
		if (typeof facts.nextTask === "string") {
			const next = sanitizeModelTask(facts.nextTask, facts);
			return next && !facts.freshCheck ? { title: next, prompt: next, source: "local" } : undefined;
		}
		if (facts.freshCheck) return undefined;
	}
	const task = sanitizeModelTask(input.modelText, facts);
	if (!task || task.length > MAX_SUGGESTION_CHARS) return undefined;
	return { title: task, prompt: task, source: input.cached ? "cache" : "generated", task };
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
export async function activeQuotaUsage(
	session: AgentSession,
	reader: SubscriptionUsageReader,
	warmFallbackMs = 1_500,
): Promise<QuotaUsage> {
	const provider = session.state.model?.provider ?? "";
	const activeId = session.state.model?.id;
	const prior = reader.snapshot(provider);
	const priorUsed = prior ? quotaPercentFromSnapshot(prior.windows, activeId) : undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const snapshot =
		priorUsed !== undefined
			? await Promise.race([
					reader.read(provider).catch(() => undefined),
					new Promise<undefined>((resolve) => {
						timer = setTimeout(() => resolve(undefined), warmFallbackMs);
					}),
				]).finally(() => clearTimeout(timer))
			: await reader.read(provider);
	if (snapshot === undefined) return priorUsed ?? "no_quota";
	return quotaPercentFromSnapshot(snapshot.windows, activeId) ?? priorUsed ?? "unavailable";
}

/** Outcome of the newest turn in a snapshot nobody settled in front of this controller (startup, resume). */
export function snapshotOutcome(messages: readonly unknown[]): SuggestionTurnOutcome {
	if (messages.length === 0) return "idle";
	const stop = lastAssistant(messages)?.stopReason;
	return stop === "aborted" ? "aborted" : stop === "error" ? "failed" : "completed";
}

/** One settled-turn suggestion pipeline; missing or rejected generation shows no fallback. */
export async function runSettledSuggestion(input: RunSettledSuggestionInput): Promise<void> {
	const { session, options, record, finalAssistant, parentTurnIndex } = input;
	const now = options.now ?? Date.now;
	const settledAtEpochMs = Date.now();
	const report = options.displayLog?.({
		parentTurnIndex,
		settledAtEpochMs,
		provider: record?.model.provider,
		model: record?.model.id,
	});
	const capsOn = isSuggestionCapsEnabled(options.env);
	const diagnostics = settlement.isSuggestionDiagnosticsEnabled(options.env);
	let quotaReadMs: number | undefined;
	const settleSkip = (plan: Parameters<typeof settlement.skipSettlement>[0]) => {
		if (!capsOn && !diagnostics) return;
		const base = settlement.skipSettlement(plan, session.model, parentTurnIndex);
		const read = diagnostics && quotaReadMs !== undefined ? { quotaReadMs } : {};
		options.settle?.({ ...base, ...(capsOn ? {} : { capsApplied: false as const }), ...read });
	};
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
	const show = (
		extra: Pick<ComposeSuggestionInput, "generation" | "modelText" | "cached">,
	): ComposedSuggestion | undefined => {
		if (outcome === "aborted" || !input.isCurrent() || !input.editorEmpty()) {
			report?.("skipped", outcome === "aborted" ? "aborted" : !input.isCurrent() ? "stale_turn" : "editor_nonempty");
			return undefined;
		}
		const canSend = sessionCanSend(session, options);
		const composed = composeSuggestion({ session, outcome, canSend, env: options.env, ...extra });
		if (extra.modelText && !composed?.task) report?.("skipped", "invalid_output");
		if (composed) input.show(composed, { parentTurnIndex, settledAtEpochMs, quotaCheckedAtEpochMs, report });
		return composed;
	};
	let plan = makePlan("no_quota");
	if (plan.kind !== "request") {
		if (outcome !== "aborted") report?.("skipped", plan.reason);
		options.onPlan?.(plan);
		settleSkip(plan);
		show({ generation: plan.reason });
		return;
	}
	const cached = input.candidates.get(record, finalAssistant, session.model);
	if (cached && input.editorEmpty()) {
		show({ modelText: cached, cached: true });
		return;
	}
	if (show({})?.source === "local") return;
	const quotaStartedAt = performance.now();
	const usage = await checkUsage(options);
	quotaCheckedAtEpochMs = Date.now();
	quotaReadMs = Math.round(performance.now() - quotaStartedAt);
	if (!input.isCurrent()) return report?.("skipped", input.cancelReason?.() ?? "stale_turn");
	plan = makePlan(usage);
	options.onPlan?.(plan);
	if (plan.kind !== "request") {
		report?.("skipped", plan.reason);
		settleSkip(plan);
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
	options.settle?.({
		result,
		provider,
		model: id,
		parentTurnIndex,
		startedAtEpochMs,
		...caps,
		...(diagnostics ? { quotaReadMs } : {}),
	});
	if (!input.isCurrent() || controller.signal.aborted)
		return report?.("skipped", input.cancelReason?.() ?? (controller.signal.aborted ? "aborted" : "stale_turn"));
	input.pendingOwner.pending = undefined;
	const current = session.model;
	if (plan.caps && (current?.provider !== provider || current?.id !== id)) return report?.("skipped", "model_changed");
	if (result.outcome !== "shown") report?.("skipped", result.outcome);
	const shown = show(
		result.text ? { modelText: result.text } : { generation: result.outcome === "shown" ? "empty" : result.outcome },
	);
	if (shown?.task) input.candidates.store(plan.record, plan.finalAssistant, shown.task);
}
