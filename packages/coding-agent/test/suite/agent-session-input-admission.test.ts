import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptInputCapacityError } from "../../src/core/prompt-budget.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness | undefined;
const previousContextGovernor = process.env.OMK_CONTEXT_GOVERNOR;

afterEach(() => {
	harness?.cleanup();
	harness = undefined;
	vi.restoreAllMocks();
	if (previousContextGovernor === undefined) delete process.env.OMK_CONTEXT_GOVERNOR;
	else process.env.OMK_CONTEXT_GOVERNOR = previousContextGovernor;
});

describe("AgentSession context input admission", () => {
	it("rejects a locally oversized first turn before provider dispatch", async () => {
		harness = await createHarness({
			models: [{ id: "tiny-window", contextWindow: 1_000, maxTokens: 100 }],
			settings: { compaction: { enabled: false }, resourceGovernor: { mode: "off" } },
		});
		const preflightResult = vi.fn();
		harness.setResponses([]);

		await expect(
			harness.session.prompt("x".repeat(10_000), {
				preflightResult,
			}),
		).rejects.toBeInstanceOf(PromptInputCapacityError);

		expect(harness.faux.state.callCount).toBe(0);
		expect(preflightResult).toHaveBeenCalledWith(false);
		expect(harness.session.lastTermination).toMatchObject({
			causeCode: "provider.context_overflow",
			sideEffects: "none",
		});
	});

	it("catches an extension system-prompt override after budgeting", async () => {
		process.env.OMK_CONTEXT_GOVERNOR = "1";
		harness = await createHarness({
			models: [{ id: "small-window", contextWindow: 8_000, maxTokens: 1_000 }],
			settings: { compaction: { enabled: false }, resourceGovernor: { mode: "off" } },
			extensionFactories: [
				(omk) => {
					omk.on("before_agent_start", async () => ({ systemPrompt: "override".repeat(10_000) }));
				},
			],
		});
		harness.setResponses([]);

		await expect(harness.session.prompt("small request")).rejects.toBeInstanceOf(PromptInputCapacityError);
		expect(harness.faux.state.callCount).toBe(0);
	});

	it("still admits a request that fits", async () => {
		harness = await createHarness({
			models: [{ id: "roomy-window", contextWindow: 32_000, maxTokens: 2_000 }],
			settings: { compaction: { enabled: false }, resourceGovernor: { mode: "off" } },
		});
		harness.setResponses([fauxAssistantMessage("ok")]);

		await expect(harness.session.prompt("small request")).resolves.toBeUndefined();
		expect(harness.faux.state.callCount).toBe(1);
	});
});
