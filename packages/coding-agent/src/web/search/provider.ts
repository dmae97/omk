import { AnthropicProvider } from "./providers/anthropic";
import type { SearchProvider } from "./providers/base";
import { BraveProvider } from "./providers/brave";
import { CodexProvider } from "./providers/codex";
import { ExaProvider } from "./providers/exa";
import { GeminiProvider } from "./providers/gemini";
import { JinaProvider } from "./providers/jina";
import { PerplexityProvider } from "./providers/perplexity";
import { SyntheticProvider } from "./providers/synthetic";
import { ZaiProvider } from "./providers/zai";
import type { SearchProviderId } from "./types";

export type { SearchParams } from "./providers/base";
export { SearchProvider } from "./providers/base";

const SEARCH_PROVIDERS: Record<SearchProviderId, SearchProvider> = {
	exa: new ExaProvider(),
	brave: new BraveProvider(),
	jina: new JinaProvider(),
	perplexity: new PerplexityProvider(),
	zai: new ZaiProvider(),
	anthropic: new AnthropicProvider(),
	gemini: new GeminiProvider(),
	codex: new CodexProvider(),
	synthetic: new SyntheticProvider(),
} as const;

const SEARCH_PROVIDER_ORDER: SearchProviderId[] = [
	"exa",
	"brave",
	"jina",
	"perplexity",
	"anthropic",
	"gemini",
	"codex",
	"zai",
	"synthetic",
];

export function getSearchProvider(provider: SearchProviderId): SearchProvider {
	return SEARCH_PROVIDERS[provider];
}

/** Preferred provider set via settings (default: auto) */
let preferredProvId: SearchProviderId | "auto" = "auto";

/** Set the preferred web search provider from settings */
export function setPreferredSearchProvider(provider: SearchProviderId | "auto"): void {
	preferredProvId = provider;
}

/** Determine which providers are configured (priority: Exa → Brave → Jina → Perplexity → Anthropic → Gemini → Codex → Z.AI → Synthetic) */
export async function resolveProviderChain(
	preferredProvider: SearchProviderId | "auto" = preferredProvId,
): Promise<SearchProvider[]> {
	const providers: SearchProvider[] = [];

	if (preferredProvider !== "auto") {
		if (await getSearchProvider(preferredProvider).isAvailable()) {
			providers.push(getSearchProvider(preferredProvider));
		}
	}

	for (const id of SEARCH_PROVIDER_ORDER) {
		if (id === preferredProvider) continue;

		const provider = getSearchProvider(id);
		if (await provider.isAvailable()) {
			providers.push(provider);
		}
	}

	return providers;
}
