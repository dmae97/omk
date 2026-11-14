/**
 * Context-aware ranking for the per-prompt `<relevant_skills>` list.
 *
 * A prompt with its own skill signal is ranked by itself only, so a topic switch never keeps the previous
 * topic's skills. When the prompt alone carries no signal (a short follow-up such as "fix it" or "이어서 해줘",
 * best score under the selector's weak floor), the most recent earlier user prompts rank the skills too,
 * each decayed by its distance, so the follow-up keeps the skills of the task it continues.
 */
import { scoreSkillRelevance, tokenizeForRelevance } from "./context-budget-relevance.ts";
import { extractUserMessageText } from "./session-message-text.ts";
import { SKILL_WEAK_THRESHOLD } from "./skill-selector.ts";
import type { Skill } from "./skills.ts";

/** Earlier user prompts consulted for a follow-up, newest first. */
export const SKILL_CONTEXT_PROMPTS = 2;
/** Score multiplier per prompt of distance: the previous prompt counts 0.8, the one before 0.64. */
export const SKILL_CONTEXT_DECAY = 0.8;
/**
 * Scoring cost grows with query tokens times catalog size (~20 ms per token over 1,500 skills; two full
 * 2000-char prompts took ~10 s), so each earlier prompt is reduced to its first distinct non-stop-word tokens.
 */
const CONTEXT_TOKENS = 8;
const PROMPT_CHARS = 2000;

export interface HistoryMessage {
	readonly role: string;
	readonly content?: unknown;
}

/** The last `limit` non-empty user messages as scoring queries (first {@link CONTEXT_TOKENS} tokens), newest first. */
export function recentUserPrompts(history: readonly HistoryMessage[], limit = SKILL_CONTEXT_PROMPTS): string[] {
	const prompts: string[] = [];
	for (let i = history.length - 1; i >= 0 && prompts.length < limit; i--) {
		const { role, content } = history[i] ?? { role: "" };
		if (role !== "user" || (typeof content !== "string" && !Array.isArray(content))) continue;
		const tokens = tokenizeForRelevance(extractUserMessageText(content).slice(0, PROMPT_CHARS));
		if (tokens.length > 0) prompts.push(tokens.slice(0, CONTEXT_TOKENS).join(" "));
	}
	return prompts;
}

export function rankRelevantSkills(
	skills: readonly Skill[],
	query: string,
	activeNames: readonly string[],
	recentPrompts: readonly string[],
	limit: number,
): Skill[] {
	if (query.trim() === "") return [];
	const active = new Set(activeNames);
	const scored = skills
		.filter((skill) => !skill.disableModelInvocation && !active.has(skill.name))
		.map((skill, index) => ({ skill, index, score: scoreSkillRelevance(skill, query) }));
	if (recentPrompts.length > 0 && scored.every((entry) => entry.score < SKILL_WEAK_THRESHOLD)) {
		for (const entry of scored) {
			for (const [distance, prompt] of recentPrompts.entries()) {
				const decayed = SKILL_CONTEXT_DECAY ** (distance + 1) * scoreSkillRelevance(entry.skill, prompt);
				if (decayed > entry.score) entry.score = decayed;
			}
		}
	}
	return scored
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.slice(0, limit)
		.map((entry) => entry.skill);
}
