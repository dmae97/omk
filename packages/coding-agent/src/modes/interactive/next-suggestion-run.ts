import type { StreamFn } from "omk-agent-core";
import type { AssistantMessage } from "omk-ai";
import { wrapBudgetStream } from "../../core/budget-stream.ts";
import {
	planSuggestion,
	type QuotaUsage,
	type RecordedMainRequest,
	requestNextSuggestion,
	USAGE_CHECK_TIMEOUT_MS,
} from "../../core/next-suggestion.ts";
import { isSuggestionCapsEnabled, suggestionBudgetFromEnv } from "../../core/next-suggestion-budget.ts";
import * as settlement from "../../core/next-suggestion-settlement.ts";
import { RunBudget } from "../../core/run-budget.ts";
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
	readonly onPending: (controller: AbortController | undefined) => void;
	readonly show: (
		text: string,
		record: RecordedMainRequest,
		parentTurnIndex: number,
		settledAtEpochMs: number,
		quotaCheckedAtEpochMs: number,
	) => void;
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

/** One settled-turn suggestion pipeline; the controller owns UI and cancellation state. */
export async function runSettledSuggestion(input: RunSettledSuggestionInput): Promise<void> {
	const { session, options, record, finalAssistant, parentTurnIndex } = input;
	const now = options.now ?? Date.now;
	const settledAtEpochMs = Date.now();
	const capsOn = isSuggestionCapsEnabled(options.env);
	const makePlan = (usage: QuotaUsage) =>
		planSuggestion({
			record,
			outcome: input.outcome === "completed" || input.outcome === "aborted" ? input.outcome : "failed",
			finalAssistant,
			currentModel: session.model,
			nowMs: now(),
			usage,
			...(capsOn ? { caps: { budget: options.budget ?? suggestionBudgetFromEnv(options.env) } } : {}),
		});
	let plan = makePlan("no_quota");
	if (plan.kind !== "request") {
		options.onPlan?.(plan);
		if (capsOn) options.settle?.(settlement.skipSettlement(plan, session.model, parentTurnIndex));
		return;
	}
	const cached = input.candidates.get(record, finalAssistant, session.model);
	if (cached && input.editorEmpty()) {
		input.show(cached, plan.record, parentTurnIndex, settledAtEpochMs, settledAtEpochMs);
		return;
	}
	const usage = await checkUsage(options);
	const quotaCheckedAtEpochMs = Date.now();
	if (!input.isCurrent()) return;
	plan = makePlan(usage);
	options.onPlan?.(plan);
	if (plan.kind !== "request") {
		if (capsOn) options.settle?.(settlement.skipSettlement(plan, session.model, parentTurnIndex));
		return;
	}
	const controller = new AbortController();
	input.onPending(controller);
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
	input.onPending(undefined);
	const current = session.model;
	if (plan.caps && (current?.provider !== provider || current?.id !== id)) return;
	const text = result.text;
	if (!text || !input.editorEmpty()) return;
	input.candidates.store(plan.record, plan.finalAssistant, text);
	input.show(text, plan.record, parentTurnIndex, settledAtEpochMs, quotaCheckedAtEpochMs);
}
