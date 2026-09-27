import type { AgentMessage, AgentTool } from "omk-agent-core";
import type { Api, Model } from "omk-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { CompactionSettings } from "../src/core/compaction/index.ts";
import type { TokenCounterAdapter } from "../src/core/context-budget-token-counter.ts";
import { PromptInputCapacityError } from "../src/core/prompt-budget.ts";
import {
	CompactedPromptInputCapacityError,
	PromptFixedOverheadError,
	promptPreflightTermination,
} from "../src/core/session-input-admission.ts";
import { SessionTurnAdmission, type SessionTurnAdmissionHost } from "../src/core/session-turn-admission.ts";
import { mcpToolGroup } from "../src/core/tool-schema-budget.ts";

const quarterCounter: TokenCounterAdapter = {
	id: "quarter",
	priority: 0,
	isAvailable: () => true,
	supports: () => true,
	countText: (input, modelId) => ({
		tokens: Math.ceil(input.length / 4),
		method: "estimated",
		confidence: "high",
		adapterId: "quarter",
		modelId,
		notes: [],
	}),
};

const settings: CompactionSettings = {
	enabled: true,
	reserveTokens: 8192,
	keepRecentTokens: 10000,
	maxUsageRatio: 0.7,
};

function model(contextWindow: number): Model<Api> {
	return {
		id: `window-${contextWindow}`,
		name: "test",
		api: "openai-completions",
		provider: "test",
		baseUrl: "http://localhost",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: 16384,
	} as Model<Api>;
}

function tool(name: string, tokens: number): AgentTool {
	return {
		name,
		label: name,
		description: "d".repeat(tokens * 4),
		parameters: Type.Object({}),
		execute: async () => ({ content: [], details: {} }),
	};
}

const user: AgentMessage = { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 };

// devin/swe-2 as configured: 262k window, 16k output, 26.2k margin -> 219,416-token input ceiling.
function harness(options: { tools: AgentTool[]; window?: number; systemPrompt?: string }) {
	const notices: string[] = [];
	const compactions: number[] = [];
	const state = {
		systemPrompt: options.systemPrompt ?? "system",
		messages: [] as AgentMessage[],
		tools: options.tools,
	};
	let current = model(options.window ?? 262_000);
	const host: SessionTurnAdmissionHost = {
		model: () => current,
		state: () => state,
		contextWindow: (_pending, window) => window,
		compactionSettings: () => settings,
		latestCompactionTimestamp: () => undefined,
		toolGroup: (name) => (name.includes("__") ? mcpToolGroup(name) : undefined),
		compact: async () => {
			compactions.push(1);
		},
		notify: (message) => notices.push(message),
	};
	return {
		admission: new SessionTurnAdmission(host),
		state,
		notices,
		compactions,
		switchModel: (window: number) => {
			current = model(window);
		},
	};
}

const catalog = [
	tool("read", 100),
	tool("notion__query", 150_000),
	tool("runpod__create", 50_000),
	tool("github__pr", 5_000),
];

describe("SessionTurnAdmission", () => {
	it("withholds the largest MCP server so a small-window model admits the prompt", async () => {
		const session = harness({ tools: catalog });

		await expect(session.admission.admit([user], quarterCounter)).resolves.toBeUndefined();

		const sent = session.admission.fitTools(session.state.tools, [user]);
		expect(sent.map((entry) => entry.name)).toEqual(["read", "runpod__create", "github__pr"]);
		expect(session.state.tools.map((entry) => entry.name)).toEqual(catalog.map((entry) => entry.name));
		expect(session.compactions).toEqual([]);
		expect(session.notices).toHaveLength(1);
		expect(session.notices[0]).toContain("notion (1 tools");
		expect(session.notices[0]).toContain("window-262000");
	});

	it("announces a changed selection once and restores every tool on a larger-context model", async () => {
		const session = harness({ tools: catalog });
		await session.admission.admit([user], quarterCounter);
		session.admission.fitTools(session.state.tools, []);
		expect(session.notices).toHaveLength(1);

		session.switchModel(1_000_000);
		const sent = session.admission.fitTools(session.state.tools, []);

		expect(sent.map((entry) => entry.name)).toEqual(catalog.map((entry) => entry.name));
		expect(session.notices).toHaveLength(2);
		expect(session.notices[1]).toContain("All MCP tools");
	});

	it("rejects overhead no compaction can shrink as a non-retryable configuration failure", async () => {
		const session = harness({ tools: [tool("read", 230_000), tool("notion__query", 10)] });

		const rejection = await session.admission.admit([user], quarterCounter).catch((error: unknown) => error);

		expect(rejection).toBeInstanceOf(PromptFixedOverheadError);
		expect(session.compactions).toEqual([]);
		const termination = promptPreflightTermination(rejection, "session", model(262_000));
		expect(termination.causeCode).toBe("configuration.invalid");
		expect(termination.phase).toBe("preflight");
		expect(termination.retryable).toBe(false);
		expect(termination.message).toContain("tool schemas");
		expect(termination.nextAction).toContain("larger-context model");
	});

	it("classifies input still too large after compaction as a compaction failure, not a provider overflow", () => {
		const rejection = new CompactedPromptInputCapacityError(new PromptInputCapacityError(300_000, 219_416));

		const termination = promptPreflightTermination(rejection, "session", model(262_000));

		expect(termination.causeCode).toBe("compaction.failed");
		expect(termination.sideEffects).toBe("confirmed");
		expect(termination.nextAction).toContain("Shorten the latest input");
	});
});
