/**
 * Per-turn runtime metrics.
 *
 * Before this, `telemetry.ts` covered install opt-in and nothing else, and
 * `run-journal.ts` recorded a hash-chained *integrity* log (run started /
 * finished / tool timeout). Neither could answer the questions that actually
 * drive harness work: which tools fail, how long they take, what a turn costs,
 * and whether the context cache is doing anything.
 *
 * Shape: one JSON object per line under `<cwd>/.omk/metrics/turns.jsonl`.
 * Append-only, bounded by size with a single rotation, and never load-bearing —
 * a failed write is dropped, never surfaced as a turn error.
 *
 * Privacy: records counts, durations, ids, and error *classes*. It never
 * records prompt text, tool arguments, tool output, or file contents. New
 * records retain bounded error classes only; raw failure text is never serialized.
 */

import fs from "node:fs";
import { cumulativeCacheReadShare, isUsageInputSemanticsVerified } from "omk-ai";
import { addSuggestionTotals, type PurposeUsageTotals, summarizeByPurpose } from "./turn-metrics-purpose.ts";
import { parseTurnMetricRecord, type TurnMetricRecord, type TurnUsageMetric } from "./turn-metrics-record.ts";
import type { MetricFieldCoverage } from "./turn-metrics-reliability.ts";

export * from "./turn-metrics-record.ts";
export {
	type MetricFieldCoverage,
	recordSessionTurnMetrics,
	TurnReliabilityCollector,
} from "./turn-metrics-reliability.ts";
export { DEFAULT_MAX_METRICS_BYTES, TurnMetricsSink, type TurnMetricsSinkOptions } from "./turn-metrics-sink.ts";

export interface ToolAggregate {
	readonly name: string;
	readonly calls: number;
	readonly failures: number;
	readonly failureRate: number;
	readonly p50Ms: number;
	readonly p95Ms: number;
	readonly totalMs: number;
}

export interface UsageCoverage {
	readonly turnsWithUsage: number;
	readonly turnsMissingUsage: number;
	/** Turns with usage whose provider did not report cache writes; excluded from cache share. */
	readonly turnsMissingCacheWrite: number;
	/** Providers with usage whose `input` semantics were not verified (shown as 미검증). */
	readonly unverifiedProviders: readonly string[];
}

export interface TurnMetricsSummary {
	readonly turns: number;
	readonly sessions: number;
	readonly models: readonly string[];
	/** Sum of catalog-price estimates (`UsageCost.total`). */
	readonly totalCostUsd: number;
	/** Sum of provider-reported billed amounts; only turns that reported one contribute. */
	readonly billedCostUsd: number;
	readonly billedTurns: number;
	readonly usageCoverage: UsageCoverage;
	readonly totals: TurnUsageMetric;
	readonly turnDurationP50Ms: number;
	readonly turnDurationP95Ms: number;
	readonly timeToFirstChunkP50Ms?: number;
	readonly cacheReadShare: number;
	/** Which turns `cacheReadShare` was computed over: turns with usage and a reported cacheWrite. */
	readonly cacheReadShareCoverage: Readonly<Record<"turnsUsed" | "turnsTotal" | "turnsMissingCacheWrite", number>>;
	/** `true` when `totalCostUsd` includes a turn with unknown cacheWrite, so it is a lower bound (하한). */
	readonly costIsLowerBound: boolean;
	readonly compactions: number;
	readonly failovers: number;
	readonly compactionCoverage: MetricFieldCoverage;
	readonly failoverCoverage: MetricFieldCoverage;
	readonly contextCachePlanHitRate?: number;
	/** Turns where a valid projection's response model differs from the selected model. */
	readonly provenanceMismatchTurns: number;
	readonly tools: readonly ToolAggregate[];
	/** Lines that could not be parsed as a metric record. */
	readonly malformedLines: number;
	/** Spec 103: only when suggestion records exist; `totals` above is the sum of both. */
	readonly byPurpose?: Readonly<Record<"main" | "suggestion", PurposeUsageTotals>>;
}

function percentile(sorted: readonly number[], fraction: number): number {
	if (sorted.length === 0) return 0;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
	return sorted[index];
}

/**
 * Aggregate JSONL lines into a summary. Malformed lines are counted rather than
 * discarded silently, so a truncated tail is visible instead of pretending the
 * data is complete.
 */
