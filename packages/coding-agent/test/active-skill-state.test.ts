import { describe, expect, it } from "vitest";
import { addActiveSkills, createActiveSkillState } from "../src/core/active-skill-state.ts";

describe("active skill state", () => {
	it("merges settings, prompt, and later sources without duplicates", () => {
		const initial = createActiveSkillState(["programming"], ["programming", "review-work"], "sdk");
		const result = addActiveSkills(initial, ["review-work", "debugging"], "sdk+grok-harness");

		expect(result).toEqual({
			names: ["programming", "review-work", "debugging"],
			source: "settings+sdk+grok-harness",
		});
	});

	it("returns the existing state when no names are added", () => {
		const state = createActiveSkillState([], [], undefined);
		expect(addActiveSkills(state, [], "grok-harness")).toBe(state);
	});
});
