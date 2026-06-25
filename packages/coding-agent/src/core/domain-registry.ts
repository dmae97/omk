import { DOMAIN_PROFILES } from "./domain-loadouts.ts";
import { compileDomains } from "./domain-score.ts";

/** Compile the whole registry once at module load (pure, no I/O). */
export const COMPILED_DOMAIN_REGISTRY = compileDomains(Object.values(DOMAIN_PROFILES));

export function inspectDomainRegistry(): readonly { id: string; triggerCount: number }[] {
	return COMPILED_DOMAIN_REGISTRY.map((domain) => ({
		id: domain.profile.id,
		triggerCount: domain.triggers.length,
	}));
}
