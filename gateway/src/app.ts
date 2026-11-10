import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { GatewayConfig } from "./config.js";
import type { Db } from "./db.js";
import { E, GatewayError } from "./errors.js";
import { KeyLimiter } from "./limiter.js";
import { createLogger, type Logger } from "./logger.js";
import { buildEvent, estimateFromOutput, normalizeUsage, polarPayload, type Normalized } from "./meter.js";
import { findKeyByHash, monthlyUsed, recordDenied, recordUsage, releaseReservation, reservedTokens, tryReserve, type KeyRow, type UserRow } from "./store.js";
import { formatKst, isoKst, kstMonthKey, nextKstMonthStart, secondsUntil } from "./time.js";
import { hashToken, isWellFormedToken, newId } from "./tokens.js";
import { checkCaps, checkModel, validateRequest, type Validated } from "./validate.js";

export interface AppDeps {
	config: GatewayConfig;
	db: Db;
	/** Upstream key from env only. Never logged, never stored. */
	upstreamApiKey: string | null;
	upstreamBaseUrl?: string;
	now?: () => Date;
	monotonic?: () => number;
	log?: Logger;
}

type Vars = { requestId: string; keyHash8?: string; user?: UserRow; keyId?: string; model?: string };
type Ctx = Context<{ Variables: Vars }>;

const enc = new TextEncoder();

function errorResponse(c: Ctx, err: GatewayError): Response {
	const res = c.json(err.body(), err.status as 400);
	for (const [k, v] of Object.entries(err.headers())) res.headers.set(k, v);
	return res;
}

