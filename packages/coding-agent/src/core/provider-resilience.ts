/**
 * Provider resilience — root-level recovery for sticky safety models and
 * sanitize-and-retry protocol failures (orphan tool_call_id, terminated streams).
 *
 * This is not a jailbreak layer. It keeps sessions alive when a provider
 * false-positives or returns a sticky transcript-shape error.
 */

import { hasStatusCodeLike } from "omk-ai";

export type FailoverCandidate = Readonly<{
	readonly provider: string;
	readonly id: string;
}>;

/** Models known to emit high false-positive content/safety stops on coding work. */
export const STICKY_SAFETY_MODEL_RE = /fable/i;

/** Claude lines that must stay on-model when they refuse. No DeepSeek hop. */
export const NO_SAFETY_FAILOVER_MODEL_RE = /(?:claude-)?(?:fable|opus|sonnet)/i;

/** Default failover chain when a sticky safety model refuses a turn. */
export const DEFAULT_SAFETY_FAILOVER_CANDIDATES: readonly FailoverCandidate[] = [
	{ provider: "kimi-coding", id: "k3" },
	{ provider: "modelstudio-maas", id: "qwen3.8-max" },
	{ provider: "xai", id: "grok-4.5" },
	{ provider: "deepseek", id: "deepseek-v4-pro" },
	{ provider: "deepseek", id: "deepseek-v4-flash" },
	{ provider: "modelstudio-maas", id: "deepseek-v4-pro" },
	{ provider: "kimi-coding", id: "kimi-for-coding" },
] as const;

export type ProviderResilienceSettings = Readonly<{
	/** When true (default), refuse selecting sticky safety models (e.g. claude-fable-5). */
	readonly blockStickySafetyModels?: boolean;
	/** When true (default), auto-switch model on content/safety stop before retry. */
	readonly autoFailoverOnSafetyStop?: boolean;
	/**
	 * When true (default), a recognized quota/billing refusal may switch to an
	 * authenticated failover candidate even when the model was CLI-pinned. A
	 * pinned model whose quota is exhausted cannot finish the turn, so the
	 * alternative is ending it. Safety-stop failover remains pin-gated.
	 */
	readonly autoFailoverOnQuotaExhaustion?: boolean;
	/** Ordered failover targets. Falls back to DEFAULT_SAFETY_FAILOVER_CANDIDATES. */
	readonly failoverCandidates?: readonly FailoverCandidate[];
}>;

export const DEFAULT_PROVIDER_RESILIENCE: Required<
	Pick<
		ProviderResilienceSettings,
		"blockStickySafetyModels" | "autoFailoverOnSafetyStop" | "autoFailoverOnQuotaExhaustion"
	>
> & {
	readonly failoverCandidates: readonly FailoverCandidate[];
} = {
	blockStickySafetyModels: true,
	autoFailoverOnSafetyStop: true,
	autoFailoverOnQuotaExhaustion: true,
	failoverCandidates: DEFAULT_SAFETY_FAILOVER_CANDIDATES,
};

export function isStickySafetyModel(modelId: string | undefined, provider?: string | undefined): boolean {
	const id = (modelId ?? "").trim();
	if (!id) return false;
	if (STICKY_SAFETY_MODEL_RE.test(id)) return true;
	const p = (provider ?? "").toLowerCase();
	return p.includes("anthropic") && STICKY_SAFETY_MODEL_RE.test(id);
}

/** Fable / Opus / Sonnet stay on the requested id after a safety stop. */
export function isNoSafetyFailoverModel(modelId: string | undefined, provider?: string | undefined): boolean {
	const id = (modelId ?? "").trim();
	if (!id) return false;
	if (NO_SAFETY_FAILOVER_MODEL_RE.test(id)) return true;
	const p = (provider ?? "").toLowerCase();
	return p.includes("anthropic") && NO_SAFETY_FAILOVER_MODEL_RE.test(id);
}

export function isContentSafetyStopMessage(text: string | undefined): boolean {
	if (!text) return false;
	return /content\/safety stop|stop_reason\s*=\s*(refusal|sensitive)|safety stop|provider\.refusal|kind=provider_refusal/i.test(
		text,
	);
}

/**
 * Billing/quota exhaustion ("usage limit for this billing cycle",
 * "insufficient_quota", zero balance, ...). Same-model retry is useless until
 * the cycle resets, but the turn can still be saved by failing over to another
 * candidate — so these classify as retryable-with-failover, not auth-fatal.
 */
