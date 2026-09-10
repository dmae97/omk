import { parseRuntimeProvenance, type RuntimeProvenance } from "./runtime-provenance.ts";

export const TURN_METRICS_SCHEMA_VERSION = "omk-turn-metrics-2" as const;
/** Compatibility constant: maximum failure text inspected for classification, never retained. */
export const MAX_ERROR_CHARS = 200;
const ERROR_CLASSES = ["timeout", "aborted", "permission", "not_found", "invalid_input", "unknown"] as const;
type ErrorClass = (typeof ERROR_CLASSES)[number];
const STOP_REASONS = ["stop", "length", "toolUse", "error", "aborted"];

export interface ToolCallMetric {
	readonly name: string;
	readonly durationMs: number;
	readonly ok: boolean;
	/** Input-only failure text. Never written to the metrics stream. */
	readonly error?: string;
}
export interface ToolCallMetricRecord extends Omit<ToolCallMetric, "error"> {
	readonly errorClass?: ErrorClass;
}
export interface TurnUsageMetric {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly costUsd: number;
}
export interface TurnMetricInput {
	readonly sessionId: string;
	readonly turnIndex: number;
	readonly provider?: string;
	readonly model?: string;
	readonly startedAtEpochMs: number;
	readonly endedAtEpochMs: number;
	readonly timeToFirstChunkMs?: number;
	readonly usage?: TurnUsageMetric;
	readonly stopReason?: string;
	readonly toolCalls?: readonly ToolCallMetric[];
	readonly compacted?: boolean;
	readonly failovers?: number;
	readonly contextCache?: { readonly planHit: boolean; readonly hits: number; readonly misses: number };
	readonly runtimeProvenance?: RuntimeProvenance;
}
export interface TurnMetricRecord extends Omit<TurnMetricInput, "toolCalls"> {
	readonly schemaVersion: typeof TURN_METRICS_SCHEMA_VERSION;
	readonly durationMs: number;
	readonly toolCalls: readonly ToolCallMetricRecord[];
	readonly toolCallCount: number;
	readonly toolFailureCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) throw new TypeError("Invalid metric object");
	return value;
}
function finite(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Invalid metric number");
	return value;
}
function quantity(value: unknown, integer = false): number {
	const number = finite(value);
	if (number < 0 || (integer && !Number.isSafeInteger(number))) throw new TypeError("Invalid metric quantity");
	return number;
}
function identifier(value: unknown): string {
	if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value))
		throw new TypeError("Invalid metric identifier");
	return value;
}
function boolean(value: unknown): boolean {
	if (typeof value !== "boolean") throw new TypeError("Invalid metric boolean");
	return value;
}
function classifyError(value: unknown): ErrorClass {
	if (value !== undefined && typeof value !== "string") throw new TypeError("Invalid metric error text");
	const text = value?.slice(0, MAX_ERROR_CHARS) ?? "";
	if (/timed? out|timeout/iu.test(text)) return "timeout";
	if (/abort|cancel/iu.test(text)) return "aborted";
	if (/permission|eacces|eperm/iu.test(text)) return "permission";
	if (/not found|enoent/iu.test(text)) return "not_found";
	if (/invalid|validation/iu.test(text)) return "invalid_input";
	return "unknown";
}
function parseErrorClass(value: unknown): ErrorClass | undefined {
	if (value === undefined) return undefined;
	for (const code of ERROR_CLASSES) if (value === code) return code;
	throw new TypeError("Invalid metric error class");
}

