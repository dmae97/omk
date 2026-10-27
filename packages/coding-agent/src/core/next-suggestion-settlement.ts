/**
 * Spec 103 §2.2b: settle one suggestion request as its own turn-metric record
 * (`purpose: "suggestion"`, `parentTurnIndex`), so it never folds into the
 * parent turn's totals. Metadata only: no prompt or suggestion text is stored.
 */
import { join } from "node:path";
import type { SuggestionCostCapHit, SuggestionResult, SuggestionSkipReason } from "./next-suggestion.ts";
import { type TurnMetricInput, TurnMetricsSink, turnUsageMetricFromUsage } from "./turn-metrics.ts";
import type { SuggestionMetricSkipReason } from "./turn-metrics-record.ts";

export interface SuggestionSettlement {
	readonly result: SuggestionResult;
	readonly provider: string;
	readonly model: string;
	/** Index of the main turn the suggestion followed (same numbering as main records). */
	readonly parentTurnIndex: number;
	readonly startedAtEpochMs: number;
	/** Spec 103b: present only with `OMK_NEXT_SUGGESTIONS_CAPS` on. */
	readonly caps?: { readonly reasoningCapped: boolean };
}

/** Spec 103b: a caps-on plan skip (no provider call). Only ever produced with the caps flag on. */
export interface SuggestionSkipSettlement {
	readonly skip: SuggestionSkipReason;
	readonly costCap?: SuggestionCostCapHit;
	readonly provider?: string;
	readonly model?: string;
	readonly parentTurnIndex: number;
	readonly atEpochMs: number;
}

/** Build a caps-on skip settlement from a skip plan; the caller checks the caps flag. */
export function skipSettlement(
	plan: { readonly reason: SuggestionSkipReason; readonly costCap?: SuggestionCostCapHit },
	model: { readonly provider: string; readonly id: string } | undefined,
	parentTurnIndex: number,
	atEpochMs: number = Date.now(),
): SuggestionSkipSettlement {
	return {
		skip: plan.reason,
		...(plan.costCap ? { costCap: plan.costCap } : {}),
		...(model ? { provider: model.provider, model: model.id } : {}),
		parentTurnIndex,
		atEpochMs,
	};
}

export type AnySuggestionSettlement = SuggestionSettlement | SuggestionSkipSettlement;

// Compile-time guard: the record enum must cover every plan skip reason.
const _skipReasonsCovered: SuggestionMetricSkipReason = "no_record" as SuggestionSkipReason;
void _skipReasonsCovered;

export function suggestionMetricInput(sessionId: string, settlement: SuggestionSettlement): TurnMetricInput {
	const { result } = settlement;
	return {
		sessionId,
		turnIndex: settlement.parentTurnIndex,
		purpose: "suggestion",
		parentTurnIndex: settlement.parentTurnIndex,
		suggestionOutcome: result.outcome,
		provider: settlement.provider,
		model: settlement.model,
		startedAtEpochMs: settlement.startedAtEpochMs,
		endedAtEpochMs: settlement.startedAtEpochMs + result.latencyMs,
		...(result.usage ? { usage: turnUsageMetricFromUsage(result.usage), stopReason: stopReasonOf(result) } : {}),
		...(settlement.caps ? { capsApplied: true, reasoningCapped: settlement.caps.reasoningCapped } : {}),
	};
}

/** Skip record: no usage, `durationMs: 0`; the cost-cap numbers only on `over_cost_cap`. */
export function suggestionSkipMetricInput(sessionId: string, settlement: SuggestionSkipSettlement): TurnMetricInput {
	const costCap = settlement.skip === "over_cost_cap" ? settlement.costCap : undefined;
	return {
		sessionId,
		turnIndex: settlement.parentTurnIndex,
		purpose: "suggestion",
		parentTurnIndex: settlement.parentTurnIndex,
		...(settlement.provider === undefined ? {} : { provider: settlement.provider }),
		...(settlement.model === undefined ? {} : { model: settlement.model }),
		startedAtEpochMs: settlement.atEpochMs,
		endedAtEpochMs: settlement.atEpochMs,
		capsApplied: true,
		suggestionSkip: settlement.skip,
		...(costCap ? { estimatedCostUsd: costCap.estimatedCostUsd, maxCostUsd: costCap.maxCostUsd } : {}),
	};
}

export function anySuggestionMetricInput(sessionId: string, settlement: AnySuggestionSettlement): TurnMetricInput {
	return "skip" in settlement
		? suggestionSkipMetricInput(sessionId, settlement)
		: suggestionMetricInput(sessionId, settlement);
}

function stopReasonOf(result: SuggestionResult): "stop" | "aborted" | "error" {
	if (result.outcome === "aborted" || result.outcome === "timeout") return "aborted";
	return result.outcome === "error" ? "error" : "stop";
}

const DISABLED = new Set(["0", "false", "off", "disable", "disabled"]);

/** Same location and opt-out as the session's own sink (`OMK_TURN_METRICS`, `OMK_TURN_METRICS_DIR`). */
export function suggestionMetricsSettler(
	sessionId: () => string,
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): ((settlement: AnySuggestionSettlement) => void) | undefined {
	const flag = env.OMK_TURN_METRICS;
	if (flag !== undefined && DISABLED.has(flag.trim().toLowerCase())) return undefined;
	const sink = new TurnMetricsSink({ dir: env.OMK_TURN_METRICS_DIR ?? join(cwd, ".omk", "metrics") });
	return (settlement) => {
		try {
			sink.record(anySuggestionMetricInput(sessionId(), settlement));
		} catch {
			// Advisory only.
		}
	};
}
