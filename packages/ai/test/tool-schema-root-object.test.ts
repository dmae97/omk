import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { normalizeToolParameters, stableTools } from "../src/providers/tool-schema.ts";

/**
 * Real-world fixture: `mcp-obsidian@1.0.0` answers `tools/list` with this exact
 * schema for both of its tools (zod v4 fed to zod-to-json-schema v3 emits only
 * the dialect key). xAI rejects it with
 * `400 "<tool>: tool parameter root must be an object type"`, which OMK surfaces
 * as a non-retryable `tool_fatal` that kills the whole run.
 */
const OBSIDIAN_SCHEMA = { $schema: "http://json-schema.org/draft-07/schema#" };

describe("normalizeToolParameters root contract", () => {
	it("adds the object root type when a schema declares only the dialect key", () => {
		// Given: a tool schema whose root has no `type` and no `properties`
		// When: the schema is normalized for a provider payload
		// Then: the root is an object schema and the dialect key survives
		expect(normalizeToolParameters(OBSIDIAN_SCHEMA)).toEqual({
			$schema: "http://json-schema.org/draft-07/schema#",
			type: "object",
			properties: {},
		});
	});

	it("collapses a non-object root type to object", () => {
		// Given: a root that claims to be a string
		// When: normalized
		// Then: the root is object-typed, because tool arguments are always a JSON object
		expect(normalizeToolParameters({ type: "string" })).toEqual({ type: "object", properties: {} });
	});

	it("collapses a union root type to object", () => {
		// Given: a root typed as `["object", "null"]`
		// When: normalized
		// Then: the root type is the plain object type providers accept
		expect(normalizeToolParameters({ type: ["object", "null"] })).toEqual({ type: "object", properties: {} });
	});

	it("fills a missing properties map without touching declared fields", () => {
		// Given: an object root with `required` but no `properties`
		// When: normalized
		// Then: `properties` becomes an empty map and `required` is preserved
		expect(normalizeToolParameters({ type: "object", required: ["paths"] })).toEqual({
			type: "object",
			properties: {},
			required: ["paths"],
		});
	});

	it("replaces a non-record properties value", () => {
		// Given: `properties` as an array, which is not a JSON Schema property map
		// When: normalized
		// Then: it becomes an empty map
		expect(normalizeToolParameters({ type: "object", properties: [] })).toEqual({
			type: "object",
			properties: {},
		});
	});

	it("leaves a valid schema byte-identical", () => {
		// Given: a well-formed TypeBox-generated schema
		const parameters = Type.Object({ message: Type.String() }, { additionalProperties: false });
		// When: normalized
		// Then: nothing is added or removed
		const normalized = normalizeToolParameters(parameters);
		expect(normalized).toMatchObject({
			type: "object",
			properties: { message: { type: "string" } },
			required: ["message"],
			additionalProperties: false,
		});
	});

	it("coerces only the root, never nested schemas", () => {
		// Given: nested string and array nodes, which legitimately are not objects
		const parameters = {
			type: "object",
			properties: {
				name: { type: "string" },
				tags: { type: "array", items: { type: "string" } },
			},
		};
		// When: normalized
		// Then: the nested nodes keep their own types
		expect(normalizeToolParameters(parameters)).toEqual(parameters);
	});

	it("still returns an empty object schema for a non-record root", () => {
		// Given: a root that is not an object at all
		// When: normalized
		// Then: the fallback object schema is used
		expect(normalizeToolParameters("nope" as never)).toEqual({ type: "object", properties: {} });
	});
});

describe("stableTools provider payload", () => {
	it("gives every tool an object-rooted schema", () => {
		// Given: one broken MCP-shaped tool and one valid tool
		const tools = [
			{ name: "obsidian__read_notes", description: "Read notes.", parameters: OBSIDIAN_SCHEMA },
			{
				name: "echo",
				description: "Echo.",
				parameters: Type.Object({ message: Type.String() }),
			},
		];
		// When: the tool list is stabilized for a provider request
		const stable = stableTools(tools as never);
		// Then: both roots are object-typed, and the valid tool keeps its field
		for (const tool of stable) {
			const parameters = tool.parameters as Record<string, unknown>;
			expect(parameters.type).toBe("object");
			expect(parameters.properties).toBeTypeOf("object");
		}
		const echo = stable.find((tool) => tool.name === "echo");
		expect((echo?.parameters as Record<string, unknown>).properties).toMatchObject({
			message: { type: "string" },
		});
	});
});
