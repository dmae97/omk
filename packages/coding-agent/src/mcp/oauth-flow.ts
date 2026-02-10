/**
 * Generic OAuth flow for MCP servers.
 *
 * Allows users to authenticate with any OAuth-compatible MCP server
 * by providing authorization URL, token URL, and client credentials.
 */

import type { OAuthController, OAuthCredentials } from "@oh-my-pi/pi-ai";
import { OAuthCallbackFlow } from "@oh-my-pi/pi-ai/utils/oauth/callback-server";

const DEFAULT_PORT = 3000;
const CALLBACK_PATH = "/callback";

export interface MCPOAuthConfig {
	/** Authorization endpoint URL */
	authorizationUrl: string;
	/** Token endpoint URL */
	tokenUrl: string;
	/** Client ID (optional when already embedded in authorization URL) */
	clientId?: string;
	/** Client secret (optional for PKCE flows) */
	clientSecret?: string;
	/** OAuth scopes (space-separated) */
	scopes?: string;
}

/**
 * Generic OAuth flow for MCP servers.
 * Supports standard OAuth 2.0 authorization code flow with PKCE.
 */
export class MCPOAuthFlow extends OAuthCallbackFlow {
	#resolvedClientId?: string;
	#registeredClientSecret?: string;
	#codeVerifier?: string;

	constructor(
		private config: MCPOAuthConfig,
		ctrl: OAuthController,
	) {
		super(ctrl, DEFAULT_PORT, CALLBACK_PATH);
		this.#resolvedClientId = this.#resolveClientId(config);
	}

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
		if (!this.#resolvedClientId) {
			await this.#tryRegisterClient(redirectUri);
		}

		const authUrl = new URL(this.config.authorizationUrl);
		const params = authUrl.searchParams;

		if (!params.get("response_type")) {
			params.set("response_type", "code");
		}
		if (this.#resolvedClientId && !params.get("client_id")) {
			params.set("client_id", this.#resolvedClientId);
		}
		if (this.config.scopes && !params.get("scope")) {
			params.set("scope", this.config.scopes);
		}
		params.set("redirect_uri", redirectUri);
		params.set("state", state);

		// Add PKCE challenge (some providers require it)
		const codeVerifier = this.#generateCodeVerifier();
		const codeChallenge = await this.#generateCodeChallenge(codeVerifier);
		params.set("code_challenge", codeChallenge);
		params.set("code_challenge_method", "S256");

		// Store code verifier for token exchange
		this.#codeVerifier = codeVerifier;

		return { url: authUrl.toString() };
	}

	async exchangeToken(code: string, _state: string, redirectUri: string): Promise<OAuthCredentials> {
		const params = new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
		});
		if (this.#resolvedClientId) {
			params.set("client_id", this.#resolvedClientId);
		}

		// Add code verifier for PKCE
		if (this.#codeVerifier) {
			params.set("code_verifier", this.#codeVerifier);
		}
		this.#codeVerifier = undefined;

		// Add client secret if provided
		const clientSecret = this.config.clientSecret ?? this.#registeredClientSecret;
		if (clientSecret) {
			params.set("client_secret", clientSecret);
		}

		const response = await fetch(this.config.tokenUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: params.toString(),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
		}

		const data = (await response.json()) as {
			access_token: string;
			refresh_token?: string;
			expires_in?: number;
			token_type?: string;
		};

		// Calculate expiry timestamp
		const expiresIn = data.expires_in ?? 3600; // Default to 1 hour
		const expires = Date.now() + expiresIn * 1000;

		return {
			access: data.access_token,
			refresh: data.refresh_token ?? "",
			expires,
		};
	}

	/**
	 * Generate PKCE code verifier (random string).
	 */
	#generateCodeVerifier(): string {
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		return this.#base64UrlEncode(bytes);
	}

	/**
	 * Generate PKCE code challenge from verifier.
	 */
	async #generateCodeChallenge(verifier: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(verifier);
		const hash = await crypto.subtle.digest("SHA-256", data);
		return this.#base64UrlEncode(new Uint8Array(hash));
	}

	/**
	 * Base64 URL encode (without padding).
	 */
	#base64UrlEncode(bytes: Uint8Array): string {
		const base64 = btoa(String.fromCharCode(...bytes));
		return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
	}

	#resolveClientId(config: MCPOAuthConfig): string | undefined {
		const fromConfig = config.clientId?.trim();
		if (fromConfig) return fromConfig;

		try {
			return new URL(config.authorizationUrl).searchParams.get("client_id") ?? undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Try OAuth dynamic client registration when provider requires a client_id.
	 */
	async #tryRegisterClient(redirectUri: string): Promise<void> {
		const registrationEndpoint = await this.#resolveRegistrationEndpoint();
		if (!registrationEndpoint) return;

		try {
			const response = await fetch(registrationEndpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					client_name: "oh-my-pi MCP",
					redirect_uris: [redirectUri],
					grant_types: ["authorization_code", "refresh_token"],
					response_types: ["code"],
					token_endpoint_auth_method: "none",
					application_type: "native",
				}),
			});

			if (!response.ok) return;

			const data = (await response.json()) as {
				client_id?: string;
				client_secret?: string;
			};

			if (data.client_id && data.client_id.trim() !== "") {
				this.#resolvedClientId = data.client_id;
			}
			if (data.client_secret && data.client_secret.trim() !== "") {
				this.#registeredClientSecret = data.client_secret;
			}
		} catch {
			// Ignore registration failures and continue without client registration.
		}
	}

	async #resolveRegistrationEndpoint(): Promise<string | null> {
		try {
			const authorizationEndpoint = new URL(this.config.authorizationUrl);
			const metadataUrl = new URL("/.well-known/oauth-authorization-server", authorizationEndpoint.origin);
			const response = await fetch(metadataUrl.toString(), {
				method: "GET",
				headers: { Accept: "application/json" },
			});

			if (!response.ok) return null;
			const metadata = (await response.json()) as { registration_endpoint?: string };
			if (metadata.registration_endpoint && metadata.registration_endpoint.trim() !== "") {
				return metadata.registration_endpoint;
			}
		} catch {
			// Ignore metadata discovery failures.
		}

		return null;
	}
}
