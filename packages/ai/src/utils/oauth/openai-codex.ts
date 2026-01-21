/**
 * OpenAI Codex (ChatGPT OAuth) flow
 */

import { OAuthCallbackFlow } from "./callback-server";
import { generatePKCE } from "./pkce";
import type { OAuthController, OAuthCredentials } from "./types";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

type JwtPayload = {
	[JWT_CLAIM_PATH]?: {
		chatgpt_account_id?: string;
	};
	[key: string]: unknown;
};

function decodeJwt(token: string): JwtPayload | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = parts[1] ?? "";
		const decoded = Buffer.from(payload, "base64").toString("utf-8");
		return JSON.parse(decoded) as JwtPayload;
	} catch {
		return null;
	}
}

function getAccountId(accessToken: string): string | null {
	const payload = decodeJwt(accessToken);
	const auth = payload?.[JWT_CLAIM_PATH];
	const accountId = auth?.chatgpt_account_id;
	return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

interface PKCE {
	verifier: string;
	challenge: string;
}

class OpenAICodexOAuthFlow extends OAuthCallbackFlow {
	constructor(
		ctrl: OAuthController,
		private readonly pkce: PKCE,
		private readonly originator: string,
	) {
		super(ctrl, CALLBACK_PORT, CALLBACK_PATH);
	}

	protected async generateAuthUrl(
		state: string,
		redirectUri: string,
	): Promise<{ url: string; instructions?: string }> {
		const searchParams = new URLSearchParams({
			response_type: "code",
			client_id: CLIENT_ID,
			redirect_uri: redirectUri,
			scope: SCOPE,
			code_challenge: this.pkce.challenge,
			code_challenge_method: "S256",
			state,
			id_token_add_organizations: "true",
			codex_cli_simplified_flow: "true",
			originator: this.originator,
		});

		const url = `${AUTHORIZE_URL}?${searchParams.toString()}`;
		return { url, instructions: "A browser window should open. Complete login to finish." };
	}

	protected async exchangeToken(code: string, _state: string, redirectUri: string): Promise<OAuthCredentials> {
		return exchangeCodeForToken(code, this.pkce.verifier, redirectUri);
	}
}

async function exchangeCodeForToken(code: string, verifier: string, redirectUri: string): Promise<OAuthCredentials> {
	const tokenResponse = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: redirectUri,
		}),
	});

	if (!tokenResponse.ok) {
		throw new Error(`Token exchange failed: ${tokenResponse.status}`);
	}

	const tokenData = (await tokenResponse.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};

	if (!tokenData.access_token || !tokenData.refresh_token || typeof tokenData.expires_in !== "number") {
		throw new Error("Token response missing required fields");
	}

	const accountId = getAccountId(tokenData.access_token);
	if (!accountId) {
		throw new Error("Failed to extract accountId from token");
	}

	return {
		access: tokenData.access_token,
		refresh: tokenData.refresh_token,
		expires: Date.now() + tokenData.expires_in * 1000,
		accountId,
	};
}

/**
 * Login with OpenAI Codex OAuth
 */
export type OpenAICodexLoginOptions = OAuthController & {
	/** Optional originator value for OpenAI Codex OAuth. Default: "opencode". */
	originator?: string;
};

export async function loginOpenAICodex(options: OpenAICodexLoginOptions): Promise<OAuthCredentials> {
	const pkce = await generatePKCE();
	const originator = options.originator?.trim() || "opencode";
	const flow = new OpenAICodexOAuthFlow(options, pkce, originator);

	return flow.login();
}

/**
 * Refresh OpenAI Codex OAuth token
 */
export async function refreshOpenAICodexToken(refreshToken: string): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}),
	});

	if (!response.ok) {
		throw new Error(`OpenAI Codex token refresh failed: ${response.status}`);
	}

	const tokenData = (await response.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};

	if (!tokenData.access_token || !tokenData.refresh_token || typeof tokenData.expires_in !== "number") {
		throw new Error("Token response missing required fields");
	}

	const accountId = getAccountId(tokenData.access_token);

	return {
		access: tokenData.access_token,
		refresh: tokenData.refresh_token || refreshToken,
		expires: Date.now() + tokenData.expires_in * 1000,
		accountId: accountId ?? undefined,
	};
}