export function isQuotaExhaustionMessage(text: string | undefined): boolean {
	if (!text) return false;
	// Explabs/OpenRouter-style quota bodies carry a stable `code` prefix the
	// message text is expected to start with (`free_limit_reached`, ...), but the
	// harness only sees `error.message`. Match the prefix words too so a free
	// daily allowance or a credit-balance refusal fails over instead of ending
	// the turn. Observed 2026-10-18: explabs/deepseek-v4.1-flash-1017
	// "429 You've hit the free limit ... free daily allowance".
	return /usage limit|GoUsageLimitError|FreeUsageLimitError|free[ _-]?limit(?:[ _-]?reached)?|free_tier_requires_payment|model_requires_(?:payment|purchase)|promo_byok_only|available balance|insufficient[ _]quota|insufficient[ _]balance|insufficient[ _]credits|no available platform credits|out of budget|quota exceeded|quota\s+(?:has been\s+|was\s+|is\s+)?exhaust|billing/i.test(
		text,
	);
}

/**
 * Terminal per-candidate failures inside a failover chain: the candidate
 * provider can never serve this request — quota/billing exhaustion, auth or
 * entitlement denial (401/403, permission_error, authentication_error), or a
 * permanent 4xx (unsupported model, invalid request). Absorbing them lets the
 * chain reach the next candidate; a transient 5xx still aborts so the same
 * model can retry instead of silently hopping providers mid-recovery.
 */
export function isTerminalProviderErrorMessage(text: string | undefined): boolean {
	if (!text) return false;
	if (isQuotaExhaustionMessage(text)) return true;
	return /permission_error|authentication_error|unsupported_model|model_not_supported|invalid_api_key|unauthori[sz]ed|forbidden|does not have access|\b4(?:01|03|02|04|22)\b/i.test(
		text,
	);
}

/**
 * Anthropic rejecting the spoofed Claude Code client version because the target
 * model is gated on a newer one (`claude_code_version_too_old`, HTTP 400).
 * Permanent for this build: every retry and every failover re-sends the same
 * user-agent, so the fix is bumping `CLAUDE_CODE_VERSION` in omk-ai (or
 * selecting an ungated model).
 */
export function isClaudeCodeVersionTooOldMessage(text: string | undefined): boolean {
	if (!text) return false;
	return /claude_code_version_too_old|does not support this model;\s*version\s+[\d.]+\s+or newer is required/i.test(
		text,
	);
}

/**
 * Codex HTTP 400 when a ChatGPT-account OAuth session asks for a model the
 * account catalog does not serve (`gpt-6-astra` during the 2026-09-04 rollout).
 * Permanent for this login: same-model retry, transcript sanitize, and /new
 * session all re-send the same slug and get the same 400. Switch model or use
 * an API-key route that has the model.
 */
export function isCodexChatgptAccountUnsupportedModelMessage(text: string | undefined): boolean {
	if (!text) return false;
	return /model is not supported when using Codex with a ChatGPT account/i.test(text);
}

/** Orphan tool results / Kimi-K3 protocol shape errors that heal after sanitize+retry. */
export function isOrphanToolCallIdError(text: string | undefined): boolean {
	if (!text) return false;
	return /tool_call_id\s+is\s+not\s+found|tool_call_id\s+not\s+found|unknown\s+tool_call_id/i.test(text);
}

/**
 * A provider rejection of the request itself (`invalid_request_error`) that no
 * sanitize or same-payload retry can heal. Orphan tool ids are the one known
 * exception: they share the type but heal after transcript sanitize.
 */
export function isPermanentInvalidRequestMessage(text: string | undefined): boolean {
	if (!text || isOrphanToolCallIdError(text)) return false;
	return /invalid_request_error/i.test(text);
}

/**
 * Transient upstream availability failures: gateway 5xx passthroughs
 * ("503 Upstream request failed", "Endpoint is unavailable") and dropped
 * streams that never carried a finish reason ("Stream ended without
 * finish_reason"). Transport problems, not transcript-shape problems — they
 * heal by backoff/retry or switching model, never by transcript sanitization.
 */
