import { afterEach, describe, expect, it, vi } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { Settings } from "../../src/config/settings";
import type { LoadExtensionsResult } from "../../src/extensibility/extensions/types";
import * as sdkModule from "../../src/sdk";
import type { AgentSession, AgentSessionEvent } from "../../src/session/agent-session";
import type { AuthStorage } from "../../src/session/auth-storage";
import { runSubprocess, SUBAGENT_WARNING_MISSING_SUBMIT_RESULT } from "../../src/task/executor";
import type { AgentDefinition } from "../../src/task/types";

vi.mock("../../src/sdk", () => ({
	createAgentSession: vi.fn(),
	discoverAuthStorage: vi.fn(async () => ({})),
}));

function createAssistantStopMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: text ? [{ type: "text", text }] : [],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createMockSession(
	onPrompt: (params: {
		text: string;
		promptIndex: number;
		emit: (event: AgentSessionEvent) => void;
		state: { messages: AssistantMessage[] };
	}) => void,
): AgentSession {
	const listeners: Array<(event: AgentSessionEvent) => void> = [];
	const state = { messages: [] as AssistantMessage[] };
	let promptIndex = 0;

	const emit = (event: AgentSessionEvent) => {
		for (const listener of listeners) listener(event);
	};

	const session = {
		state,
		agent: { state: { systemPrompt: "test" } },
		model: undefined,
		extensionRunner: undefined,
		sessionManager: {
			appendSessionInit: () => {},
		},
		getActiveToolNames: () => ["read", "submit_result"],
		setActiveToolsByName: async (_toolNames: string[]) => {},
		subscribe: (listener: (event: AgentSessionEvent) => void) => {
			listeners.push(listener);
			return () => {
				const index = listeners.indexOf(listener);
				if (index >= 0) listeners.splice(index, 1);
			};
		},
		prompt: async (text: string) => {
			promptIndex += 1;
			onPrompt({ text, promptIndex, emit, state });
		},
		waitForIdle: async () => {},
		getLastAssistantMessage: () => state.messages[state.messages.length - 1],
		abort: async () => {},
		dispose: async () => {},
	};

	return session as unknown as AgentSession;
}

describe("runSubprocess submit_result reminders", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const baseAgent: AgentDefinition = {
		name: "task",
		description: "test",
		systemPrompt: "test",
		source: "bundled",
	};

	const baseOptions = {
		cwd: "/tmp",
		agent: baseAgent,
		task: "do work",
		index: 0,
		id: "subagent-1",
		settings: Settings.isolated(),
		authStorage: {} as unknown as AuthStorage,
		modelRegistry: { refresh: async () => {} } as unknown as import("../../src/config/model-registry").ModelRegistry,
		enableLsp: false,
	};

	it("sends reminder prompt when subagent stops without submit_result", async () => {
		const prompts: string[] = [];
		const session = createMockSession(({ text, promptIndex, emit, state }) => {
			prompts.push(text);
			if (promptIndex === 1) {
				const assistant = createAssistantStopMessage("did some work");
				state.messages.push(assistant);
				emit({ type: "message_end", message: assistant });
				return;
			}
			emit({
				type: "tool_execution_end",
				toolCallId: "tool-1",
				toolName: "submit_result",
				result: {
					content: [{ type: "text", text: "Result submitted." }],
					details: { status: "success", data: { done: true } },
				},
				isError: false,
			});
		});

		(sdkModule.createAgentSession as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({
			session,
			extensionsResult: {} as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
		});

		const result = await runSubprocess(baseOptions);
		expect(prompts.length).toBe(2);
		expect(prompts[1]).toContain("You stopped without calling submit_result");
		expect(result.output).toContain('"done": true');
		expect(result.output.includes("SYSTEM WARNING")).toBe(false);
	});

	it("keeps null submit_result warning when subagent submits success without data", async () => {
		const session = createMockSession(({ promptIndex, emit, state }) => {
			if (promptIndex === 1) {
				const assistant = createAssistantStopMessage("partial output");
				state.messages.push(assistant);
				emit({ type: "message_end", message: assistant });
				return;
			}
			emit({
				type: "tool_execution_end",
				toolCallId: "tool-2",
				toolName: "submit_result",
				result: {
					content: [{ type: "text", text: "Result submitted." }],
					details: { status: "success" },
				},
				isError: false,
			});
		});

		(sdkModule.createAgentSession as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({
			session,
			extensionsResult: {} as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
		});

		const result = await runSubprocess({ ...baseOptions, id: "subagent-2" });
		expect(result.output).toContain("SYSTEM WARNING: Subagent called submit_result with null data.");
	});

	it("retries when submit_result tool returns an error before succeeding", async () => {
		const prompts: string[] = [];
		const session = createMockSession(({ text, promptIndex, emit, state }) => {
			prompts.push(text);
			if (promptIndex === 1) {
				const assistant = createAssistantStopMessage("attempted submit_result");
				state.messages.push(assistant);
				emit({ type: "message_end", message: assistant });
				emit({
					type: "tool_execution_end",
					toolCallId: "tool-error",
					toolName: "submit_result",
					result: {
						content: [{ type: "text", text: "Output does not match schema" }],
						details: { status: "error", error: "Output does not match schema" },
					},
					isError: true,
				});
				return;
			}
			emit({
				type: "tool_execution_end",
				toolCallId: "tool-success",
				toolName: "submit_result",
				result: {
					content: [{ type: "text", text: "Result submitted." }],
					details: { status: "success", data: { ok: true } },
				},
				isError: false,
			});
		});

		(sdkModule.createAgentSession as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({
			session,
			extensionsResult: {} as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
		});

		const result = await runSubprocess({ ...baseOptions, id: "subagent-err-then-success" });
		expect(prompts).toHaveLength(2);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('"ok": true');
	});
	it("aborts after 3 reminders when submit_result is never called", async () => {
		const prompts: string[] = [];
		const session = createMockSession(({ text, promptIndex, emit, state }) => {
			prompts.push(text);
			const assistant = createAssistantStopMessage(promptIndex === 1 ? "did work" : "still no submit_result");
			state.messages.push(assistant);
			emit({ type: "message_end", message: assistant });
		});

		(sdkModule.createAgentSession as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({
			session,
			extensionsResult: {} as unknown as LoadExtensionsResult,
			setToolUIContext: () => {},
		});

		const result = await runSubprocess({
			...baseOptions,
			id: "subagent-3",
			outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
		});
		expect(prompts).toHaveLength(4);
		expect(result.exitCode).toBe(1);
		expect(result.aborted).toBe(true);
		expect(result.stderr).toBe(SUBAGENT_WARNING_MISSING_SUBMIT_RESULT);
	});
});
