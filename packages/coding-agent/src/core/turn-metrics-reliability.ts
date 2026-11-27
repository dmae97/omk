export interface TurnReliabilitySnapshot {
	readonly compacted: boolean;
	readonly failovers: number;
}

export interface MetricFieldCoverage {
	readonly turnsMeasured: number;
	readonly turnsUnknown: number;
	readonly turnsTotal: number;
}

/** Collects real compaction and failover success events for the next persisted turn metric. */
export class TurnReliabilityCollector {
	private compacted = false;
	private failovers = 0;

	noteCompaction(): void {
		this.compacted = true;
	}

	noteFailover(): void {
		this.failovers += 1;
	}

	consume(): TurnReliabilitySnapshot {
		const snapshot: TurnReliabilitySnapshot = { compacted: this.compacted, failovers: this.failovers };
		this.compacted = false;
		this.failovers = 0;
		return snapshot;
	}
}

export function formatMeasuredMetricCount(count: number, coverage: MetricFieldCoverage): string {
	const formatted = count.toLocaleString("en-US");
	if (coverage.turnsTotal === 0 || coverage.turnsUnknown === 0) return formatted;
	if (coverage.turnsMeasured === 0) {
		return `unknown (0/${coverage.turnsTotal.toLocaleString("en-US")} measured)`;
	}
	return `${formatted} (${coverage.turnsMeasured.toLocaleString("en-US")}/${coverage.turnsTotal.toLocaleString("en-US")} measured)`;
}

export interface SessionTurnMetricParams {
	readonly sink: { record(input: import("./turn-metrics-record.ts").TurnMetricInput): boolean };
	readonly sessionId: string;
	readonly turnIndex: number;
	readonly provider?: string;
	readonly modelId?: string;
	readonly startedAtEpochMs: number;
	readonly endedAtEpochMs: number;
	readonly requestedModel: string | null;
	readonly requestedThinking: string;
	readonly effectiveThinking: string;
	readonly assistant?: {
		readonly provider?: string;
		readonly model?: string;
		readonly responseModel?: string;
		readonly stopReason?: string;
		readonly usage?: Parameters<typeof import("./turn-metrics-record.ts").turnUsageMetricFromUsage>[0];
	};
	readonly toolCalls: readonly import("./turn-metrics-record.ts").ToolCallMetric[];
	readonly reliability: TurnReliabilityCollector;
	readonly buildProvenance: (input: {
		requestedModel: string | null;
		selectedModel: string | null;
		responseModel: string | null;
		requestedThinking: string;
		effectiveThinking: string;
		source: "session";
	}) => import("./runtime-provenance.ts").RuntimeProvenance;
	readonly toUsageMetric: typeof import("./turn-metrics-record.ts").turnUsageMetricFromUsage;
}

/** Persist one session turn metric safely; never throws. */
export function recordSessionTurnMetrics(params: SessionTurnMetricParams): void {
	const { assistant } = params;
	const selectedModel = params.provider && params.modelId ? `${params.provider}/${params.modelId}` : null;
	const runtimeProvenance = params.buildProvenance({
		requestedModel: params.requestedModel,
		selectedModel,
		responseModel:
			assistant?.responseModel ??
			(assistant?.provider && assistant?.model ? `${assistant.provider}/${assistant.model}` : null),
		requestedThinking: params.requestedThinking,
		effectiveThinking: params.effectiveThinking,
		source: "session",
	});
	try {
		params.sink.record({
			sessionId: params.sessionId,
			turnIndex: params.turnIndex,
			provider: params.provider,
			model: params.modelId,
			startedAtEpochMs: params.startedAtEpochMs,
			endedAtEpochMs: params.endedAtEpochMs,
			stopReason: assistant?.stopReason,
			runtimeProvenance,
			usage: assistant?.usage ? params.toUsageMetric(assistant.usage) : undefined,
			toolCalls: params.toolCalls,
			...params.reliability.consume(),
		});
	} catch {
		// Never let observability break a turn.
	}
}
