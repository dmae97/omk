/**
 * Capability-clause relevance for skill selection.
 *
 * `scoreSkillRelevance` divides matched weight by every token of the request, so a request
 * that needs several capabilities ("fix the layout, add pytest tests, review the compose
 * file") dilutes each skill below the grant threshold, and so does a long structured prompt.
 * This module splits the request into clauses and scores a skill against each clause as if
 * that clause were the whole request. The per-token match weights are computed once per
 * skill and reused for the whole-request score and every clause.
 *
 * A short clause saturates on one name token (weight 3 over two or three tokens), so a clause
 * only counts when it has {@link MIN_CLAUSE_TOKENS} tokens and the skill matches at least
 * {@link MIN_CLAUSE_MATCHES} of them; otherwise its score is 0 and only `whole` applies.
 *
 * Parity: `whole` equals `scoreSkillRelevance(skill, task)` and a counted clause score equals
 * `scoreSkillRelevance(skill, clause.text)`; `test/skill-selector-clauses.test.ts` pins both.
 * I/O-free.
 */
import { tokenizeForRelevance } from "./context-budget-relevance.ts";
import { fuzzyTokenWeight } from "./context-budget-token-similarity.ts";

/** Clauses considered per request; later clauses of a longer request only count toward `whole`. */
export const MAX_TASK_CLAUSES = 12;
/** A fragment needs this many relevance tokens to stand as a capability clause. */
export const MIN_CLAUSE_TOKENS = 3;
/** Distinct clause tokens a skill must match before the clause score counts. */
export const MIN_CLAUSE_MATCHES = 2;
const NAME_TOKEN_WEIGHT = 3;
const NAME_MATCH_BONUS = 0.2;
const NEUTRAL_SCORE = 0.3;
const CLAUSE_BOUNDARY = /[\r\n]+|[.!?;:]+(?=\s|$)|,\s+|\s+(?:and|then|also|plus)\s+|\s+(?:그리고|및|또한)\s+|[。；]/giu;
// An expanded `/skill:` block is host markup (tag, location path, body), not the user's request: its
// short lines would match every `skill-*` name. It still counts toward `whole`, as before clauses.
const SKILL_BLOCK = /<skill name="[^"]*" location="[^"]*">\n[\s\S]*?\n<\/skill>/gu;

export interface TaskClause {
	readonly text: string;
	readonly tokens: readonly string[];
}

/** Distinct clauses of a request in source order; fragments under {@link MIN_CLAUSE_TOKENS} are dropped. */
export function splitTaskClauses(task: string): TaskClause[] {
	const clauses: TaskClause[] = [];
	const seen = new Set<string>();
	for (const fragment of task.replace(SKILL_BLOCK, "\n").split(CLAUSE_BOUNDARY)) {
		const text = fragment
			.replace(/^[\s#>*-]+/u, "")
			.replace(/^(?:and|then|also|plus|그리고|및|또한)\s+/iu, "")
			.trim();
		const tokens = tokenizeForRelevance(text);
		const key = tokens.join(" ");
		if (tokens.length < MIN_CLAUSE_TOKENS || seen.has(key)) continue;
		seen.add(key);
		clauses.push({ text, tokens });
		if (clauses.length === MAX_TASK_CLAUSES) break;
	}
	return clauses;
}

interface SkillTokens {
	readonly name: string;
	readonly description: string;
	readonly tokens: Set<string>;
	readonly weights: Map<string, number>;
}

const skillTokenCache = new WeakMap<object, SkillTokens>();

/** Description tokens weigh 1 and name tokens 3, as in `scoreSkillRelevance`. Cached per skill object. */
function skillTokens(skill: { readonly name: string; readonly description: string }): SkillTokens {
	const cached = skillTokenCache.get(skill);
	if (cached?.name === skill.name && cached.description === skill.description) return cached;
	const tokens = new Set<string>();
	const weights = new Map<string, number>();
	for (const token of tokenizeForRelevance(skill.description)) {
		tokens.add(token);
		weights.set(token, 1);
	}
	for (const token of tokenizeForRelevance(skill.name)) {
		tokens.add(token);
		weights.set(token, NAME_TOKEN_WEIGHT);
	}
	const built = { name: skill.name, description: skill.description, tokens, weights };
	skillTokenCache.set(skill, built);
	return built;
}

export interface ClauseScores {
	/** Relevance against the whole request. */
	readonly whole: number;
	/** Relevance against each clause, index-aligned with the clause list. */
	readonly clauses: readonly number[];
	/**
	 * Distinct clause tokens the skill matched, index-aligned. Breaks ties between clause scores
	 * that saturate at 1 (a name token weighs 3), so the skill matching more of the clause wins.
	 */
	readonly clauseMatches: readonly number[];
}

/** Whole-request and per-clause relevance of one skill from a single pass over the request tokens. */
export function scoreSkillByClauses(
	skill: { readonly name: string; readonly description: string },
	task: string,
	clauses: readonly TaskClause[],
): ClauseScores {
	const item = skillTokens(skill);
	const nameLower = skill.name.toLowerCase();
	const matched = new Map<string, number>();
	const weightOf = (token: string): number => {
		let weight = matched.get(token);
		if (weight === undefined) {
			weight = item.tokens.has(token)
				? (item.weights.get(token) ?? 1)
				: fuzzyTokenWeight(token, item.tokens, item.weights);
			matched.set(token, weight);
		}
		return weight;
	};
	const score = (text: string, tokens: readonly string[], minMatches: number): readonly [number, number] => {
		if (tokens.length === 0) return [NEUTRAL_SCORE, 0];
		let sum = 0;
		let matches = 0;
		for (const token of tokens) {
			const weight = weightOf(token);
			sum += weight;
			if (weight > 0) matches += 1;
		}
		if (matches < minMatches) return [0, matches];
		const coverage = Math.min(1, sum / tokens.length);
		const lower = text.toLowerCase();
		const named = lower.includes(nameLower) || nameLower.includes(lower.trim());
		return [Math.max(0, Math.min(1, named ? coverage + NAME_MATCH_BONUS : coverage)), matches];
	};
	const perClause = clauses.map((clause) => score(clause.text, clause.tokens, MIN_CLAUSE_MATCHES));
	return {
		whole: score(task, tokenizeForRelevance(task), 0)[0],
		clauses: perClause.map(([value]) => value),
		clauseMatches: perClause.map(([, matches]) => matches),
	};
}
