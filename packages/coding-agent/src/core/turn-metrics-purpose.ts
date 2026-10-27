/** Spec 103 §2.2b: per-purpose breakdown of turn-metric records (main vs suggestion). */
import type { TurnMetricPurpose, TurnMetricRecord } from "./turn-metrics-record.ts";

export interface PurposeUsageTotals {
	readonly records: number;
	/** Records without usage: missing coverage, never counted as 0. */
	readonly missingUsage: number;
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly costUsd: number;
	/** Suggestion records only: cost of outcomes `aborted` and `timeout`. */
	readonly cancelledCostUsd: number;
	/** Spec 103b, suggestion bucket only, present only when a caps-on record exists. */
	readonly capsEligible?: number;
	readonly capHits?: CapHits;
}

/** A record counts once in `total` even when several caps hit it. */
export interface CapHits {
	readonly deadline: number;
	readonly cost: number;
	readonly reasoning: number;
	readonly total: number;
}

export function summarizeByPurpose(
	records: readonly TurnMetricRecord[],
): Readonly<Record<TurnMetricPurpose, PurposeUsageTotals>> {
	const empty = () => ({
		records: 0,
		missingUsage: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		costUsd: 0,
		cancelledCostUsd: 0,
	});
	const result: Record<TurnMetricPurpose, PurposeUsageTotals & ReturnType<typeof empty>> = {
		main: empty(),
		suggestion: empty(),
	};
	const hits = { deadline: 0, cost: 0, reasoning: 0, total: 0 };
	let capsEligible = 0;
	for (const record of records) {
		if (record.purpose === "suggestion" && record.capsApplied) {
			capsEligible++;
			const deadline = record.suggestionOutcome === "timeout";
			const cost = record.suggestionSkip === "over_cost_cap";
			const reasoning = record.reasoningCapped === true;
			if (deadline) hits.deadline++;
			if (cost) hits.cost++;
			if (reasoning) hits.reasoning++;
			if (deadline || cost || reasoning) hits.total++;
		}
		// Skip records made no request: not a record with missing usage.
		if (record.suggestionSkip !== undefined) continue;
		const bucket = result[record.purpose ?? "main"];
		bucket.records++;
		const usage = record.usage;
		if (!usage) {
			bucket.missingUsage++;
			continue;
		}
		bucket.input += usage.input;
		bucket.output += usage.output;
		bucket.cacheRead += usage.cacheRead;
		bucket.cacheWrite += usage.cacheWrite ?? 0;
		bucket.costUsd += usage.costUsd;
		if (record.suggestionOutcome === "aborted" || record.suggestionOutcome === "timeout") {
			bucket.cancelledCostUsd += usage.costUsd;
		}
	}
	if (capsEligible === 0) return result;
	return { main: result.main, suggestion: { ...result.suggestion, capsEligible, capHits: hits } };
}

type MutableTotals = { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number };

/** Add suggestion usage to the cost/token totals; returns their billed count and amount. */
export function addSuggestionTotals(
	records: readonly TurnMetricRecord[],
	totals: MutableTotals,
): { billedTurns: number; billedCostUsd: number } {
	const billed = { billedTurns: 0, billedCostUsd: 0 };
	for (const record of records) {
		if (record.purpose !== "suggestion" || !record.usage) continue;
		totals.input += record.usage.input;
		totals.output += record.usage.output;
		totals.cacheRead += record.usage.cacheRead;
		totals.cacheWrite += record.usage.cacheWrite ?? 0;
		totals.costUsd += record.usage.costUsd;
		if (record.usage.billedUsd !== undefined) {
			billed.billedTurns++;
			billed.billedCostUsd += record.usage.billedUsd;
		}
	}
	return billed;
}
