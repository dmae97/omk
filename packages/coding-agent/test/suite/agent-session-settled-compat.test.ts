import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
	while (harnesses.length) harnesses.pop()?.cleanup();
});

describe("Pi agent_settled final boundary compatibility", () => {
	it("stops a settlement handler when the session closes", async () => {
		let entered = () => {};
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const harness = await createHarness({
			extensionFactories: [
				(omk) => {
					omk.on("agent_settled", async (_event, ctx) => {
						const signal = ctx.signal;
						expect(signal).toBeDefined();
						entered();
						await new Promise<void>((resolve) =>
							signal?.addEventListener("abort", () => resolve(), { once: true }),
						);
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("done")]);
		const run = harness.session.prompt("fixture");
		const outcome = run.catch(() => undefined);
		await started;
		await harness.session.close();
		await outcome;
	});

	it("emits once after all queued continuations with an explicit abort flag", async () => {
		const settled: boolean[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(omk) => {
					let first = true;
					omk.on("agent_end", () => {
						if (!first) return;
						first = false;
						omk.sendMessage({ customType: "queued", content: "continue", display: false }, { triggerTurn: true });
					});
					omk.on("agent_settled", (event) => {
						settled.push(event.aborted);
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("last")]);
		await harness.session.prompt("fixture");
		expect(settled).toEqual([false]);
	});

	it("reports an aborted run instead of scheduling an extension switch", async () => {
		const settled: boolean[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(omk) => {
					omk.on("agent_settled", (event) => {
						settled.push(event.aborted);
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("", { stopReason: "aborted" })]);
		await harness.session.prompt("fixture");
		expect(settled).toEqual([true]);
	});

	it("defers command expansion from settlement until the old run scope closes", async () => {
		let commands = 0;
		const harness = await createHarness({
			extensionFactories: [
				(omk) => {
					omk.registerCommand("fixture-switch", {
						description: "fixture",
						handler: async () => {
							commands++;
						},
					});
					omk.on("agent_settled", () => {
						omk.sendUserMessage("/fixture-switch", { expandPromptTemplates: true });
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("done")]);
		await harness.session.prompt("fixture");
		await vi.waitFor(() => expect(commands).toBe(1));
		expect(harness.getPendingResponseCount()).toBe(0);
	});
});
