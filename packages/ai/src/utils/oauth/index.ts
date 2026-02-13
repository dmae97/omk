// ============================================================================
// High-level API
// ============================================================================

import { refreshAnthropicToken } from "./anthropic";
import { refreshCursorToken } from "./cursor";
import { refreshGitHubCopilotToken } from "./github-copilot";
import { refreshAntigravityToken } from "./google-antigravity";
import { refreshGoogleCloudToken } from "./google-gemini-cli";
import { refreshKimiToken } from "./kimi";
import { refreshOpenAICodexToken } from "./openai-codex";
import type { OAuthCredentials, OAuthProvider, OAuthProviderInfo } from "./types";

/**
 * OAuth credential management for AI providers.
 *
 * This module handles login, token refresh, and credential storage
 * for OAuth-based providers:
 * - Anthropic (Claude Pro/Max)
 * - GitHub Copilot
 * - Google Cloud Code Assist (Gemini CLI)
 * - Antigravity (Gemini 3, Claude, GPT-OSS via Google Cloud)
 * - Kimi Code
 * - Perplexity (Pro/Max — desktop app extraction or manual cookie)
 */

// Anthropic
export { loginAnthropic, refreshAnthropicToken } from "./anthropic";
// Cursor
export {
	generateCursorAuthParams,
	isTokenExpiringSoon as isCursorTokenExpiringSoon,
	loginCursor,
	pollCursorAuth,
	refreshCursorToken,
} from "./cursor";
// GitHub Copilot
export {
	getGitHubCopilotBaseUrl,
	loginGitHubCopilot,
	normalizeDomain,
	refreshGitHubCopilotToken,
} from "./github-copilot";
// Google Antigravity
export { loginAntigravity, refreshAntigravityToken } from "./google-antigravity";
// Google Gemini CLI
export { loginGeminiCli, refreshGoogleCloudToken } from "./google-gemini-cli";
// Kimi Code
export { loginKimi, refreshKimiToken } from "./kimi";
// MiniMax Coding Plan (API key)
export { loginMiniMaxCode, loginMiniMaxCodeCn } from "./minimax-code";
export type { OpenAICodexLoginOptions } from "./openai-codex";
// OpenAI Codex (ChatGPT OAuth)
export { loginOpenAICodex, refreshOpenAICodexToken } from "./openai-codex";
// OpenCode (API key)
export { loginOpenCode } from "./opencode";
// Perplexity
export { loginPerplexity } from "./perplexity";
export * from "./types";
// Z.AI (API key)
export { loginZai } from "./zai";

/**
 * Refresh token for any OAuth provider.
 * Saves the new credentials and returns the new access token.
 */
export async function refreshOAuthToken(
	provider: OAuthProvider,
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	if (!credentials) {
		throw new Error(`No OAuth credentials found for ${provider}`);
	}

	let newCredentials: OAuthCredentials;

	switch (provider) {
		case "anthropic":
			newCredentials = await refreshAnthropicToken(credentials.refresh);
			break;
		case "github-copilot":
			newCredentials = await refreshGitHubCopilotToken(credentials.refresh, credentials.enterpriseUrl);
			break;
		case "google-gemini-cli":
			if (!credentials.projectId) {
				throw new Error("Google Cloud credentials missing projectId");
			}
			newCredentials = await refreshGoogleCloudToken(credentials.refresh, credentials.projectId);
			break;
		case "google-antigravity":
			if (!credentials.projectId) {
				throw new Error("Antigravity credentials missing projectId");
			}
			newCredentials = await refreshAntigravityToken(credentials.refresh, credentials.projectId);
			break;
		case "openai-codex":
			newCredentials = await refreshOpenAICodexToken(credentials.refresh);
			break;
		case "kimi-code":
			newCredentials = await refreshKimiToken(credentials.refresh);
			break;
		case "cursor":
			newCredentials = await refreshCursorToken(credentials.refresh);
			break;
		case "perplexity":
		case "opencode":
		case "zai":
		case "minimax-code":
		case "minimax-code-cn":
			// API keys don't expire, return as-is
			newCredentials = credentials;
			break;
		default:
			throw new Error(`Unknown OAuth provider: ${provider}`);
	}

	return newCredentials;
}

