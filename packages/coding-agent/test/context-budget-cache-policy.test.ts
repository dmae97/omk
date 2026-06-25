import { describe, expect, it } from "vitest";
import { createExactResponseCacheKey, type ExactResponseCacheKeyInput } from "../src/core/exact-cache-policy.ts";
import { classifySemanticCacheEligibility, type SemanticCacheCandidate } from "../src/core/semantic-cache-policy.ts";

const exactInput: ExactResponseCacheKeyInput = {
	provider: "openai",
	model: "gpt-4o",
	modelRevision: "2026-06-01",
	messages: [{ role: "user", content: "hello" }],
	toolSchema: { tools: [] },
	temperature: 0,
	seed: null,
	reasoningEffort: null,
	promptPolicyVersion: "prompt-v1",
	tenantId: null,
	userId: null,
	repoHead: "abc",
	worktreeHash: "worktree",
	environmentHash: "env",
};

const semanticBase: SemanticCacheCandidate = {
	enabled: true,
	responseKind: "final",
	responseReadOnly: true,
	pendingToolCallCount: 0,
	taskClass: "faq",
	action: "answer",
	cacheAttributes: { branch: "main", worktree: "/repo", repoSha: "abc" },
	currentAttributes: { branch: "main", worktree: "/repo", repoSha: "abc" },
};

describe("context budget cache policy", () => {
	it("separates exact response cache keys by context budget plan metadata", () => {
		const baseline = createExactResponseCacheKey(exactInput);
		const budgeted = createExactResponseCacheKey({
			...exactInput,
			contextBudget: {
				policyVersion: "context-budget-v1",
				planHash: "a".repeat(64),
				emergency: false,
				omittedHighPriority: false,
			},
		});
		const otherPlan = createExactResponseCacheKey({
			...exactInput,
			contextBudget: {
				policyVersion: "context-budget-v1",
				planHash: "b".repeat(64),
				emergency: false,
				omittedHighPriority: false,
			},
		});

		expect(budgeted.key).not.toBe(baseline.key);
		expect(otherPlan.key).not.toBe(budgeted.key);
		expect(budgeted.material.contextBudget?.planHash).toBe("a".repeat(64));
	});

	it("rejects semantic cache use when budget omitted required or high-priority context", () => {
		expect(classifySemanticCacheEligibility(semanticBase)).toMatchObject({ eligible: true });
		expect(
			classifySemanticCacheEligibility({
				...semanticBase,
				contextBudget: { omittedHighPriority: true },
			}),
		).toMatchObject({ eligible: false, reason: "context_budget.incomplete" });
		expect(
			classifySemanticCacheEligibility({
				...semanticBase,
				contextBudget: { emergency: true },
			}),
		).toMatchObject({ eligible: false, reason: "context_budget.incomplete" });
	});
});
