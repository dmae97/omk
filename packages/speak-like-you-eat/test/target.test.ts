// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import type { AgentEndEvent, SessionEntry } from "open-multi-agent-kit";
import { describe, expect, it } from "vitest";
import { prepareManualRewriteRequest, prepareRewriteRequest, stripFencedCodeBlocks } from "../src/target.ts";

type AgentMessage = AgentEndEvent["messages"][number];
const text = (value: string) => ({ type: "text" as const, text: value });
const user = (content: unknown) => ({ role: "user", content, timestamp: 1 }) as AgentMessage;
const assistant = (content: unknown, stopReason = "stop") =>
	({ role: "assistant", content, stopReason, timestamp: 2 }) as AgentMessage;
const entry = (id: string, message: AgentMessage) =>
	({ type: "message", id, parentId: null, timestamp: "now", message }) as SessionEntry;

describe("rewrite target selection", () => {
	it("accepts the 200 non-whitespace character boundary and joins text blocks", () => {
		const first = "a".repeat(100);
		const second = "b".repeat(100);
		const target = assistant([text(first), text(second)]);
		expect(prepareRewriteRequest([target], [entry("assistant", target)])).toEqual({
			entryId: "assistant",
			request: { target: `${first}\n\n${second}` },
		});
	});
	it("rejects short automatic targets but permits short manual prose", () => {
		const automatic = assistant([text("a".repeat(199))]);
		expect(prepareRewriteRequest([automatic], [entry("assistant", automatic)])).toBeUndefined();
		const manual = assistant([text("```ts\nconst answer = true;\n```"), text("x")]);
		expect(prepareManualRewriteRequest([entry("assistant", manual)])).toEqual({
			entryId: "assistant",
			request: { target: "```ts\nconst answer = true;\n```\n\nx" },
		});
	});
	it("rejects unfinished, blank, code-only and tool-call responses", () => {
		for (const target of [
			assistant([text("   ")]),
			assistant([text("```ts\nconst ignored = true;\n```")]),
			assistant([text("prose")], "length"),
			assistant([text("prose")], "error"),
			assistant([text("prose")], "aborted"),
			assistant([text("prose")], "toolUse"),
			assistant([text("prose"), { type: "toolCall", id: "tool-1", name: "read", arguments: {} }]),
		]) {
			expect(prepareManualRewriteRequest([entry("assistant", target)])).toBeUndefined();
		}
	});
	it("never rewrites an older response after a newer user message", () => {
		const target = assistant([text("Completed response")]);
		expect(
			prepareManualRewriteRequest([entry("assistant", target), entry("user", user("New request"))]),
		).toBeUndefined();
	});
	it("strips only matching fenced code while preserving the original target", () => {
		const source = [
			"opening",
			"````ts",
			"ignored",
			"```",
			"still ignored",
			"````",
			"middle",
			"~~~",
			"ignored",
			"~~~~",
			"closing",
		].join("\n");
		expect(stripFencedCodeBlocks(source)).toBe("opening\nmiddle\nclosing");
		const target = assistant([text(source), text("x".repeat(200))]);
		expect(prepareRewriteRequest([target], [entry("assistant", target)])?.request.target).toBe(
			`${source}\n\n${"x".repeat(200)}`,
		);
	});
});
