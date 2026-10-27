import { type AssistantMessage, type AssistantMessageEvent, type Context, EventStream } from "omk-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { Agent, type AgentMessage, type AgentTool } from "../src/index.ts";

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

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
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

function tool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `${name} tool`,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: name }], details: {} }),
	};
}

function recordingAgent(sent: string[][]): Agent {
	return new Agent({
		initialState: { tools: [tool("keep"), tool("withheld")] },
		streamFn: (_model, context: Context) => {
			sent.push((context.tools ?? []).map((candidate) => candidate.name));
			const stream = new MockAssistantStream();
			queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: assistant("ok") }));
			return stream;
		},
	});
}

describe("Agent.prepareTools", () => {
	it("sends every active tool when no hook is installed", async () => {
		const sent: string[][] = [];
		const agent = recordingAgent(sent);

		await agent.prompt("hello");

		expect(sent).toEqual([["keep", "withheld"]]);
	});

	it("sends the hook's selection with the pending prompt, leaving active tools unchanged", async () => {
		const sent: string[][] = [];
		const pendingSeen: AgentMessage[][] = [];
		const agent = recordingAgent(sent);
		agent.prepareTools = (tools, pending) => {
			pendingSeen.push([...pending]);
			return tools.filter((candidate) => candidate.name !== "withheld");
		};

		await agent.prompt("hello");

		expect(sent).toEqual([["keep"]]);
		expect(pendingSeen).toHaveLength(1);
		expect(pendingSeen[0]?.map((message) => message.role)).toEqual(["user"]);
		expect(agent.state.tools.map((candidate) => candidate.name)).toEqual(["keep", "withheld"]);
	});

	it("applies the hook to continuations, where nothing is pending", async () => {
		const sent: string[][] = [];
		const pendingSeen: number[] = [];
		const agent = recordingAgent(sent);
		agent.state.messages = [{ role: "user", content: [{ type: "text", text: "resume" }], timestamp: Date.now() }];
		agent.prepareTools = (tools, pending) => {
			pendingSeen.push(pending.length);
			return tools.filter((candidate) => candidate.name === "keep");
		};

		await agent.continue();

		expect(sent).toEqual([["keep"]]);
		expect(pendingSeen).toEqual([0]);
	});

	it("a prepareTools throw on continue still opens the run, ends it with the real error, and sends nothing", async () => {
		const sent: string[][] = [];
		const agent = recordingAgent(sent);
		await agent.prompt("hello");
		class Unavailable extends Error {}
		const cause = new Unavailable("required tool missing");
		agent.prepareTools = () => {
			throw cause;
		};
		const events: string[] = [];
		agent.subscribe((event) => {
			events.push(event.type);
		});
		agent.followUp({ role: "user", content: [{ type: "text", text: "next" }], timestamp: Date.now() });

		const error = await agent.continue().catch((caught: unknown) => caught);

		expect(error).toBe(cause);
		expect(events[0]).toBe("agent_start");
		expect(events.at(-1)).toBe("agent_end");
		expect(events.filter((type) => type === "agent_start")).toHaveLength(1);
		expect(sent).toHaveLength(1);
		expect(agent.state.isStreaming).toBe(false);
		const last = agent.state.messages.at(-1);
		expect(last).toMatchObject({ role: "assistant", stopReason: "error" });
		expect((last as { errorMessage?: string }).errorMessage).toContain("required tool missing");
	});

	it("a prepareTools throw on prompt follows the same lifecycle", async () => {
		const sent: string[][] = [];
		const agent = recordingAgent(sent);
		const cause = new Error("boom");
		agent.prepareTools = () => {
			throw cause;
		};
		const events: string[] = [];
		agent.subscribe((event) => {
			events.push(event.type);
		});

		await expect(agent.prompt("hello")).rejects.toBe(cause);
		expect(events[0]).toBe("agent_start");
		expect(events.at(-1)).toBe("agent_end");
		expect(sent).toHaveLength(0);
	});
});
