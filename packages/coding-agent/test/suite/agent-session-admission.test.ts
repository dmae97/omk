import { fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness | undefined;
afterEach(() => {
	harness?.cleanup();
	harness = undefined;
	vi.restoreAllMocks();
});
function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("actual prompt admission boundaries", () => {
	it("keeps unbounded preflight owned when a second prompt offers a budget", async () => {
		const entered = deferred();
		const finish = deferred();
		harness = await createHarness({
			settings: { resourceGovernor: { mode: "off" } },
			extensionFactories: [
				(omk) => {
					omk.on("before_agent_start", async () => {
						entered.resolve();
						await finish.promise;
					});
				},
			],
		});
		harness.setResponses([fauxAssistantMessage("first completed")]);
		const first = harness.session.prompt("first");
		await entered.promise;
		try {
			await expect(harness.session.prompt("second", { runBudget: { maxRequests: 0 } })).rejects.toThrow(
				/already processing/i,
			);
			expect(harness.faux.state.callCount).toBe(0);
		} finally {
			finish.resolve();
			await first;
		}
		expect(harness.faux.state.callCount).toBe(1);
		expect(harness.eventsOfType("prompt_settled").map((event) => event.outcome)).toEqual(["completed"]);
	});

	it("denies a second provider request before core authentication", async () => {
		harness = await createHarness({
			settings: { retry: { enabled: false }, resourceGovernor: { mode: "off" } },
			tools: [
				{
					name: "echo",
					label: "Echo",
					description: "Produce a continuation",
					parameters: Type.Object({}),
					execute: async () => ({ content: [{ type: "text", text: "echo" }], details: {} }),
				},
			],
		});
		const resolver = vi.fn(harness.session.agent.getApiKey);
		harness.session.agent.getApiKey = resolver;
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("not sent"),
		]);
		await expect(harness.session.prompt("echo", { runBudget: { maxRequests: 1 } })).rejects.toMatchObject({
			code: "requests",
		});
		expect(resolver).toHaveBeenCalledTimes(1);
		expect(harness.faux.state.callCount).toBe(1);
		expect(harness.session.agent.getApiKey).toBe(resolver);
		expect(harness.session.lastTermination?.kind).toBe("budget_exhausted");
	});
});
