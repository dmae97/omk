import type { Queryable } from "./db.js";

export interface Row {
	[k: string]: any;
}

/** T-01 invariants on one usage row. Returns the violated rules (empty = ok). */
export function checkInvariants(r: Row): string[] {
	const bad: string[] = [];
	if (r.prompt_tokens !== r.cache_hit_tokens + r.cache_miss_tokens) bad.push("prompt != hit + miss");
	if (r.total_tokens !== r.prompt_tokens + r.completion_tokens) bad.push("total != prompt + completion");
	if (r.answer_tokens !== r.completion_tokens - r.reasoning_tokens || r.answer_tokens < 0) bad.push("answer != completion - reasoning");
	return bad;
}

/** Exact comparison of a metered row against the upstream `usage` it was derived from. */
export function compareToUpstream(r: Row, usage: any): string[] {
	const hit = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
	const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? 0;
	const want: Record<string, number> = {
		prompt_tokens: usage.prompt_tokens,
		cache_hit_tokens: hit,
		cache_miss_tokens: usage.prompt_cache_miss_tokens ?? usage.prompt_tokens - hit,
		completion_tokens: usage.completion_tokens,
		reasoning_tokens: reasoning,
		answer_tokens: usage.completion_tokens - reasoning,
		total_tokens: usage.total_tokens,
	};
	return Object.entries(want).filter(([k, v]) => r[k] !== v).map(([k, v]) => `${k}: metered ${r[k]} != upstream ${v}`);
}

export interface Report {
	exact: { rows: number; tokens: number; billed_nano_usd: number; upstream_nano_usd: number };
	estimated: { rows: number; tokens: number; billed_nano_usd: number; upstream_nano_usd: number };
	invariant_violations: { id: string; rules: string[] }[];
}

/** Reconciliation report straight from the DB. Estimated rows are aggregated SEPARATELY. */
export async function reportFromDb(db: Queryable, month?: string): Promise<Report> {
	const r = await db.query(
		`SELECT * , billed_cost_nano_usd::float8 AS b, upstream_cost_nano_usd::float8 AS u FROM usage_events ${month ? "WHERE month=$1" : ""} ORDER BY ts_start`,
		month ? [month] : [],
	);
	const rep: Report = {
		exact: { rows: 0, tokens: 0, billed_nano_usd: 0, upstream_nano_usd: 0 },
		estimated: { rows: 0, tokens: 0, billed_nano_usd: 0, upstream_nano_usd: 0 },
		invariant_violations: [],
	};
	for (const row of r.rows) {
		const bucket = row.estimated ? rep.estimated : rep.exact;
		bucket.rows++;
		bucket.tokens += row.total_tokens;
		bucket.billed_nano_usd += row.b;
		bucket.upstream_nano_usd += row.u;
		const rules = checkInvariants(row);
		if (rules.length) rep.invariant_violations.push({ id: row.id, rules });
	}
	return rep;
}
