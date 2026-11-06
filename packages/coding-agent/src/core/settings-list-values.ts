const MAX_DEFAULT_ACTIVE_SKILLS = 64;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function parseDefaultActiveSkills(value: unknown): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_DEFAULT_ACTIVE_SKILLS) {
		throw new Error(`defaultActiveSkills must be an array of at most ${MAX_DEFAULT_ACTIVE_SKILLS} skill names`);
	}
	const names: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string" || item.length > 64 || !SKILL_NAME_PATTERN.test(item)) {
			throw new Error("defaultActiveSkills entries must be valid skill names");
		}
		if (!seen.has(item)) {
			seen.add(item);
			names.push(item);
		}
	}
	return names;
}

export function parseSubscriptionUsageProviders(value: unknown): readonly string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((provider) => typeof provider !== "string" || !provider.trim())) {
		throw new Error("subscriptionUsageProviders must be an array of non-empty provider IDs");
	}
	return value.slice();
}
