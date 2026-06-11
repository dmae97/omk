import type { AssistantMessage, Message, Model, UserMessage } from "@earendil-works/pi-ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentLoop, agentLoopContinue } from "../../src/agent-loop.ts";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, StreamFn } from "../../src/types.ts";

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function createUserMessage(text: string): UserMessage {
	return {
		role: "user",
		content: text,
		timestamp: Date.now(),
	};
}

function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

function expectAssistantFailure(message: AgentMessage, errorText: string): AssistantMessage {
	expect(message.role).toBe("assistant");
	if (message.role !== "assistant") {
		throw new Error("expected an assistant failure message");
	}
	expect(message.stopReason).toBe("error");
	expect(message.errorMessage).toContain(errorText);
	return message;
}

const unhandledRejections: unknown[] = [];
function onUnhandledRejection(reason: unknown): void {
	unhandledRejections.push(reason);
}

beforeAll(() => {
	process.on("unhandledRejection", onUnhandledRejection);
});

afterAll(() => {
	process.off("unhandledRejection", onUnhandledRejection);
});

describe("agentLoop/agentLoopContinue stream termination on loop rejection", () => {
	it("agentLoop ends the stream with a coherent failure sequence when streamFn throws", async () => {
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};
		// Mimics pi-ai's streamSimple throwing synchronously for an unregistered API.
		const failingStreamFn: StreamFn = () => {
			throw new Error("No API provider registered for api: mock");
		};

		const prompt = createUserMessage("Hello");
		const stream = agentLoop([prompt], context, config, undefined, failingStreamFn);

		// Without the fix this loop never terminates: the stream is never ended.
		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();

		const types = events.map((e) => e.type);
		expect(types.slice(-4)).toEqual(["message_start", "message_end", "turn_end", "agent_end"]);

		// Messages so far (the prompt) are preserved, followed by the failure message.
		expect(messages.length).toBe(2);
		expect(messages[0].role).toBe("user");
		expectAssistantFailure(messages[1], "No API provider registered");

		const lastEvent = events[events.length - 1];
		expect(lastEvent.type).toBe("agent_end");
		if (lastEvent.type === "agent_end") {
			expect(lastEvent.messages).toEqual(messages);
		}
	});

	it("agentLoop settles when convertToLlm rejects", async () => {
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: async () => {
				throw new Error("convertToLlm rejected");
			},
		};

		const stream = agentLoop([createUserMessage("Hello")], context, config);

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();
		expectAssistantFailure(messages[messages.length - 1], "convertToLlm rejected");
	});

	it("agentLoopContinue ends the stream when a hook rejects", async () => {
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [createUserMessage("Hello")],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			transformContext: async () => {
				throw new Error("transformContext rejected");
			},
		};

		const stream = agentLoopContinue(context, config);

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();

		const types = events.map((e) => e.type);
		expect(types.slice(-4)).toEqual(["message_start", "message_end", "turn_end", "agent_end"]);
		expectAssistantFailure(messages[messages.length - 1], "transformContext rejected");
	});

	it("does not leak unhandled rejections", async () => {
		// Let any pending rejection from the previous tests surface.
		await new Promise((resolve) => setImmediate(resolve));
		expect(unhandledRejections).toEqual([]);
	});
});
