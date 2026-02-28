/**
 * Antigravity OAuth flow (Gemini 3, Claude, GPT-OSS via Google Cloud)
 * Uses different OAuth credentials than google-gemini-cli for access to additional models.
 */
import { getAntigravityAuthHeaders } from "../../providers/google-gemini-cli";
import { OAuthCallbackFlow } from "./callback-server";
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
const CLOUD_CODE_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const TIER_LEGACY = "legacy-tier";
const PROJECT_ONBOARD_MAX_ATTEMPTS = 5;
const PROJECT_ONBOARD_INTERVAL_MS = 2000;

interface LoadCodeAssistPayload {
	cloudaicompanionProject?: string | { id?: string };
	currentTier?: { id?: string };
	allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
}

interface LongRunningOperationResponse {
	done?: boolean;
	response?: {
		cloudaicompanionProject?: string | { id?: string };
	};
}

export const ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA = Object.freeze({
	ideType: "ANTIGRAVITY",
	platform: "PLATFORM_UNSPECIFIED",
	pluginType: "GEMINI",
});

function readProjectId(value: string | { id?: string } | undefined): string | undefined {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	if (value && typeof value === "object" && typeof value.id === "string" && value.id.length > 0) {
		return value.id;
	}
	return undefined;
}

function getDefaultTierId(allowedTiers?: Array<{ id?: string; isDefault?: boolean }>): string {
	if (!allowedTiers || allowedTiers.length === 0) {
		return TIER_LEGACY;
	}
	const defaultTier = allowedTiers.find(tier => tier.isDefault && typeof tier.id === "string" && tier.id.length > 0);
	if (defaultTier?.id) {
		return defaultTier.id;
	}
	return TIER_LEGACY;
}

async function onboardProjectWithRetries(
	endpoint: string,
	headers: Record<string, string>,
	onboardBody: { tierId: string; metadata: typeof ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA },
	onProgress?: (message: string) => void,
): Promise<string> {
	for (let attempt = 1; attempt <= PROJECT_ONBOARD_MAX_ATTEMPTS; attempt += 1) {
		if (attempt > 1) {
			onProgress?.(`Waiting for project provisioning (attempt ${attempt}/${PROJECT_ONBOARD_MAX_ATTEMPTS})...`);
			await Bun.sleep(PROJECT_ONBOARD_INTERVAL_MS);
		}

		const onboardResponse = await fetch(`${endpoint}/v1internal:onboardUser`, {
			method: "POST",
			headers,
			body: JSON.stringify(onboardBody),
		});

		if (!onboardResponse.ok) {
			const errorText = await onboardResponse.text();
			throw new Error(`onboardUser failed: ${onboardResponse.status} ${onboardResponse.statusText}: ${errorText}`);
		}

		const operation = (await onboardResponse.json()) as LongRunningOperationResponse;
		if (!operation.done) {
			continue;
		}

		const projectId = readProjectId(operation.response?.cloudaicompanionProject);
		if (projectId) {
			return projectId;
		}
	}

	throw new Error(
		`onboardUser did not return a provisioned project id after ${PROJECT_ONBOARD_MAX_ATTEMPTS} attempts`,
	);
}

async function discoverProject(accessToken: string, onProgress?: (message: string) => void): Promise<string> {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		...getAntigravityAuthHeaders(),
	};

	onProgress?.("Checking for existing project...");
	const endpoint = CLOUD_CODE_ENDPOINT;
	try {
		const loadResponse = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
			}),
		});

		if (!loadResponse.ok) {
			const errorText = await loadResponse.text();
			throw new Error(`loadCodeAssist failed: ${loadResponse.status} ${loadResponse.statusText}: ${errorText}`);
		}

		const loadPayload = (await loadResponse.json()) as LoadCodeAssistPayload;
		const existingProject = readProjectId(loadPayload.cloudaicompanionProject);
		if (existingProject) {
			return existingProject;
		}

		const tierId = getDefaultTierId(loadPayload.allowedTiers);
		onProgress?.("Provisioning project...");
		const onboardBody = {
			tierId,
			metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
		};
		const provisionedProject = await onboardProjectWithRetries(endpoint, headers, onboardBody, onProgress);
		return provisionedProject;
	} catch (error) {
		throw new Error(
			`Could not discover or provision an Antigravity project. ${error instanceof Error ? error.message : String(error)}`,
		);
	}
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
	constructor(ctrl: OAuthController) {
		super(ctrl, CALLBACK_PORT, CALLBACK_PATH);
	}

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
		const authParams = new URLSearchParams({
			client_id: CLIENT_ID,
			response_type: "code",
			redirect_uri: redirectUri,
			scope: SCOPES.join(" "),
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
