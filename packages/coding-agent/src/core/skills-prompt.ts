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
	// 읽으니, 목록이 길 때만 설명을 "무엇을"과 "언제" 두 문장으로 줄여 매칭 단서만 남긴다.
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
const COMPACT_DESCRIPTION_MAX_CHARS = 200;

/** 문장 끝으로 보지 않을 약어(소문자 비교). `e.g.`에서 설명이 잘려 단서가 빠지는 걸 막는다. */
const ABBREVIATIONS = new Set([
	"e.g.",
	"i.e.",
	"etc.",
	"vs.",
	"cf.",
	"approx.",
	"incl.",
	"no.",
	"mr.",
	"mrs.",
	"ms.",
	"dr.",
	"st.",
	"jr.",
	"u.s.",
	"u.k.",
]);
/** 스킬 설명에서 언제 쓰는지 알려 주는 문장. 매칭의 핵심 단서라 첫 문장보다 우선한다. */
const TRIGGER_SENTENCE = /^(use|invoke|apply|run|call)\b|^(when|before|after)\b/i;
const MIN_LEAD_CHARS = 72;

/** 마침표 뒤 공백에서 문장을 나누되, 약어나 `v1.2` 같은 소수점에서는 나누지 않는다. */
export function splitSentences(text: string): string[] {
	const sentences: string[] = [];
	let start = 0;
	for (const match of text.matchAll(/[.!?。](?=\s|$)/g)) {
		const end = (match.index ?? 0) + 1;
		const lastWord = text.slice(start, end).split(/\s+/).pop()?.toLowerCase() ?? "";
		if (ABBREVIATIONS.has(lastWord)) {
			continue;
		}
		sentences.push(text.slice(start, end).trim());
		start = end;
	}
	const rest = text.slice(start).trim();
	if (rest) {
		sentences.push(rest);
	}
	return sentences.filter(Boolean);
}

function truncateAtWord(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	const cut = text.slice(0, maxChars - 1);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * 첫 문장(무엇을 하는지)과 첫 트리거 문장(언제 쓰는지)을 남긴다.
 * 둘이 길면 첫 문장은 최소 몫까지만 줄이고 나머지 길이를 트리거 문장에 준다.
 */
export function compactSkillDescription(description: string, maxChars = COMPACT_DESCRIPTION_MAX_CHARS): string {
	const sentences = splitSentences(description.replace(/\s+/g, " ").trim());
	const lead = sentences[0] ?? "";
	const trigger = sentences.slice(1).find((sentence) => TRIGGER_SENTENCE.test(sentence));
	if (!trigger) {
		return truncateAtWord(lead, maxChars);
	}
	const combined = `${lead} ${trigger}`;
	if (combined.length <= maxChars) {
		return combined;
	}
	// 첫 문장에는 최소 몫만 보장하고 나머지를 트리거 문장에 준다.
	// maxChars가 작으면 최소 몫도 절반까지만 줘서 합친 길이가 상한을 넘지 않게 한다.
	const minLead = Math.min(MIN_LEAD_CHARS, Math.floor(maxChars / 2));
	const leadCap = Math.min(lead.length, Math.max(minLead, maxChars - trigger.length - 1));
	const leadPart = truncateAtWord(lead, leadCap);
	const triggerBudget = maxChars - leadPart.length - 1;
	if (triggerBudget < 2) {
		return truncateAtWord(lead, maxChars);
	}
	return `${leadPart} ${truncateAtWord(trigger, triggerBudget)}`;
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
