import type { ProviderModelConfig } from "../extensions/types.ts";

/** Provider id as typed by users (`OMK/coder`). Matching is case-insensitive in the CLI, exact everywhere else. */
export const OMK_PROVIDER_ID = "OMK";

/** Upstream harness family a model is prepared for; see harness-marker.ts. */
export type OmkHarness = "deepseek";

/**
 * Client-side metadata that is never registered on the model: `harness` (see harness-marker.ts) and
 * `noReasoningRoute`, the id of the model that serves calls arriving without a reasoning level (route.ts).
 */
export type OmkModelEntry = ProviderModelConfig & {
	readonly harness?: OmkHarness;
	readonly noReasoningRoute?: string;
};

const GATEWAY_COMPAT = {
	thinkingFormat: "deepseek",
	requiresReasoningContentOnAssistantMessages: true,
	maxTokensField: "max_tokens",
	supportsReasoningEffort: true,
	// The gateway URL is not a known vendor URL, so the auto-detected store/developer-role defaults would differ.
	supportsStore: false,
	supportsDeveloperRole: false,
} as const;

const COMMON = {
	input: ["text"],
	// Pricing is not decided yet; zero keeps the footer honest ("unknown") rather than invented.
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000_000,
	maxTokens: 384_000,
	compat: GATEWAY_COMPAT,
	harness: "deepseek",
} as const satisfies Omit<OmkModelEntry, "id" | "name" | "reasoning">;

/**
 * The single source of truth for OMK model ids. Renaming a model is a one-line change here.
 *
 * - `coder`: non-thinking, so the client sends no `thinking` or `reasoning_effort`.
 * - `reasoner`: thinking is always on. `off` and `max` are unsupported (null), so the session clamps them up or
 *   down to a supported level. `medium` is accepted but sent as `low`, which makes the default level (`medium`,
 *   defaults.ts) go out as effort `low`; `high` stays selectable. Calls that carry no reasoning level (compaction,
 *   summaries, other internal calls) are sent as `coder`: the gateway rejects `thinking: disabled` for this model.
 */
export const OMK_MODEL_TABLE: readonly OmkModelEntry[] = [
	{ ...COMMON, id: "coder", name: "OMK Coder", reasoning: false },
	{
		...COMMON,
		id: "reasoner",
		name: "OMK Reasoner",
		reasoning: true,
		noReasoningRoute: "coder",
		thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "low", high: "high", xhigh: null, max: null },
	},
];
