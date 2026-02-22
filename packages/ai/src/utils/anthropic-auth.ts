/**
 * Anthropic Authentication
 *
 * 4-tier auth resolution:
 *   1. ANTHROPIC_SEARCH_API_KEY / ANTHROPIC_SEARCH_BASE_URL env vars
 *   2. Provider with api="anthropic-messages" in ~/.omp/agent/models.json
 *   3. OAuth credentials in ~/.omp/agent/agent.db (with expiry check)
 *   4. ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL fallback
 */
import { $env } from "@oh-my-pi/pi-utils";
import { getAgentDbPath } from "@oh-my-pi/pi-utils/dirs";
import { type AuthCredential, AuthCredentialStore } from "../auth-storage";
import { buildAnthropicHeaders as buildProviderAnthropicHeaders } from "../providers/anthropic";
import { getEnvApiKey } from "../stream";

/** Auth configuration for Anthropic */
export interface AnthropicAuthConfig {
	apiKey: string;
	baseUrl: string;
	isOAuth: boolean;
}

/** models.json structure for provider resolution */
export interface ModelsJson {
	providers?: Record<
		string,
		{
			baseUrl?: string;
			apiKey?: string;
			api?: string;
		}
	>;
}

/** OAuth credential for Anthropic API access */
export interface AnthropicOAuthCredential {
	type: "oauth";
	access: string;
	refresh?: string;
	/** Expiry timestamp in milliseconds */
	expires: number;
}

const DEFAULT_BASE_URL = "https://api.anthropic.com";

/**
 * Checks if a token is an OAuth token by looking for sk-ant-oat prefix.
 * @param apiKey - The API key to check
 * @returns True if the token is an OAuth token
 */
export function isOAuthToken(apiKey: string): boolean {
	return apiKey.includes("sk-ant-oat");
}

/**
 * Converts a generic AuthCredential to AnthropicOAuthCredential if it's a valid OAuth entry.
 * @param credential - The credential to convert
 * @returns The converted OAuth credential, or null if not a valid OAuth type
 */
function toAnthropicOAuthCredential(credential: AuthCredential): AnthropicOAuthCredential | null {
	if (credential.type !== "oauth") return null;
	if (typeof credential.access !== "string" || typeof credential.expires !== "number") return null;
	return {
		type: "oauth",
		access: credential.access,
		refresh: credential.refresh,
		expires: credential.expires,
	};
}

/**
 * Reads Anthropic OAuth credentials from an AuthCredentialStore.
 * @param store - Credential store to read from (creates AuthCredentialStore if not provided)
 * @returns Array of valid Anthropic OAuth credentials
 */
async function readAnthropicOAuthCredentials(store?: AuthCredentialStore): Promise<AnthropicOAuthCredential[]> {
	const ownsStore = !store;
	const effectiveStore = store ?? (await AuthCredentialStore.open(getAgentDbPath()));
	try {
		const records = effectiveStore.listAuthCredentials("anthropic");
		const credentials: AnthropicOAuthCredential[] = [];
		for (const record of records) {
			const mapped = toAnthropicOAuthCredential(record.credential);
			if (mapped) {
				credentials.push(mapped);
			}
		}

		return credentials;
	} finally {
		if (ownsStore) {
			effectiveStore.close();
		}
	}
}

/**
 * Finds Anthropic auth config using 4-tier priority:
 *   1. ANTHROPIC_SEARCH_API_KEY / ANTHROPIC_SEARCH_BASE_URL
 *   2. Provider with api="anthropic-messages" in models.json
 *   3. OAuth in agent.db (with 5-minute expiry buffer)
 *   4. ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL fallback
 * @param store - Optional credential store (creates one from default db path if not provided)
 * @returns The first valid auth configuration found, or null if none available
 */
export async function findAnthropicAuth(store?: AuthCredentialStore): Promise<AnthropicAuthConfig | null> {
	// 1. Explicit search-specific env vars
	const searchApiKey = $env.ANTHROPIC_SEARCH_API_KEY;
	const searchBaseUrl = $env.ANTHROPIC_SEARCH_BASE_URL;
	if (searchApiKey) {
		return {
			apiKey: searchApiKey,
			baseUrl: searchBaseUrl ?? DEFAULT_BASE_URL,
			isOAuth: isOAuthToken(searchApiKey),
		};
	}

	// 2. OAuth credentials in agent.db (with 5-minute expiry buffer)
	const expiryBuffer = 5 * 60 * 1000; // 5 minutes
	const now = Date.now();
	const credentials = await readAnthropicOAuthCredentials(store);
	for (const credential of credentials) {
		if (!credential.access) continue;
		if (credential.expires > now + expiryBuffer) {
			return {
				apiKey: credential.access,
				baseUrl: DEFAULT_BASE_URL,
				isOAuth: true,
			};
		}
	}

	// 3. Generic ANTHROPIC_API_KEY fallback
	const apiKey = getEnvApiKey("anthropic");
	const baseUrl = $env.ANTHROPIC_BASE_URL;
	if (apiKey) {
		return {
			apiKey,
			baseUrl: baseUrl ?? DEFAULT_BASE_URL,
			isOAuth: isOAuthToken(apiKey),
		};
	}

	return null;
}

/**
 * Builds HTTP headers for Anthropic API requests (search variant).
 * @param auth - The authentication configuration
 * @returns Headers object ready for use in fetch requests
 */
export function buildAnthropicSearchHeaders(auth: AnthropicAuthConfig): Record<string, string> {
	return buildProviderAnthropicHeaders({
		apiKey: auth.apiKey,
		baseUrl: auth.baseUrl,
		isOAuth: auth.isOAuth,
		extraBetas: ["web-search-2025-03-05"],
		stream: false,
	});
}

/**
 * Builds the full API URL for Anthropic messages endpoint.
 * @param auth - The authentication configuration
 * @returns The complete API URL with beta query parameter
 */
export function buildAnthropicUrl(auth: AnthropicAuthConfig): string {
	const base = `${auth.baseUrl}/v1/messages`;
	return `${base}?beta=true`;
}
