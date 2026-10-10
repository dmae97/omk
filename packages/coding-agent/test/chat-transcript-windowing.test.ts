import { Agent, type AgentEvent, type AgentTool } from "omk-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream } from "omk-ai";
import { Container, type TUI } from "omk-tui";
import { Type } from "typebox";
import { beforeAll, describe, expect, test } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { ChatContainer } from "../src/modes/interactive/components/chat-container.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

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

/** A provider stream that yields `start` and then throws (spec 026 F1 failure path). */
class ThrowingAssistantStream extends MockAssistantStream {
	private readonly partial: AssistantMessage;

	constructor(partial: AssistantMessage) {
		super();
		this.partial = partial;
	}

	override async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
		yield { type: "start", partial: this.partial };
		throw new Error("provider exploded mid-stream");
	}
}

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop") {
	const message: AssistantMessage = {
		role: "assistant",
		content,
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
		stopReason,
		timestamp: Date.now(),
	};
	return message;
}

const fakeTui = { requestRender: () => {} } as unknown as TUI;

function toolComponent(name: string, id: string, args: unknown): ToolExecutionComponent {
	return new ToolExecutionComponent(name, id, args, {}, undefined, fakeTui, process.cwd());
}

/**
 * Mirrors the interactive-mode event wiring that matters for the transcript:
 * a component per streamed assistant message and per tool execution, with
 * every event forwarded to ChatContainer.handleAgentEvent afterwards.
 */
function attachTranscript(agent: Agent, chat: ChatContainer) {
	const record = { assistantStarts: 0, assistantEnds: 0, liveBeforeAgentEnd: -1, liveAfterAgentEnd: -1 };
	let streaming: AssistantMessageComponent | undefined;
	const tools = new Map<string, ToolExecutionComponent>();
	agent.subscribe((event: AgentEvent) => {
		switch (event.type) {
			case "message_start":
				if (event.message.role === "assistant") {
					record.assistantStarts += 1;
					streaming = new AssistantMessageComponent(undefined);
					chat.addChild(streaming);
					streaming.updateContent(event.message);
				}
				break;
			case "message_update":
				if (event.message.role === "assistant") streaming?.updateContent(event.message);
				break;
			case "message_end":
				if (event.message.role === "assistant") {
					record.assistantEnds += 1;
					streaming?.updateContent(event.message);
					streaming = undefined;
				}
				break;
			case "tool_execution_start": {
				const component = toolComponent(event.toolName, event.toolCallId, event.args);
				chat.addChild(component);
				tools.set(event.toolCallId, component);
				break;
			}
			case "tool_execution_end": {
				const result = event.result as { content: { type: string; text?: string }[] };
				tools.get(event.toolCallId)?.updateResult({ content: result.content, isError: event.isError });
				break;
			}
			case "agent_end":
				record.liveBeforeAgentEnd = chat.getLiveChildCount();
				break;
		}
		chat.handleAgentEvent(event);
		if (event.type === "agent_end") record.liveAfterAgentEnd = chat.getLiveChildCount();
	});
	return record;
}

