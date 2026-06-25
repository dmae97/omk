import { type CompiledTrigger, compileTrigger, describeTrigger } from "./domain-trigger-match.ts";
import type { DomainProfile, DomainScore } from "./domain-types.ts";

export type { CompiledTrigger } from "./domain-trigger-match.ts";

export interface CompiledDomain {
	readonly profile: DomainProfile;
	readonly triggers: readonly CompiledTrigger[];
	readonly registryIndex: number;
}

export function compileDomain(profile: DomainProfile, registryIndex = 0): CompiledDomain {
	return { profile, triggers: profile.triggers.map(compileTrigger), registryIndex };
}

export function compileDomains(profiles: readonly DomainProfile[]): readonly CompiledDomain[] {
	return profiles.map((profile, index) => compileDomain(profile, index));
}

export function scoreDomain(domain: CompiledDomain, text: string, paths: readonly string[]): DomainScore {
	const lowerText = text.toLowerCase();
	const lowerPaths = paths.map((path) => path.toLowerCase());
	let score = 0;
	const matchedSignals: string[] = [];

	for (const trigger of domain.triggers) {
		const { spec } = trigger;
		let contribution = 0;
		if (spec.kind === "keyword" || spec.kind === "regex") {
			const count = trigger.textMatcher ? trigger.textMatcher(lowerText) : 0;
			contribution = count > 0 ? spec.weight * count : 0;
		} else if (spec.kind === "extension") {
			const extension = spec.pattern.toLowerCase();
			if (lowerPaths.some((path) => path.endsWith(extension))) contribution = spec.weight;
		} else if (spec.kind === "path") {
			const fragment = spec.pattern.toLowerCase();
			if (lowerPaths.some((path) => path.includes(fragment))) contribution = spec.weight;
		}

		if (contribution > 0) {
			score += contribution;
			matchedSignals.push(`${describeTrigger(spec)} +${contribution}`);
		}
	}

	return { id: domain.profile.id, label: domain.profile.label, score, matchedSignals };
}

export function scoreDomains(
	domains: readonly CompiledDomain[],
	text: string,
	paths: readonly string[],
): readonly DomainScore[] {
	return domains
		.map((domain) => ({ domain, score: scoreDomain(domain, text, paths) }))
		.filter((entry) => entry.score.score > 0)
		.sort((a, b) => {
			if (b.score.score !== a.score.score) return b.score.score - a.score.score;
			return a.domain.registryIndex - b.domain.registryIndex;
		})
		.map((entry) => entry.score);
}
