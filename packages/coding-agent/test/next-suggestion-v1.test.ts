import { describe, expect, it } from "vitest";
import { SUGGESTION_INSTRUCTION, SUGGESTION_MAX_TOKENS } from "../src/core/next-suggestion.ts";
import { composeSuggestion } from "../src/modes/interactive/next-suggestion-run.ts";
import type { SuggestionSessionPort } from "../src/modes/interactive/next-suggestion-types.ts";

const session: SuggestionSessionPort = {
	agent: {
		streamFn: () => {
			throw new Error("composition must not call a provider");
		},
		state: { messages: [] },
	},
	model: { provider: "faux", id: "test" },
	subscribe: () => () => {},
};

function compose(modelText?: string, canSend = true) {
	return composeSuggestion({ session, canSend, outcome: "completed", modelText, env: { LANG: "en_US.UTF-8" } });
}

describe("suggestion v1 rollback", () => {
	it("requests one sentence within the original output budget", () => {
		expect(SUGGESTION_INSTRUCTION).toContain("one sentence only");
		expect(SUGGESTION_INSTRUCTION).not.toContain("3 to 5");
		expect(SUGGESTION_MAX_TOKENS).toBe(128);
	});

	it("displays only the model request without host context, scope or completion rules", () => {
		expect(compose("Run the uploader tests next.")).toEqual({
			title: "Run the uploader tests next.",
			prompt: "Run the uploader tests next.",
			task: "Run the uploader tests next.",
			source: "generated",
		});
	});

	it("does not invent a startup, failure or missing-model suggestion", () => {
		expect(compose()).toBeUndefined();
		expect(compose("  ")).toBeUndefined();
		expect(compose("x".repeat(201))).toBeUndefined();
		expect(compose("Run tests next.", false)).toBeUndefined();
		expect(composeSuggestion({ session, canSend: true, outcome: "failed", generation: "error" })).toBeUndefined();
	});
});
