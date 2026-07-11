/**
 * Reasoning-router v4 real-world generalization regression suite.
 *
 * Mirrors the read-only adversarial probe at
 * .omk/goals/009-router-v4-generalization/adversarial-probe.mjs so the
 * out-of-vocabulary fixes stay locked without editing the frozen gold set.
 */

import { describe, expect, it } from "vitest";

import { classifyTaskV4, type TaskClassV4 } from "../../../src/core/reasoning-router-v4.ts";
import { normalizeIntentTokensV4 } from "../../../src/core/reasoning-router-v4-normalize.ts";

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
		prompt: "The numbers come out wrong after the migration.",
		expectedClass: "debug",
		note: "wrong numbers after migration",
	},
	{ prompt: "CI is red only on the mac runner.", expectedClass: "debug", note: "platform-only red CI" },
	{
		prompt: "Users report the export silently produces an empty file.",
		expectedClass: "debug",
		note: "silent empty export",
	},
	{ prompt: "어제는 됐는데 오늘은 합계가 안 맞아.", expectedClass: "debug", note: "KR totals off" },
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
	{ prompt: "Can you look over my approach before I commit?", expectedClass: "review", note: "look over approach" },
	{ prompt: "Poke holes in this design before we build it.", expectedClass: "review", note: "poke holes" },
	{ prompt: "Does this handle the concurrent case?", expectedClass: "review", note: "handles concurrent case" },
	{ prompt: "이 접근 방식 괜찮은지 봐줘.", expectedClass: "review", note: "KR look over approach" },
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

	it("routes code artifact requests through scored code-gen evidence instead of default fallback", () => {
		const verdict = classifyTaskV4({ prompt: "I need a script that batch-renames files by regex." });
		expect(verdict.taskClass).toBe("code-gen");
		expect(verdict.fallbackReason).toBeNull();
		expect(verdict.scores["code-gen"]).toBeGreaterThan(0);
	});

	it("treats leading review synonyms as review intent", () => {
		const verdict = classifyTaskV4({ prompt: "Give this PR a once-over before I merge." });
		expect(verdict.taskClass).toBe("review");
		expect(verdict.fallbackReason).toBeNull();
		expect(verdict.scores.review).toBeGreaterThan(verdict.scores["code-gen"]);
	});

	it("routes evaluative review-object phrasing to review instead of implementation nouns", () => {
		const verdict = classifyTaskV4({ prompt: "Sanity-check my auth flow for holes." });
		expect(verdict.taskClass).toBe("review");
		expect(verdict.scores.review).toBeGreaterThan(verdict.scores["code-gen"]);
		expect(verdict.confidenceBand).not.toBe("low");
	});

	it("suppresses first-person future clauses instead of scoring them as agent work", () => {
		const verdict = classifyTaskV4({ prompt: "Review this endpoint, then I'll refactor it." });
		expect(verdict.taskClass).toBe("review");
		expect(verdict.secondClauseIntent).toBeNull();
		expect(verdict.compoundIntent).toBe(false);
		expect(verdict.scores.refactor).toBe(0);
	});

	it("keeps imperative second clauses agent-directed and compound", () => {
		const verdict = classifyTaskV4({ prompt: "Review this endpoint, then refactor it." });
		expect(verdict.secondClauseIntent).toBe("refactor");
		expect(verdict.compoundIntent).toBe(true);
		expect(verdict.scores.refactor).toBeGreaterThan(0);
	});

	it("routes Korean morphology variants through the bounded Korean cluster", () => {
		const verdict = classifyTaskV4({ prompt: "다음 배포 계획 좀 짜줘" });
		expect(verdict.taskClass).toBe("plan");
		expect(verdict.fallbackReason).toBe("ko-short-task-signal");
	});

	it("routes real-world debug failure shapes through scored diagnostic evidence", () => {
		const debugPrompts: readonly string[] = [
			"The numbers come out wrong after the migration.",
			"CI is red only on the mac runner.",
			"Users report the export silently produces an empty file.",
			"어제는 됐는데 오늘은 합계가 안 맞아.",
		];

		for (const prompt of debugPrompts) {
			const verdict = classifyTaskV4({ prompt });
			expect(verdict.taskClass).toBe("debug");
			expect(verdict.fallbackReason).toBeNull();
			expect(verdict.scores.debug).toBeGreaterThan(verdict.scores["code-gen"]);
		}
	});

	it("routes real-world review assessment shapes above incidental implementation/debug nouns", () => {
		const reviewPrompts: readonly string[] = [
			"Can you look over my approach before I commit?",
			"Poke holes in this design before we build it.",
			"Does this handle the concurrent case?",
			"Can this leak permissions between tenants?",
			"이 접근 방식 괜찮은지 봐줘.",
		];

		for (const prompt of reviewPrompts) {
			const verdict = classifyTaskV4({ prompt });
			expect(verdict.taskClass).toBe("review");
			expect(verdict.fallbackReason).toBeNull();
			expect(verdict.scores.review).toBeGreaterThan(verdict.scores["code-gen"]);
		}
	});

	it("normalizes English and Korean morphology into canonical intent stems", () => {
		const english = normalizeIntentTokensV4("hangs hung hanging breaks broke broken");
		expect(english).toContain("hang");
		expect(english).toContain("break");

		const korean = normalizeIntentTokensV4("고쳐줘 고칠거야 고쳐줘요");
		expect(korean.filter((token) => token === "고치")).toHaveLength(1);
	});

	it("keeps a single normalized generalized match at medium confidence", () => {
		const verdict = classifyTaskV4({ prompt: "Exports vanished after deploy." });
		expect(verdict.taskClass).toBe("debug");
		expect(verdict.fallbackReason).toBeNull();
		expect(verdict.confidenceBand).toBe("medium");
	});

	it("routes temporal deferral skeletons to the current action", () => {
		const debugVerdict = classifyTaskV4({ prompt: "Review can wait; find why the smoke check fails first." });
		expect(debugVerdict.taskClass).toBe("debug");
		expect(debugVerdict.suppressedFeatureIds).toContain("deferral:review");
		expect(debugVerdict.scores.review).toBe(0);

		const reviewVerdict = classifyTaskV4({
			prompt: "Refactor later; evaluate whether the current boundary is safe first.",
		});
		expect(reviewVerdict.taskClass).toBe("review");
		expect(reviewVerdict.suppressedFeatureIds).toContain("deferral:refactor");
		expect(reviewVerdict.scores.refactor).toBe(0);
	});
});
