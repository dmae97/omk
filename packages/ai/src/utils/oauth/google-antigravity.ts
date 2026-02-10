/**
 * Antigravity OAuth flow (Gemini 3, Claude, GPT-OSS via Google Cloud)
 * Uses different OAuth credentials than google-gemini-cli for access to additional models.
 */
import { OAuthCallbackFlow } from "./callback-server";
import { generatePKCE } from "./pkce";
import type { OAuthController, OAuthCredentials } from "./types";

const decode = (s: string) => atob(s);
const CLIENT_ID = decode(
	"MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
);
const CLIENT_SECRET = decode("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");
const CALLBACK_PORT = 51121;
const CALLBACK_PATH = "/oauth-callback";

const SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_PROJECT_ID = "rising-fact-p41fc";

interface LoadCodeAssistPayload {
	cloudaicompanionProject?: string | { id?: string };
	currentTier?: { id?: string };
	allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
}

async function discoverProject(accessToken: string, onProgress?: (message: string) => void): Promise<string> {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		"User-Agent": "google-api-nodejs-client/9.15.1",
		"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
		"Client-Metadata": JSON.stringify({
			ideType: "IDE_UNSPECIFIED",
			platform: "PLATFORM_UNSPECIFIED",
			pluginType: "GEMINI",
		}),
	};

	const endpoints = ["https://cloudcode-pa.googleapis.com", "https://daily-cloudcode-pa.sandbox.googleapis.com"];

	onProgress?.("Checking for existing project...");

	for (const endpoint of endpoints) {
		try {
			const loadResponse = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
				method: "POST",
				headers,
				body: JSON.stringify({
					metadata: {
						ideType: "IDE_UNSPECIFIED",
						platform: "PLATFORM_UNSPECIFIED",
						pluginType: "GEMINI",
					},
				}),
			});

			if (loadResponse.ok) {
				const data = (await loadResponse.json()) as LoadCodeAssistPayload;

				if (typeof data.cloudaicompanionProject === "string" && data.cloudaicompanionProject) {
					return data.cloudaicompanionProject;
				}
				if (
					data.cloudaicompanionProject &&
					typeof data.cloudaicompanionProject === "object" &&
					data.cloudaicompanionProject.id
				) {
					return data.cloudaicompanionProject.id;
				}
			}
		} catch {
			// Try next endpoint
		}
	}

	onProgress?.("Using default project...");
	return DEFAULT_PROJECT_ID;
}

async function getUserEmail(accessToken: string): Promise<string | undefined> {
	try {
		const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
			headers: { Authorization: `Bearer ${accessToken}` },
		});

		if (response.ok) {
			const data = (await response.json()) as { email?: string };
			return data.email;
		}
	} catch {
		// Ignore errors, email is optional
	}
	return undefined;
}

class AntigravityOAuthFlow extends OAuthCallbackFlow {
	#verifier: string = "";
	#challenge: string = "";

	constructor(ctrl: OAuthController) {
		super(ctrl, CALLBACK_PORT, CALLBACK_PATH);
	}

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
		const pkce = await generatePKCE();
		this.#verifier = pkce.verifier;
		this.#challenge = pkce.challenge;

		const authParams = new URLSearchParams({
			client_id: CLIENT_ID,
			response_type: "code",
			redirect_uri: redirectUri,
			scope: SCOPES.join(" "),
			code_challenge: this.#challenge,
			code_challenge_method: "S256",
			state,
			access_type: "offline",
			prompt: "consent",
		});

		const url = `${AUTH_URL}?${authParams.toString()}`;
		return { url, instructions: "Complete the sign-in in your browser." };
	}

	async exchangeToken(code: string, _state: string, redirectUri: string): Promise<OAuthCredentials> {
		this.ctrl.onProgress?.("Exchanging authorization code for tokens...");

		const tokenResponse = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				code,
				grant_type: "authorization_code",
				redirect_uri: redirectUri,
				code_verifier: this.#verifier,
			}),
		});

		if (!tokenResponse.ok) {
			const error = await tokenResponse.text();
			throw new Error(`Token exchange failed: ${error}`);
		}

		const tokenData = (await tokenResponse.json()) as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
		};

		if (!tokenData.refresh_token) {
			throw new Error("No refresh token received. Please try again.");
		}

		this.ctrl.onProgress?.("Getting user info...");
		const email = await getUserEmail(tokenData.access_token);
		const projectId = await discoverProject(tokenData.access_token, this.ctrl.onProgress);

		return {
			refresh: tokenData.refresh_token,
			access: tokenData.access_token,
			expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
			projectId,
			email,
		};
	}
}

/**
 * Login with Antigravity OAuth
 */
export async function loginAntigravity(ctrl: OAuthController): Promise<OAuthCredentials> {
	const flow = new AntigravityOAuthFlow(ctrl);
	return flow.login();
}

/**
 * Refresh Antigravity token
 */
export async function refreshAntigravityToken(refreshToken: string, projectId: string): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Antigravity token refresh failed: ${error}`);
	}

	const data = (await response.json()) as {
		access_token: string;
		expires_in: number;
		refresh_token?: string;
	};

	return {
		refresh: data.refresh_token || refreshToken,
		access: data.access_token,
		expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
		projectId,
	};
}
