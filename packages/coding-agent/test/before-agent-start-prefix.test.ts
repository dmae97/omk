import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareMessageStart } from "../src/core/extensions/before-agent-start.ts";
import { buildSystemPromptPlan } from "../src/core/system-prompt.ts";
import { PrefixBoundaryCauseHolder } from "../src/core/system-prompt-cache-boundary.ts";

const options = { cwd: "/tmp", customPrompt: "Stable instructions.", appendSystemPrompt: "Dynamic tail A." };

afterEach(() => vi.unstubAllEnvs());

describe("local before_agent_start and v1.5.5 prefix cause handoff", () => {
	it.each([
		["1", "suffix_changed"],
		["0", "flag_off"],
	])("records the changed tail with OMK_PREFIX_BOUNDARY=%s", async (flag, cause) => {
		vi.stubEnv("OMK_PREFIX_BOUNDARY", flag);
		const plan = buildSystemPromptPlan(options);
		const systemPrompt = `${plan.prompt.slice(0, plan.cacheBoundary)}Dynamic tail B.`;
		const causes = new PrefixBoundaryCauseHolder();
		const runner = { emitBeforeAgentStart: async () => ({ systemPrompt }) };
		const prepared = await prepareMessageStart(runner, { messageType: "user", prompt: "hello" }, options, causes);
		expect(prepared.promptState.systemPrompt).toBe(systemPrompt);
		expect(causes.take(systemPrompt)).toMatchObject({ cause });
		expect(causes.take(systemPrompt)).toBeUndefined();
	});

	it("clears a pending cause when an extension leaves the plan unchanged", async () => {
		const plan = buildSystemPromptPlan(options);
		const causes = new PrefixBoundaryCauseHolder();
		causes.record(plan.prompt, { cause: "suffix_changed" });
		const runner = { emitBeforeAgentStart: async () => undefined };
		await prepareMessageStart(runner, { messageType: "user", prompt: "hello" }, options, causes);
		expect(causes.take(plan.prompt)).toBeUndefined();
	});
});
