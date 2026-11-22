import { splitTaskSections, type TaskClause } from "./skill-clause-relevance.ts";
import { SKILL_SEARCH_MAX_QUERY } from "./skill-search-mode.ts";

/** Report bounds; scoring keeps its own `MAX_TASK_CLAUSES` bound. */
export const MAX_REPORTED_SECTIONS = 16;
export const MAX_SECTION_HEADING_CHARS = 120;

export type SkillSectionMissingReason =
	| "insufficient_context"
	| "not_scored"
	| "no_match"
	| "below_strong_threshold"
	| "selection_limit"
	| "covered_elsewhere";

interface SectionSkill {
	readonly name: string;
	readonly score: number;
}

export interface SkillSectionSelection {
	readonly section: string;
	readonly query: string;
	/** Selector grants, not evidence of loaded or applied instructions. */
	readonly selected: readonly SectionSkill[];
	readonly candidates: readonly SectionSkill[];
	readonly missingReason?: SkillSectionMissingReason;
}

/** Diagnostics reuse the scores already computed by the selector; they never change grants. */
export function summarizeSkillSections(
	task: string,
	clauses: readonly TaskClause[],
	ranked: readonly { skill: { name: string }; clauseScores: readonly number[] }[],
	selected: readonly (SectionSkill & { section?: string })[],
	thresholds: { weak: number; strong: number; max: number },
): SkillSectionSelection[] {
	const grantedNames = new Set(selected.map((skill) => skill.name));
	const sections = splitTaskSections(task).slice(0, MAX_REPORTED_SECTIONS);
	return sections.map(({ section, query, hasCapability }) => {
		const indices = clauses.flatMap((clause, index) => (clause.section === section ? [index] : []));
		const matches = (indices.length > 0 ? ranked : [])
			.map((entry) => ({
				name: entry.skill.name,
				score: Math.max(0, ...indices.map((index) => entry.clauseScores[index] ?? 0)),
			}))
			.filter((entry) => entry.score >= thresholds.weak)
			.sort((a, b) => b.score - a.score);
		const grants = selected.filter((skill) => skill.section === section).map(({ name, score }) => ({ name, score }));
		let missingReason: SkillSectionMissingReason | undefined;
		if (grants.some((skill) => skill.score >= thresholds.strong)) missingReason = undefined;
		else if (!hasCapability) missingReason = "insufficient_context";
		else if (indices.length === 0) missingReason = "not_scored";
		else if (matches.length === 0) missingReason = "no_match";
		else if (!matches.some((skill) => skill.score >= thresholds.strong)) missingReason = "below_strong_threshold";
		else if (matches.some((skill) => skill.score >= thresholds.strong && grantedNames.has(skill.name)))
			missingReason = "covered_elsewhere";
		else missingReason = "selection_limit";
		return {
			section: section.slice(0, MAX_SECTION_HEADING_CHARS),
			query: query.slice(0, SKILL_SEARCH_MAX_QUERY),
			selected: grants,
			candidates: matches.slice(0, thresholds.max),
			...(missingReason ? { missingReason } : {}),
		};
	});
}
