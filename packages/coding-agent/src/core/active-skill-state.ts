export interface ActiveSkillState {
	readonly names: readonly string[];
	readonly source: string | undefined;
}

export function createActiveSkillState(
	defaultNames: readonly string[],
	promptNames: readonly string[],
	promptSource: string | undefined,
): ActiveSkillState {
	return {
		names: mergeNames(defaultNames, promptNames),
		source: defaultNames.length > 0 ? mergeSources("settings", promptSource) : promptSource,
	};
}

export function addActiveSkills(state: ActiveSkillState, names: readonly string[], source: string): ActiveSkillState {
	if (names.length === 0) return state;
	return {
		names: mergeNames(state.names, names),
		source: mergeSources(state.source, source),
	};
}

function mergeNames(first: readonly string[], second: readonly string[]): string[] {
	return [...new Set([...first, ...second])];
}

function mergeSources(first: string | undefined, second: string | undefined): string | undefined {
	const sources = [first, second]
		.flatMap((source) => source?.split("+") ?? [])
		.map((source) => source.trim())
		.filter((source) => source !== "");
	return sources.length > 0 ? [...new Set(sources)].join("+") : undefined;
}