export function createApp(deps: AppDeps) {
	const { config, db } = deps;
	const now = deps.now ?? (() => new Date());
	const log = deps.log ?? createLogger((l) => process.stdout.write(`${l}\n`));
	const limiter = new KeyLimiter(config.limits.rpmPerKey, config.limits.concurrentPerKey, deps.monotonic ?? (() => performance.now()));
	const baseUrl = (deps.upstreamBaseUrl ?? config.gateway.upstreamBaseUrl).replace(/\/+$/, "");
	const app = new Hono<{ Variables: Vars }>();

	app.use("*", async (c, next) => {
		const t = performance.now();
		c.set("requestId", `req_${randomUUID().replace(/-/g, "")}`);
		await next();
		c.res.headers.set("x-request-id", c.get("requestId"));
		log.info("request", {
			request_id: c.get("requestId"),
			method: c.req.method,
			path: new URL(c.req.url).pathname,
			status: c.res.status,
			key: c.get("keyHash8"),
			model: c.get("model"),
			ms: Math.round(performance.now() - t),
			code: c.res.status >= 400 ? c.res.headers.get("x-omk-code") ?? undefined : undefined,
		});
		c.res.headers.delete("x-omk-code");
	});

	app.onError(async (err, c) => {
		if (err instanceof GatewayError) {
			if (err.status === 429) {
				const u = c.get("user");
				await recordDenied(db, { requestId: c.get("requestId"), ts: now(), userId: u?.id, keyId: c.get("keyId"), code: err.code, model: c.get("model") }).catch(() => {});
			}
			const res = errorResponse(c, err);
			res.headers.set("x-omk-code", err.code);
			return res;
		}
		log.warn("unhandled_error", { request_id: c.get("requestId"), msg: err instanceof Error ? err.name : "unknown" });
		const g = new GatewayError(500, "internal_error", "api_error", "Internal error.");
		const res = errorResponse(c, g);
		res.headers.set("x-omk-code", g.code);
		return res;
	});

	app.notFound((c) => {
		const g = new GatewayError(404, "not_found", "invalid_request_error", "Unknown endpoint.");
		const res = errorResponse(c, g);
		res.headers.set("x-omk-code", g.code);
		return res;
	});

	app.use(
		"/v1/*",
		bodyLimit({
			maxSize: 8 * 1024 * 1024,
			onError: (c) => {
				const g = new GatewayError(413, "request_too_large", "invalid_request_error", "Request body is too large.");
				const res = errorResponse(c as Ctx, g);
				res.headers.set("x-omk-code", g.code);
				return res;
			},
		}),
	);

	async function authenticate(c: Ctx, at: Date): Promise<{ key: KeyRow; user: UserRow }> {
		const h = c.req.header("authorization");
		if (!h) throw E.tokenMissing();
		const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
		if (!m) throw E.tokenInvalid();
		const token = m[1] as string;
		const hash = hashToken(token);
		c.set("keyHash8", hash.slice(0, 8));
		if (!isWellFormedToken(token)) throw E.tokenInvalid();
		const row = await findKeyByHash(db, hash);
		if (!row) throw E.tokenInvalid();
		c.set("user", row.user);
		c.set("keyId", row.id);
		if (row.revoked_at) throw E.tokenRevoked();
		if (row.expires_at && new Date(row.expires_at).getTime() <= at.getTime()) throw E.tokenExpired();
		return { key: row, user: row.user };
	}

	function monthlyCap(user: UserRow): number {
		const cap = user.monthly_cap_override ?? config.limits.plans[user.plan]?.monthly_token_cap;
		if (typeof cap !== "number") throw new Error("user has no monthly cap");
		return cap;
	}

	app.get("/healthz", (c) => c.json({ status: "ok" }));

	app.get("/v1/models", async (c) => {
		const { user } = await authenticate(c, now());
		const data = Object.entries(config.models)
			.filter(([id]) => !user.allowed_models || user.allowed_models.includes(id))
			.map(([id, m]) => {
				const ceiling = config.limits.maxTokensCeiling[id] ?? null;
				return { id, object: "model", owned_by: "omk", omk: { ...m.public, ...(ceiling !== null ? { max_tokens_ceiling: ceiling } : {}) } };
			});
		return c.json({ object: "list", data });
	});

	app.get("/v1/account", async (c) => {
		const at = now();
		const { key, user } = await authenticate(c, at);
		const month = kstMonthKey(at);
		return c.json({
			id: user.id,
			label: user.label,
			expires_at: key.expires_at ? new Date(key.expires_at).toISOString() : null,
			quota: { monthly_token_cap: monthlyCap(user), used: await monthlyUsed(db, user.id, month), resets_at: isoKst(nextKstMonthStart(at)) },
		});
	});

	app.post("/v1/chat/completions", async (c) => {
		const start = now();
		const requestId = c.get("requestId");
		const { key, user } = await authenticate(c, start);

		const wait = limiter.checkRate(key.id);
		if (wait !== null) {
			throw new GatewayError(429, "rate_limited", "rate_limit_error", `Too many requests. Retry in ${wait} seconds.`, { retryAfter: wait });
		}
		let body: any;
		try {
			body = await c.req.json();
		} catch {
			throw E.invalid("Request body is not valid JSON.", undefined, "invalid_json");
		}
		const { model, cfg } = checkModel(body, config, user);
		c.set("model", model);
		const v = validateRequest(body, model, cfg, config, user, user.id);
		const capErr = checkCaps(v, config, user);
		if (capErr) throw capErr;

		// monthly budget: reserve (prompt estimate + max_tokens) atomically, settle after the response
		const month = kstMonthKey(start);
		const cap = monthlyCap(user);
		const need = v.maxTokens + Math.ceil(v.promptChars / config.gateway.estimateCharsPerToken);
		const reservationId = await tryReserve(db, { userId: user.id, month, tokens: need, cap, now: start });
		if (!reservationId) {
			const used = await monthlyUsed(db, user.id, month);
			const reserved = await reservedTokens(db, user.id, month);
			const reset = nextKstMonthStart(start);
			if (used >= cap) {
				throw new GatewayError(
					429,
					"quota_exceeded",
					"rate_limit_error",
					`Monthly token budget used (${used} of ${cap}). Resets ${formatKst(reset)}. Wait for the reset or ask the admin to raise the plan.`,
					{ retryAfter: secondsUntil(start, reset), retryable: false, limit: cap, remaining: 0 },
				);
			}
			const remaining = Math.max(0, cap - used - reserved);
			throw new GatewayError(
				429,
				"request_limit_exceeded",
				"rate_limit_error",
				`This request needs up to ${need} tokens (max_tokens ${v.maxTokens} plus the prompt), but only ${remaining} of ${cap} remain this month. Lower max_tokens.`,
				{ param: "max_tokens", retryAfter: reserved > 0 ? 1 : 0, retryable: reserved > 0 ? true : false, limit: cap, remaining },
			);
		}
		if (!limiter.acquire(key.id)) {
			await releaseReservation(db, reservationId);
			throw new GatewayError(429, "rate_limited", "rate_limit_error", "Too many concurrent requests for this token. Retry in 1 second.", { retryAfter: 1 });
		}

		let released = false;
		const releaseAll = async () => {
			if (released) return;
			released = true;
			limiter.release(key.id);
			await releaseReservation(db, reservationId).catch(() => {});
		};
		const ctx: FlowCtx = { requestId, key, user, v, start, reservationId };
		try {
			return await forward(c, ctx, releaseAll);
		} catch (e) {
			await releaseAll();
			throw e;
		}
	});

	interface FlowCtx {
		requestId: string;
		key: KeyRow;
		user: UserRow;
		v: Validated;
		start: Date;
		reservationId: string;
	}

	async function callUpstream(v: Validated): Promise<{ res: Response; ac: AbortController }> {
		if (!deps.upstreamApiKey) {
			log.warn("upstream_key_missing", {});
			throw E.unavailable(503);
		}
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), config.gateway.upstreamTimeoutMs);
		let res: Response;
		try {
			res = await fetch(`${baseUrl}/chat/completions`, {
				method: "POST",
				headers: { authorization: `Bearer ${deps.upstreamApiKey}`, "content-type": "application/json", accept: v.stream ? "text/event-stream" : "application/json" },
				body: JSON.stringify(v.upstreamBody),
				signal: ac.signal,
			});
		} catch {
			throw E.unavailable(503);
		} finally {
			clearTimeout(timer);
		}
		if (res.status !== 200) {
			const ra = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
			await res.body?.cancel().catch(() => {});
			// Upstream error text is never forwarded. 401/402 are OUR account problems, not the user's.
			if (res.status === 429) {
				const s = Number.isFinite(ra) && ra > 0 ? ra : 1;
				throw new GatewayError(429, "rate_limited", "rate_limit_error", `The model service is busy. Retry in ${s} seconds.`, { retryAfter: s });
			}
			if (res.status === 400 || res.status === 422) throw E.invalid("The request was rejected. Check the request parameters.");
			log.warn("upstream_status", { status: res.status });
			throw E.unavailable(502, Number.isFinite(ra) && ra > 0 ? ra : undefined);
		}
		return { res, ac };
	}

	async function persist(ctx: FlowCtx, usage: Normalized, finish: string | null, estimated: boolean, endReason: string, upstreamUsage: unknown) {
		const ev = buildEvent({
			config,
			eventId: newId("evt"),
			requestId: ctx.requestId,
			userId: ctx.user.id,
			keyId: ctx.key.id,
			start: ctx.start,
			end: now(),
			modelPublic: ctx.v.model,
			modelUpstream: ctx.v.cfg.upstream,
			stream: ctx.v.stream,
			usage,
			finishReason: finish,
			estimated,
			endReason,
			upstreamUsage,
		});
		await recordUsage(db, ev, ctx.reservationId, polarPayload(ev));
		log.info("usage_recorded", { request_id: ctx.requestId, event_id: ev.id, model: ev.model_public, total_tokens: ev.total_tokens, estimated, end_reason: endReason, stream: ev.stream });
	}

	/** Scrubbed copy of an upstream chunk/body: public model ID, own id, no upstream fingerprint. */
	function scrubObject(o: any, ctx: FlowCtx): any {
		if (typeof o !== "object" || o === null) return o;
		const out = { ...o, id: `chatcmpl-${ctx.requestId.slice(4)}`, model: ctx.v.model };
		delete out.system_fingerprint;
		return out;
	}

	function countChars(o: any, chars: { content: number; reasoning: number; tool: number }) {
		for (const ch of o?.choices ?? []) {
			const d = ch?.delta ?? ch?.message;
			if (!d) continue;
			if (typeof d.content === "string") chars.content += d.content.length;
			if (typeof d.reasoning_content === "string") chars.reasoning += d.reasoning_content.length;
			for (const tc of d.tool_calls ?? []) if (typeof tc?.function?.arguments === "string") chars.tool += tc.function.arguments.length;
		}
	}

	function finishOf(o: any): string | null {
		for (const ch of o?.choices ?? []) if (ch?.finish_reason) return String(ch.finish_reason);
		return null;
	}

	async function forward(c: Ctx, ctx: FlowCtx, releaseAll: () => Promise<void>): Promise<Response> {
		const { res, ac } = await callUpstream(ctx.v);
		const chars = { content: 0, reasoning: 0, tool: 0 };

		if (!ctx.v.stream) {
			let json: any;
			try {
				json = JSON.parse(await res.text());
			} catch {
				throw E.unavailable(502);
			}
			countChars(json, chars);
			const has = json?.usage && typeof json.usage === "object";
			const usage = has ? normalizeUsage(json.usage) : estimateFromOutput(chars, config.gateway.estimateCharsPerToken);
			await persist(ctx, usage, finishOf(json), !has, has ? "complete" : "upstream_ended_without_usage", has ? json.usage : null);
			await releaseAll();
			return c.json(scrubObject(json, ctx));
		}

		// Streaming: pull-based tap. Rewrites `model`, captures usage, forwards everything else.
		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		let buf = "";
		let usageRaw: any = null;
		let finish: string | null = null;
		let finalized = false;
		const finalize = async (reason: string) => {
			if (finalized) return;
			finalized = true;
			try {
				if (usageRaw) await persist(ctx, normalizeUsage(usageRaw), finish, false, reason, usageRaw);
				else await persist(ctx, estimateFromOutput(chars, config.gateway.estimateCharsPerToken), finish, true, reason === "complete" ? "upstream_ended_without_usage" : reason, null);
			} catch (e) {
				log.warn("usage_persist_failed", { request_id: ctx.requestId, msg: e instanceof Error ? e.name : "unknown" });
			} finally {
				await releaseAll();
			}
		};
		const processLine = (line: string): string | null => {
			const l = line.endsWith("\r") ? line.slice(0, -1) : line;
			if (l === "") return "";
			if (l.startsWith(":")) return ": keep-alive";
			if (!l.startsWith("data:")) return null;
			const payload = l.slice(5).trimStart();
			if (payload === "[DONE]") return "data: [DONE]";
			let o: any;
			try {
				o = JSON.parse(payload);
			} catch {
				return null;
			}
			if (o?.usage && typeof o.usage === "object") usageRaw = o.usage;
			const f = finishOf(o);
			if (f) finish = f;
			countChars(o, chars);
			return `data: ${JSON.stringify(scrubObject(o, ctx))}`;
		};

		const body = new ReadableStream<Uint8Array>({
			async pull(controller) {
				try {
					const { done, value } = await reader.read();
					if (done) {
						let out = "";
						if (buf) {
							const r = processLine(buf);
							buf = "";
							if (r !== null) out += `${r}\n`;
						}
						if (out) controller.enqueue(enc.encode(out));
						await finalize("complete");
						controller.close();
						return;
					}
					buf += decoder.decode(value, { stream: true });
					let out = "";
					let i: number;
					while ((i = buf.indexOf("\n")) >= 0) {
						const r = processLine(buf.slice(0, i));
						buf = buf.slice(i + 1);
						if (r !== null) out += `${r}\n`;
					}
					if (out) controller.enqueue(enc.encode(out));
				} catch {
					await finalize("upstream_error");
					controller.error(new Error("upstream stream failed"));
				}
			},
			async cancel() {
				ac.abort();
				await reader.cancel().catch(() => {});
				await finalize("client_abort");
			},
		});
		return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
	}

	return app;
}
