/**
 * The query that drives skill ranking must survive a tool-calling turn.
 *
 * `_extractCurrentQuery()` feeds `queryContext`, which is the only signal that
 * orders the inactive-skill slots in the system prompt. Tool results are
 * separate messages (`Message = UserMessage | AssistantMessage |
 * ToolResultMessage`), so a single turn that calls two tools already appends
 * `[assistant, toolResult, toolResult]` after the user's message. If the
 * extractor only looks at a short tail, the task text disappears mid-turn,
 * every skill falls back to the neutral score, and the ranking degrades to
 * catalogue order — exactly when a skill is most needed.
 */
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "omk-agent-core";
import { getModel } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { scoreSkillRelevance } from "../src/core/context-budget-relevance.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

describe("skill query context survives tool turns", () => {
	let session: AgentSession;
	let tempDir: string;

	const TASK = "refactor the postgres migration runner and add a rollback test";

	beforeEach(() => {
		tempDir = join(tmpdir(), `omk-skill-query-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model: getModel("anthropic", "claude-sonnet-5"), systemPrompt: "x", tools: [] },
		});
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.create(tempDir, tempDir),
			cwd: tempDir,
			modelRegistry: ModelRegistry.create(authStorage),
			resourceLoader: createTestResourceLoader(),
		});
	});

	afterEach(() => {
		if (session) session.dispose();
		if (tempDir) rmSync(tempDir, { recursive: true });
	});

	function userTurn() {
		return { role: "user" as const, content: TASK, timestamp: Date.now() };
	}
	function assistantWithToolCalls() {
		return {
			role: "assistant" as const,
			content: [],
			provider: "anthropic",
			model: "claude-sonnet-5",
			stopReason: "toolUse",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
			timestamp: Date.now(),
		};
	}
	function toolResult(id: string) {
		return {
			role: "toolResult" as const,
			toolCallId: id,
			toolName: "bash",
			content: "ok",
			isError: false,
			timestamp: Date.now(),
		};
	}

	function currentQuery(): string | undefined {
		// @ts-expect-error private method under test
		return session._extractCurrentQuery();
	}

	it("finds the task before any tool has run", () => {
		session.agent.state.messages = [userTurn()] as never;
		expect(currentQuery()).toBe(TASK);
	});

	it("still finds the task after a two-tool turn", () => {
		// One ordinary parallel tool call already pushes the user message to
		// index -4, out of a three-message tail.
		session.agent.state.messages = [userTurn(), assistantWithToolCalls(), toolResult("a"), toolResult("b")] as never;
		expect(currentQuery()).toBe(TASK);
	});

	it("still finds the task deep inside a long tool sequence", () => {
		const messages: unknown[] = [userTurn(), assistantWithToolCalls()];
		for (let i = 0; i < 12; i++) messages.push(toolResult(`t${i}`));
		session.agent.state.messages = messages as never;
		expect(currentQuery()).toBe(TASK);
	});

	it("keeps skill ranking task-driven rather than neutral mid-turn", () => {
		session.agent.state.messages = [userTurn(), assistantWithToolCalls(), toolResult("a"), toolResult("b")] as never;
		const query = currentQuery();
		const onTopic = { name: "database-optimizer", description: "postgres migration and rollback tuning" };
		const offTopic = { name: "scanpy", description: "single-cell RNA-seq clustering and UMAP" };
		// Without a query both collapse to the neutral score and the ranking
		// becomes catalogue order.
		expect(scoreSkillRelevance(onTopic, query)).toBeGreaterThan(scoreSkillRelevance(offTopic, query));
	});

	it("reports no query when the session has only tool traffic", () => {
		session.agent.state.messages = [assistantWithToolCalls(), toolResult("a")] as never;
		expect(currentQuery()).toBeUndefined();
	});
});
