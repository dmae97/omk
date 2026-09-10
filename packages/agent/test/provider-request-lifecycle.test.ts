import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../src/agent-loop.ts";
import type { AgentEvent } from "../src/types.ts";
import { contract, model, response } from "./provider-request-fixtures.ts";

const prompt = { role: "user" as const, content: "fixture", timestamp: 0 };

describe("request policy lifecycle", () => {
	it("pins policy before an agent_start listener changes caller-owned configuration", async () => {
		const supplied = { ...contract, allowedModels: [...contract.allowedModels] };
		const send = vi.fn(() => response());
		const config = { model: { ...model, id: "other" }, modelContract: supplied, convertToLlm: () => [] };
		await expect(
			runAgentLoop(
				[prompt],
				{ systemPrompt: "", messages: [] },
				config,
				(event) => {
					if (event.type === "agent_start") supplied.allowedModels.push({ provider: model.provider, id: "other" });
				},
				undefined,
				send,
			),
		).rejects.toThrow();
		expect(send).not.toHaveBeenCalled();
	});

	it("closes the dispatch event when its observer throws before the stream starts", async () => {
		const events: AgentEvent[] = [];
		const send = vi.fn(() => response());
		const config = { model, modelContract: contract, convertToLlm: () => [] };
		await expect(
			runAgentLoop(
				[prompt],
				{ systemPrompt: "", messages: [] },
				config,
				(event) => {
					events.push(event);
					if (event.type === "provider_request") throw new Error("observer fixture");
				},
				undefined,
				send,
			),
		).rejects.toThrow("observer fixture");
		expect(send).not.toHaveBeenCalled();
		expect(events.filter((event) => event.type === "provider_request_end")).toEqual([
			expect.objectContaining({ type: "provider_request_end", outcome: "error" }),
		]);
	});
});
