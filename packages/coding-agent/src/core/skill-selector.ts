/**
 * Query-aware skill grant selection.
 *
 * Scores candidates with {@link scoreSkillRelevance}, then applies the same
 * ranking/confidence shape as domain routing: weak/strong thresholds, a 2–3
 * skill cap, input-order ties, and an ambiguity flag when a tentative leader
 * is within the documented margin of the runner-up.
 *
 * A request with several capability clauses is also scored clause by clause
 * (`skill-clause-relevance.ts`): a skill counts with its best clause, and the grant
 * takes one skill per clause before a second skill for a clause it already covers.
 * Exploration and grant stay separate: `candidates` lists every skill above the weak
 * floor with the clause it matched, while `selected` keeps the 2–3 cap.
 *
 * I/O-free. Callers still decide whether to mark the result active.
 */
import { scoreSkillRelevance } from "./context-budget-relevance.ts";
import { scoreSkillByClauses, splitTaskClauses } from "./skill-clause-relevance.ts";

/** Documented lane grant cap: load at most 2–3 skills. */
export const MAX_SELECTED_SKILLS = 3;
/** Coverage at/above which a skill is a confident match. */
export const SKILL_STRONG_THRESHOLD = 0.7;
/**
 * Minimum score to grant a skill. Neutral (no-query) relevance is 0.3, so the
 * weak floor sits above that and ignores idle overlap.
 */
export const SKILL_WEAK_THRESHOLD = 0.35;
/** If the runner-up is within this margin of a tentative leader, flag ambiguous. */
export const SKILL_AMBIGUITY_MARGIN = 0.08;

type SkillConfidence = "confident" | "tentative" | "fallback";

export interface SkillCandidate {
	readonly name: string;
	readonly description: string;
}

interface SkillScore {
	readonly name: string;
	readonly score: number;
}

interface SelectedSkill extends SkillScore {
	readonly description: string;
	/** The request clause this skill was granted for; absent when the whole request or a path matched. */
	readonly covers?: string;
}

/** One explored skill above the weak floor, granted or not. */
export interface SkillCandidateMatch extends SkillScore {
	readonly covers?: string;
	readonly selected: boolean;
	/** Granted skill that already covers the same clause; such a candidate is not granted. */
	readonly redundantWith?: string;
}

export interface SelectSkillsInput {
	readonly task: string;
	readonly skills: readonly SkillCandidate[];
	readonly max?: number;
	/** Path segments become independent, camelCase-aware skill-name signals. */
	readonly paths?: readonly string[];
}

export interface SkillSelectionResult {
	readonly selected: readonly SelectedSkill[];
	readonly scores: readonly SkillScore[];
	/** Every skill above the weak floor in rank order: the explored set, wider than `selected`. */
	readonly candidates: readonly SkillCandidateMatch[];
	readonly confidence: SkillConfidence;
	readonly ambiguous: boolean;
	readonly reason: string;
}

