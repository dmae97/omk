import { describe, it } from "vitest";

/**
 * Flag-on cases that are NOT covered by PR (a) and stay `it.todo` for PR (b) / the gateway client work.
 * The registry, harness, resolver, effort and payload cases from PR (c)'s placeholders are now real tests:
 * - omk-provider-register.test.ts, omk-provider-harness-flag-on.test.ts, omk-provider-resolver-flag-on.test.ts
 * - omk-provider-effort.test.ts
 */
describe("OMK gateway errors (PR b)", () => {
	it.todo("monthly-quota 429 (x-omk-retryable: false or code quota_exceeded) is not retried");
	it.todo("429 rate_limited is retried and honors Retry-After");
	it.todo(
		"missing, invalid (401), expired, forbidden (403) and rate-limited (429) tokens produce five distinct messages",
	);
});
