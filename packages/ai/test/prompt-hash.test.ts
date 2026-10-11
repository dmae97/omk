import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	messagesPrefixHash,
	serializePromptMessage,
	serializePromptTools,
	systemHash,
	toolsHash,
} from "../src/prompt-hash.ts";
import type { Context, Tool } from "../src/types.ts";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const readTool: Tool = {
	name: "read",
	description: "Read a file",
	parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } as never,
};

describe("prompt-hash (spec 051)", () => {
	it("hashes the system prompt as UTF-8 bytes", () => {
		expect(systemHash({ systemPrompt: "시스템 prompt" })).toBe(sha("시스템 prompt"));
		expect(systemHash({})).toBe(sha(""));
		expect(systemHash({ systemPrompt: "a" })).not.toBe(systemHash({ systemPrompt: "a " }));
	});

	it("hashes name, description and parameters in the order given", () => {
		const context: Pick<Context, "tools"> = { tools: [readTool] };
		expect(serializePromptTools(context)).toBe(
			'[{"name":"read","description":"Read a file","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}]',
		);
		expect(toolsHash(context)).toBe(sha(serializePromptTools(context)));
		expect(toolsHash({})).toBe(sha("[]"));
	});

	it("does not hide tool order or schema key order", () => {
		const writeTool: Tool = { ...readTool, name: "write" };
		expect(toolsHash({ tools: [readTool, writeTool] })).not.toBe(toolsHash({ tools: [writeTool, readTool] }));
		const reordered: Tool = {
			...readTool,
			parameters: { properties: { path: { type: "string" } }, type: "object", required: ["path"] } as never,
		};
		expect(toolsHash({ tools: [reordered] })).not.toBe(toolsHash({ tools: [readTool] }));
	});

	it("ignores local bookkeeping on messages but not their content", () => {
		const base = { role: "user" as const, content: "hi", timestamp: 1 };
		expect(serializePromptMessage(base)).toBe(serializePromptMessage({ ...base, timestamp: 2 }));
		expect(serializePromptMessage(base)).not.toBe(serializePromptMessage({ ...base, content: "hi " }));
		const result = {
			role: "toolResult" as const,
			toolCallId: "c1",
			toolName: "read",
			isError: false,
			content: [{ type: "text" as const, text: "ok" }],
			timestamp: 1,
		};
		expect(serializePromptMessage(result)).toContain('"toolCallId":"c1"');
	});

	it("hashes a message prefix so an appended message keeps the earlier hash", () => {
		const first = { role: "user" as const, content: "one", timestamp: 1 };
		const second = { role: "user" as const, content: "two", timestamp: 2 };
		const short = { messages: [first] };
		const long = { messages: [first, second] };
		expect(messagesPrefixHash(long, 1)).toBe(messagesPrefixHash(short));
		expect(messagesPrefixHash(long)).not.toBe(messagesPrefixHash(short));
		expect(messagesPrefixHash({ messages: [{ ...first, content: "one!" }, second] }, 1)).not.toBe(
			messagesPrefixHash(short),
		);
	});
});
