import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDurableGoal } from "../../src/core/durable-goal.ts";
import { DurableGoalStore } from "../../src/core/durable-goal-store.ts";
import goalController from "../../src/core/extensions/builtin/goal-controller.ts";
import { createHarness, getUserTexts, type Harness, type HarnessOptions } from "./harness.ts";

function initGit(cwd: string): void {
	const git = (...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
	git("init", "-q");
	git("config", "user.email", "goal@test.invalid");
	git("config", "user.name", "goal");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(cwd, "README.txt"), "base\n");
	git("add", ".");
	git("commit", "-qm", "init");
}

function goalStore(harness: Harness): DurableGoalStore {
	return new DurableGoalStore(join(harness.tempDir, ".omk", "goals", "current.json"));
}

async function createGoal(harness: Harness, objective: string, maxRounds: number): Promise<void> {
	await goalStore(harness).create(
		createDurableGoal({ id: "session", objective, maxRounds, now: new Date().toISOString() }),
	);
}

async function settle(harness: Harness, prompt: string): Promise<void> {
	await harness.session.prompt(prompt);
	await vi.waitFor(
		async () => {
			await harness.session.agent.waitForIdle();
			expect(harness.session.isStreaming).toBe(false);
			expect(harness.getPendingResponseCount()).toBe(0);
		},
		{ timeout: 20_000, interval: 50 },
	);
	await harness.session.agent.waitForIdle();
}

describe("durable goal loop through a live session", () => {
	const harnesses: Harness[] = [];

	beforeEach(() => {
		vi.stubEnv("OMK_BASH_SANDBOX", "off");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function newHarness(settings?: HarnessOptions["settings"]): Promise<Harness> {
		const harness = await createHarness({ extensionFactories: [goalController], ...(settings ? { settings } : {}) });
		harnesses.push(harness);
		initGit(harness.tempDir);
		return harness;
	}

	it("queues one continuation per settled turn until the round limit", async () => {
		const harness = await newHarness();
		await createGoal(harness, "Write the report", 1);
		harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

		await settle(harness, "go");

		expect(getUserTexts(harness)).toEqual(["go", "Continue the active goal (1/1): Write the report"]);
		expect((await goalStore(harness).current())?.completedRounds).toBe(1);
	});

	it("does not advance the goal on an attempt that will be retried", async () => {
		const harness = await newHarness({ retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } });
		await createGoal(harness, "Write the report", 1);
		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
			fauxAssistantMessage("recovered"),
			fauxAssistantMessage("continued"),
		]);

		await settle(harness, "go");

		expect(getUserTexts(harness)).toEqual(["go", "Continue the active goal (1/1): Write the report"]);
		expect(harness.faux.state.callCount).toBe(3);
		expect((await goalStore(harness).current())?.completedRounds).toBe(1);
	});
});
