/**
 * Kagi login flow.
 *
 * Kagi web search uses an API key from the account settings page.
 * This is an API key flow:
 * 1. Open browser to Kagi API settings
 * 2. User copies API key
 * 3. User pastes key into CLI
 */

import type { OAuthController } from "./types";

const AUTH_URL = "https://kagi.com/settings/api";

/**
 * Login to Kagi.
 *
 * Opens browser to API settings and prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginKagi(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Kagi login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your API key from Kagi API settings",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Kagi API key",
		placeholder: "kagi_...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	return trimmed;
}