/** Explicit projection is shared by new input and legacy/current persisted records. */
function project(value: unknown, source: "input" | "v1" | "v2"): TurnMetricRecord {
	const input = object(value);
	const rawTools = input.toolCalls === undefined ? [] : input.toolCalls;
	if (!Array.isArray(rawTools) || rawTools.length > 10000) throw new TypeError("Invalid metric tool list");
	const toolCalls = Array.from(rawTools, (raw): ToolCallMetricRecord => {
		const call = object(raw);
		const ok = boolean(call.ok);
		if (source === "v2" && call.error !== undefined) throw new TypeError("Raw errors are not v2 metrics");
		const errorClass = source === "v2" ? parseErrorClass(call.errorClass) : classifyError(call.error);
		return {
			name: identifier(call.name),
			durationMs: source === "input" ? Math.max(0, Math.round(finite(call.durationMs))) : quantity(call.durationMs),
			ok,
			...(!ok && errorClass ? { errorClass } : {}),
		};
	});
	const usage = input.usage === undefined ? undefined : object(input.usage);
	const contextCache = input.contextCache === undefined ? undefined : object(input.contextCache);
	const runtimeProvenance =
		input.runtimeProvenance === undefined ? undefined : parseRuntimeProvenance(input.runtimeProvenance);
	const startedAtEpochMs = quantity(input.startedAtEpochMs);
	const endedAtEpochMs = quantity(input.endedAtEpochMs);
	if (
		input.stopReason !== undefined &&
		(typeof input.stopReason !== "string" || !STOP_REASONS.includes(input.stopReason))
	)
		throw new TypeError("Invalid metric stop reason");
	return {
		schemaVersion: TURN_METRICS_SCHEMA_VERSION,
		sessionId: identifier(input.sessionId),
		turnIndex: quantity(input.turnIndex, true),
		startedAtEpochMs,
		endedAtEpochMs,
		durationMs: Math.max(0, endedAtEpochMs - startedAtEpochMs),
		toolCalls,
		toolCallCount: toolCalls.length,
		toolFailureCount: toolCalls.filter((call) => !call.ok).length,
		...(input.provider === undefined ? {} : { provider: identifier(input.provider) }),
		...(input.model === undefined ? {} : { model: identifier(input.model) }),
		...(input.timeToFirstChunkMs === undefined ? {} : { timeToFirstChunkMs: quantity(input.timeToFirstChunkMs) }),
		...(usage === undefined
			? {}
			: {
					usage: {
						input: quantity(usage.input, true),
						output: quantity(usage.output, true),
						cacheRead: quantity(usage.cacheRead, true),
						cacheWrite: quantity(usage.cacheWrite, true),
						costUsd: quantity(usage.costUsd),
					},
				}),
		...(input.stopReason === undefined ? {} : { stopReason: input.stopReason }),
		...(input.compacted === undefined ? {} : { compacted: boolean(input.compacted) }),
		...(input.failovers === undefined ? {} : { failovers: quantity(input.failovers, true) }),
		...(contextCache === undefined
			? {}
			: {
					contextCache: {
						planHit: boolean(contextCache.planHit),
						hits: quantity(contextCache.hits, true),
						misses: quantity(contextCache.misses, true),
					},
				}),
		...(runtimeProvenance ? { runtimeProvenance } : {}),
	};
}

export function buildTurnMetricRecord(input: TurnMetricInput): TurnMetricRecord {
	return project(input, "input");
}

/** Invalid records count as malformed; legacy records are projected, never rewritten on disk. */
export function parseTurnMetricRecord(line: string): TurnMetricRecord | undefined {
	try {
		const value = object(JSON.parse(line));
		const version = value.schemaVersion;
		if (version !== "omk-turn-metrics-1" && version !== TURN_METRICS_SCHEMA_VERSION) return undefined;
		const projected = project(value, version === "omk-turn-metrics-1" ? "v1" : "v2");
		if (
			quantity(value.durationMs) !== projected.durationMs ||
			quantity(value.toolCallCount, true) !== projected.toolCallCount ||
			quantity(value.toolFailureCount, true) !== projected.toolFailureCount
		)
			return undefined;
		return projected;
	} catch (error) {
		if (error instanceof SyntaxError || error instanceof TypeError) return undefined;
		throw error;
	}
}
