/**
 * Anthropic Authentication
 *
 * 4-tier auth resolution:
 *   1. ANTHROPIC_SEARCH_API_KEY / ANTHROPIC_SEARCH_BASE_URL env vars
 *   2. Provider with api="anthropic-messages" in ~/.omp/agent/models.json
 *   3. OAuth credentials in ~/.omp/agent/agent.db (with expiry check)
 *   4. ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL fallback
 */
import * as path from "node:path";
import { buildAnthropicHeaders as buildProviderAnthropicHeaders, getEnvApiKey } from "@oh-my-pi/pi-ai";
import { $env, logger } from "@oh-my-pi/pi-utils";
import { getAgentDbPath, getConfigDirPaths } from "../../config";
import { AgentStorage } from "../../session/agent-storage";
import type { AuthCredential, AuthCredentialEntry, AuthStorageData } from "../../session/auth-storage";
import { migrateJsonStorage } from "../../session/storage-migration";
import type { AnthropicAuthConfig, AnthropicOAuthCredential, ModelsJson } from "./types";

const DEFAULT_BASE_URL = "https://api.anthropic.com";

/**
 * Reads and parses a JSON file safely.
 * @param filePath - Path to the JSON file
 * @returns Parsed JSON content, or null if file doesn't exist or parsing fails
 */
async function readJson<T>(filePath: string): Promise<T | null> {
	try {
		const file = Bun.file(filePath);
		if (!(await file.exists())) return null;
		const content = await file.text();
		return JSON.parse(content) as T;
	} catch (error) {
		logger.warn("Failed to parse JSON file", { path: filePath, error: String(error) });
		return null;
	}
}

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

function normalizeAuthEntry(entry: AuthCredentialEntry | undefined): AuthCredential[] {
	if (!entry) return [];
	return Array.isArray(entry) ? entry : [entry];
}

async function readLegacyAnthropicOAuthCredentials(configDir: string): Promise<AnthropicOAuthCredential[]> {
	const authJson = await readJson<AuthStorageData>(path.join(configDir, "auth.json"));
	if (!authJson) return [];
	const entry = authJson.anthropic as AuthCredentialEntry | undefined;
	const credentials = normalizeAuthEntry(entry);
	const results: AnthropicOAuthCredential[] = [];
	for (const credential of credentials) {
		const mapped = toAnthropicOAuthCredential(credential);
		if (mapped) results.push(mapped);
	}
	return results;
}

/**
 * Reads Anthropic OAuth credentials from agent.db, migrating from legacy auth.json if needed.
 * @param configDir - Path to the config directory containing agent.db
 * @returns Array of valid Anthropic OAuth credentials
 */
async function readAnthropicOAuthCredentials(configDir: string): Promise<AnthropicOAuthCredential[]> {
	await migrateJsonStorage({
		agentDir: configDir,
		settingsPath: path.join(configDir, "settings.json"),
		authPaths: [path.join(configDir, "auth.json")],
	});

	const storage = await AgentStorage.open(getAgentDbPath(configDir));
	const records = storage.listAuthCredentials("anthropic");
	const credentials: AnthropicOAuthCredential[] = [];
	for (const record of records) {
		const mapped = toAnthropicOAuthCredential(record.credential);
		if (mapped) {
			credentials.push(mapped);
		}
	}

	if (credentials.length === 0) {
		return readLegacyAnthropicOAuthCredentials(configDir);
	}

	return credentials;
}

/**
 * Finds Anthropic auth config using 4-tier priority:
 *   1. ANTHROPIC_SEARCH_API_KEY / ANTHROPIC_SEARCH_BASE_URL
 *   2. Provider with api="anthropic-messages" in models.json
 *   3. OAuth in agent.db (with 5-minute expiry buffer)
 *   4. ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL fallback
 * @returns The first valid auth configuration found, or null if none available
 */
export async function findAnthropicAuth(): Promise<AnthropicAuthConfig | null> {
	// Get all config directories (user-level only) for fallback support
	const configDirs = getConfigDirPaths("", { project: false });

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

	// 2. Provider with api="anthropic-messages" in models.json (check all config dirs)
	for (const configDir of configDirs) {
		const modelsJson = await readJson<ModelsJson>(path.join(configDir, "models.json"));
		if (modelsJson?.providers) {
			// First pass: look for providers with actual API keys
			for (const [_name, provider] of Object.entries(modelsJson.providers)) {
				if (provider.api === "anthropic-messages" && provider.apiKey && provider.apiKey !== "none") {
					return {
						apiKey: provider.apiKey,
						baseUrl: provider.baseUrl ?? DEFAULT_BASE_URL,
						isOAuth: isOAuthToken(provider.apiKey),
					};
				}
			}
			// Second pass: check for proxy mode (baseUrl but apiKey="none")
			for (const [_name, provider] of Object.entries(modelsJson.providers)) {
				if (provider.api === "anthropic-messages" && provider.baseUrl) {
					return {
						apiKey: provider.apiKey ?? "",
						baseUrl: provider.baseUrl,
						isOAuth: false,
					};
				}
			}
		}
	}

	// 3. OAuth credentials in agent.db (with 5-minute expiry buffer, check all config dirs)
	const expiryBuffer = 5 * 60 * 1000; // 5 minutes
	const now = Date.now();
	for (const configDir of configDirs) {
		const credentials = await readAnthropicOAuthCredentials(configDir);
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
	}

	// 4. Generic ANTHROPIC_API_KEY fallback
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
 * Builds HTTP headers for Anthropic API requests.
 * @param auth - The authentication configuration
 * @returns Headers object ready for use in fetch requests
 */
export function buildAnthropicHeaders(auth: AnthropicAuthConfig): Record<string, string> {
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
