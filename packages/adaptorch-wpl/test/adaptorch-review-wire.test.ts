import { describe, expect, it, vi } from "vitest";
import { AdaptOrchClient } from "../src/adaptorch-client.ts";

describe("canonical AdaptOrch review MCP wire contract", () => {
	it("translates camelCase arguments and retains explicit false, zero, and empty payload", async () => {
		const callTool = vi.fn(async () => ({
			content: [{ type: "text", text: JSON.stringify({ run_id: "run-1", status: "QUEUED" }) }],
		}));
		const result = await new AdaptOrchClient({ callTool }).run({
			taskPayload: {},
			connector: "mcp",
			synthesisMode: "robust",
			budgetPolicy: {},
			waitForTerminal: false,
			timeoutSeconds: 0,
			pollIntervalSeconds: 0,
		});
		expect(callTool).toHaveBeenCalledWith("adaptorch_run", {
			payload: {},
			connector_name: "mcp",
			synthesis_mode: "robust",
			budget_policy: {},
			wait_for_terminal: false,
			timeout_seconds: 0,
			poll_interval_seconds: 0,
		});
		expect(result.run_id).toBe("run-1");
	});
	it("omits absent arguments instead of replacing server defaults", async () => {
		const callTool = vi.fn(async () => ({ run_id: "run-1" }));
		await new AdaptOrchClient({ callTool }).run({ taskPayload: { subtasks: [] } });
		expect(callTool).toHaveBeenCalledWith("adaptorch_run", { payload: { subtasks: [] } });
	});
	it("does not forward undocumented keys or loose prompt/context alongside the raw payload", async () => {
		const callTool = vi.fn(async () => ({ run_id: "run-1" }));
		const args = {
			taskPayload: { subtasks: [] },
			prompt: "ignored override",
			context: "unrelated",
			wait_for_terminal: true,
			waitForTerminal: false,
		};
		await new AdaptOrchClient({ callTool }).run(args);
		expect(callTool).toHaveBeenCalledWith("adaptorch_run", { payload: { subtasks: [] }, wait_for_terminal: false });
	});
	it("decodes get_run without dropping diagnostics, null scores, or semantic evidence", async () => {
		const summary = {
			run_id: "r",
			status: "SUCCEEDED",
			correctness_wall: { verdict: "BLOCKED" },
			diagnostics: { corroboration_score: null },
		};
		const client = new AdaptOrchClient({
			callTool: async () => ({ content: [{ type: "text", text: JSON.stringify(summary) }] }),
		});
		expect(await client.getRun("r")).toEqual(summary);
	});
	it.each([
		{ isError: true, content: [{ type: "text", text: "tool execution failed" }] },
		{ content: [{ type: "text", text: "not json" }] },
		{ content: [] },
		{ content: [{ type: "image", text: "{}" }] },
		{
			content: [
				{ type: "text", text: "{}" },
				{ type: "text", text: "{}" },
			],
		},
	])("fails closed on MCP errors/invalid envelopes: %j", async (raw) => {
		const client = new AdaptOrchClient({ callTool: async () => raw });
		await expect(client.run({ taskPayload: {} })).rejects.toThrow();
		await expect(client.getRun("r")).rejects.toThrow();
	});
});
