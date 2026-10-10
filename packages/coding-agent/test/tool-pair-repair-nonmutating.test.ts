import { describe, expect, it } from "vitest";
import toolPairRepair from "../src/core/extensions/builtin/tool-pair-repair.ts";
import {
	contextHandlerMutatesMessages,
	markContextHandlerNonMutating,
} from "../src/core/extensions/context-handler-options.ts";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import { applyToolPairRepair } from "../src/core/tool-pair-repair.ts";

describe("tool-pair-repair non-mutating contract", () => {
	it("registers with mutatesMessages: false", () => {
		const handlers: object[] = [];
		const omk = {
			on: (_event: string, handler: object, options?: { mutatesMessages?: boolean }) => {
				handlers.push(handler);
				expect(options).toEqual({ mutatesMessages: false });
				markContextHandlerNonMutating(handler);
			},
		};
		toolPairRepair(omk as unknown as ExtensionAPI);
		expect(handlers).toHaveLength(1);
		expect(contextHandlerMutatesMessages(handlers[0])).toBe(false);
	});

	it("never mutates its input, including repair cases", () => {
		const cases = [
			[
				{ role: "user", content: "hi" },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "call" },
						{ type: "toolCall", id: "t1", name: "bash", arguments: {} },
						{ type: "toolCall", id: "orphan", name: "bash", arguments: {} },
					],
				},
				{ role: "toolResult", toolCallId: "t1", toolName: "bash", content: "ok" },
			],
			[{ role: "assistant", content: [{ type: "toolCall", id: "gone", name: "bash", arguments: {} }] }],
			[{ role: "user", content: "plain" }],
		];
		for (const input of cases) {
			const snapshot = structuredClone(input);
			for (const message of input) {
				Object.freeze(message);
				if (Array.isArray(message.content)) Object.freeze(message.content);
			}
			Object.freeze(input);
			const repaired = applyToolPairRepair(input);
			expect(input).toEqual(snapshot);
			expect(repaired).not.toBe(input);
		}
	});

	it("handler returns a new array without writing into event.messages", async () => {
		let registered: ((event: { messages: unknown[] }, ctx: unknown) => unknown) | undefined;
		toolPairRepair({
			on: (_e: string, handler: typeof registered) => {
				registered = handler;
			},
		} as unknown as ExtensionAPI);
		const messages = Object.freeze([
			Object.freeze({
				role: "assistant",
				content: Object.freeze([
					Object.freeze({ type: "toolCall", id: "orphan", name: "bash", arguments: {} }),
					Object.freeze({ type: "toolCall", id: "t1", name: "bash", arguments: {} }),
				]),
			}),
			Object.freeze({ role: "toolResult", toolCallId: "t1", toolName: "bash", content: "ok" }),
		]);
		const before = structuredClone(messages);
		const result = await registered!({ messages: messages as never }, {});
		expect(messages).toEqual(before);
		expect(result).toEqual({
			messages: [
				{ role: "assistant", content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }] },
				{ role: "toolResult", toolCallId: "t1", toolName: "bash", content: "ok" },
			],
		});
	});
});
