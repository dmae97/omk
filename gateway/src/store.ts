import type { Db, Queryable } from "./db.js";
import { newId } from "./tokens.js";

export interface UserRow {
	id: string;
	label: string;
	plan: string;
	allow_max_effort: boolean;
	allowed_models: string[] | null;
	monthly_cap_override: number | null;
}

export interface KeyRow {
	id: string;
	user_id: string;
	token_hash: string;
	expires_at: Date | null;
	revoked_at: Date | null;
}

export interface UsageEvent {
	id: string;
	user_id: string;
	key_id: string;
	request_id: string;
	ts_start: Date;
	ts_end: Date;
	month: string;
	model_public: string;
	model_upstream: string;
	stream: boolean;
	prompt_tokens: number;
	cache_hit_tokens: number;
	cache_miss_tokens: number;
	completion_tokens: number;
	reasoning_tokens: number;
	answer_tokens: number;
	total_tokens: number;
	finish_reason: string | null;
	peak: boolean;
	price_table_version: string;
	billed_cost_nano_usd: number;
	upstream_cost_nano_usd: number;
	estimated: boolean;
	end_reason: string;
	usage_anomaly: boolean;
	upstream_usage_json: unknown;
}

export async function createUser(db: Queryable, o: { label: string; plan: string; allowMaxEffort?: boolean; allowedModels?: string[] | null; capOverride?: number | null }): Promise<string> {
	const id = newId("usr");
	await db.query(
		"INSERT INTO users(id,label,plan,allow_max_effort,allowed_models,monthly_cap_override) VALUES ($1,$2,$3,$4,$5::jsonb,$6::bigint)",
		[id, o.label, o.plan, o.allowMaxEffort ?? false, o.allowedModels ? JSON.stringify(o.allowedModels) : null, o.capOverride ?? null],
	);
	return id;
}

export async function insertKey(db: Queryable, o: { userId: string; tokenHash: string; label?: string; expiresAt?: Date | null; now: Date }): Promise<string> {
	const id = newId("key");
	await db.query("INSERT INTO api_keys(id,user_id,token_hash,label,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6)", [
		id,
		o.userId,
		o.tokenHash,
		o.label ?? null,
		o.now.toISOString(),
		o.expiresAt ? o.expiresAt.toISOString() : null,
	]);
	return id;
}

export async function revokeKey(db: Queryable, keyId: string, now: Date): Promise<boolean> {
	const r = await db.query("UPDATE api_keys SET revoked_at = COALESCE(revoked_at,$2) WHERE id=$1 RETURNING id", [keyId, now.toISOString()]);
	return r.rows.length > 0;
}

export async function findKeyByHash(db: Queryable, hash: string): Promise<(KeyRow & { user: UserRow }) | null> {
	const r = await db.query(
		`SELECT k.id, k.user_id, k.token_hash, k.expires_at, k.revoked_at,
		        u.label, u.plan, u.allow_max_effort, u.allowed_models, u.monthly_cap_override::float8 AS monthly_cap_override
		 FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.token_hash = $1`,
		[hash],
	);
	const row = r.rows[0];
	if (!row) return null;
	return {
		id: row.id,
		user_id: row.user_id,
		token_hash: row.token_hash,
		expires_at: row.expires_at ?? null,
		revoked_at: row.revoked_at ?? null,
		user: { id: row.user_id, label: row.label, plan: row.plan, allow_max_effort: row.allow_max_effort, allowed_models: row.allowed_models ?? null, monthly_cap_override: row.monthly_cap_override ?? null },
	};
}

export async function monthlyUsed(db: Queryable, userId: string, month: string): Promise<number> {
	const r = await db.query("SELECT COALESCE((SELECT tokens FROM usage_monthly WHERE user_id=$1 AND month=$2),0)::float8 AS used", [userId, month]);
	return Number(r.rows[0].used);
}

export async function reservedTokens(db: Queryable, userId: string, month: string): Promise<number> {
	const r = await db.query("SELECT COALESCE(SUM(tokens),0)::float8 AS n FROM reservations WHERE user_id=$1 AND month=$2", [userId, month]);
	return Number(r.rows[0].n);
}

/**
 * Atomic check-and-reserve in ONE statement. Race-safe on PGlite (single connection).
 * On a multi-connection Postgres this needs an advisory lock or SERIALIZABLE (open issue).
 */
