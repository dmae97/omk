import { describe, expect, it } from "vitest";
import { classifyProviderError } from "../src/core/provider-error-classification.ts";

/**
 * G-T01..G-T03 (audit §17): structured signals decide before free text; a
 * permanent 400 is never confused with a transient 429, a stray "500" in a
 * message body is not a status, and refusals stay a separate state.
 */

describe("classifyProviderError (typed precedence)", () => {
	it("a status 429 is rate_limit and retryable", () => {
		const result = classifyProviderError({ status: 429, text: "slow down" });
		expect(result).toEqual({
			kind: "rate_limit",
			retryable: true,
			failoverEligible: true,
			basis: "status",
		});
	});

	it("a status 500 is transient_transport even when the text looks permanent", () => {
		const result = classifyProviderError({ status: 503, text: "gateway timeout" });
		expect(result.kind).toBe("transient_transport");
		expect(result.retryable).toBe(true);
		expect(result.basis).toBe("status");
	});

	it("a status 400 with a plain invalid_request_error is permanent — retry must not resend it", () => {
		// The audit's required negative case: an unbounded regex marked every
		// invalid_request_error transient; typed classification must not retry
		// one that heals by nothing.
		const result = classifyProviderError({
			status: 400,
			errorType: "invalid_request_error",
			text: '400 {"error":{"type":"invalid_request_error","message":"temperature is out of range"}}',
		});
		expect(result.kind).toBe("permanent_request");
		expect(result.retryable).toBe(false);
		expect(result.basis).toBe("status");
	});

	it("a status 400 carrying a known-healing orphan tool_call_id is transcript_shape", () => {
		const result = classifyProviderError({
			status: 400,
			errorType: "invalid_request_error",
			text: '400 {"error":{"type":"invalid_request_error","message":"tool_call_id  is not found"}}',
		});
		expect(result.kind).toBe("transcript_shape");
		expect(result.retryable).toBe(true);
	});

	it("a known permanent provider code beats the status and the text", () => {
		const result = classifyProviderError({
			status: 429,
			errorCode: "claude_code_version_too_old",
			text: "overloaded",
		});
		expect(result.kind).toBe("permanent_request");
		expect(result.retryable).toBe(false);
		expect(result.basis).toBe("provider_code");
	});

	it("a stale client-version body is permanent even with no structured fields", () => {
		const result = classifyProviderError({
			text: '400 {"error":{"type":"invalid_request_error","message":"Claude Code 2.1.75 does not support this model; version 2.1.251 or newer is required.","details":{"error_code":"claude_code_version_too_old"}}}',
		});
		expect(result.kind).toBe("permanent_request");
		expect(result.basis).toBe("known_permanent");
	});

	it("a ChatGPT-account unsupported-model body is permanent", () => {
		const result = classifyProviderError({
			text: "The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account.",
		});
		expect(result.kind).toBe("permanent_request");
		expect(result.retryable).toBe(false);
	});

	it("a stray 500 inside a message body is not a status — only structured status counts", () => {
		// Text-only classification may legitimately mark transport wording
		// transient, but "500" alone in arbitrary text proves nothing.
		const result = classifyProviderError({ text: "saved 500 records before failing" });
		expect(result.kind).not.toBe("transient_transport");
	});

	it("keeps refusal as its own state, eligible for failover but never same-route retry", () => {
		const result = classifyProviderError({ text: "content/safety stop (stop_reason=refusal)" });
		expect(result.kind).toBe("refusal");
		expect(result.retryable).toBe(false);
		expect(result.failoverEligible).toBe(true);
	});

	it("auth failures are never retryable on the same credential", () => {
		expect(classifyProviderError({ status: 401, text: "unauthorized" }).kind).toBe("auth");
		expect(classifyProviderError({ status: 401, text: "unauthorized" }).retryable).toBe(false);
		expect(classifyProviderError({ text: "Authentication failed" }).kind).toBe("auth");
	});

	it("a 403 quota body is quota_exhausted, not auth", () => {
		const result = classifyProviderError({
			status: 403,
			text: '403 {"error":{"type":"permission_error","message":"You\'ve reached your usage limit for this billing cycle."}}',
		});
		expect(result.kind).toBe("quota_exhausted");
		expect(result.retryable).toBe(false);
		expect(result.failoverEligible).toBe(true);
	});

	it("text fallback keeps observed transient transport patterns retryable", () => {
		expect(classifyProviderError({ text: "503 Upstream request failed" }).retryable).toBe(true);
		expect(classifyProviderError({ text: "Upstream stream ended before terminal chunk" }).retryable).toBe(true);
		expect(classifyProviderError({ text: "terminated" }).retryable).toBe(true);
		expect(classifyProviderError({ text: "rate limit exceeded" }).retryable).toBe(true);
	});

	it("an empty input is unclassified and non-retryable", () => {
		const result = classifyProviderError({});
		expect(result.kind).toBe("unclassified");
		expect(result.retryable).toBe(false);
	});
});
