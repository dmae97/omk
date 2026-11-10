import { isOmkProviderEnabled, OMK_ACCOUNT_TOKEN_ENV, OMK_GATEWAY_BASE_URL_ENV } from "./flag.ts";
import { OMK_PROVIDER_ID } from "./models.ts";

/** What the gateway said about a failed request (`error.code`, `error.message`, headers). Never holds the token. */
export interface OmkGatewayFailure {
	status: number;
	code?: string;
	message?: string;
	/** `x-omk-retryable: false` */
	notRetryable: boolean;
}

/** Client-side texts: no request was made. */
export const OMK_TOKEN_MISSING_MESSAGE = `OMK account token missing. Set ${OMK_ACCOUNT_TOKEN_ENV} or run /login and choose OMK.`;
export const OMK_BASE_URL_MISSING_MESSAGE = `OMK gateway base URL missing. Set ${OMK_GATEWAY_BASE_URL_ENV} (for example https://host/v1); the OMK models are unavailable until it is set.`;

const NEW_TOKEN_HINT = `then run /login (choose OMK) or update ${OMK_ACCOUNT_TOKEN_ENV}`;

/**
 * The "no credential" text for `/login`-style prompts (`formatNoApiKeyFoundMessage`); undefined for every other
 * provider and whenever the flag is off, so the generic text is unchanged there.
 */
export function formatOmkNoCredentialMessage(
	provider: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	return provider === OMK_PROVIDER_ID && isOmkProviderEnabled(env) ? OMK_TOKEN_MISSING_MESSAGE : undefined;
}

function withGatewayText(prefix: string, failure: OmkGatewayFailure): string {
	return failure.message ? `${prefix} Gateway: ${failure.message}` : prefix;
}

/**
 * Client text for a gateway error, keyed by its `error.code`. Undefined = not an account/limit error, keep the
 * original text. 429 texts without the retry-worthy status digits where the gateway says "do not retry", so the
 * turn-level retry classifier (which reads the text) agrees with the gateway.
 */
export function describeOmkGatewayFailure(failure: OmkGatewayFailure): string | undefined {
	switch (failure.code) {
		case "token_missing":
			return OMK_TOKEN_MISSING_MESSAGE;
		case "token_invalid":
			return `OMK token rejected (401 token_invalid): the gateway does not accept this token. Check ${OMK_ACCOUNT_TOKEN_ENV} or run /login to store a new one.`;
		case "token_expired":
			return `OMK token expired (401 token_expired): ask the admin for a new token, ${NEW_TOKEN_HINT}.`;
		case "token_revoked":
			return `OMK token revoked (403 token_revoked): ask the admin for a new token, ${NEW_TOKEN_HINT}.`;
		case "model_not_allowed":
			return "OMK model not allowed for this token (403 model_not_allowed): choose another OMK model with /model or ask the admin to change the plan.";
		case "quota_exceeded":
			return withGatewayText("OMK monthly quota exceeded (quota_exceeded, not retried).", failure);
		case "request_limit_exceeded":
			return withGatewayText(
				failure.notRetryable
					? "OMK per-request limit exceeded (request_limit_exceeded, not retried)."
					: "OMK per-request limit exceeded (request_limit_exceeded).",
				failure,
			);
		case "rate_limited":
			return withGatewayText("OMK rate limited (429 rate_limited), still throttled after retrying.", failure);
		default:
			return undefined;
	}
}

/** Replace every occurrence of the token (and its trimmed form) so no message can echo it. */
export function redactOmkToken(text: string, token: string | undefined): string {
	const secret = token?.trim();
	return secret ? text.split(secret).join("[redacted]") : text;
}
