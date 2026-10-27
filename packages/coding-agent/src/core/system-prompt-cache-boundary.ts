import { isDefaultOnEnvFlag } from "./env-flag.ts";
/**
 * Spec 052: whether a system prompt changed by `before_agent_start` handlers
 * keeps the planned cache boundary. Text appended after the whole planned
 * prompt (finish-check's discipline, prompt presets) leaves the stable prefix
 * byte-identical, so the boundary still holds. Anything else (a replacement,
 * an edit, a prepend) may move bytes inside the prefix and drops it.
 *
 * Spec 102 (`OMK_PREFIX_BOUNDARY`, default off): with the flag on, the boundary
 * is also kept when only the dynamic tail after it differs, as long as the
 * prefix is byte-identical (UTF-16 code units) and the boundary does not split
 * a surrogate pair in either string. Flag off is exactly the spec 052 rule.
 */

export interface SystemPromptCachePlan {
	readonly prompt: string;
	readonly cacheBoundary: number | undefined;
}

export interface SystemPromptCacheState {
	readonly cacheBoundary: number | undefined;
	readonly bypass: boolean;
	/**
	 * Spec 102 cause, set only when the prefix before the boundary is identical
	 * but the spec 052 rule alone would drop the boundary: `suffix_changed`
	 * (flag on, kept), `bypass_surrogate` (flag on, boundary splits a surrogate
	 * pair), `flag_off` (flag off, the prefix rule would have kept it).
	 */
	readonly cause?: PrefixBoundaryCause;
	/** Flag off only: the cause the flag-on rule would have produced (spec 102 §5 off arm). */
	readonly shadowCause?: "suffix_changed" | "bypass_surrogate";
}

export type PrefixBoundaryCause = "suffix_changed" | "bypass_surrogate" | "flag_off";

export interface SystemPromptCacheOptions {
	/** Spec 102 prefix rule. Defaults to `OMK_PREFIX_BOUNDARY` from the environment. */
	readonly prefixBoundary?: boolean;
}

/** Default on; `0`/`false`/`off` opt out. */
export function isPrefixBoundaryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return isDefaultOnEnvFlag(env.OMK_PREFIX_BOUNDARY);
}

/** True when `boundary` falls between a high and a low surrogate of `text`. */
export function splitsSurrogatePair(text: string, boundary: number): boolean {
	if (boundary <= 0 || boundary >= text.length) return false;
	const before = text.charCodeAt(boundary - 1);
	const at = text.charCodeAt(boundary);
	return before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff;
}

export function resolveExtendedSystemPromptCache(
	plan: SystemPromptCachePlan,
	systemPrompt: string,
	options: SystemPromptCacheOptions = {},
): SystemPromptCacheState {
	if (systemPrompt === plan.prompt) return { cacheBoundary: plan.cacheBoundary, bypass: false };
	const boundary = plan.cacheBoundary;
	const validBoundary =
		boundary !== undefined && Number.isSafeInteger(boundary) && boundary > 0 && boundary <= plan.prompt.length;
	if (plan.prompt.length > 0 && validBoundary && systemPrompt.startsWith(plan.prompt)) {
		return { cacheBoundary: boundary, bypass: false };
	}
	const prefixIdentical =
		plan.prompt.length > 0 &&
		validBoundary &&
		systemPrompt.length >= boundary &&
		systemPrompt.slice(0, boundary) === plan.prompt.slice(0, boundary);
	if (!prefixIdentical) return { cacheBoundary: undefined, bypass: true };
	const split = splitsSurrogatePair(plan.prompt, boundary) || splitsSurrogatePair(systemPrompt, boundary);
	if (!(options.prefixBoundary ?? isPrefixBoundaryEnabled())) {
		const shadowCause = split ? "bypass_surrogate" : "suffix_changed";
		return { cacheBoundary: undefined, bypass: true, cause: "flag_off", shadowCause };
	}
	if (split) return { cacheBoundary: undefined, bypass: true, cause: "bypass_surrogate" };
	return { cacheBoundary: boundary, bypass: false, cause: "suffix_changed" };
}

/**
 * Hand the cause from the session (which knows the turn plan) to the request
 * trace (which only sees the outgoing context). The agent loop builds a new
 * Context per request, so the object cannot be the key: the cause is pending
 * for the exact prompt and read once, so a later request with the same prompt
 * (a retry, the next turn) falls back to the fingerprint reason.
 */
export interface PendingPrefixBoundaryCause {
	readonly cause: PrefixBoundaryCause;
	readonly shadowCause?: "suffix_changed" | "bypass_surrogate";
}

/** Session-scoped handoff: each AgentSession owns one and passes it to its stream wrapper. */
export class PrefixBoundaryCauseHolder {
	private pending: { readonly systemPrompt: string; readonly value: PendingPrefixBoundaryCause } | undefined;

	record(systemPrompt: string, value: PendingPrefixBoundaryCause | undefined): void {
		this.pending = value === undefined ? undefined : { systemPrompt, value };
	}

	/** Resolve the session's extension override and record its cause for the request trace. */
	resolve(plan: SystemPromptCachePlan, systemPrompt: string): SystemPromptCacheState {
		return resolveAndRecordSystemPromptCache(plan, systemPrompt, this);
	}

	take(systemPrompt: string | undefined): PendingPrefixBoundaryCause | undefined {
		const pending = this.pending;
		if (pending === undefined || systemPrompt !== pending.systemPrompt) return undefined;
		this.pending = undefined;
		return pending.value;
	}
}

/** Resolve for the session's extension override and record the cause for the request trace. */
export function resolveAndRecordSystemPromptCache(
	plan: SystemPromptCachePlan,
	systemPrompt: string,
	causes: PrefixBoundaryCauseHolder,
): SystemPromptCacheState {
	const cache = resolveExtendedSystemPromptCache(plan, systemPrompt);
	causes.record(
		systemPrompt,
		cache.cause === undefined ? undefined : { cause: cache.cause, shadowCause: cache.shadowCause },
	);
	return cache;
}
