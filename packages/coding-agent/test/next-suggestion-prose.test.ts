import { describe, expect, it } from "vitest";
import { extractSuggestion, SUGGESTION_INSTRUCTION } from "../src/core/next-suggestion.ts";
import { collectSuggestionFacts } from "../src/core/next-suggestion-facts.ts";
import {
	buildSuggestion,
	isWellFormedSuggestionPrompt,
	renderSuggestionPrompt,
	sanitizeModelTask,
	suggestionSkillQuery,
} from "../src/core/next-suggestion-prompt.ts";

const request = "업로더 재시도를 추가해줘";
const facts = collectSuggestionFacts({
	messages: [
		{ role: "user", content: request },
		{ role: "assistant", content: "재시도를 추가했습니다." },
	],
	outcome: "completed",
});
const prose =
	"업로더의 재시도 간격을 설정할 수 있게 해줘. 기존 재시도 처리는 유지하고 설정값만 연결해줘. 기본값과 사용자 지정값의 동작을 테스트해줘. 변경 내용과 검사 결과를 알려줘.";

function sentences(text: string): string[] {
	return Array.from(new Intl.Segmenter("ko", { granularity: "sentence" }).segment(text), ({ segment }) =>
		segment.trim(),
	);
}

describe("legacy suggestion prose compatibility with v1 extraction", () => {
	it("requests only one short model sentence", () => {
		expect(SUGGESTION_INSTRUCTION).toContain("one sentence only");
		expect(SUGGESTION_INSTRUCTION).toContain("no tool calls");
	});

	it("extracts the first line while retaining legacy prose rendering for old requests", () => {
		const message = { stopReason: "stop", content: [{ type: "text", text: prose.replaceAll(". ", ".\n") }] };
		const extracted = extractSuggestion(message as Parameters<typeof extractSuggestion>[0]);
		expect(extracted).toBe(sentences(prose)[0]);
		const task = sanitizeModelTask(prose, facts);
		expect(task).toBe(prose);
		const suggestion = buildSuggestion(facts, task);
		expect(suggestion.title).toBe(sentences(prose)[0]);
		expect(renderSuggestionPrompt(suggestion)).toBe(sentences(prose).join("\n"));
		expect(isWellFormedSuggestionPrompt(prose)).toBe(true);
		expect(suggestionSkillQuery(prose)).toBe(prose);
	});

	it("accepts three and five sentences without adding a host checklist", () => {
		for (const count of [3, 5]) {
			const text = Array.from({ length: count }, (_, i) => `Implement the next uploader step ${i + 1}.`).join(" ");
			const rendered = renderSuggestionPrompt(buildSuggestion(facts, sanitizeModelTask(text, facts)));
			expect(rendered).toBe(sentences(text).join("\n"));
			expect(sentences(rendered)).toHaveLength(count);
		}
	});

	it("uses four actionable fallback sentences without the previous-answer audit", () => {
		const suggestion = buildSuggestion(facts);
		const text = renderSuggestionPrompt(suggestion);
		expect(text).not.toMatch(/미확인 사항 점검|요구사항을 항목별로|충족, 미충족|맥락:|범위:|완료 기준:/);
		expect(text).toContain("다음");
		expect(sentences(text)).toHaveLength(4);
		expect(isWellFormedSuggestionPrompt(text)).toBe(true);
	});

	it("rejects incomplete, overlong and out-of-range model prose", () => {
		for (const text of [
			"Do the next task. Keep the scope small.",
			Array.from({ length: 6 }, () => "Do the next task.").join(" "),
			"Do the next task. Keep the scope small. Report the result without finishing",
			`Do ${"x".repeat(1200)}. Keep the scope small. Report the result.`,
		]) {
			expect(sanitizeModelTask(text, facts)).toBeUndefined();
		}
	});

	it("restores the v1 200-character extraction cap", () => {
		const text =
			"Configure the uploader retry delay without replacing the existing upload handler. Preserve the default behavior when no custom retry delay is provided. Add focused tests for both the default delay and a custom delay. Report the commands you ran and the observed results.";
		expect(text.length).toBeGreaterThan(200);
		const message = { stopReason: "stop", content: [{ type: "text", text }] };
		const extracted = extractSuggestion(message as Parameters<typeof extractSuggestion>[0]);
		expect(extracted).toHaveLength(200);
		expect(extracted?.endsWith("…")).toBe(true);
	});
});
