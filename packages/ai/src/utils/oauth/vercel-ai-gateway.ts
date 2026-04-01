/**
 * Vercel AI Gateway login flow.
 *
 * Vercel AI Gateway proxies upstream model providers through a unified endpoint.
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. Open Vercel AI Gateway docs
 * 2. User copies their API key
 * 3. User pastes the API key into the CLI
 */

import type { OAuthController } from "./types";

const AUTH_URL = "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keys";

/**
 * Login to Vercel AI Gateway.
 *
 * Opens browser to Vercel AI Gateway docs and prompts for an API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginVercelAiGateway(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Vercel AI Gateway login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your Vercel AI Gateway API key from the Vercel dashboard",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Vercel AI Gateway API key",
		placeholder: "vck_...",
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