function getPerplexityJwtExpiryMs(token: string): number | undefined {
	const parts = token.split(".");
	if (parts.length !== 3) return undefined;
	const payload = parts[1];
	if (!payload) return undefined;
	try {
		const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
		if (typeof decoded.exp !== "number" || !Number.isFinite(decoded.exp)) return undefined;
		return decoded.exp * 1000 - 5 * 60_000;
	} catch {
		return undefined;
	}
}

/**
 * Get API key for a provider from OAuth credentials.
 * Automatically refreshes expired tokens.
 *
 * For google-gemini-cli and antigravity, returns JSON-encoded { token, projectId }
 *
 * @returns API key string, or null if no credentials
 * @throws Error if refresh fails
 */
export async function getOAuthApiKey(
	provider: OAuthProvider,
	credentials: Record<string, OAuthCredentials>,
): Promise<{ newCredentials: OAuthCredentials; apiKey: string } | null> {
	let creds = credentials[provider];
	if (!creds) {
		return null;
	}

	if (provider === "perplexity") {
		const normalizedExpires =
			creds.expires > 0 && creds.expires < 10_000_000_000 ? creds.expires * 1000 : creds.expires;
		const jwtExpiry = getPerplexityJwtExpiryMs(creds.access);
		const expires = jwtExpiry && jwtExpiry > normalizedExpires ? jwtExpiry : normalizedExpires;
		if (expires !== creds.expires) {
			creds = { ...creds, expires };
		}
	}

	// Refresh if expired
	if (Date.now() >= creds.expires) {
		try {
			creds = await refreshOAuthToken(provider, creds);
		} catch {
			if (provider === "perplexity") {
				const jwtExpiry = getPerplexityJwtExpiryMs(creds.access);
				if (jwtExpiry && Date.now() < jwtExpiry) {
					const fallbackCredentials = { ...creds, expires: jwtExpiry };
					return { newCredentials: fallbackCredentials, apiKey: fallbackCredentials.access };
				}
			}
			throw new Error(`Failed to refresh OAuth token for ${provider}`);
		}
	}

	// For providers that need projectId, return JSON
	const needsProjectId = provider === "google-gemini-cli" || provider === "google-antigravity";
	const apiKey = needsProjectId ? JSON.stringify({ token: creds.access, projectId: creds.projectId }) : creds.access;
	return { newCredentials: creds, apiKey };
}

/**
 * Get list of OAuth providers
 */
export function getOAuthProviders(): OAuthProviderInfo[] {
	return [
		{
			id: "anthropic",
			name: "Anthropic (Claude Pro/Max)",
			available: true,
		},
		{
			id: "openai-codex",
			name: "ChatGPT Plus/Pro (Codex Subscription)",
			available: true,
		},
		{
			id: "kimi-code",
			name: "Kimi Code",
			available: true,
		},
		{
			id: "github-copilot",
			name: "GitHub Copilot",
			available: true,
		},
		{
			id: "google-gemini-cli",
			name: "Google Cloud Code Assist (Gemini CLI)",
			available: true,
		},
		{
			id: "google-antigravity",
			name: "Antigravity (Gemini 3, Claude, GPT-OSS)",
			available: true,
		},
		{
			id: "cursor",
			name: "Cursor (Claude, GPT, etc.)",
			available: true,
		},
		{
			id: "opencode",
			name: "OpenCode Zen",
			available: true,
		},
		{
			id: "zai",
			name: "Z.AI (GLM Coding Plan)",
			available: true,
		},
		{
			id: "minimax-code",
			name: "MiniMax Coding Plan (International)",
			available: true,
		},
		{
			id: "minimax-code-cn",
			name: "MiniMax Coding Plan (China)",
			available: true,
		},
		{
			id: "perplexity",
			name: "Perplexity (Pro/Max)",
			available: true,
		},
	];
}
