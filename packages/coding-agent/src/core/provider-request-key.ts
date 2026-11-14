/**
 * Request-time API key resolution for one provider: the stored credential first, a models.json
 * provider key only when nothing is stored.
 *
 * A stored OAuth login is never replaced by another key. Sessions share auth.json, and a request
 * that could not take the lock within the retry window used to come back as "no credential"; the
 * models.json key (`"$ANTHROPIC_API_KEY"`) then went out for a logged-in session and the provider
 * answered 401 "invalid x-api-key". The lock only serializes refreshes, so a token that has not
 * expired is used as it is, and a login that cannot be resolved is reported as that.
 */

import type { OAuthCredentials } from "omk-ai";
import { getOAuthProvider } from "omk-ai/oauth";
import type { AuthStorage } from "./auth-storage.ts";
import { rejectedOAuthLoginMessage, unresolvedOAuthLoginMessage } from "./credential-resolution-failure.ts";
import { resolveConfigValueOrThrow } from "./resolve-config-value.ts";

export type ProviderRequestKey = { ok: true; apiKey: string | undefined } | { ok: false; error: string };

/** Selected account of a stored OAuth login whose provider is registered in this process. */
function getStoredOAuthLogin(authStorage: AuthStorage, provider: string): OAuthCredentials | undefined {
	if (authStorage.get(provider)?.type !== "oauth" || !getOAuthProvider(provider)) return undefined;
	return authStorage.getOAuthCredentials(provider);
}

/** Stored access token while it has not expired; never refreshes. */
function getUnexpiredOAuthApiKey(provider: string, account: OAuthCredentials): string | undefined {
	// wall-clock: account.expires is a persisted absolute expiry
	if (Date.now() >= account.expires) return undefined;
	return getOAuthProvider(provider)?.getApiKey(account);
}

/**
 * Stands in for a stored OAuth login the auth store returned no key for. `undefined` means the
 * provider has no such login and the caller may consult other key sources.
 */
export function resolveUnresolvedOAuthLogin(
	authStorage: AuthStorage,
	provider: string,
): ProviderRequestKey | undefined {
	const account = getStoredOAuthLogin(authStorage, provider);
	if (!account) return undefined;
	const apiKey = getUnexpiredOAuthApiKey(provider, account);
	if (apiKey !== undefined) return { ok: true, apiKey };
	// A store that could not be read keeps its own message: /login cannot clear a read failure.
	if (authStorage.hasLoadError()) return { ok: true, apiKey: undefined };
	// A refused refresh ends the turn at once; the other failures are retried by the agent loop.
	const refused = authStorage.wasOAuthRefreshRefused(provider);
	return { ok: false, error: (refused ? rejectedOAuthLoginMessage : unresolvedOAuthLoginMessage)(provider) };
}

export async function resolveProviderRequestKey(
	authStorage: AuthStorage,
	provider: string,
	modelsJsonApiKey: string | undefined,
	options?: { minRemainingMs?: number },
): Promise<ProviderRequestKey> {
	const stored = await authStorage.getApiKey(provider, {
		includeFallback: false,
		minRemainingMs: options?.minRemainingMs,
	});
	if (stored !== undefined) return { ok: true, apiKey: stored };

	const login = resolveUnresolvedOAuthLogin(authStorage, provider);
	if (login) return login;

	// A models.json provider key must not stand in for a stored credential whose store could not
	// be read: that substitution sent a stale environment token to the provider, and the 401
	// ("OAuth access token is invalid") survived re-running /login.
	if (authStorage.hasLoadError() || !modelsJsonApiKey) return { ok: true, apiKey: undefined };
	return { ok: true, apiKey: resolveConfigValueOrThrow(modelsJsonApiKey, `API key for provider "${provider}"`) };
}
