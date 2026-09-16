/**
 * Typed provider-error classification (audit §17): structured signals win over
 * free text. The precedence is
 *
 *     transport/status/providerCode → typed category → conservative text
 *     fallback
 *
 * A bare string regex cannot tell a retryable "400 tool_call_id is not found"
 * from a permanent "400 invalid_request_error", and a stray "500" inside a
 * message body is not a status code. Callers that only have a message keep the
 * {@link classifyProviderError} text fallback; callers that can also pass
 * transport fields should prefer {@link classifyProviderError} over
 * {@link isTransientProviderErrorMessage}.
 */

import {
	isClaudeCodeVersionTooOldMessage,
	isCodexChatgptAccountUnsupportedModelMessage,
	isContentSafetyStopMessage,
	isOrphanToolCallIdError,
	isQuotaExhaustionMessage,
	isTransientProviderErrorMessage,
	isUpstreamUnavailableMessage,
} from "./provider-resilience.ts";

export type ProviderErrorKind =
	/** Network cut, upstream 5xx, dropped stream, overload — heals by backoff/retry/failover. */
	| "transient_transport"
	/** Provider-directed throttling; honor Retry-After inside the run deadline. */
	| "rate_limit"
	/** Quota/billing exhaustion — same-model retry is useless until reset; failover only. */
	| "quota_exhausted"
	/** Permanent auth/permission failure — never auto-repeat on the same credential. */
	| "auth"
	/** Permanent request/model/config fault — retrying resends the same rejection. */
	| "permanent_request"
	/** Provider refusal/policy stop — a separate state, not a transport failure. */
	| "refusal"
	/** Transcript-shape fault that heals after sanitize+retry (e.g. orphan tool_call_id). */
	| "transcript_shape"
	/** No category assigned — caller treats as non-retryable. */
	| "unclassified";

export interface ProviderErrorClassification {
	readonly kind: ProviderErrorKind;
	/** Retry the same route inside the shared run budget. */
	readonly retryable: boolean;
	/** Failing over to another authorized route may save the turn. */
	readonly failoverEligible: boolean;
	/** Which signal decided the classification. */
	readonly basis: "status" | "provider_code" | "known_permanent" | "text_fallback" | "none";
}

export interface ProviderErrorInput {
	/** Free-text error message (may be the only signal available). */
	readonly text?: string;
	/** HTTP status code when the caller has one. */
	readonly status?: number;
	/** Structured provider error type, e.g. `invalid_request_error`. */
	readonly errorType?: string;
	/** Structured provider error code, e.g. `claude_code_version_too_old`. */
	readonly errorCode?: string;
}

const PERMANENT_PROVIDER_CODES = new Set([
	"claude_code_version_too_old",
	"unsupported_model",
	"model_not_supported",
	"invalid_api_key",
	"authentication_error",
	"permission_error",
]);

const TRANSIENT_PROVIDER_CODES = new Set([
	"overloaded_error",
	"rate_limit_error",
	"timeout",
	"server_error",
	"service_unavailable",
	"upstream_error",
]);

function isAuthText(text: string): boolean {
	return /auth|unauthori[sz]ed|forbidden|invalid.?api.?key|no api key|401|403|\/login/i.test(text);
}

/**
 * Classify a provider failure. Structured fields are consulted first; a text
 * fallback keeps the observed-provider patterns (the same precedence
 * {@link providerFailureCause} uses) when nothing else is available.
 */
export function classifyProviderError(input: ProviderErrorInput): ProviderErrorClassification {
	const text = input.text ?? "";

	// Known permanent bodies beat every other signal: they carry
	// `invalid_request_error` or a 400, but no retry fixes a stale client
	// version or an account that lacks the model.
	if (isClaudeCodeVersionTooOldMessage(text) || isCodexChatgptAccountUnsupportedModelMessage(text)) {
		return { kind: "permanent_request", retryable: false, failoverEligible: false, basis: "known_permanent" };
	}

	if (input.errorCode !== undefined) {
		const code = input.errorCode.toLowerCase();
		if (PERMANENT_PROVIDER_CODES.has(code)) {
			return { kind: "permanent_request", retryable: false, failoverEligible: false, basis: "provider_code" };
		}
		if (TRANSIENT_PROVIDER_CODES.has(code)) {
			return { kind: "transient_transport", retryable: true, failoverEligible: true, basis: "provider_code" };
		}
	}

	if (input.status !== undefined) {
		if (input.status === 429) {
			return { kind: "rate_limit", retryable: true, failoverEligible: true, basis: "status" };
		}
		if (input.status >= 500 && input.status <= 599) {
			return { kind: "transient_transport", retryable: true, failoverEligible: true, basis: "status" };
		}
		if (input.status === 401 || input.status === 403) {
			// A 403 quota body still wins over the auth default.
			if (isQuotaExhaustionMessage(text)) {
				return { kind: "quota_exhausted", retryable: false, failoverEligible: true, basis: "text_fallback" };
			}
			return { kind: "auth", retryable: false, failoverEligible: false, basis: "status" };
		}
		if (input.status === 402) {
			return { kind: "quota_exhausted", retryable: false, failoverEligible: true, basis: "status" };
		}
		if (input.status === 400 || input.status === 404 || input.status === 422) {
			// A 4xx is permanent unless a known-healing transcript shape explains
			// it — `tool_call_id is not found` is the only observed exception.
			if (isOrphanToolCallIdError(text)) {
				return { kind: "transcript_shape", retryable: true, failoverEligible: true, basis: "text_fallback" };
			}
			return { kind: "permanent_request", retryable: false, failoverEligible: false, basis: "status" };
		}
	}

	if (isContentSafetyStopMessage(text)) {
		return { kind: "refusal", retryable: false, failoverEligible: true, basis: "text_fallback" };
	}
	if (isQuotaExhaustionMessage(text)) {
		return { kind: "quota_exhausted", retryable: false, failoverEligible: true, basis: "text_fallback" };
	}
	if (isUpstreamUnavailableMessage(text)) {
		return { kind: "transient_transport", retryable: true, failoverEligible: true, basis: "text_fallback" };
	}
	if (isOrphanToolCallIdError(text)) {
		return { kind: "transcript_shape", retryable: true, failoverEligible: true, basis: "text_fallback" };
	}
	if (isAuthText(text)) {
		return { kind: "auth", retryable: false, failoverEligible: false, basis: "text_fallback" };
	}
	if (isTransientProviderErrorMessage(text)) {
		return { kind: "transient_transport", retryable: true, failoverEligible: true, basis: "text_fallback" };
	}
	return { kind: "unclassified", retryable: false, failoverEligible: false, basis: "none" };
}
