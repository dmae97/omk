import { describe, expect, it } from "bun:test";
import {
	convertTools,
	sanitizeSchemaForCloudCodeAssistClaude,
	sanitizeSchemaForGoogle,
} from "@oh-my-pi/pi-ai/providers/google-shared";
import type { Model, Tool } from "@oh-my-pi/pi-ai/types";
import type { TSchema } from "@sinclair/typebox";

function createModel(id: string): Model<"google-gemini-cli"> {
	return {
		id,
		name: id,
		api: "google-gemini-cli",
		provider: "google-antigravity",
		baseUrl: "https://example.com",
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 200000,
		maxTokens: 8192,
	};
}

describe("Cloud Code Assist Claude tool schema conversion", () => {
	it("removes nullable keyword while preserving JSON Schema union types", () => {
		const schema = {
			type: "object",
			properties: {
				value: {
					type: ["string", "null"],
					nullable: true,
				},
			},
		} as unknown;

		expect(sanitizeSchemaForCloudCodeAssistClaude(schema)).toEqual({
			type: "object",
			properties: {
				value: {
					type: ["string", "null"],
				},
			},
		});
	});

	it("uses sanitized parameters for claude models with deterministic output", () => {
		const parameters = {
			type: "object",
			properties: {
				value: {
					type: ["string", "null"],
					nullable: true,
				},
			},
			required: ["value"],
		} as unknown as TSchema;
		const tools: Tool[] = [{ name: "test_tool", description: "Test tool", parameters }];
		const model = createModel("claude-sonnet-4-5");

		const first = convertTools(tools, model);
		const second = convertTools(tools, model);
		const declaration = first?.[0]?.functionDeclarations[0] as Record<string, unknown>;

		expect(first).toEqual(second);
		expect(declaration.parameters).toEqual({
			type: "object",
			properties: {
				value: {
					type: ["string", "null"],
				},
			},
			required: ["value"],
		});
		expect(declaration.parametersJsonSchema).toBeUndefined();
	});

	it("keeps google sanitizer behavior for non-claude schema path", () => {
		const schema = {
			type: "object",
			properties: {
				value: {
					type: ["string", "null"],
				},
			},
		} as unknown;

		expect(sanitizeSchemaForGoogle(schema)).toEqual({
			type: "object",
			properties: {
				value: {
					type: "string",
					nullable: true,
				},
			},
		});
	});
});