export async function tryReserve(db: Queryable, o: { userId: string; month: string; tokens: number; cap: number; now: Date }): Promise<string | null> {
	const id = newId("rsv");
	const r = await db.query(
		`INSERT INTO reservations(id,user_id,month,tokens,created_at)
		 SELECT $1::text,$2::text,$3::text,$4::bigint,$5::timestamptz
		 WHERE $6::bigint
		   - COALESCE((SELECT tokens FROM usage_monthly WHERE user_id=$2::text AND month=$3::text),0)
		   - COALESCE((SELECT SUM(tokens) FROM reservations WHERE user_id=$2::text AND month=$3::text),0) >= $4::bigint
		 RETURNING id`,
		[id, o.userId, o.month, o.tokens, o.now.toISOString(), o.cap],
	);
	return r.rows[0] ? id : null;
}

export async function releaseReservation(db: Queryable, id: string | null): Promise<void> {
	if (id) await db.query("DELETE FROM reservations WHERE id=$1", [id]);
}

export async function recordDenied(db: Queryable, o: { requestId: string; ts: Date; userId?: string; keyId?: string; code: string; model?: string }): Promise<void> {
	await db.query("INSERT INTO denied_events(id,ts,user_id,key_id,request_id,code,model) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
		newId("den"),
		o.ts.toISOString(),
		o.userId ?? null,
		o.keyId ?? null,
		o.requestId,
		o.code,
		o.model ?? null,
	]);
}

/** One transaction: immutable event row + monthly counters + reservation settle + Polar outbox row. */
export async function recordUsage(db: Db, ev: UsageEvent, reservationId: string | null, outboxPayload: Record<string, unknown>): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.query(
			`INSERT INTO usage_events(id,user_id,key_id,request_id,ts_start,ts_end,month,model_public,model_upstream,stream,
			  prompt_tokens,cache_hit_tokens,cache_miss_tokens,completion_tokens,reasoning_tokens,answer_tokens,total_tokens,
			  finish_reason,peak,price_table_version,billed_cost_nano_usd,upstream_cost_nano_usd,estimated,end_reason,usage_anomaly,upstream_usage_json)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb)`,
			[
				ev.id, ev.user_id, ev.key_id, ev.request_id, ev.ts_start.toISOString(), ev.ts_end.toISOString(), ev.month,
				ev.model_public, ev.model_upstream, ev.stream, ev.prompt_tokens, ev.cache_hit_tokens, ev.cache_miss_tokens,
				ev.completion_tokens, ev.reasoning_tokens, ev.answer_tokens, ev.total_tokens, ev.finish_reason, ev.peak,
				ev.price_table_version, ev.billed_cost_nano_usd, ev.upstream_cost_nano_usd, ev.estimated, ev.end_reason,
				ev.usage_anomaly, JSON.stringify(ev.upstream_usage_json ?? null),
			],
		);
		await tx.query(
			`INSERT INTO usage_monthly(user_id,month,tokens,reasoning_tokens,billed_cost_nano_usd,upstream_cost_nano_usd,requests)
			 VALUES ($1,$2,$3,$4,$5,$6,1)
			 ON CONFLICT (user_id,month) DO UPDATE SET
			   tokens = usage_monthly.tokens + EXCLUDED.tokens,
			   reasoning_tokens = usage_monthly.reasoning_tokens + EXCLUDED.reasoning_tokens,
			   billed_cost_nano_usd = usage_monthly.billed_cost_nano_usd + EXCLUDED.billed_cost_nano_usd,
			   upstream_cost_nano_usd = usage_monthly.upstream_cost_nano_usd + EXCLUDED.upstream_cost_nano_usd,
			   requests = usage_monthly.requests + 1`,
			[ev.user_id, ev.month, ev.total_tokens, ev.reasoning_tokens, ev.billed_cost_nano_usd, ev.upstream_cost_nano_usd],
		);
		if (reservationId) await tx.query("DELETE FROM reservations WHERE id=$1", [reservationId]);
		await enqueueOutbox(tx, ev.id, outboxPayload);
	});
}

/** Outbox only: no network call anywhere. external_id is the dedup key, so a retry is a no-op. */
export async function enqueueOutbox(db: Queryable, externalId: string, payload: Record<string, unknown>): Promise<boolean> {
	const r = await db.query("INSERT INTO polar_outbox(external_id,payload) VALUES ($1,$2::jsonb) ON CONFLICT (external_id) DO NOTHING RETURNING id", [externalId, JSON.stringify({ ...payload, external_id: externalId })]);
	return r.rows.length > 0;
}
