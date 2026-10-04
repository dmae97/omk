import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { serializePromptToolSchemas } from "../src/core/prompt-tool-projection.ts";

describe("phase3 provider tool-schema projection", () => {
	it("excludes cyclic runtime state and display labels", () => {
		const runtime: Record<string, unknown> = {};
		runtime.self = runtime;
		const tool = {
			name: "read",
			label: "x".repeat(10000),
			description: "read file",
			parameters: Type.Object({ path: Type.String() }),
			runtime,
			execute: async () => ({ content: [{ type: "text" as const, text: "ok" }], details: {} }),
		};
		expect(JSON.parse(serializePromptToolSchemas([tool]))).toEqual([
			{ name: tool.name, description: tool.description, parameters: JSON.parse(JSON.stringify(tool.parameters)) },
		]);
	});
	it("does not invoke a whole-tool toJSON serializer", () => {
		const tool = {
			name: "read",
			label: "Read",
			description: "read file",
			parameters: Type.Object({}),
			toJSON: () => {
				throw new Error("not provider data");
			},
			execute: async () => ({ content: [{ type: "text" as const, text: "ok" }], details: {} }),
		};
		expect(serializePromptToolSchemas([tool])).toContain('"name":"read"');
	});
});
