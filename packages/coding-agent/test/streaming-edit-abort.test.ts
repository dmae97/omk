/**
 * Streaming edit abort tests.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentTool } from "@oh-my-pi/pi-agent-core";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	getModel,
	type StopReason,
	type ToolCall,
} from "@oh-my-pi/pi-ai";
import { Type } from "@sinclair/typebox";
import { nanoid } from "nanoid";
import { ModelRegistry } from "$c/config/model-registry";
import { SettingsManager } from "$c/config/settings-manager";
import { AgentSession } from "$c/session/agent-session";
import { AuthStorage } from "$c/session/auth-storage";
import { SessionManager } from "$c/session/session-manager";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(content: AssistantMessage["content"], stopReason: StopReason): AssistantMessage {
	return {
		role: "assistant",
		content,
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

function createToolCall(id: string, args: Record<string, unknown>): ToolCall {
	return {
		type: "toolCall",
		id,
		name: "edit",
		arguments: args,
	};
}

function lastAssistantMessage(messages: Array<{ role: string }>): AssistantMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") return msg as AssistantMessage;
	}
	return undefined;
}

function createRng(seed: number): () => number {
	let state = seed % 2147483647;
	if (state <= 0) state += 2147483646;
	return () => {
		state = (state * 48271) % 2147483647;
		return state / 2147483647;
	};
}

function chunkStringRandomly(text: string, seed: number): string[] {
	const rand = createRng(seed);
	const chunks: string[] = [];
	let offset = 0;
	while (offset < text.length) {
		const remaining = text.length - offset;
		const maxSize = Math.min(8, remaining);
		const size = Math.max(1, Math.floor(rand() * maxSize) + 1);
		chunks.push(text.slice(offset, offset + size));
		offset += size;
	}
	return chunks;
}

async function createSession(tempDir: string, streamFn: Agent["streamFn"], tool: AgentTool): Promise<AgentSession> {
	const model = getModel("anthropic", "claude-sonnet-4-5")!;
	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: {
			model,
			systemPrompt: "Test",
			tools: [tool],
		},
		streamFn,
	});

	const sessionManager = SessionManager.inMemory(tempDir);
	const settingsManager = SettingsManager.inMemory({ edit: { streamingAbort: true } });
	const authStorage = new AuthStorage(join(tempDir, "auth.json"));
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const modelRegistry = new ModelRegistry(authStorage, tempDir);

	return new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		modelRegistry,
	});
}

function buildEditTool(): AgentTool {
	const schema = Type.Object({
		path: Type.String(),
		diff: Type.String(),
		op: Type.Optional(Type.String()),
		rename: Type.Optional(Type.String()),
	});

	return {
		name: "edit",
		label: "Edit",
		description: "",
		parameters: schema,
		async execute() {
			return { content: [{ type: "text", text: "ok" }] };
		},
	};
}

function createStreamForDiff(
	path: string,
	chunks: string[],
	abortSignalRef: { current?: AbortSignal },
): Agent["streamFn"] {
	let callIndex = 0;
	return (_model, _context, options) => {
		abortSignalRef.current = options?.signal;
		const stream = new MockAssistantStream();
		const toolCallId = "call_edit_1";
		let diffSoFar = "";
		let aborted = false;

		const notifyAbort = () => {
			if (aborted) return;
			aborted = true;
			const partialCall = createToolCall(toolCallId, { path, diff: diffSoFar });
			stream.push({
				type: "toolcall_delta",
				contentIndex: 0,
				delta: "",
				partial: createAssistantMessage([partialCall], "stop"),
			});
			stream.push({ type: "error", reason: "aborted", error: createAssistantMessage([], "aborted") });
		};

		options?.signal?.addEventListener("abort", notifyAbort, { once: true });

		queueMicrotask(async () => {
			if (callIndex > 0) {
				const finalMessage = createAssistantMessage([{ type: "text", text: "done" }], "stop");
				stream.push({ type: "done", reason: "stop", message: finalMessage });
				callIndex++;
				return;
			}
			const startMessage = createAssistantMessage([], "stop");
			stream.push({ type: "start", partial: startMessage });

			const startCall = createToolCall(toolCallId, { path, diff: "" });
			stream.push({ type: "toolcall_start", contentIndex: 0, partial: createAssistantMessage([startCall], "stop") });

			for (const chunk of chunks) {
				if (aborted) return;
				diffSoFar += chunk;
				const partialCall = createToolCall(toolCallId, { path, diff: diffSoFar });
				stream.push({
					type: "toolcall_delta",
					contentIndex: 0,
					delta: chunk,
					partial: createAssistantMessage([partialCall], "stop"),
				});
				await Bun.sleep(0);
			}

			if (aborted) return;

			const finalCall = createToolCall(toolCallId, { path, diff: diffSoFar });
			const finalMessage = createAssistantMessage([finalCall], "toolUse");
			stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: finalCall, partial: finalMessage });
			stream.push({ type: "done", reason: "toolUse", message: finalMessage });
			callIndex++;
		});

		return stream;
	};
}

describe("streaming edit abort", () => {
	let tempDir: string;
	const editTool = buildEditTool();
	const seeds = [7, 21, 42, 84, 128];

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-streaming-edit-${nanoid()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(async () => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("does not abort for successful patches across random streams", async () => {
		await Bun.write(join(tempDir, "sample.txt"), "alpha\nbeta\ngamma\n");
		const diff = "@@\n-beta\n+beta2\n";

		for (const seed of seeds) {
			const chunks = chunkStringRandomly(diff, seed);
			const abortSignalRef: { current?: AbortSignal } = {};
			const streamFn = createStreamForDiff("sample.txt", chunks, abortSignalRef);
			const session = await createSession(tempDir, streamFn, editTool);

			await session.prompt("apply patch");

			const lastAssistant = lastAssistantMessage(session.state.messages);
			expect(lastAssistant?.stopReason).not.toBe("aborted");
			expect(abortSignalRef.current?.aborted ?? false).toBe(false);
			await session.dispose();
		}
	});

	it("aborts for failing patches across random streams", async () => {
		await Bun.write(join(tempDir, "sample.txt"), "alpha\nbeta\ngamma\n");
		const diff = "@@\n-omega\n+beta2\n";

		for (const seed of seeds) {
			const chunks = chunkStringRandomly(diff, seed);
			const abortSignalRef: { current?: AbortSignal } = {};
			const streamFn = createStreamForDiff("sample.txt", chunks, abortSignalRef);
			const session = await createSession(tempDir, streamFn, editTool);

			await session.prompt("apply patch");

			const lastAssistant = lastAssistantMessage(session.state.messages);
			expect(lastAssistant?.stopReason).toBe("aborted");
			expect(abortSignalRef.current?.aborted ?? false).toBe(true);
			await session.dispose();
		}
	});
});