describe("chat transcript windowing lifecycle (spec 026 AC1/AC2, spec 022)", () => {
	beforeAll(() => initTheme("dark"));

	test("AC1 normal path: tool turn then text turn, every start paired and nothing live after agent_end", async () => {
		const schema = Type.Object({ path: Type.String() });
		const tool: AgentTool<typeof schema> = {
			name: "read",
			label: "Read",
			description: "read",
			parameters: schema,
			async execute(_id, params) {
				return { content: [{ type: "text", text: `read ${params.path}` }], details: {} };
			},
		};
		let turn = 0;
		const agent = new Agent({
			initialState: { tools: [tool] },
			streamFn: () => {
				const current = turn++;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					const partial = assistant([{ type: "text", text: "" }]);
					stream.push({ type: "start", partial });
					stream.push({
						type: "text_delta",
						contentIndex: 0,
						delta: "hi",
						partial: assistant([{ type: "text", text: "hi" }]),
					});
					stream.push(
						current === 0
							? {
									type: "done",
									reason: "toolUse",
									message: assistant(
										[{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "a" } }],
										"toolUse",
									),
								}
							: { type: "done", reason: "stop", message: assistant([{ type: "text", text: "done" }]) },
					);
				});
				return stream;
			},
		});
		const chat = new ChatContainer();
		const record = attachTranscript(agent, chat);
		await agent.prompt("go");
		expect(record.assistantStarts).toBe(2);
		expect(record.assistantEnds).toBe(2);
		expect(record.liveBeforeAgentEnd).toBe(0);
		expect(record.liveAfterAgentEnd).toBe(0);
	});

	test("AC1 provider error path pairs start/end and leaves nothing live", async () => {
		const agent = new Agent({
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: assistant([{ type: "text", text: "par" }]) });
					stream.push({ type: "error", reason: "error", error: assistant([], "error") });
				});
				return stream;
			},
		});
		const chat = new ChatContainer();
		const record = attachTranscript(agent, chat);
		await agent.prompt("go");
		expect(record.assistantStarts).toBe(record.assistantEnds);
		expect(record.liveAfterAgentEnd).toBe(0);
	});

	test("AC1 abort path pairs start/end and leaves nothing live", async () => {
		const agent = new Agent({
			streamFn: (_model, _context, options) => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: assistant([{ type: "text", text: "" }]) });
					const check = () => {
						if (options?.signal?.aborted) {
							stream.push({ type: "error", reason: "aborted", error: assistant([], "aborted") });
						} else {
							setTimeout(check, 2);
						}
					};
					check();
				});
				return stream;
			},
		});
		const chat = new ChatContainer();
		const record = attachTranscript(agent, chat);
		const run = agent.prompt("go");
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(chat.getLiveChildCount()).toBe(1);
		agent.abort();
		await run;
		expect(record.assistantStarts).toBe(record.assistantEnds);
		expect(record.liveAfterAgentEnd).toBe(0);
	});

	test("AC1 mid-stream throw: the partial gets no message_end, agent_end still settles it", async () => {
		const agent = new Agent({
			streamFn: () => new ThrowingAssistantStream(assistant([{ type: "text", text: "partial" }])),
		});
		const chat = new ChatContainer();
		const record = attachTranscript(agent, chat);
		await agent.prompt("go");
		// Recorded finding (spec 026 F1): the failure assistant is a new message with its own
		// start/end pair, and the streamed partial's message_start is never closed.
		expect(record.assistantStarts - record.assistantEnds).toBe(1);
		expect(record.liveAfterAgentEnd).toBe(0);
		for (const child of chat.children) expect(child.isRenderSettled?.() ?? true).toBe(true);
	});

	test("agent_end backstop settles a tool that never received its final result", () => {
		const chat = new ChatContainer();
		const tool = toolComponent("read", "t-1", { path: "x" });
		chat.addChild(tool);
		expect(chat.getLiveChildCount()).toBe(1);
		chat.handleAgentEvent({ type: "message_end", message: assistant([]) });
		expect(chat.getLiveChildCount()).toBe(1);
		chat.handleAgentEvent({ type: "agent_end" });
		expect(chat.getLiveChildCount()).toBe(0);
		// The backstop does not change how the tool renders (still the pending card).
		expect(tool.isRenderSettled()).toBe(false);
	});

	test("message_end settles only the matching open message (responseId, else the oldest)", () => {
		const chat = new ChatContainer();
		const older = new AssistantMessageComponent(undefined);
		const newer = new AssistantMessageComponent(undefined);
		chat.addChild(older);
		chat.addChild(newer);
		chat.handleAgentEvent({ type: "message_end", message: assistant([]) });
		expect(older.isRenderSettled()).toBe(true);
		expect(newer.isRenderSettled()).toBe(false);

		const a = new AssistantMessageComponent(undefined);
		const b = new AssistantMessageComponent(undefined);
		a.updateContent({ ...assistant([]), responseId: "r-a" });
		b.updateContent({ ...assistant([]), responseId: "r-b" });
		chat.addChild(a);
		chat.addChild(b);
		chat.handleAgentEvent({ type: "message_end", message: { ...assistant([]), responseId: "r-b" } });
		expect(b.isRenderSettled()).toBe(true);
		expect(a.isRenderSettled()).toBe(false);
		expect(newer.isRenderSettled()).toBe(false);
		// A late message_end for a message no longer open contradicts every known id.
		chat.handleAgentEvent({ type: "message_end", message: { ...assistant([]), responseId: "r-gone" } });
		expect(a.isRenderSettled()).toBe(false);
		chat.handleAgentEvent({ type: "agent_end" });
		expect(chat.getLiveChildCount()).toBe(0);
	});

	test("late message_end then streaming past the live window keeps output equal to a plain Container (review P3)", () => {
		const md = (i: number) => `## Heading ${i}\n\nSome **bold** and \`code\`.\n\n- a ${"word ".repeat(30)}\n- b\n`;
		const full = new Container();
		const chat = new ChatContainer();
		chat.setLiveLineBudget(20);
		for (const target of [full, chat]) {
			for (let i = 0; i < 30; i++)
				target.addChild(new AssistantMessageComponent(assistant([{ type: "text", text: md(i) }])));
		}
		const streamFull = new AssistantMessageComponent(undefined);
		const streamChat = new AssistantMessageComponent(undefined);
		full.addChild(streamFull);
		chat.addChild(streamChat);
		chat.handleAgentEvent({ type: "message_end", message: assistant([]) });
		for (let k = 0; k < 5; k++) {
			const message = assistant([{ type: "text", text: md(k).repeat(k + 1) }]);
			streamFull.updateContent(message);
			streamChat.updateContent(message);
			full.addChild(new AssistantMessageComponent(assistant([{ type: "text", text: "tail ".repeat(400) }])));
			chat.addChild(new AssistantMessageComponent(assistant([{ type: "text", text: "tail ".repeat(400) }])));
			expect(chat.render(90)).toEqual(full.render(90));
		}
	});

	test("AC2 every message_update swaps the reference and bumps the generation", async () => {
		const updates = 12;
		const agent = new Agent({
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: assistant([{ type: "text", text: "" }]) });
					let text = "";
					for (let i = 0; i < updates; i++) {
						text += `w${i} `;
						stream.push({
							type: "text_delta",
							contentIndex: 0,
							delta: `w${i} `,
							partial: assistant([{ type: "text", text }]),
						});
					}
					stream.push({ type: "done", reason: "stop", message: assistant([{ type: "text", text }]) });
				});
				return stream;
			},
		});
		let component: AssistantMessageComponent | undefined;
		const seen: { same: boolean; revisionStep: number; generationRose: boolean }[] = [];
		agent.subscribe((event) => {
			if (event.type === "message_start" && event.message.role === "assistant") {
				component = new AssistantMessageComponent(undefined);
				component.updateContent(event.message);
			} else if (event.type === "message_update" && event.message.role === "assistant" && component) {
				const revision = component.getContentRevision();
				const generation = component.getRenderGeneration();
				component.updateContent(event.message);
				seen.push({
					same: component.getMessage() === event.message,
					revisionStep: component.getContentRevision() - revision,
					generationRose: component.getRenderGeneration() > generation,
				});
			}
		});
		await agent.prompt("go");
		expect(seen).toHaveLength(updates);
		for (const step of seen) expect(step).toEqual({ same: true, revisionStep: 1, generationRose: true });
	});

	test("frozen tool cards follow expand-all and a late result like a plain Container", () => {
		const build = (target: Container) => {
			const tools: ToolExecutionComponent[] = [];
			for (let i = 0; i < 40; i++) {
				target.addChild(
					new AssistantMessageComponent(assistant([{ type: "text", text: `Answer ${i} `.repeat(30) }])),
				);
				const tool = toolComponent("bash", `t-${i}`, { command: `echo ${i}` });
				if (i !== 3) {
					tool.updateResult({
						content: [{ type: "text", text: Array.from({ length: 30 }, (_, l) => `out ${i}.${l}`).join("\n") }],
						isError: false,
					});
				}
				target.addChild(tool);
				tools.push(tool);
			}
			return tools;
		};
		const full = new Container();
		const chat = new ChatContainer();
		chat.setLiveLineBudget(60);
		const toolsF = build(full);
		const toolsW = build(chat);
		expect(chat.render(100)).toEqual(full.render(100));
		expect(chat.getFrozenChildCount()).toBeGreaterThan(40);
		for (const tools of [toolsF, toolsW]) for (const tool of tools) tool.setExpanded(true);
		expect(chat.render(100)).toEqual(full.render(100));
		for (const tools of [toolsF, toolsW]) {
			tools[3].updateResult({ content: [{ type: "text", text: "LATE RESULT" }], isError: false });
		}
		const out = chat.render(100);
		expect(out).toEqual(full.render(100));
		expect(out.some((line) => line.includes("LATE RESULT"))).toBe(true);
	});
});
