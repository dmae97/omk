import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.ts";
import { contract, model, response } from "./provider-request-fixtures.ts";

describe("Agent model contract", () => {
	it("uses a detached policy for successive prompts", async () => {
		const supplied = { ...contract, allowedModels: [...contract.allowedModels] };
		const sent: string[] = [];
		const agent = new Agent({
			initialState: { model },
			modelContract: supplied,
			streamFn: (selected) => {
				sent.push(selected.id);
				return response();
			},
		});
		await agent.prompt("first");
		supplied.allowedModels.push({ provider: model.provider, id: "other" });
		agent.state.model = { ...model, id: "other" };
		await agent.prompt("second");
		expect(sent).toEqual([model.id]);
		expect(agent.state.errorMessage).toBeTruthy();
		expect(agent.state.isStreaming).toBe(false);
	});

	it("does not allow prepareNextTurn to replace the contracted model", async () => {
		const sent: string[] = [];
		const agent = new Agent({
			initialState: { model },
			modelContract: contract,
			prepareNextTurn: () => ({ model: { ...model, id: "other" } }),
			streamFn: (selected) => {
				sent.push(selected.id);
				return response();
			},
		});
		agent.followUp({ role: "user", content: "follow up", timestamp: 0 });
		await agent.prompt("first");
		expect(sent).toEqual([model.id]);
		expect(agent.state.errorMessage).toBeTruthy();
	});

	it("forwards a smaller explicit maximum output limit", async () => {
		let sentLimit: number | undefined;
		const agent = new Agent({
			initialState: { model },
			modelContract: contract,
			maxTokens: 32,
			streamFn: (_model, _context, options) => {
				sentLimit = options?.maxTokens;
				return response();
			},
		});
		await agent.prompt("first");
		expect(sentLimit).toBe(32);
	});
});
