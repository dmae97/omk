import type { AssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDocsPath } from "../src/config.ts";
import { formatNoApiKeyFoundMessage } from "../src/core/auth-guidance.ts";
import { preflightFailureCause, providerFailureCause } from "../src/core/session-failure-cause.ts";
import { FLAG_ENV, FLAG_OFF_VARIANTS, goldenOrUpdate, variantLabel, withFlag } from "./omk-provider-golden-lib.ts";

/**
 * The two OMK hooks in existing files (auth-guidance.ts `formatNoApiKeyFoundMessage`, session-failure-cause.ts
 * `providerFailureCause` / `preflightFailureCause`) must leave their output byte-identical with the flag off. The golden
 * was generated at the base commit (before the hooks existed), see omk-provider-golden-lib.ts for the update command.
 */
const TEXTS = [
	"OMK account token missing. Set OMK_ACCOUNT_TOKEN or run /login and choose OMK.",
	"OMK gateway base URL missing. Set OMK_GATEWAY_BASE_URL (for example https://host/v1); OMK requests are refused until it is set.",
	"OMK token rejected (401 token_invalid): the gateway does not accept this token.",
	"OMK token expired (401 token_expired): ask the admin for a new token.",
	"OMK token revoked (403 token_revoked): ask the admin for a new token.",
	"OMK model not allowed for this token (403 model_not_allowed): choose another OMK model with /model.",
	"OMK monthly quota exceeded (quota_exceeded, not retried).",
	"OMK rate limited (429 rate_limited), still throttled after retrying.",
	"401 Incorrect API key provided",
	"403 Forbidden",
	"429 Too Many Requests",
	"400 Bad request",
	"503 Service Unavailable",
	"Connection error.",
	"No API key found for OMK.\n\nUse /login to log into a provider via OAuth or API key.",
	"authentication failed",
	"rate limit exceeded",
	"Monthly usage limit reached",
	"tool_call_id is not found",
	"stop_reason=refusal",
	"tool crashed",
	"compaction failed",
	"write failed",
	"no model selected",
	"model is required",
	"",
];
const OMK_TEXT = /^OMK /;
const PROVIDERS = ["OMK", "openai", "opencode-go", "unknown"];

function observe(texts: readonly string[], providers: readonly string[]) {
	return {
		provider: Object.fromEntries(
			texts.map((t) => [
				t,
				providerFailureCause({ errorMessage: t, stopReason: "error" } as AssistantMessage, 1_000_000),
			]),
		),
		preflightWithModel: Object.fromEntries(texts.map((t) => [t, preflightFailureCause(t, true)])),
		preflightNoModel: Object.fromEntries(texts.map((t) => [t, preflightFailureCause(t, false)])),
		// The docs path depends on the checkout location, so it is replaced with a placeholder on both sides.
		noApiKey: Object.fromEntries(
			providers.map((p) => [p, formatNoApiKeyFoundMessage(p).split(getDocsPath()).join("<DOCS>")]),
		),
	};
}

afterEach(() => vi.unstubAllEnvs());

describe("OMK hooks in existing files, flag off", () => {
	const golden = goldenOrUpdate(
		"hooks-flag-off.golden.json",
		withFlag(undefined, () => observe(TEXTS, PROVIDERS)),
	);

	it.each(FLAG_OFF_VARIANTS)(
		"OMK_PROVIDER_OMK=%j: failure classification and no-API-key text are byte-identical",
		(value) => {
			expect(
				withFlag(value, () => observe(TEXTS, PROVIDERS)),
				variantLabel(value),
			).toEqual(golden);
		},
	);

	it("flag on: every text that is not an OMK text, and every other provider, is still byte-identical", () => {
		const others = TEXTS.filter((t) => !OMK_TEXT.test(t));
		const providers = PROVIDERS.filter((p) => p !== "OMK");
		const on = withFlag("1", () => observe(others, providers));
		const pick = (record: Record<string, unknown>, keys: readonly string[]) =>
			Object.fromEntries(keys.map((k) => [k, record[k]]));
		expect(on).toEqual({
			provider: pick(golden.provider, others),
			preflightWithModel: pick(golden.preflightWithModel, others),
			preflightNoModel: pick(golden.preflightNoModel, others),
			noApiKey: pick(golden.noApiKey, providers),
		});
		expect(process.env[FLAG_ENV]).toBeUndefined();
	});
});
