import { describe, expect, it } from "vitest";
import { isPrefixSuggestionsEnabled, projectSuggestion } from "../src/modes/interactive/next-suggestion-prefix.ts";

const end = (text: string) => {
	const lines = text.split("\n");
	return { line: lines.length - 1, col: (lines.at(-1) ?? "").length };
};

describe("next suggestion prefix projection", () => {
	it("is a separate default-off experiment", () => {
		expect(isPrefixSuggestionsEnabled({})).toBe(false);
		expect(isPrefixSuggestionsEnabled({ OMK_NEXT_SUGGESTIONS_PREFIX: "0" })).toBe(false);
		expect(isPrefixSuggestionsEnabled({ OMK_NEXT_SUGGESTIONS_PREFIX: "on" })).toBe(true);
	});

	it("projects an empty editor and an exact-prefix inline suffix", () => {
		expect(projectSuggestion("Run the tests", { text: "", cursor: end("") })).toEqual({
			kind: "empty-editor",
			text: "Run the tests",
		});
		expect(projectSuggestion("Run the tests", { text: "Run", cursor: end("Run") })).toEqual({
			kind: "inline-suffix",
			text: " the tests",
		});
	});

	it("rejects a mismatch, a complete candidate, a missing cursor, and a mid-document cursor", () => {
		expect(projectSuggestion("Run the tests", { text: "Walk", cursor: end("Walk") }).kind).toBe("none");
		expect(projectSuggestion("Run the tests", { text: "Run the tests", cursor: end("Run the tests") }).kind).toBe(
			"none",
		);
		expect(projectSuggestion("Run", { text: "R" }).kind).toBe("none");
		expect(projectSuggestion("Run the tests", { text: "Run now", cursor: { line: 0, col: 2 } }).kind).toBe("none");
	});

	it("preserves exact unicode input boundaries and does not normalize Korean text", () => {
		const candidate = "😀 한글 테스트";
		const prefix = "😀 한";
		expect(projectSuggestion(candidate, { text: prefix, cursor: end(prefix) })).toEqual({
			kind: "inline-suffix",
			text: "글 테스트",
		});
		const decomposed = "한가";
		expect(projectSuggestion("한가 테스트", { text: decomposed, cursor: end(decomposed) }).kind).toBe("none");
	});
});
