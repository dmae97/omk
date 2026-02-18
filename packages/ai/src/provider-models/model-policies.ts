/**
 * Post-processing policies applied to generated model catalogs.
 *
 * Each policy corrects known upstream metadata errors or normalizes model
 * properties that differ from the canonical values. Keeping these in a
 * dedicated module makes them explicit, isolated, and testable.
 */
import type { Api, Model } from "../types";

const CLOUDFLARE_AI_GATEWAY_BASE_URL = "https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic";

/**
 * Static fallback model injected when Cloudflare AI Gateway discovery
 * returns no results. Ensures the provider always has at least one usable
 * model entry in the catalog.
 */
export const CLOUDFLARE_FALLBACK_MODEL: Model<"anthropic-messages"> = {
	id: "claude-sonnet-4-5",
	name: "Claude Sonnet 4.5",
	api: "anthropic-messages",
	provider: "cloudflare-ai-gateway",
	baseUrl: CLOUDFLARE_AI_GATEWAY_BASE_URL,
	reasoning: true,
	input: ["text", "image"],
	cost: {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 3.75,
	},
	contextWindow: 200000,
	maxTokens: 64000,
};

/**
 * Apply upstream metadata corrections to a mutable array of models.
 *
 * Corrections include cache-pricing fixes and context-window clamps where
 * provider APIs or models.dev report incorrect values.
 */
export function applyGeneratedModelPolicies(models: Model<Api>[]): void {
	for (const model of models) {
		// Claude Opus 4.5: models.dev reports 3x the correct cache pricing
		if (model.provider === "anthropic" && model.id === "claude-opus-4-5") {
			model.cost.cacheRead = 0.5;
			model.cost.cacheWrite = 6.25;
		}

		// Bedrock Opus 4.6: upstream cache pricing is incorrect
		if (model.provider === "amazon-bedrock" && model.id.includes("anthropic.claude-opus-4-6-v1")) {
			model.cost.cacheRead = 0.5;
			model.cost.cacheWrite = 6.25;
		}

		// Opus 4.6 / Sonnet 4.6: 1M context is beta; clamp to 200K
		if (
			model.id.includes("opus-4-6") ||
			model.id.includes("opus-4.6") ||
			model.id.includes("sonnet-4-6") ||
			model.id.includes("sonnet-4.6")
		) {
			model.contextWindow = 200000;
		}

		// OpenCode: Claude Sonnet 4/4.5 listed with 1M context, actual limit is 200K
		if (model.provider === "opencode" && (model.id === "claude-sonnet-4-5" || model.id === "claude-sonnet-4")) {
			model.contextWindow = 200000;
		}

		// Codex models: 400K figure includes output budget; input window is 272K
		if (model.id.includes("codex") && !model.id.includes("codex-spark")) {
			model.contextWindow = 272000;
		}
	}
}

/**
 * Link `-spark` model variants to their base models for context promotion.
 *
 * When a spark model's context is exhausted, the agent can promote to the
 * corresponding full model. This sets `contextPromotionTarget` on each
 * spark variant that has a matching base model.
 */
export function linkSparkPromotionTargets(models: Model<Api>[]): void {
	for (const candidate of models) {
		if (!candidate.id.endsWith("-spark")) continue;
		const baseId = candidate.id.slice(0, -"-spark".length);
		const fallback = models.find(
			model => model.provider === candidate.provider && model.api === candidate.api && model.id === baseId,
		);
		if (!fallback) continue;
		candidate.contextPromotionTarget = `${fallback.provider}/${fallback.id}`;
	}
}
