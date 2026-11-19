import { fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
	while (harnesses.length) harnesses.pop()?.cleanup();
});

describe("Pi 1.2 before_agent_start compatibility", () => {
	it("keeps an idle registered command outside inference preparation", async () => {
		const idle: boolean[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(omk) => {
					omk.registerCommand("fixture-idle", {
						description: "fixture",
						handler: async (_args, ctx) => {
							idle.push(ctx.isIdle());
						},
					});
				},
			],
		});
		harnesses.push(harness);
		await harness.session.prompt("/fixture-idle");
		expect(idle).toEqual([true]);
		expect(harness.faux.state.callCount).toBe(0);
	});

	it("identifies user starts and owns the session while preparing them", async () => {
		const events: Array<{ messageType: string; prompt?: string; idle: boolean }> = [];
		const harness = await createHarness({
			extensionFactories: [
				(omk) => {
					omk.on("before_agent_start", (event, ctx) => {
						if (event.messageType === "user")
							events.push({ messageType: event.messageType, prompt: event.prompt, idle: ctx.isIdle() });
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("done")]);
		await harness.session.prompt("hello");
		expect(events).toEqual([{ messageType: "user", prompt: "hello", idle: false }]);
	});

	it("prepares custom starts, nextTurn context and prompt overrides through tool continuations", async () => {
		const starts: unknown[] = [];
		const prompts: string[] = [];
		const texts: string[] = [];
		const harness = await createHarness({
			tools: [
				{
					name: "fixture",
					label: "Fixture",
					description: "fixture",
					parameters: Type.Object({}),
					execute: async () => ({ content: [{ type: "text", text: "tool done" }], details: {} }),
				},
			],
			extensionFactories: [
				(omk) => {
					omk.on("before_agent_start", (event, ctx) => {
						starts.push({
							messageType: event.messageType,
							hasPrompt: "prompt" in event,
							message: event.messageType === "custom" ? event.message : undefined,
							idle: ctx.isIdle(),
						});
						return {
							systemPrompt: `${event.systemPrompt}\nCUSTOM_RUN_MARKER`,
							message: { customType: "hook", content: "hook context", display: false },
						};
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			(context) => {
				prompts.push(context.systemPrompt ?? "");
				texts.push(JSON.stringify(context.messages));
				return fauxAssistantMessage([fauxToolCall("fixture", {}, { id: "fixture-call" })]);
			},
			(context) => {
				prompts.push(context.systemPrompt ?? "");
				return fauxAssistantMessage("done");
			},
		]);
		await harness.session.sendCustomMessage(
			{ customType: "next", content: "next context", display: false },
			{ deliverAs: "nextTurn" },
		);
		await harness.session.sendCustomMessage(
			{ customType: "wake", content: "wake context", display: true },
			{ triggerTurn: true },
		);
		expect(starts).toEqual([
			{
				messageType: "custom",
				hasPrompt: false,
				message: expect.objectContaining({ customType: "wake" }),
				idle: false,
			},
		]);
		expect(prompts).toHaveLength(2);
		for (const prompt of prompts) expect(prompt).toContain("CUSTOM_RUN_MARKER");
		expect(texts[0]).toContain("next context");
		expect(texts[0]).toContain("hook context");
	});

	it("queues custom input from a starting user hook instead of starting another run", async () => {
		let starts = 0;
		const harness = await createHarness({
			extensionFactories: [
				(omk) => {
					omk.on("before_agent_start", () => {
						if (++starts === 1)
							omk.sendMessage(
								{ customType: "queued", content: "hook wake", display: false },
								{ triggerTurn: true },
							);
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
		await harness.session.prompt("hello");
		expect(starts).toBe(1);
		expect(
			harness.session.messages.some((message) => message.role === "custom" && message.customType === "queued"),
		).toBe(true);
		expect(harness.eventsOfType("prompt_settled")).toHaveLength(1);
	});

	it("aborts a custom start before issuing any provider request", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(omk) => {
					omk.on("before_agent_start", (_event, ctx) => {
						ctx.abort();
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("must not run")]);
		await expect(
			harness.session.sendCustomMessage(
				{ customType: "wake", content: "wake", display: false },
				{ triggerTurn: true },
			),
		).rejects.toThrow();
		expect(harness.getPendingResponseCount()).toBe(1);
	});
});
