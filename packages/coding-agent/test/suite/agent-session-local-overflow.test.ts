import { fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness | undefined;
afterEach(() => {
	harness?.cleanup();
	harness = undefined;
	vi.unstubAllEnvs();
});

describe("local capacity overflow during a tool turn", () => {
	it.each([true, false])("recovers only with auto-compaction enabled=%s", async (enabled) => {
		vi.stubEnv("OMK_CONTEXT_GOVERNOR", "1");
		vi.stubEnv("OMK_VERIFIED_MEMORY", "1");
		harness = await createHarness({
			models: [{ id: "local-overflow", contextWindow: 32_000, maxTokens: 2_000 }],
			settings: {
				compaction: { enabled, keepRecentTokens: 1 },
				retry: { enabled: false },
				resourceGovernor: { mode: "off" },
			},
			tools: [
				{
					name: "inflate",
					label: "inflate",
					description: "Return fixture text",
					parameters: Type.Object({}),
					execute: async () => ({ content: [{ type: "text", text: "y".repeat(48_000) }], details: {} }),
				},
			],
			initialActiveToolNames: ["inflate"],
			extensionFactories: [
				(omk) => {
					omk.on("session_before_compact", async (event) => ({
						compaction: {
							summary: "Earlier fixture history summarized",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: {},
						},
					}));
				},
			],
		});
		const now = Date.now();
		harness.sessionManager.appendMessage({ role: "user", content: "x".repeat(60_000), timestamp: now - 2000 });
		harness.sessionManager.appendMessage({
			...fauxAssistantMessage("earlier answer"),
			api: harness.getModel().api,
			provider: harness.getModel().provider,
			model: harness.getModel().id,
			timestamp: now - 1000,
		});
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("inflate", {}, { id: "large-result" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("continued after local overflow"),
		]);

		await harness.session.prompt("continue the fixture");

		const errors = harness
			.eventsOfType("message_end")
			.map((event) => event.message)
			.filter((message) => message.role === "assistant" && message.stopReason === "error");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ errorMessage: expect.stringContaining("safe model context window") });
		if (enabled) {
			expect(harness.eventsOfType("compaction_end")).toContainEqual(
				expect.objectContaining({
					reason: "overflow",
					willRetry: true,
					aborted: false,
				}),
			);
			expect(harness.faux.state.callCount).toBe(2);
			expect(harness.session.messages.at(-1)).toMatchObject({ stopReason: "stop" });
		} else {
			expect(harness.eventsOfType("compaction_end")).toHaveLength(0);
			expect(harness.faux.state.callCount).toBe(1);
			expect(harness.session.lastTermination).toMatchObject({ causeCode: "provider.context_overflow" });
			expect(harness.session.lastTermination?.nextAction).toMatch(/compact or reduce context/i);
		}
	});
});
