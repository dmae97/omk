import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import * as path from "node:path";
import { TempDir } from "@oh-my-pi/pi-utils";

const compactMock = vi.fn();

mock.module("../src/session/compaction", () => ({
	calculateContextTokens: (usage: { totalTokens?: number; input: number; output: number; cacheRead: number; cacheWrite: number }) =>
		usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
	calculatePromptTokens: () => 0,
	collectEntriesForBranchSummary: () => [],
	compact: compactMock,
	estimateTokens: () => 0,
	generateBranchSummary: async () => "Branch summary",
	prepareCompaction: (entries: Array<{ id?: string }>) => ({
		firstKeptEntryId: entries[entries.length - 1]?.id ?? "missing-entry",
		messagesToSummarize: [],
		turnPrefixMessages: [],
		recentMessages: [],
		isSplitTurn: false,
		tokensBefore: 321,
		previousSummary: undefined,
		previousPreserveData: undefined,
		fileOps: { read: new Set<string>(), edited: new Set<string>() },
		settings: {
			enabled: true,
			strategy: "context-full",
			thresholdPercent: 80,
			reserveTokens: 16384,
			keepRecentTokens: 20000,
			autoContinue: false,
			remoteEnabled: false,
		},
	}),
	shouldCompact: () => true,
}));

describe("AgentSession compaction Copilot initiator attribution", async () => {
	const { getBundledModel } = await import("@oh-my-pi/pi-ai");
	const { Settings } = await import("../src/config/settings");
	const { createAgentSession } = await import("../src/sdk");
	const { AuthStorage } = await import("../src/session/auth-storage");
	const { SessionManager } = await import("../src/session/session-manager");

	let tempDir: TempDir;
	const sessions: Array<{ dispose: () => Promise<void> }> = [];

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-auto-compaction-x-initiator-");
		compactMock.mockReset();
		compactMock.mockImplementation((preparation: { firstKeptEntryId: string }) => ({
			summary: "Compacted summary",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: 321,
		}));
	});

	afterEach(async () => {
		for (const session of sessions.splice(0)) {
			await session.dispose();
		}
		vi.restoreAllMocks();
		tempDir.removeSync();
	});

	async function createSession(taskDepth: number) {
		const model = getBundledModel("github-copilot", "gpt-4o");
		if (!model) {
			throw new Error("Expected github-copilot/gpt-4o model to exist");
		}

		const authStorage = await AuthStorage.create(path.join(tempDir.path(), `testauth-${taskDepth}.db`));
		authStorage.setRuntimeApiKey("github-copilot", "test-key");

		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({
			role: "user",
			content: "Initial request with enough text to summarize later.",
			timestamp: Date.now() - 3,
		});
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "Initial response with extra context for compaction." }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			stopReason: "stop",
			usage: {
				input: 100,
				output: 50,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 150,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now() - 2,
		});
		sessionManager.appendMessage({
			role: "user",
			content: "Latest request before the oversized assistant turn.",
			timestamp: Date.now(),
		});

		const { session } = await createAgentSession({
			cwd: tempDir.path(),
			agentDir: tempDir.path(),
			authStorage,
			model,
			sessionManager,
			settings: Settings.isolated({
				"compaction.autoContinue": false,
			}),
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			taskDepth,
		});
		sessions.push(session);
		return { model, session };
	}

	function expectNoForcedCopilotHeader(model: { headers?: Record<string, string> | undefined }) {
		expect(model.headers?.["X-Initiator"]).toBeUndefined();
	}

	async function triggerAutoCompaction(session: {
		agent: { emitExternalEvent: (event: unknown) => void };
		subscribe: (listener: (event: { type: string }) => void) => () => void;
	}, model: { api: string; provider: string; id: string; contextWindow: number }) {
		const { promise, resolve } = Promise.withResolvers<void>();
		const unsubscribe = session.subscribe(event => {
			if (event.type === "auto_compaction_end") {
				unsubscribe();
				resolve();
			}
		});

		const assistantMessage = {
			role: "assistant" as const,
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			stopReason: "stop" as const,
			usage: {
				input: model.contextWindow,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: model.contextWindow,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now(),
		};

		session.agent.emitExternalEvent({ type: "message_end", message: assistantMessage });
		session.agent.emitExternalEvent({ type: "agent_end", messages: [assistantMessage] });

		await promise;
	}

	it("keeps main-session manual compaction user-attributed", async () => {
		const { model, session } = await createSession(0);

		await session.compact();

		expect(compactMock).toHaveBeenCalledTimes(1);
		const compactModel = compactMock.mock.calls[0]?.[1] as { provider: string; id: string; headers?: Record<string, string> };
		const compactOptions = compactMock.mock.calls[0]?.[5] as { initiatorOverride?: string } | undefined;
		expect(compactModel.provider).toBe("github-copilot");
		expect(compactModel.id).toBe(model.id);
		expectNoForcedCopilotHeader(compactModel);
		expect(compactOptions?.initiatorOverride).toBeUndefined();
	});

	it("uses agent attribution for main-session auto-compaction", async () => {
		const { model, session } = await createSession(0);

		await triggerAutoCompaction(session, model);

		expect(compactMock).toHaveBeenCalledTimes(1);
		const compactModel = compactMock.mock.calls[0]?.[1] as { provider: string; id: string; headers?: Record<string, string> };
		const compactOptions = compactMock.mock.calls[0]?.[5] as { initiatorOverride?: string } | undefined;
		expect(compactModel.provider).toBe("github-copilot");
		expect(compactModel.id).toBe(model.id);
		expectNoForcedCopilotHeader(compactModel);
		expect(compactOptions?.initiatorOverride).toBe("agent");
	});

	it("keeps subagent manual compaction user-attributed", async () => {
		const { model, session } = await createSession(1);

		await session.compact();

		expect(compactMock).toHaveBeenCalledTimes(1);
		const compactModel = compactMock.mock.calls[0]?.[1] as { provider: string; id: string; headers?: Record<string, string> };
		const compactOptions = compactMock.mock.calls[0]?.[5] as { initiatorOverride?: string } | undefined;
		expect(compactModel.provider).toBe("github-copilot");
		expect(compactModel.id).toBe(model.id);
		expectNoForcedCopilotHeader(compactModel);
		expect(compactOptions?.initiatorOverride).toBeUndefined();
	});

	it("uses agent attribution for subagent auto-compaction", async () => {
		const { model, session } = await createSession(1);

		await triggerAutoCompaction(session, model);

		expect(compactMock).toHaveBeenCalledTimes(1);
		const compactModel = compactMock.mock.calls[0]?.[1] as { provider: string; id: string; headers?: Record<string, string> };
		const compactOptions = compactMock.mock.calls[0]?.[5] as { initiatorOverride?: string } | undefined;
		expect(compactModel.provider).toBe("github-copilot");
		expect(compactModel.id).toBe(model.id);
		expectNoForcedCopilotHeader(compactModel);
		expect(compactOptions?.initiatorOverride).toBe("agent");
	});
});