export function summarizeTurnMetrics(lines: readonly string[]): TurnMetricsSummary {
	const records: TurnMetricRecord[] = [];
	let malformedLines = 0;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		const record = parseTurnMetricRecord(trimmed);
		if (record) records.push(record);
		else malformedLines++;
	}

	const sessions = new Set<string>();
	const models = new Set<string>();
	const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
	const turnDurations: number[] = [];
	const firstChunkTimes: number[] = [];
	const toolStats = new Map<string, { durations: number[]; failures: number }>();
	let compactions = 0;
	let failovers = 0;
	let compactionsMeasured = 0;
	let failoversMeasured = 0;
	let planHits = 0;
	let planObservations = 0;
	let provenanceMismatchTurns = 0;
	// Spec 103: suggestion records count only toward cost totals (and `byPurpose`), never as turns.
	let { billedTurns, billedCostUsd } = addSuggestionTotals(records, totals);
	let turnsMissingUsage = 0;
	let turnsMissingCacheWrite = 0;
	// Cache share is computed over covered usage only: turns whose cache writes are known.
	const covered = { input: 0, cacheRead: 0, cacheWrite: 0 };
	const unverifiedProviders = new Set<string>();

	const mainRecords = records.filter((record) => record.purpose !== "suggestion");
	for (const record of mainRecords) {
		sessions.add(record.sessionId);
		if (record.model) models.add(record.provider ? `${record.provider}/${record.model}` : record.model);
		if (record.usage) {
			totals.input += record.usage.input;
			totals.output += record.usage.output;
			totals.cacheRead += record.usage.cacheRead;
			if (record.usage.cacheWrite === undefined) {
				turnsMissingCacheWrite++;
			} else {
				totals.cacheWrite += record.usage.cacheWrite;
				covered.input += record.usage.input;
				covered.cacheRead += record.usage.cacheRead;
				covered.cacheWrite += record.usage.cacheWrite;
			}
			totals.costUsd += record.usage.costUsd;
			if (record.usage.billedUsd !== undefined) {
				billedCostUsd += record.usage.billedUsd;
				billedTurns++;
			}
			if (!isUsageInputSemanticsVerified(record.provider)) unverifiedProviders.add(record.provider ?? "unknown");
		} else {
			turnsMissingUsage++;
		}
		turnDurations.push(record.durationMs);
		if (typeof record.timeToFirstChunkMs === "number") firstChunkTimes.push(record.timeToFirstChunkMs);
		if (typeof record.compacted === "boolean") {
			compactionsMeasured++;
			if (record.compacted) compactions++;
		}
		if (typeof record.failovers === "number") {
			failoversMeasured++;
			failovers += record.failovers;
		}
		if (record.contextCache) {
			planObservations++;
			if (record.contextCache.planHit) planHits++;
		}
		const provenance = record.runtimeProvenance;
		if (
			provenance !== undefined &&
			provenance !== null &&
			provenance.responseModel !== null &&
			provenance.responseModel !== provenance.selectedModel
		) {
			provenanceMismatchTurns++;
		}
		for (const call of record.toolCalls ?? []) {
			const stats = toolStats.get(call.name) ?? { durations: [], failures: 0 };
			stats.durations.push(call.durationMs);
			if (!call.ok) stats.failures++;
			toolStats.set(call.name, stats);
		}
	}

	turnDurations.sort((a, b) => a - b);
	firstChunkTimes.sort((a, b) => a - b);

	const tools: ToolAggregate[] = [...toolStats.entries()]
		.map(([name, stats]) => {
			const sorted = [...stats.durations].sort((a, b) => a - b);
			return {
				name,
				calls: sorted.length,
				failures: stats.failures,
				failureRate: sorted.length === 0 ? 0 : stats.failures / sorted.length,
				p50Ms: percentile(sorted, 0.5),
				p95Ms: percentile(sorted, 0.95),
				totalMs: sorted.reduce((sum, value) => sum + value, 0),
			};
		})
		.sort((a, b) => b.totalMs - a.totalMs || a.name.localeCompare(b.name));

	return {
		turns: mainRecords.length,
		sessions: sessions.size,
		models: [...models].sort(),
		totalCostUsd: totals.costUsd,
		billedCostUsd,
		billedTurns,
		usageCoverage: {
			turnsWithUsage: mainRecords.length - turnsMissingUsage,
			turnsMissingUsage,
			turnsMissingCacheWrite,
			unverifiedProviders: [...unverifiedProviders].sort(),
		},
		totals,
		turnDurationP50Ms: percentile(turnDurations, 0.5),
		turnDurationP95Ms: percentile(turnDurations, 0.95),
		timeToFirstChunkP50Ms: firstChunkTimes.length > 0 ? percentile(firstChunkTimes, 0.5) : undefined,
		// Shared helper: cacheRead / (input + cacheRead + cacheWrite) over token sums of
		// covered turns only; turns with unknown cache writes are counted in
		// usageCoverage.turnsMissingCacheWrite instead of being treated as 0.
		cacheReadShare: cumulativeCacheReadShare([covered]) ?? 0,
		cacheReadShareCoverage: {
			turnsUsed: mainRecords.length - turnsMissingUsage - turnsMissingCacheWrite,
			turnsTotal: mainRecords.length,
			turnsMissingCacheWrite,
		},
		costIsLowerBound: turnsMissingCacheWrite > 0,
		compactions,
		failovers,
		compactionCoverage: {
			turnsMeasured: compactionsMeasured,
			turnsUnknown: mainRecords.length - compactionsMeasured,
			turnsTotal: mainRecords.length,
		},
		failoverCoverage: {
			turnsMeasured: failoversMeasured,
			turnsUnknown: mainRecords.length - failoversMeasured,
			turnsTotal: mainRecords.length,
		},
		contextCachePlanHitRate: planObservations === 0 ? undefined : planHits / planObservations,
		provenanceMismatchTurns,
		tools,
		malformedLines,
		...(records.some((r) => r.purpose === "suggestion") ? { byPurpose: summarizeByPurpose(records) } : {}),
	};
}

/** Read and summarize a metrics file. A missing file summarizes as zero turns. */
export function summarizeTurnMetricsFile(filePath: string): TurnMetricsSummary {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf8");
	} catch {
		return summarizeTurnMetrics([]);
	}
	return summarizeTurnMetrics(raw.split("\n"));
}
