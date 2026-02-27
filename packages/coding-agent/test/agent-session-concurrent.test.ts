/**
 * Tests for AgentSession concurrent prompt guard.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Agent, AgentBusyError, type AgentTool } from "@oh-my-pi/pi-agent-core";
import { type AssistantMessage, getBundledModel, type ToolCall } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import type { Rule } from "@oh-my-pi/pi-coding-agent/capability/rule";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { TtsrManager } from "@oh-my-pi/pi-coding-agent/export/ttsr";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { Snowflake } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";

// Mock stream that mimics AssistantMessageEventStream
class MockAssistantStream extends AssistantMessageEventStream {}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
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

describe("AgentSession concurrent prompt guard", () => {
	let session: AgentSession;
	let tempDir: string;

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `pi-concurrent-test-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
	});

	afterEach(async () => {
		if (session) {
			session.dispose();
		}
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	async function createSession() {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;
		let abortSignal: AbortSignal | undefined;

		// Use a stream function that responds to abort
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
			},
			streamFn: (_model, _context, options) => {
				abortSignal = options?.signal;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: createAssistantMessage("") });
					const checkAbort = () => {
						if (abortSignal?.aborted) {
							stream.push({ type: "error", reason: "aborted", error: createAssistantMessage("Aborted") });
						} else {
							setTimeout(checkAbort, 5);
						}
					};
					checkAbort();
				});
				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settings = Settings.isolated();
		const authStorage = await AuthStorage.create(path.join(tempDir, "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");

		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
		});

		return session;
	}

	it("should throw when prompt() called while streaming", async () => {
		await createSession();

		// Start first prompt (don't await, it will block until abort)
		const firstPrompt = session.prompt("First message");

		// Wait a tick for isStreaming to be set
		await Bun.sleep(10);

		// Verify we're streaming
		expect(session.isStreaming).toBe(true);

		// Second prompt should reject
		await expect(session.prompt("Second message")).rejects.toBeInstanceOf(AgentBusyError);

		// Cleanup
		await session.abort();
		await firstPrompt.catch(() => {}); // Ignore abort error
	});

	it("should allow steer() while streaming", async () => {
		await createSession();

		// Start first prompt
		const firstPrompt = session.prompt("First message");
		await Bun.sleep(10);

		// steer should work while streaming
		expect(() => session.steer("Steering message")).not.toThrow();
		expect(session.queuedMessageCount).toBe(1);

		// Cleanup
		await session.abort();
		await firstPrompt.catch(() => {});
	});

	it("should allow followUp() while streaming", async () => {
		await createSession();

		// Start first prompt
		const firstPrompt = session.prompt("First message");
		await Bun.sleep(10);

		// followUp should work while streaming
		expect(() => session.followUp("Follow-up message")).not.toThrow();
		expect(session.queuedMessageCount).toBe(1);

		// Cleanup
		await session.abort();
		await firstPrompt.catch(() => {});
	});

	it("should allow prompt() after previous completes", async () => {
		// Create session with a stream that completes immediately
		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
			},
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: createAssistantMessage("") });
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage("Done") });
				});
				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settings = Settings.isolated();
		const authStorage = await AuthStorage.create(path.join(tempDir, "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");

		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
		});

		// First prompt completes
		await session.prompt("First message");

		// Should not be streaming anymore
		expect(session.isStreaming).toBe(false);

		// Second prompt should work
		await expect(session.prompt("Second message")).resolves.toBeUndefined();
	});
});

describe("AgentSession TTSR resume gate", () => {
	let session: AgentSession;
	let tempDir: string;

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `pi-ttsr-gate-test-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
	});

	afterEach(async () => {
		if (session) {
			session.dispose();
		}
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	const testRule: Rule = {
		name: "no-unwrap",
		path: "/tmp/no-unwrap.md",
		content: "Do not use .unwrap()",
		condition: ["\\.unwrap\\("],
		_source: { provider: "test", providerName: "test", path: "/tmp/no-unwrap.md", level: "project" },
	};

	function makeMsg(text: string, stopReason: "stop" | "aborted" = "stop"): AssistantMessage {
		return {
			role: "assistant",
			content: [{ type: "text", text }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "mock",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason,
			timestamp: Date.now(),
		};
	}

	it("prompt() blocks until TTSR interrupt continuation completes", async () => {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;
		let streamCallCount = 0;
		let continuationCompleted = false;

		const ttsrManager = new TtsrManager({
			enabled: true,
			contextMode: "discard",
			interruptMode: "always",
			repeatMode: "once",
			repeatGap: 10,
		});
		ttsrManager.addRule(testRule);

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn: (_model, _context, options) => {
				streamCallCount++;
				const stream = new MockAssistantStream();
				const signal = options?.signal;

				if (streamCallCount === 1) {
					// First stream: emit text that triggers TTSR, then respond to abort
					queueMicrotask(() => {
						const partial = makeMsg("");
						stream.push({ type: "start", partial });
						stream.push({
							type: "text_delta",
							contentIndex: 0,
							delta: "let val = result.unwrap(",
							partial: makeMsg("let val = result.unwrap("),
						});
						// TTSR abort should fire synchronously; poll for it
						const checkAbort = () => {
							if (signal?.aborted) {
								stream.push({
									type: "error",
									reason: "aborted",
									error: makeMsg("let val = result.unwrap(", "aborted"),
								});
							} else {
								setTimeout(checkAbort, 2);
							}
						};
						checkAbort();
					});
				} else {
					// Continuation stream: complete normally after a delay
					setTimeout(() => {
						const partial = makeMsg("");
						stream.push({ type: "start", partial });
						setTimeout(() => {
							continuationCompleted = true;
							stream.push({
								type: "done",
								reason: "stop",
								message: makeMsg('Fixed: let val = result.expect("msg")'),
							});
						}, 80);
					}, 10);
				}

				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settings = Settings.isolated();
		const authStorage = await AuthStorage.create(path.join(tempDir, "testauth-int.db"));
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");

		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
			ttsrManager,
		});

		// prompt() must block until the TTSR continuation completes
		await session.prompt("Write some Rust code");

		// By the time prompt() returns, the continuation must have finished
		expect(continuationCompleted).toBe(true);
		expect(streamCallCount).toBeGreaterThanOrEqual(2);
		expect(session.isStreaming).toBe(false);
	});

	it("prompt() blocks until TTSR deferred continuation completes", async () => {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;
		let streamCallCount = 0;
		let continuationCompleted = false;

		// interruptMode: "never" -> TTSR match queues deferred injection instead of aborting
		const ttsrManager = new TtsrManager({
			enabled: true,
			contextMode: "discard",
			interruptMode: "never",
			repeatMode: "once",
			repeatGap: 10,
		});
		ttsrManager.addRule(testRule);

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn: (_model, _context, _options) => {
				streamCallCount++;
				const stream = new MockAssistantStream();

				if (streamCallCount === 1) {
					// First stream: emit matching text and complete normally
					queueMicrotask(() => {
						const partial = makeMsg("");
						stream.push({ type: "start", partial });
						stream.push({
							type: "text_delta",
							contentIndex: 0,
							delta: "let val = result.unwrap(",
							partial: makeMsg("let val = result.unwrap("),
						});
						// Complete normally (no abort) -- deferred path
						stream.push({
							type: "done",
							reason: "stop",
							message: makeMsg("let val = result.unwrap()"),
						});
					});
				} else {
					// Continuation stream after deferred TTSR injection
					setTimeout(() => {
						const partial = makeMsg("");
						stream.push({ type: "start", partial });
						setTimeout(() => {
							continuationCompleted = true;
							stream.push({
								type: "done",
								reason: "stop",
								message: makeMsg('Fixed: let val = result.expect("msg")'),
							});
						}, 80);
					}, 10);
				}

				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settings = Settings.isolated();
		const authStorage = await AuthStorage.create(path.join(tempDir, "testauth-def.db"));
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");

		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
			ttsrManager,
		});

		// prompt() must block until the deferred TTSR continuation completes
		await session.prompt("Write some Rust code");

		// By the time prompt() returns, the deferred continuation must have finished
		expect(continuationCompleted).toBe(true);
		expect(streamCallCount).toBeGreaterThanOrEqual(2);
		expect(session.isStreaming).toBe(false);
	});

	it("prompt() returns immediately when session is aborted during TTSR wait", async () => {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;

		const ttsrManager = new TtsrManager({
			enabled: true,
			contextMode: "discard",
			interruptMode: "always",
			repeatMode: "once",
			repeatGap: 10,
		});
		ttsrManager.addRule(testRule);

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn: (_model, _context, options) => {
				const stream = new MockAssistantStream();
				const signal = options?.signal;

				queueMicrotask(() => {
					const partial = makeMsg("");
					stream.push({ type: "start", partial });
					stream.push({
						type: "text_delta",
						contentIndex: 0,
						delta: "result.unwrap(",
						partial: makeMsg("result.unwrap("),
					});
					const checkAbort = () => {
						if (signal?.aborted) {
							stream.push({
								type: "error",
								reason: "aborted",
								error: makeMsg("result.unwrap(", "aborted"),
							});
						} else {
							setTimeout(checkAbort, 2);
						}
					};
					checkAbort();
				});

				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settings = Settings.isolated();
		const authStorage = await AuthStorage.create(path.join(tempDir, "testauth-abt.db"));
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");

		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
			ttsrManager,
		});

		// Start prompt (will trigger TTSR and create resume gate)
		const promptPromise = session.prompt("Write some Rust code");

		// Wait for TTSR abort to be pending
		await Bun.sleep(20);

		// Abort session — prompt() should unblock
		await session.abort();
		await promptPromise;

		expect(session.isStreaming).toBe(false);
	});

	it("prompt() waits for TTSR continuation with tool calls to finish", async () => {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;
		let streamCallCount = 0;
		let toolExecutionFinished = false;
		let allTurnsCompleted = false;

		const ttsrManager = new TtsrManager({
			enabled: true,
			contextMode: "discard",
			interruptMode: "always",
			repeatMode: "once",
			repeatGap: 10,
		});
		ttsrManager.addRule(testRule);

		const mockTool: AgentTool = {
			name: "mock_edit",
			label: "Mock Edit",
			description: "A mock edit tool",
			parameters: Type.Object({}),
			execute: async () => {
				await Bun.sleep(100);
				toolExecutionFinished = true;
				return { content: [{ type: "text" as const, text: "edit applied" }] };
			},
		};

		const toolCallContent: ToolCall = {
			type: "toolCall",
			id: "call_test_001",
			name: "mock_edit",
			arguments: {},
		};

		function makeToolCallMsg(): AssistantMessage {
			return {
				role: "assistant",
				content: [toolCallContent],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "mock",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: Date.now(),
			};
		}

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [mockTool] },
			streamFn: (_model, _context, options) => {
				streamCallCount++;
				const stream = new MockAssistantStream();
				const signal = options?.signal;

				if (streamCallCount === 1) {
					// First stream: emit text that triggers TTSR, then respond to abort
					queueMicrotask(() => {
						const partial = makeMsg("");
						stream.push({ type: "start", partial });
						stream.push({
							type: "text_delta",
							contentIndex: 0,
							delta: "let val = result.unwrap(",
							partial: makeMsg("let val = result.unwrap("),
						});
						const checkAbort = () => {
							if (signal?.aborted) {
								stream.push({
									type: "error",
									reason: "aborted",
									error: makeMsg("let val = result.unwrap(", "aborted"),
								});
							} else {
								setTimeout(checkAbort, 2);
							}
						};
						checkAbort();
					});
				} else if (streamCallCount === 2) {
					// Continuation: return assistant message with a tool call
					setTimeout(() => {
						const msg = makeToolCallMsg();
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "done", reason: "toolUse", message: msg });
					}, 10);
				} else {
					// After tool execution: return final response
					setTimeout(() => {
						allTurnsCompleted = true;
						const msg = makeMsg('Fixed: let val = result.expect("msg")');
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "done", reason: "stop", message: msg });
					}, 10);
				}

				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settings = Settings.isolated();
		const authStorage = await AuthStorage.create(path.join(tempDir, "testauth-tool.db"));
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");

		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
			ttsrManager,
		});

		// prompt() must block until the TTSR continuation (including tool execution) completes.
		// Before the fix, prompt() returned after the continuation's first assistant message_end,
		// while the agent was still executing tool calls in the background.
		await session.prompt("Write some Rust code");

		// By the time prompt() returns, ALL turns must have completed
		expect(toolExecutionFinished).toBe(true);
		expect(allTurnsCompleted).toBe(true);
		expect(streamCallCount).toBeGreaterThanOrEqual(3);
		expect(session.isStreaming).toBe(false);
	});
	it("prompt() waits for context-promotion continuation to finish", async () => {
		const authStorage = await AuthStorage.create(path.join(tempDir, "testauth-promo.db"));
		authStorage.setRuntimeApiKey("openai-codex", "test-key");
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));

		const sparkModel = modelRegistry.find("openai-codex", "gpt-5.3-codex-spark");
		const codexModel = modelRegistry.find("openai-codex", "gpt-5.3-codex");
		if (!sparkModel || !codexModel) {
			throw new Error("Expected codex spark and codex models to exist");
		}

		let streamCallCount = 0;
		let continuationCompleted = false;

		const makeOverflowMessage = (): AssistantMessage => ({
			role: "assistant",
			content: [{ type: "text", text: "" }],
			api: sparkModel.api,
			provider: sparkModel.provider,
			model: sparkModel.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "error",
			errorMessage: "context_length_exceeded: Your input exceeds the context window of this model.",
			timestamp: Date.now(),
		});

		const makeSuccessMessage = (): AssistantMessage => ({
			role: "assistant",
			content: [{ type: "text", text: "Recovered after promotion" }],
			api: codexModel.api,
			provider: codexModel.provider,
			model: codexModel.id,
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
		});

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model: sparkModel, systemPrompt: "Test", tools: [] },
			streamFn: () => {
				streamCallCount++;
				const stream = new MockAssistantStream();
				if (streamCallCount === 1) {
					queueMicrotask(() => {
						const message = makeOverflowMessage();
						stream.push({ type: "start", partial: message });
						stream.push({ type: "error", reason: "error", error: message });
					});
				} else {
					setTimeout(() => {
						continuationCompleted = true;
						const message = makeSuccessMessage();
						stream.push({ type: "start", partial: message });
						stream.push({ type: "done", reason: "stop", message });
					}, 80);
				}
				return stream;
			},
		});

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.enabled": false, "contextPromotion.enabled": true }),
			modelRegistry,
		});

		await session.prompt("Handle overflow");

		expect(continuationCompleted).toBe(true);
		expect(streamCallCount).toBeGreaterThanOrEqual(2);
		expect(session.model?.id).toBe(codexModel.id);
		expect(session.isStreaming).toBe(false);
	});
});
