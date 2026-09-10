import { getProviders } from "omk-ai";
import { BUILT_IN_PROVIDER_DISPLAY_NAMES } from "../../core/provider-display-names.ts";

const BUILT_IN_MODEL_PROVIDERS = new Set<string>(getProviders());

/**
 * Resolve a `/login <provider>` argument to a login option.
 *
 * Matches (in order): exact provider id (case-insensitive), display-name
 * substring (case-insensitive), then unambiguous prefix match on id.
 * Returns undefined when nothing matches, or when a display-name/prefix
 * match is ambiguous.
 */
export function resolveLoginProviderArg(
	arg: string,
	options: ReadonlyArray<{ id: string; name: string; authType: "oauth" | "api_key" }>,
): { id: string; name: string; authType: "oauth" | "api_key" } | undefined {
	const query = arg.trim().toLowerCase();
	if (!query) return undefined;
	const exactMatches = options.filter((option) => option.id.toLowerCase() === query);
	// Prefer the oauth (subscription) entry when a provider id appears in both
	// lists (e.g. meta: "Muse Code (subscription)" oauth + Model API key).
	if (exactMatches.length > 0) {
		return exactMatches.find((option) => option.authType === "oauth") ?? exactMatches[0];
	}
	const byName = options.filter((option) => option.name.toLowerCase().includes(query));
	if (byName.length === 1) return byName[0];
	if (byName.length > 1) return undefined;
	const byPrefix = options.filter((option) => option.id.toLowerCase().startsWith(query));
	return byPrefix.length === 1 ? byPrefix[0] : undefined;
}

/**
 * Display name for the API-key login row when the provider id is shared
 * with an oauth entry. `resolvedName` is what
 * `ModelRegistry.getProviderDisplayName()` returned (the oauth name wins
 * there), while `BUILT_IN_PROVIDER_DISPLAY_NAMES` holds the API-key-side
 * label (e.g. meta → "Meta Model API").
 */
export function getApiKeyLoginDisplayName(providerId: string, resolvedName: string): string {
	const apiKeyName = BUILT_IN_PROVIDER_DISPLAY_NAMES[providerId];
	if (apiKeyName && apiKeyName !== resolvedName) return apiKeyName;
	if (resolvedName !== providerId) return `${resolvedName} (API key)`;
	return providerId;
}

export function isApiKeyLoginProvider(
	providerId: string,
	oauthProviderIds: ReadonlySet<string>,
	builtInProviderIds: ReadonlySet<string> = BUILT_IN_MODEL_PROVIDERS,
): boolean {
	if (BUILT_IN_PROVIDER_DISPLAY_NAMES[providerId]) {
		return true;
	}
	if (builtInProviderIds.has(providerId)) {
		return false;
	}
	return !oauthProviderIds.has(providerId);
}
