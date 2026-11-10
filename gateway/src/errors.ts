export type ErrorType = "authentication_error" | "permission_error" | "invalid_request_error" | "rate_limit_error" | "api_error";

export class GatewayError extends Error {
	constructor(
		public status: number,
		public code: string,
		public type: ErrorType,
		message: string,
		public opts: { param?: string | null; retryAfter?: number; retryable?: boolean; limit?: number; remaining?: number } = {},
	) {
		super(message);
	}

	body() {
		return { error: { message: this.message, type: this.type, code: this.code, param: this.opts.param ?? null } };
	}

	headers(): Record<string, string> {
		const h: Record<string, string> = {};
		if (this.status === 429) h["retry-after"] = String(Math.max(0, Math.trunc(this.opts.retryAfter ?? 0)));
		else if (this.opts.retryAfter !== undefined) h["retry-after"] = String(Math.max(0, Math.trunc(this.opts.retryAfter)));
		if (this.opts.retryable === false) h["x-omk-retryable"] = "false";
		if (this.opts.limit !== undefined) h["x-omk-limit"] = String(this.opts.limit);
		if (this.opts.remaining !== undefined) h["x-omk-remaining"] = String(this.opts.remaining);
		return h;
	}
}

export const E = {
	tokenMissing: () => new GatewayError(401, "token_missing", "authentication_error", "No token provided. Send 'Authorization: Bearer <your OMK account token>'."),
	tokenInvalid: () => new GatewayError(401, "token_invalid", "authentication_error", "The token is not valid. Check OMK_ACCOUNT_TOKEN or ask for a new one."),
	tokenExpired: () => new GatewayError(401, "token_expired", "authentication_error", "This token has expired. Ask the admin for a new token."),
	tokenRevoked: () => new GatewayError(403, "token_revoked", "permission_error", "This token was revoked. Ask the admin for a new token."),
	modelNotAllowed: (m: string) => new GatewayError(403, "model_not_allowed", "permission_error", `Model '${m}' is not available for this token. Available models are listed at GET /v1/models.`, { param: "model" }),
	invalid: (message: string, param?: string, code = "invalid_request") => new GatewayError(400, code, "invalid_request_error", message, { param: param ?? null }),
	unavailable: (status: 502 | 503, retryAfter?: number) =>
		new GatewayError(status, "upstream_unavailable", "api_error", "The model service is temporarily unavailable. Please retry shortly.", retryAfter === undefined ? {} : { retryAfter }),
};
