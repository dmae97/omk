import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

const CONTEXT_GOVERNOR_ENV = "OMK_CONTEXT_GOVERNOR";
let previousContextGovernor: string | undefined;

function expectPlanCacheHit(prompt: string, expected: boolean): void {
	expect(prompt).toContain(`<cache_decision plan_hit="${expected}"`);
}

function rebuildSystemPrompt(harness: Harness): string {
	harness.session.setActiveToolsByName(harness.session.getActiveToolNames());
	return harness.session.systemPrompt;
}

describe("AgentSession context-budget cache", () => {
	beforeEach(() => {
		previousContextGovernor = process.env[CONTEXT_GOVERNOR_ENV];
		process.env[CONTEXT_GOVERNOR_ENV] = "1";
	});

	afterEach(() => {
		if (previousContextGovernor === undefined) {
			delete process.env[CONTEXT_GOVERNOR_ENV];
			return;
		}
		process.env[CONTEXT_GOVERNOR_ENV] = previousContextGovernor;
	});

	it("reuses the plan cache when rebuilding a system prompt in one session", async () => {
		const harness = await createHarness();
		const freshHarness = await createHarness();
		try {
			expectPlanCacheHit(harness.session.systemPrompt, false);
			expectPlanCacheHit(rebuildSystemPrompt(harness), true);
			expectPlanCacheHit(freshHarness.session.systemPrompt, false);
		} finally {
			harness.cleanup();
			freshHarness.cleanup();
		}
	});

	it("enables the context budget from global settings without an environment variable", async () => {
		delete process.env[CONTEXT_GOVERNOR_ENV];
		const harness = await createHarness({ settings: { contextBudget: { enabled: true } } });
		try {
			expect(harness.session.systemPrompt).toContain("<context_budget>");
		} finally {
			harness.cleanup();
		}
	});

	it("lets an environment opt-out disable the global context budget", async () => {
		process.env[CONTEXT_GOVERNOR_ENV] = "0";
		const harness = await createHarness({ settings: { contextBudget: { enabled: true } } });
		try {
			expect(harness.session.systemPrompt).not.toContain("<context_budget>");
		} finally {
			harness.cleanup();
		}
	});
});
