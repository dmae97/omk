import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { parseStreamingJson } from "../utils/json-parse.ts";
import { ProtoMessage } from "./devin-protobuf.ts";

export class DevinStreamState {
	private text: TextContent | undefined;
	private thinking: ThinkingContent | undefined;
	private activeTool: string | undefined;
	private readonly tools = new Map<string, { block: ToolCall; json: string; parsedLength: number }>();
	private stopReason = 0;
	private readonly output: AssistantMessage;
	private readonly stream: AssistantMessageEventStream;

	constructor(output: AssistantMessage, stream: AssistantMessageEventStream) {
		this.output = output;
		this.stream = stream;
	}

	private endText(): void {
		if (!this.text) return;
		this.stream.push({
			type: "text_end",
			contentIndex: this.output.content.indexOf(this.text),
			content: this.text.text,
			partial: this.output,
		});
		this.text = undefined;
	}

	private endThinking(): void {
		if (!this.thinking) return;
		this.stream.push({
			type: "thinking_end",
			contentIndex: this.output.content.indexOf(this.thinking),
			content: this.thinking.thinking,
			partial: this.output,
		});
		this.thinking = undefined;
	}

	accept(data: Uint8Array): void {
		const message = new ProtoMessage(data);
		if (message.number(8) || message.number(11)) throw new Error("Devin response was filtered");
		if (message.string(1)) this.output.responseId = message.string(1);
		if (message.string(23)) this.output.responseModel = message.string(23);
		const thinking = message.string(9);
		if (thinking) {
			this.endText();
			if (!this.thinking) {
				this.thinking = { type: "thinking", thinking: "" };
				this.output.content.push(this.thinking);
				this.stream.push({
					type: "thinking_start",
					contentIndex: this.output.content.length - 1,
					partial: this.output,
				});
			}
			this.thinking.thinking += thinking;
			this.stream.push({
				type: "thinking_delta",
				contentIndex: this.output.content.indexOf(this.thinking),
				delta: thinking,
				partial: this.output,
			});
		}
		if (this.thinking && message.string(10))
			this.thinking.thinkingSignature = (this.thinking.thinkingSignature ?? "") + message.string(10);
		const text = message.string(3);
		if (text) {
			this.endThinking();
			if (!this.text) {
				this.text = { type: "text", text: "" };
				this.output.content.push(this.text);
				this.stream.push({
					type: "text_start",
					contentIndex: this.output.content.length - 1,
					partial: this.output,
				});
			}
			this.text.text += text;
			this.stream.push({
				type: "text_delta",
				contentIndex: this.output.content.indexOf(this.text),
				delta: text,
				partial: this.output,
			});
		}
		for (const tool of message.messages(6)) this.acceptTool(tool);
		if (message.number(5)) this.stopReason = message.number(5);
		const usage = message.messages(7)[0];
		if (usage) {
			Object.assign(this.output.usage, {
				input: usage.number(2),
				output: usage.number(3),
				cacheWrite: usage.number(4),
				cacheRead: usage.number(5),
			});
			this.output.usage.totalTokens =
				this.output.usage.input +
				this.output.usage.output +
				this.output.usage.cacheRead +
				this.output.usage.cacheWrite;
		}
	}

	private acceptTool(tool: ProtoMessage): void {
		this.endText();
		this.endThinking();
		const id = tool.string(1) || this.activeTool;
		if (!id) throw new Error("Devin tool call missing an ID");
		let state = this.tools.get(id);
		if (!state) {
			const block: ToolCall = { type: "toolCall", id, name: tool.string(2), arguments: {} };
			state = { block, json: "", parsedLength: 0 };
			this.tools.set(id, state);
			this.output.content.push(block);
			this.stream.push({
				type: "toolcall_start",
				contentIndex: this.output.content.length - 1,
				partial: this.output,
			});
		}
		this.activeTool = id;
		if (tool.string(2)) state.block.name = tool.string(2);
		if (tool.string(4) || tool.string(5)) throw new Error("Devin returned invalid tool arguments");
		const argumentsJson = tool.string(3);
		if (!argumentsJson) return;
		const combined = argumentsJson.startsWith(state.json) ? argumentsJson : state.json + argumentsJson;
		if (combined.length > 16 * 1024 * 1024) throw new Error("Devin tool arguments exceed size limit");
		const delta = combined.slice(state.json.length);
		state.json = combined;
		if (combined.length >= Math.max(32, state.parsedLength * 2)) {
			state.block.arguments = parseStreamingJson(combined);
			state.parsedLength = combined.length;
		}
		this.stream.push({
			type: "toolcall_delta",
			contentIndex: this.output.content.indexOf(state.block),
			delta,
			partial: this.output,
		});
	}

	finish(): "stop" | "length" | "toolUse" {
		if ([7, 11, 13].includes(this.stopReason))
			throw new Error(`Devin generation failed (stop reason ${this.stopReason})`);
		this.endText();
		this.endThinking();
		for (const { block, json } of this.tools.values()) {
			let argumentsValue: unknown;
			try {
				argumentsValue = JSON.parse(json || "{}");
			} catch {
				throw new Error("Devin returned incomplete tool arguments");
			}
			if (!block.name || !argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue))
				throw new Error("Invalid Devin tool call");
			block.arguments = Object.fromEntries(Object.entries(argumentsValue));
			this.stream.push({
				type: "toolcall_end",
				contentIndex: this.output.content.indexOf(block),
				toolCall: block,
				partial: this.output,
			});
		}
		if (this.tools.size) return "toolUse";
		if ([3, 5].includes(this.stopReason)) return "length";
		if (!this.output.content.length) throw new Error("Devin returned no assistant content");
		return "stop";
	}
}
