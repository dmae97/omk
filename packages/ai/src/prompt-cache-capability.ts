/**
 * Spec 103 §2.4: explicit prompt-cache capability and lifetime table.
 *
 * Replaces "cache supported because cacheRead price > 0" for the next-task
 * suggestion skip heuristic. Values are documented *lower bounds* of how long
 * a cached prefix stays warm for the retention omk actually sends; they are a
 * skip heuristic, not a billing guarantee. Anything not verified against the
 * provider's own docs is `unknown` (fail closed). No pricing feed, no deps.
 *
 * Sources (fetched 2026-10-21 KST):
 * - https://platform.openai.com/docs/guides/prompt-caching
 * - https://docs.claude.com/en/docs/build-with-claude/prompt-caching
 */
import type { CacheRetention } from "./types.ts";

export type PromptCacheCapability =
	| { readonly kind: "supported"; readonly coldAfterMs: number; readonly source: string }
	| { readonly kind: "none" }
	| { readonly kind: "unknown" };

export interface PromptCacheModelRef {
	readonly api: string;
	readonly provider: string;
	readonly id: string;
	readonly compat?: { readonly supportsLongCacheRetention?: boolean } | object;
}

const MINUTE = 60_000;
const OPENAI_DOC = "openai:prompt-caching";
const ANTHROPIC_DOC = "anthropic:prompt-caching";

function longRetentionSupported(model: PromptCacheModelRef): boolean {
	const compat = model.compat as { supportsLongCacheRetention?: boolean } | undefined;
	return compat?.supportsLongCacheRetention ?? true;
}

/** `gpt-5.<minor>` family minor version, or undefined for any other id. */
function gpt5Minor(id: string): number | undefined {
	const match = /^gpt-5\.(\d+)(?:\D|$)/u.exec(id);
	return match ? Number(match[1]) : undefined;
}

function openAiLifetimeMs(model: PromptCacheModelRef, retention: "short" | "long"): number {
	const minor = gpt5Minor(model.id);
	// GPT-5.6+: default ttl "30m" (minimum). GPT-5.5 / 5.5 Pro: "typically around 30 minutes".
	if (minor !== undefined && minor >= 5) return 30 * MINUTE;
	// Earlier models: `24h` "typically keeps entries around 30 minutes"; in_memory "5 to 10 minutes" (lower bound).
	return retention === "long" && longRetentionSupported(model) ? 30 * MINUTE : 5 * MINUTE;
}

/**
 * Capability for `(api/provider, model family, retention sent)`. An unset
 * retention is read as `short`, the shortest documented lifetime, because the
 * provider default can depend on environment or org settings (ZDR).
 */
export function promptCacheCapability(
	model: PromptCacheModelRef,
	retention: CacheRetention | undefined,
): PromptCacheCapability {
	if (retention === "none") return { kind: "none" };
	const sent = retention === "long" ? "long" : "short";
	if (model.api === "openai-responses" && model.provider === "openai") {
		return { kind: "supported", coldAfterMs: openAiLifetimeMs(model, sent), source: OPENAI_DOC };
	}
	if (model.api === "anthropic-messages" && model.provider === "anthropic") {
		const coldAfterMs = sent === "long" && longRetentionSupported(model) ? 60 * MINUTE : 5 * MINUTE;
		return { kind: "supported", coldAfterMs, source: ANTHROPIC_DOC };
	}
	// xAI, Google, compat endpoints and everything else: not verified.
	return { kind: "unknown" };
}
