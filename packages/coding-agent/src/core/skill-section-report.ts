import { parseBangInvocation } from "./bang-skill-invocation.ts";
import { SKILL_SEARCH_MAX_QUERY } from "./skill-search-mode.ts";
import type { SkillSectionSelection } from "./skill-section-selection.ts";
import type { Skill } from "./skills.ts";

export type SkillSectionLoadStatus =
	| "loaded"
	| "not_loaded"
	| "in_context"
	| "below_strong_threshold"
	| "unreadable"
	| "body_budget"
	| "admission_limit";

export interface SkillSectionReport extends SkillSectionSelection {
	readonly selected: readonly { name: string; score: number; status: SkillSectionLoadStatus }[];
	readonly loadFailure?: SkillSectionLoadStatus;
	readonly discovery?: {
		readonly query: string;
		readonly hub?: { name: string; location: string };
	};
}

/** Discovery is a metadata handoff, not an additional grant, body read or provider call. */
export function skillSectionReports(
	sections: readonly SkillSectionSelection[],
	skills: readonly Skill[],
	outcomes: ReadonlyMap<string, SkillSectionLoadStatus>,
): SkillSectionReport[] {
	const invocable = new Map(
		skills.filter((skill) => !skill.disableModelInvocation).map((skill) => [skill.name, skill]),
	);
	return sections.map((section) => {
		const selected = section.selected.map((skill) => ({
			...skill,
			status: outcomes.get(skill.name) ?? "not_loaded",
		}));
		const loadFailure = selected.find((skill) => skill.status !== "loaded" && skill.status !== "in_context")?.status;
		if (!section.missingReason && !loadFailure) return { ...section, selected };
		const query = section.query.slice(0, SKILL_SEARCH_MAX_QUERY);
		const route = parseBangInvocation(`!omk ${query}`, { hasSkill: (name) => invocable.has(name) });
		const hub = route.kind === "skill" ? invocable.get(route.skillName) : undefined;
		return {
			...section,
			selected,
			...(loadFailure ? { loadFailure } : {}),
			discovery: { query, ...(hub ? { hub: { name: hub.name, location: hub.filePath } } : {}) },
		};
	});
}

export function renderSkillSectionReports(sections: readonly SkillSectionReport[], searchAvailable: boolean): string {
	const lines = ["Skill selection by request section (diagnostics only; no additional grants):"];
	for (const section of sections) {
		const selected = section.selected.map((skill) => `${JSON.stringify(skill.name)} [${skill.status}]`).join(", ");
		const reason = section.loadFailure ?? section.missingReason;
		lines.push(`- ${JSON.stringify(section.section)}: ${selected || "none"}${reason ? `; reason=${reason}` : ""}`);
		if (!section.discovery) continue;
		const { hub, query } = section.discovery;
		if (hub) lines.push(`  Hub discovery: read ${JSON.stringify(hub.location)} (${JSON.stringify(hub.name)}).`);
		lines.push(
			searchAvailable
				? `  Specialist discovery: skill_search with query=${JSON.stringify(query)}.`
				: `  Specialist discovery: use the available skill inventory for ${JSON.stringify(query)}.`,
		);
	}
	lines.push(
		"Discovery does not load instructions. Read a matching specialist before applying it; normal admission limits still apply.",
	);
	return lines.join("\n");
}