export function isUpstreamUnavailableMessage(text: string | undefined): boolean {
	if (!text) return false;
	return (
		/upstream(?: request)? failed|upstream connect|endpoint (?:is )?unavailable|stream ended without finish_reason|gateway request failed|provider stream failed|all routes failed|bad gateway|service unavailable/i.test(
			text,
		) ||
		// Cloudflare origin errors (520-527) are retryable upstream failures. The
		// observed Explabs/1017 shape is "520 status code (no body)"; 520 alone
		// fell outside the old 500/502/503/504 list and ended the turn.
		hasStatusCodeLike(text, [500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527])
	);
}

/**
 * Route families: the same underlying model served by several provider
 * routes. Matched on the model id OR display name so alias routes like
 * `openrouter/stealth/ox-alpha`, `opencode-go/ox-alpha-free`, and
 * `opencode/x-preview-f-free` ("Ox Alpha Free (Unlimited)") rotate as one
 * ox-alpha family.
 */
const MODEL_ROUTE_FAMILIES: readonly { readonly pattern: RegExp; readonly family: string }[] = [
	{ pattern: /(?:^|[-_/])ox[-_ ]?alpha(?:[-_/\s(]|$)/i, family: "ox-alpha" },
	// union-alpha is served by opencode-go/union-alpha (anthropic-messages) and
	// openrouter/stealth/union-alpha (openai-completions); both map to one family
	// so an upstream-unavailable 503/empty stream rotates to the live route.
	{ pattern: /(?:^|[-_/])union[-_ ]?alpha(?:[-_/\s(]|$)/i, family: "union-alpha" },
];

/** Family key for a model route, or undefined when it has no known alias group. */
export function modelRouteFamily(model: {
	readonly provider?: string | undefined;
	readonly id: string;
	readonly name?: string | undefined;
}): string | undefined {
	for (const { pattern, family } of MODEL_ROUTE_FAMILIES) {
		if (pattern.test(model.id)) return family;
		if (model.name && pattern.test(model.name)) return family;
	}
	return undefined;
}

/**
 * Alternative provider routes serving the same model family as
 * {@link failed}, in registry order, excluding the failed route itself.
 * Callers filter by authentication and per-turn failure bookkeeping.
 */
export function sameModelRouteCandidates<
	T extends { readonly provider: string; readonly id: string; readonly name?: string | undefined },
>(
	failed: { readonly provider: string; readonly id: string; readonly name?: string | undefined },
	available: readonly T[],
): T[] {
	const family = modelRouteFamily(failed);
	if (!family) return [];
	const candidates: T[] = [];
	for (const model of available) {
		if (model.provider === failed.provider && model.id === failed.id) continue;
		if (modelRouteFamily(model) === family) candidates.push(model);
	}
	return candidates;
}

/**
 * Errors the agent loop may auto-retry (after optional failover / message sanitize).
 * Kept in one place so agent-session and tests share the same contract.
 */
export function isTransientProviderErrorMessage(text: string | undefined): boolean {
	if (!text) return false;
	// Checked first: the payload carries `invalid_request_error`, which the
	// pattern below treats as transient, but a stale client version never heals
	// by retrying.
	if (isClaudeCodeVersionTooOldMessage(text)) return false;
	if (isCodexChatgptAccountUnsupportedModelMessage(text)) return false;
	// A bare invalid_request_error used to match the pattern below and re-send
	// the same rejected payload. Only the orphan tool_call_id shape heals.
	if (isPermanentInvalidRequestMessage(text)) return false;
	// `at capacity|high demand`: xAI serves overload as HTTP 429 whose body carries
	// no status or limit token, so the message-level classifier misses it and the
	// turn never auto-retries (observed 2026-09-03, xai/grok-4.6).
	if (
		/overloaded|at capacity|high demand|provider.?returned.?error|rate.?limit|too many requests|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|gateway request failed|gateway overloaded|gateway draining|provider stream failed|all routes failed|org_rate_limit|org_token_rate_limit|reset before headers|socket hang up|ended without|stream ended before message_stop|stream ended before terminal|http2 request did not get a response|timed? out|timeout|\bterminated\b|retry delay|content\/safety stop|stop_reason\s*=\s*(refusal|sensitive)|safety stop|tool_call_id\s+is\s+not\s+found|tool_call_id\s+not\s+found|invalid_request_error|json error injected into sse stream|injected into sse/i.test(
			text,
		)
	) {
		return true;
	}
	// Status-looking numbers only count with adjacent transport context — a
	// bare `500` in a message body ("saved 500 records") is not a status code.
	// 520-527 are Cloudflare origin errors and are transient like 502/503/504.
	return hasStatusCodeLike(text, [429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527]);
}

export function resolveFailoverCandidates(
	settings: ProviderResilienceSettings | undefined,
): readonly FailoverCandidate[] {
	const custom = settings?.failoverCandidates;
	if (custom && custom.length > 0) return custom;
	return DEFAULT_SAFETY_FAILOVER_CANDIDATES;
}

/** Explicit `--model` / `--provider` pins stay on the requested model. */
export function shouldHonorSafetyFailover(options: {
	readonly autoFailoverOnSafetyStop: boolean;
	readonly modelPinned: boolean;
	readonly modelId?: string;
	readonly provider?: string;
}): boolean {
	if (!options.autoFailoverOnSafetyStop || options.modelPinned) return false;
	return !isNoSafetyFailoverModel(options.modelId, options.provider);
}

/** Sticky-model eject still applies unless the user pinned that model. */
/**
 * Quota exhaustion is different from a safety-stop false positive: the pinned
 * model cannot serve any later request until the billing window resets, so the
 * pin cannot be honored by retrying the same route. Authenticated failover
 * candidates still have to exist; otherwise the turn ends with the quota cause.
 */
export function shouldHonorQuotaFailover(options: { readonly autoFailoverOnQuotaExhaustion: boolean }): boolean {
	return options.autoFailoverOnQuotaExhaustion;
}

/** One gate for both failover triggers; quota ignores the CLI pin by default. */
export function shouldHonorProviderFailover(
	quotaExhausted: boolean,
	resilience: ReturnType<typeof resolveProviderResilience>,
	modelPinned: boolean,
	model: { readonly id?: string; readonly provider?: string } | undefined,
): boolean {
	if (quotaExhausted) {
		return shouldHonorQuotaFailover({
			autoFailoverOnQuotaExhaustion: resilience.autoFailoverOnQuotaExhaustion,
		});
	}
	return shouldHonorSafetyFailover({
		autoFailoverOnSafetyStop: resilience.autoFailoverOnSafetyStop,
		modelPinned,
		modelId: model?.id,
		provider: model?.provider,
	});
}

export function shouldEjectStickySafetyModel(options: {
	readonly blockStickySafetyModels: boolean;
	readonly modelPinned: boolean;
}): boolean {
	return options.blockStickySafetyModels && !options.modelPinned;
}

export function resolveProviderResilience(settings: ProviderResilienceSettings | undefined): {
	readonly blockStickySafetyModels: boolean;
	readonly autoFailoverOnSafetyStop: boolean;
	readonly autoFailoverOnQuotaExhaustion: boolean;
	readonly failoverCandidates: readonly FailoverCandidate[];
} {
	return {
		blockStickySafetyModels: settings?.blockStickySafetyModels ?? DEFAULT_PROVIDER_RESILIENCE.blockStickySafetyModels,
		autoFailoverOnSafetyStop:
			settings?.autoFailoverOnSafetyStop ?? DEFAULT_PROVIDER_RESILIENCE.autoFailoverOnSafetyStop,
		autoFailoverOnQuotaExhaustion:
			settings?.autoFailoverOnQuotaExhaustion ?? DEFAULT_PROVIDER_RESILIENCE.autoFailoverOnQuotaExhaustion,
		failoverCandidates: resolveFailoverCandidates(settings),
	};
}

/**
 * Pick first failover candidate that is not the current model and passes `isAllowed`.
 * Pure — caller performs auth checks and setModel.
 */
export function pickFailoverCandidate(
	candidates: readonly FailoverCandidate[],
	current: { readonly provider?: string; readonly id?: string } | undefined,
	isAllowed: (candidate: FailoverCandidate) => boolean,
): FailoverCandidate | undefined {
	for (const c of candidates) {
		if (current && c.provider === current.provider && c.id === current.id) continue;
		if (isStickySafetyModel(c.id, c.provider)) continue;
		if (!isAllowed(c)) continue;
		return c;
	}
	return undefined;
}

export function stickySafetyBlockMessage(modelId: string, provider: string): string {
	return (
		`Blocked sticky safety model ${provider}/${modelId} (providerResilience.blockStickySafetyModels). ` +
		`Use kimi-coding/k3, modelstudio-maas/qwen3.8-max, grok-4.5, or deepseek; ` +
		`or set providerResilience.blockStickySafetyModels=false.`
	);
}
