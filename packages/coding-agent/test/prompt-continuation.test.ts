import { describe, expect, it } from "vitest";
import { continuationPromptOptions, isPromptContinuation } from "../src/core/prompt-continuation.ts";
import type { PromptOptions } from "../src/core/prompt-options.ts";

describe("isPromptContinuation", () => {
	it("returns false for undefined", () => {
		expect(isPromptContinuation(undefined)).toBe(false);
	});

	it("returns false for a plain options object", () => {
		const options: PromptOptions = { expandPromptTemplates: false };
		expect(isPromptContinuation(options)).toBe(false);
	});

	it("returns true for options marked by continuationPromptOptions", () => {
		const options: PromptOptions = { expandPromptTemplates: false };
		expect(isPromptContinuation(continuationPromptOptions(options))).toBe(true);
	});

	it("marks the empty object returned for undefined input", () => {
		const marked = continuationPromptOptions(undefined);
		expect(marked).toEqual({});
		expect(isPromptContinuation(marked)).toBe(true);
	});

	it("returns a copy and leaves the original unmarked", () => {
		const options: PromptOptions = {
			expandPromptTemplates: false,
			activeSkillNames: ["planner"],
		};
		const marked = continuationPromptOptions(options);
		expect(marked).toEqual(options);
		expect(marked).not.toBe(options);
		expect(isPromptContinuation(marked)).toBe(true);
		expect(isPromptContinuation(options)).toBe(false);
	});
});