export function selectSkills(input: SelectSkillsInput): SkillSelectionResult {
	const task = input.task.trim();
	const pathTokens = pathHintTokens(input.paths);
	const max = resolveMax(input.max);
	const skills = uniqueSkills(input.skills);
	if ((task === "" && pathTokens.length === 0) || skills.length === 0) {
		return fallback([], "no skill signals detected");
	}

	// A single clause is the whole request: clause scoring would add nothing to it.
	const found = task === "" ? [] : splitTaskClauses(task);
	const clauses = found.length >= 2 ? found : [];
	const ranked = skills
		.map((skill, index) => {
			const byClause = task === "" ? undefined : scoreSkillByClauses(skill, task, clauses);
			let score = byClause?.whole ?? 0;
			let clause = -1;
			let matches = 0;
			for (const [clauseIndex, clauseScore] of (byClause?.clauses ?? []).entries()) {
				const clauseMatches = byClause?.clauseMatches[clauseIndex] ?? 0;
				if (clauseScore > score || (clause >= 0 && clauseScore === score && clauseMatches > matches)) {
					score = clauseScore;
					clause = clauseIndex;
					matches = clauseMatches;
				}
			}
			const pathIdentity = { name: skill.name, description: "" };
			for (const token of pathTokens) {
				const pathScore = scoreSkillRelevance(pathIdentity, token);
				if (pathScore > score) {
					score = pathScore;
					clause = -1;
					matches = 0;
				}
			}
			return { skill, index, score, clause, matches };
		})
		.sort((left, right) => {
			if (right.score !== left.score) return right.score - left.score;
			// Only clause matches carry a count, so single-clause requests keep input-order ties.
			if (right.matches !== left.matches) return right.matches - left.matches;
			return left.index - right.index;
		});

	const scores: SkillScore[] = ranked.map((entry) => ({ name: entry.skill.name, score: entry.score }));
	const aboveWeak = ranked.filter((entry) => entry.score >= SKILL_WEAK_THRESHOLD);
	if (aboveWeak.length === 0) {
		return fallback(scores, "no skill signals detected");
	}

	const leader = aboveWeak[0];
	if (!leader) {
		return fallback(scores, "no skill signals detected");
	}
	// One skill per clause first; whole-request and path matches keep their rank-order slots.
	const coveredBy = new Map<number, string>();
	const selected: SelectedSkill[] = [];
	const candidates: SkillCandidateMatch[] = [];
	for (const entry of aboveWeak) {
		const covers = entry.clause >= 0 ? clauses[entry.clause]?.text : undefined;
		const redundantWith = entry.clause >= 0 ? coveredBy.get(entry.clause) : undefined;
		const take = redundantWith === undefined && selected.length < max;
		const match = { name: entry.skill.name, score: entry.score, ...(covers ? { covers } : {}) };
		if (take) {
			selected.push({ ...match, description: entry.skill.description });
			if (entry.clause >= 0) coveredBy.set(entry.clause, entry.skill.name);
		}
		candidates.push({ ...match, selected: take, ...(redundantWith ? { redundantWith } : {}) });
	}
	const runner = aboveWeak[1];
	const confidence: SkillConfidence = leader.score >= SKILL_STRONG_THRESHOLD ? "confident" : "tentative";
	const ambiguous =
		confidence === "tentative" && runner !== undefined && leader.score - runner.score <= SKILL_AMBIGUITY_MARGIN;
	const reason =
		ambiguous && runner
			? `ambiguous: ${leader.skill.name}(${formatScore(leader.score)}) vs ${runner.skill.name}(${formatScore(runner.score)})`
			: `${leader.skill.name} selected (${formatScore(leader.score)})`;

	return { selected, scores, candidates, confidence, ambiguous, reason };
}

function fallback(scores: readonly SkillScore[], reason: string): SkillSelectionResult {
	return { selected: [], scores, candidates: [], confidence: "fallback", ambiguous: false, reason };
}

function formatScore(score: number): string {
	return score.toFixed(2);
}

function resolveMax(max: number | undefined): number {
	if (max === undefined || !Number.isFinite(max) || max < 0) return MAX_SELECTED_SKILLS;
	return Math.min(Math.floor(max), MAX_SELECTED_SKILLS);
}

function uniqueSkills(skills: readonly SkillCandidate[]): SkillCandidate[] {
	const seen = new Set<string>();
	const unique: SkillCandidate[] = [];
	for (const skill of skills) {
		if (seen.has(skill.name)) continue;
		seen.add(skill.name);
		unique.push(skill);
	}
	return unique;
}

function pathHintTokens(paths: readonly string[] | undefined): string[] {
	if (!paths || paths.length === 0) return [];
	const tokens = new Set<string>();
	for (const path of paths) {
		const splitCase = path.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
		for (const raw of splitCase.toLowerCase().split(/[/\\._\s-]+/)) {
			if (raw.length > 0) tokens.add(raw);
		}
	}
	return [...tokens];
}
