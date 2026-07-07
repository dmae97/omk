/**
 * Reasoning-router v4 adversarial accuracy suite.
 *
 * These cases cover false positives that the frozen gold-set suite cannot
 * express without relabeling existing benchmark rows.
 */

import { describe, expect, it } from "vitest";

import { classifyTaskV4, type TaskClassV4 } from "../../../src/core/reasoning-router-v4.ts";

interface ExpectedRouteCase {
	readonly prompt: string;
	readonly expectedClass: TaskClassV4;
	readonly expectedSuppression?: string;
}

const ADVERSARIAL_CASES: readonly ExpectedRouteCase[] = [
	{
		prompt: "refactoring the parser to isolate IO boundaries",
		expectedClass: "refactor",
	},
	{
		prompt: "avoid refactoring; fix the crash",
		expectedClass: "debug",
		expectedSuppression: "negation:refactor-cue",
	},
	{
		prompt: "don't skip the review",
		expectedClass: "review",
	},
	{
		prompt: "shouldn't we refactor this parser?",
		expectedClass: "refactor",
	},
	{
		prompt: "no need for a review, just implement it",
		expectedClass: "code-gen",
		expectedSuppression: "negation:keyword-review",
	},
	{
		prompt: "review is not needed, implement the endpoint",
		expectedClass: "code-gen",
		expectedSuppression: "negation:keyword-review",
	},
	{
		prompt: "review-free implementation of the endpoint",
		expectedClass: "code-gen",
		expectedSuppression: "negation:keyword-review",
	},
	{
		prompt: "instead of review, implement the endpoint",
		expectedClass: "code-gen",
		expectedSuppression: "negation:keyword-review",
	},
	{
		prompt: "no review, implement the endpoint",
		expectedClass: "code-gen",
		expectedSuppression: "negation:keyword-review",
	},
	{
		prompt: "rather than design, implement the endpoint",
		expectedClass: "code-gen",
		expectedSuppression: "negation:keyword-plan",
	},
	{
		prompt: "not refactoring, fix the crash",
		expectedClass: "debug",
		expectedSuppression: "negation:refactor-cue",
	},
	{
		prompt: "refactor-free implementation of the endpoint",
		expectedClass: "code-gen",
		expectedSuppression: "negation:refactor-cue",
	},
	{
		prompt: "not a refactor; fix the crash",
		expectedClass: "debug",
		expectedSuppression: "negation:refactor-cue",
	},
	{
		prompt: "commit and push this small branch update after the checks finish",
		expectedClass: "code-gen",
	},
	{
		prompt: "commit, push, tag the release, update the changelog, and publish to npm",
		expectedClass: "plan",
	},
];

describe("reasoning-router v4 adversarial accuracy", () => {
	it.each(ADVERSARIAL_CASES)("routes $prompt to $expectedClass", ({ prompt, expectedClass, expectedSuppression }) => {
		const verdict = classifyTaskV4({ prompt });
		expect(verdict.taskClass).toBe(expectedClass);
		if (expectedSuppression !== undefined) {
			expect(verdict.suppressedFeatureIds).toContain(expectedSuppression);
		}
	});

	it("does not over-promote simple commit/push requests into release runbooks", () => {
		const verdict = classifyTaskV4({ prompt: "commit and push this small branch update after the checks finish" });
		expect(verdict.taskClass).toBe("code-gen");
		expect(verdict.scores.plan).toBe(0);
	});

	it("keeps adversarial verdicts deterministic", () => {
		for (const { prompt } of ADVERSARIAL_CASES) {
			const first = classifyTaskV4({ prompt });
			for (let i = 0; i < 5; i++) {
				expect(classifyTaskV4({ prompt }), prompt).toEqual(first);
			}
		}
	});
});
