import { describe, it } from "vitest";

/**
 * Flag-on cases that PR (a) turns into real tests (OMK_PROVIDER_OMK=1 + OMK_GATEWAY_BASE_URL set). They are
 * `it.todo` so they show in the report without asserting anything. Baselines they build on:
 * - registry/resolver/harness goldens: omk-provider-*-golden.test.ts
 * - deepseek-flash payload per level: omk-provider-deepseek-flash-baseline.test.ts
 * - how a registered `OMK` provider resolves: omk-provider-parse.test.ts
 */
describe("OMK provider with OMK_PROVIDER_OMK=1 (PR a)", () => {
	describe("registry", () => {
		it.todo("adds exactly two models, OMK/coder and OMK/reasoner, and no other provider or model changes");
		it.todo("registers nothing and reports one diagnostic naming OMK_GATEWAY_BASE_URL when the URL is unset");
		it.todo("every non-OMK entry of getAll() hashes the same as the flag-off golden (per-provider sha256)");
		it.todo("both models are text-only: input is exactly [text], so no image blocks are sent");
	});

	describe("harness", () => {
		it.todo(
			"isDeepSeekHarnessModel is true for OMK/coder and OMK/reasoner via the per-model marker, not the id regex",
		);
		it.todo("isDeepSeekHarnessModel over deepseek/* (and every other catalog id) still equals harness.golden.json");
	});

	describe("resolver", () => {
		it.todo("`--model OMK/coder` and `--model OMK/reasoner` resolve to provider OMK with the table's model ids");
		it.todo("short patterns flash and deepseek resolve to the same non-OMK models as resolver.golden.json");
		it.todo(
			"short pattern `coder` (main: experientiallabs/qwen3-coder-plus) and `reasoner` (main: not found): decide expected",
		);
		it.todo("`--model deepseek/deepseek-flash` and deepseek-v4-pro are unchanged");
	});

	describe("OMK/reasoner payload parity with deepseek/deepseek-flash", () => {
		it.todo(
			"thinking, reasoning_effort and max_tokens equal the deepseek-flash payload for low, high, max, off and unset",
		);
		it.todo("default level (medium) clamps to high exactly as deepseek-flash does");
		it.todo("OMK/coder sends no thinking and no reasoning_effort (or an explicit disabled, per gateway answer)");
		it.todo("request carries Authorization: Bearer <omk token> and the model name the gateway expects");
	});

	describe("gateway errors", () => {
		it.todo("monthly-quota 429 (x-omk-retryable: false or code quota_exceeded) is not retried");
		it.todo("429 rate_limited is retried and honors Retry-After");
		it.todo(
			"missing, invalid (401), expired, forbidden (403) and rate-limited (429) tokens produce five distinct messages",
		);
	});
});
