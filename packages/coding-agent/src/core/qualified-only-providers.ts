import type { Api, Model } from "omk-ai";

/**
 * Providers whose models resolve only by their full `provider/id` reference (e.g. `OMK/coder`). Their ids never match
 * as a bare id or a fuzzy substring when a pattern is resolved across several providers, so adding such a provider
 * cannot change what short patterns like `coder` resolve to. Empty unless a provider opts in, so the resolver's
 * behavior is unchanged by default.
 */
const qualifiedOnly = new Set<string>();

export function markQualifiedOnlyProvider(provider: string): void {
	qualifiedOnly.add(provider);
}

export function resetQualifiedOnlyProviders(): void {
	qualifiedOnly.clear();
}

/**
 * The models a bare-id or fuzzy match may consider. Returns `models` itself (same array) when nothing is marked, or
 * when the list is already scoped to a single provider (`--provider OMK --model coder`).
 */
export function bareMatchCandidates(models: Model<Api>[]): Model<Api>[] {
	if (qualifiedOnly.size === 0 || new Set(models.map((model) => model.provider)).size < 2) return models;
	return models.filter((model) => !qualifiedOnly.has(model.provider));
}
