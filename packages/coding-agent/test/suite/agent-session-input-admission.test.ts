import { fileURLToPath } from "node:url";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptInputCapacityError } from "../../src/core/prompt-budget.ts";
import { createHarness, type Harness } from "./harness.ts";

const FAKE_MCP_SERVER = fileURLToPath(new URL("../mcp/fake-server.mjs", import.meta.url));

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
		// The window holds the system prompt and tools; only the oversized latest input overflows it.
		harness = await createHarness({
			models: [{ id: "small-window", contextWindow: 32_000, maxTokens: 2_000 }],
			settings: { compaction: { enabled: false }, resourceGovernor: { mode: "off" } },
		});
		const preflightResult = vi.fn();
		harness.setResponses([]);

		await expect(
			harness.session.prompt("x".repeat(200_000), {
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
		// A system prompt that alone overflows the window is a configuration fault compaction cannot fix.
		expect(harness.session.lastTermination).toMatchObject({ causeCode: "configuration.invalid", retryable: false });
	});

	it("withholds an MCP server a small-window model cannot carry instead of rejecting every prompt", async () => {
		// devin/swe-2 as configured: a 262k window whose MCP catalog alone outgrew the input ceiling.
		harness = await createHarness({
			models: [{ id: "swe-sized", contextWindow: 262_000, maxTokens: 16_384 }],
			settings: {
				compaction: { enabled: true, reserveTokens: 8_192, keepRecentTokens: 10_000, maxUsageRatio: 0.7 },
				resourceGovernor: { mode: "off" },
			},
		});
		const server = (name: string, descriptionChars: number) => ({
			name,
			command: process.execPath,
			args: [FAKE_MCP_SERVER],
			env: { FAKE_MCP_MODE: "ok", FAKE_MCP_DESCRIPTION_CHARS: String(descriptionChars) },
			inheritEnv: false,
		});
		await harness.session.attachMcpServers({ servers: [server("bulky", 300_000), server("slim", 0)] });
		const notify = vi.spyOn(harness.session.extensionRunner.getUIContext(), "notify");
		const sent: string[][] = [];
		harness.setResponses([
			(context) => {
				sent.push((context.tools ?? []).map((tool) => tool.name));
				return fauxAssistantMessage("ok");
			},
		]);

		await expect(harness.session.prompt("hello")).resolves.toBeUndefined();

		expect(sent).toHaveLength(1);
		expect(sent[0]?.filter((name) => name.includes("__")).sort()).toEqual(["slim__echo", "slim__fail"]);
		expect(harness.session.getActiveToolNames()).toEqual(expect.arrayContaining(["bulky__echo", "bulky__fail"]));
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("withhold bulky (2 tools"), "warning");
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
