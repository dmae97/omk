import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_SELECTED_SKILLS, type SelectSkillsInput, selectSkills } from "../src/core/skill-selector.ts";

const tokenArbitrary = fc.stringMatching(/^[a-z][a-z0-9]{2,11}$/);
const skillArbitrary = fc.record({
	name: fc.array(tokenArbitrary, { minLength: 1, maxLength: 3 }).map((tokens) => tokens.join("-")),
	description: fc.array(tokenArbitrary, { maxLength: 12 }).map((tokens) => tokens.join(" ")),
});
const taskArbitrary = fc.array(tokenArbitrary, { maxLength: 16 }).map((tokens) => tokens.join(" "));
const pathArbitrary = fc.array(tokenArbitrary, { minLength: 1, maxLength: 8 }).map((tokens) => tokens.join("/"));

function selectionInput(
	task: string,
	skills: SelectSkillsInput["skills"],
	paths: readonly string[],
	max: number | undefined,
): SelectSkillsInput {
	return max === undefined ? { task, skills, paths } : { task, skills, paths, max };
}

describe("skill selector properties", () => {
	it("is deterministic, bounded, finite, and returns only input skill names", () => {
		fc.assert(
			fc.property(
				taskArbitrary,
				fc.array(skillArbitrary, { maxLength: 30 }),
				fc.array(pathArbitrary, { maxLength: 8 }),
				fc.option(fc.oneof(fc.integer({ min: -5, max: 20 }), fc.constant(Number.NaN)), {
					nil: undefined,
				}),
				(task, skills, paths, max) => {
					const input = selectionInput(task, skills, paths, max);
					const result = selectSkills(input);
					const available = new Set(skills.map((skill) => skill.name));
					const selectedNames = result.selected.map((skill) => skill.name);

					expect(result).toEqual(selectSkills(input));
					expect(selectedNames.length).toBeLessThanOrEqual(MAX_SELECTED_SKILLS);
					expect(new Set(selectedNames).size).toBe(selectedNames.length);
					expect(selectedNames.every((name) => available.has(name))).toBe(true);
					expect(result.scores.every(({ score }) => Number.isFinite(score) && score >= 0 && score <= 1)).toBe(
						true,
					);
				},
			),
			{ numRuns: 250, seed: 0x5a1112026 },
		);
	});

	it("is invariant to path-hint ordering", () => {
		fc.assert(
			fc.property(
				taskArbitrary,
				fc.array(skillArbitrary, { maxLength: 20 }),
				fc.array(pathArbitrary, { maxLength: 8 }),
				(task, skills, paths) => {
					const forward = selectSkills({ task, skills, paths });
					const reverse = selectSkills({ task, skills, paths: [...paths].reverse() });
					expect(reverse).toEqual(forward);
				},
			),
			{ numRuns: 250, seed: 0x5a1112027 },
		);
	});
});
