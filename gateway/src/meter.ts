import type { GatewayConfig } from "./config.js";
import { costs } from "./cost.js";
import type { UsageEvent } from "./store.js";
import { isPeak, kstMonthKey } from "./time.js";

export interface Normalized {
	prompt: number;
	hit: number;
	miss: number;
	completion: number;
	reasoning: number;
	answer: number;
	total: number;
	anomaly: boolean;
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0);

/** Reads the upstream `usage` object. Nothing is recomputed unless a field is absent. */
export function normalizeUsage(u: any): Normalized {
	const prompt = n(u?.prompt_tokens);
	const hit = u?.prompt_cache_hit_tokens !== undefined ? n(u.prompt_cache_hit_tokens) : n(u?.prompt_tokens_details?.cached_tokens);
	const miss = u?.prompt_cache_miss_tokens !== undefined ? n(u.prompt_cache_miss_tokens) : Math.max(0, prompt - hit);
	const completion = n(u?.completion_tokens);
	const reasoning = n(u?.completion_tokens_details?.reasoning_tokens);
	const total = u?.total_tokens !== undefined ? n(u.total_tokens) : prompt + completion;
	const anomaly = hit + miss !== prompt || reasoning > completion || total !== prompt + completion;
	return { prompt, hit, miss, completion, reasoning, answer: Math.max(0, completion - reasoning), total, anomaly };
}

/** Estimate for a stream that ended without usage. Output only: the prompt size was never reported. */
export function estimateFromOutput(chars: { content: number; reasoning: number; tool: number }, charsPerToken: number): Normalized {
	const completion = Math.ceil((chars.content + chars.reasoning + chars.tool) / charsPerToken);
	const reasoning = Math.ceil(chars.reasoning / charsPerToken);
	return { prompt: 0, hit: 0, miss: 0, completion, reasoning, answer: Math.max(0, completion - reasoning), total: completion, anomaly: false };
}

export function buildEvent(o: {
	config: GatewayConfig;
	eventId: string;
	requestId: string;
	userId: string;
	keyId: string;
	start: Date;
	end: Date;
	modelPublic: string;
	modelUpstream: string;
	stream: boolean;
	usage: Normalized;
	finishReason: string | null;
	estimated: boolean;
	endReason: string;
	upstreamUsage: unknown;
}): UsageEvent {
	const peak = isPeak(o.start, o.config.prices.windows, o.config.prices.holidays);
	const c = costs(o.config, o.modelUpstream, { hit: o.usage.hit, miss: o.usage.miss, out: o.usage.completion }, peak);
	return {
		id: o.eventId,
		user_id: o.userId,
		key_id: o.keyId,
		request_id: o.requestId,
		ts_start: o.start,
		ts_end: o.end,
		month: kstMonthKey(o.start),
		model_public: o.modelPublic,
		model_upstream: o.modelUpstream,
		stream: o.stream,
		prompt_tokens: o.usage.prompt,
		cache_hit_tokens: o.usage.hit,
		cache_miss_tokens: o.usage.miss,
		completion_tokens: o.usage.completion,
		reasoning_tokens: o.usage.reasoning,
		answer_tokens: o.usage.answer,
		total_tokens: o.usage.total,
		finish_reason: o.finishReason,
		peak,
		price_table_version: o.config.prices.version,
		billed_cost_nano_usd: c.billedNano,
		upstream_cost_nano_usd: c.upstreamNano,
		estimated: o.estimated,
		end_reason: o.endReason,
		usage_anomaly: o.usage.anomaly,
		upstream_usage_json: o.upstreamUsage,
	};
}

/** Polar event payload (outbox only). Public model ID only, flat metadata within Polar's limits. */
export function polarPayload(ev: UsageEvent): Record<string, unknown> {
	return {
		name: "omk_usage",
		external_customer_id: ev.user_id,
		timestamp: ev.ts_start.toISOString(),
		metadata: {
			model: ev.model_public,
			input_miss_tokens: ev.cache_miss_tokens,
			input_hit_tokens: ev.cache_hit_tokens,
			output_tokens: ev.completion_tokens,
			reasoning_tokens: ev.reasoning_tokens,
			answer_tokens: ev.answer_tokens,
			total_tokens: ev.total_tokens,
			peak: ev.peak,
			estimated: ev.estimated,
			cost_nano_usd: ev.billed_cost_nano_usd,
			price_table_version: ev.price_table_version,
		},
	};
}
