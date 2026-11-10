import { EFFORT_ORDER, type Effort, type GatewayConfig, type ModelCfg } from "./config.js";
import { E, GatewayError } from "./errors.js";
import type { UserRow } from "./store.js";

const IMAGE_PART_TYPES = new Set(["image_url", "image", "input_image", "file", "input_file", "input_audio"]);
// Per upstream docs: minimal -> low, medium/xhigh -> high.
const EFFORT_ALIAS: Record<string, Effort> = { minimal: "low", low: "low", medium: "high", high: "high", xhigh: "high", max: "max" };

export interface Validated {
	model: string;
	cfg: ModelCfg;
	stream: boolean;
	effort: Effort | null;
	maxTokens: number;
	promptChars: number;
	upstreamBody: Record<string, unknown>;
}

// Whitelist: anything not listed is dropped (never forwarded upstream).
const PASS_THROUGH = ["messages", "temperature", "top_p", "tools", "tool_choice", "response_format", "stop", "frequency_penalty", "presence_penalty", "logprobs", "top_logprobs"];

function isObj(v: unknown): v is Record<string, any> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function checkModel(body: any, config: GatewayConfig, user: UserRow): { model: string; cfg: ModelCfg } {
	const model = isObj(body) ? body.model : undefined;
	if (typeof model !== "string" || !model) throw E.invalid("'model' is required.", "model");
	const cfg = Object.hasOwn(config.models, model) ? config.models[model] : undefined;
	if (!cfg || (user.allowed_models && !user.allowed_models.includes(model))) throw E.modelNotAllowed();
	return { model, cfg };
}

export function validateRequest(body: any, model: string, cfg: ModelCfg, config: GatewayConfig, user: UserRow, userOpaqueId: string): Validated {
	if (!isObj(body)) throw E.invalid("Request body must be a JSON object.");
	const messages = body.messages;
	if (!Array.isArray(messages) || messages.length === 0) throw E.invalid("'messages' must be a non-empty array.", "messages");

	let promptChars = 0;
	for (const m of messages) {
		if (!isObj(m) || typeof m.role !== "string") throw E.invalid("Each message needs a string 'role'.", "messages");
		if (m.prefix === true && (cfg.thinking === "enabled" || !config.gateway.features.fim)) {
			throw E.invalid("Prefix/FIM completion is not available with this model.", "messages", "unsupported_feature");
		}
		const c = m.content;
		if (typeof c === "string") promptChars += c.length;
		else if (Array.isArray(c)) {
			for (const part of c) {
				const t = isObj(part) ? part.type : undefined;
				if (typeof t === "string" && IMAGE_PART_TYPES.has(t)) {
					throw E.invalid("Image and file input is not supported. Send text only.", "messages", "image_input_unsupported");
				}
				if (t !== "text" || typeof part.text !== "string") throw E.invalid("Unsupported content part. Only text parts are accepted.", "messages");
				promptChars += part.text.length;
			}
		} else if (c !== null && c !== undefined) throw E.invalid("Message 'content' must be a string, an array of text parts, or null.", "messages");
		if (typeof m.reasoning_content === "string") promptChars += m.reasoning_content.length;
	}

	if (body.stream !== undefined && typeof body.stream !== "boolean") throw E.invalid("'stream' must be a boolean.", "stream");

	// thinking
	let clientThinking: "enabled" | "disabled" | null = null;
	if (body.thinking !== undefined) {
		const t = isObj(body.thinking) ? body.thinking.type : undefined;
		if (t !== "enabled" && t !== "disabled") throw E.invalid("'thinking.type' must be 'enabled' or 'disabled'.", "thinking");
		clientThinking = t;
	}
	if (cfg.thinking === "enabled" && clientThinking === "disabled") {
		throw E.invalid("OMK/reasoner always uses thinking. Use OMK/coder for non-thinking requests.", "thinking", "thinking_required");
	}

	// effort (reasoner only; coder drops it)
	let effort: Effort | null = null;
	if (cfg.thinking === "enabled") {
		if (body.reasoning_effort !== undefined) {
			const e = typeof body.reasoning_effort === "string" ? EFFORT_ALIAS[body.reasoning_effort] : undefined;
			if (!e) throw E.invalid("'reasoning_effort' must be one of low, high, max.", "reasoning_effort");
			effort = e;
		} else effort = cfg.default_effort as Effort;
	}

	// max_tokens
	const raw = body.max_tokens ?? body.max_completion_tokens;
	if (raw !== undefined && (!Number.isInteger(raw) || raw < 1)) throw E.invalid("'max_tokens' must be a positive integer.", "max_tokens");
	const maxTokens: number = raw ?? (config.limits.defaultMaxTokens[model] as number);

	const upstreamBody: Record<string, unknown> = { model: cfg.upstream };
	for (const k of PASS_THROUGH) if (body[k] !== undefined) upstreamBody[k] = body[k];
	upstreamBody.max_tokens = maxTokens;
	upstreamBody.thinking = { type: cfg.thinking };
	if (effort) upstreamBody.reasoning_effort = effort;
	const stream = body.stream === true;
	upstreamBody.stream = stream;
	if (stream) upstreamBody.stream_options = { include_usage: true };
	upstreamBody.user_id = userOpaqueId;
	return { model, cfg, stream, effort, maxTokens, promptChars, upstreamBody };
}

/** Per-request caps. Returns a 429 error or null. Values come from config, never from code. */
export function checkCaps(v: Validated, config: GatewayConfig, user: UserRow): GatewayError | null {
	const ceiling = config.limits.maxTokensCeiling[v.model] ?? null;
	if (ceiling !== null && v.maxTokens > ceiling) {
		return new GatewayError(
			429,
			"request_limit_exceeded",
			"rate_limit_error",
			`max_tokens ${v.maxTokens} is above the per-request limit of ${ceiling} for ${v.model}. Lower max_tokens to ${ceiling} or less.`,
			{ param: "max_tokens", retryAfter: 0, retryable: false, limit: ceiling },
		);
	}
	if (v.effort && v.cfg.max_effort) {
		// PM 2026-11-11: low/high only for everyone; no per-user max allow-list.
		const allowed: Effort = v.cfg.max_effort;
		if (EFFORT_ORDER.indexOf(v.effort) > EFFORT_ORDER.indexOf(allowed)) {
			return new GatewayError(
				429,
				"request_limit_exceeded",
				"rate_limit_error",
				`reasoning_effort '${v.effort}' is above the allowed level '${allowed}' for ${v.model}. Use reasoning_effort '${allowed}' or lower.`,
				{ param: "reasoning_effort", retryAfter: 0, retryable: false },
			);
		}
	}
	return null;
}
