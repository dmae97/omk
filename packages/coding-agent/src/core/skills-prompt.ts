/**
 * 시스템 프롬프트에 넣는 스킬 목록 렌더링.
 * skills.ts의 로딩/검증과 분리해, 프롬프트 크기 정책을 한곳에서 다룬다.
 */
import type { Skill } from "./skills.ts";

/**
 * Format skills for inclusion in a system prompt.
 * Uses XML format per Agent Skills standard.
 * See: https://agentskills.io/integrate-skills
 *
 * Skills with disableModelInvocation=true are excluded from the prompt
 * (they can only be invoked explicitly via /skill:name commands).
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
	const visibleSkills = skills.filter((s) => !s.disableModelInvocation);
	// 스킬이 많으면 매 턴 시스템 프롬프트가 수만 토큰으로 커진다. 본문은 어차피 read로
	// 읽으니, 목록이 길 때만 설명을 첫 문장 위주로 줄여 매칭에 필요한 단서만 남긴다.
	const compact = visibleSkills.length > SKILL_PROMPT_COMPACT_THRESHOLD;

	if (visibleSkills.length === 0) {
		return "";
	}

	const lines = [
		"\n\nThe following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		...(compact ? ["Descriptions below are shortened; read the skill file for its full description."] : []),
		"",
		"<available_skills>",
	];

	for (const skill of visibleSkills) {
		const description = compact ? compactSkillDescription(skill.description) : skill.description;
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(description)}</description>`);
		lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
		lines.push("  </skill>");
	}

	lines.push("</available_skills>");

	return lines.join("\n");
}

/** 이 개수를 넘는 스킬 목록부터 설명을 줄인다. 그 이하는 기존 출력과 같다. */
export const SKILL_PROMPT_COMPACT_THRESHOLD = 24;
const COMPACT_DESCRIPTION_MAX_CHARS = 160;

/** 첫 문장을 남기고, 그래도 길면 단어 경계에서 잘라 말줄임표를 붙인다. */
export function compactSkillDescription(description: string, maxChars = COMPACT_DESCRIPTION_MAX_CHARS): string {
	const text = description.replace(/\s+/g, " ").trim();
	const sentenceEnd = text.search(/[.!?。](\s|$)/);
	const firstSentence = sentenceEnd >= 0 ? text.slice(0, sentenceEnd + 1) : text;
	if (firstSentence.length <= maxChars) {
		return firstSentence;
	}
	const cut = firstSentence.slice(0, maxChars - 1);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
