/**
 * Reasoning-router v4 real-world generalization regression suite.
 *
 * Mirrors the read-only adversarial probe at
 * .omk/goals/009-router-v4-generalization/adversarial-probe.mjs so the
 * out-of-vocabulary fixes stay locked without editing the frozen gold set.
 */

import { describe, expect, it } from "vitest";

import { classifyTaskV4, type TaskClassV4 } from "../../../src/core/reasoning-router-v4.ts";

interface GeneralizationCase {
	readonly prompt: string;
	readonly expectedClass: TaskClassV4;
	readonly note: string;
}

const GENERALIZATION_CASES: readonly GeneralizationCase[] = [
	{ prompt: "Whip up a small utility that memoizes fibonacci results.", expectedClass: "code-gen", note: "whip up" },
	{
		prompt: "Scaffold a REST endpoint that returns the current server time.",
		expectedClass: "code-gen",
		note: "scaffold",
	},
	{ prompt: "I need a script that batch-renames files by regex.", expectedClass: "code-gen", note: "need a script" },
	{ prompt: "Cook me a debounce helper in TypeScript.", expectedClass: "code-gen", note: "cook (slang)" },
	{
		prompt: "The pipeline hangs after the third retry — figure out why.",
		expectedClass: "debug",
		note: "hangs/figure out",
	},
	{
		prompt: "Requests intermittently 500 under load; get to the bottom of it.",
		expectedClass: "debug",
		note: "get to bottom",
	},
	{
		prompt: "Something's eating memory over time, track down the leak.",
		expectedClass: "debug",
		note: "track down leak",
	},
	{
		prompt: "This module is a 900-line spaghetti mess; untangle it into cohesive units.",
		expectedClass: "refactor",
		note: "untangle",
	},
	{ prompt: "Tidy up this class so the dependencies flow one direction.", expectedClass: "refactor", note: "tidy up" },
	{
		prompt: "Consolidate these three near-duplicate helpers into one.",
		expectedClass: "refactor",
		note: "consolidate",
	},
	{ prompt: "Give this PR a once-over before I merge.", expectedClass: "review", note: "once-over" },
	{ prompt: "Sanity-check my auth flow for holes.", expectedClass: "review", note: "sanity-check" },
	{ prompt: "Eyeball this diff and tell me if anything looks off.", expectedClass: "review", note: "eyeball" },
	{ prompt: "Draw up a roadmap for migrating us off REST to gRPC.", expectedClass: "plan", note: "draw up roadmap" },
	{
		prompt: "Let's think through the architecture for a multi-tenant billing system.",
		expectedClass: "plan",
		note: "think through arch",
	},
	{ prompt: "Map out the phases to ship offline-first sync.", expectedClass: "plan", note: "map out phases" },
	{ prompt: "Bump the copyright year in the footer to 2026.", expectedClass: "simple-edit", note: "bump year" },
	{ prompt: "Swap the button label from 'Submit' to 'Send'.", expectedClass: "simple-edit", note: "swap label" },
	{ prompt: "Capitalize the first letter of the page title.", expectedClass: "simple-edit", note: "tiny edit" },
	{ prompt: "yep sounds good", expectedClass: "trivial", note: "ack" },
	{ prompt: "cool, ship it", expectedClass: "trivial", note: "ack" },
	{
		prompt: "Don't refactor anything — just tell me whether this code is correct.",
		expectedClass: "review",
		note: "negated refactor -> review",
	},
	{
		prompt: "Not a bug report, I just want a plan for next quarter.",
		expectedClass: "plan",
		note: "negated bug -> plan",
	},
	{
		prompt: "Add a rate limiter and then write tests for it.",
		expectedClass: "code-gen",
		note: "compound, code-gen lead",
	},
	{ prompt: "Review this endpoint, then I'll refactor it.", expectedClass: "review", note: "compound, review lead" },
	{ prompt: "이 함수 리팩터링 해줘", expectedClass: "refactor", note: "KR refactor" },
	{ prompt: "로그인 버그 원인 찾아줘", expectedClass: "debug", note: "KR debug" },
	{ prompt: "README 오타 하나만 고쳐줘", expectedClass: "simple-edit", note: "KR tiny edit" },
	{ prompt: "다음 스프린트 계획 좀 세워줘", expectedClass: "plan", note: "KR plan" },
	{ prompt: "결제 API 하나 만들어줘", expectedClass: "code-gen", note: "KR code-gen" },
];

describe("reasoning-router v4 real-world generalization", () => {
	it.each(GENERALIZATION_CASES)("routes $note prompt to $expectedClass", ({ prompt, expectedClass }) => {
		expect(classifyTaskV4({ prompt }).taskClass).toBe(expectedClass);
	});

	it("routes the high-confidence sanity-check probe to review instead of code-gen", () => {
		const verdict = classifyTaskV4({ prompt: "Sanity-check my auth flow for holes." });
		expect(verdict.taskClass).toBe("review");
		expect(verdict.scores.review).toBeGreaterThan(verdict.scores["code-gen"]);
	});
});
