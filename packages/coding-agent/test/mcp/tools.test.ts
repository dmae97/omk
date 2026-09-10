import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { McpClient } from "../../src/core/mcp/client.ts";
import { McpManager } from "../../src/core/mcp/manager.ts";
import { createMcpToolDefinition } from "../../src/core/mcp/tools.ts";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-server.mjs");

/**
 * The exact schema `mcp-obsidian@1.0.0` returns for `read_notes` and
 * `search_notes`: a dialect key and nothing else. Providers reject a tool whose
 * parameter root is not an object — xAI answers
 * `400 "obsidian__read_notes: tool parameter root must be an object type"`,
 * which OMK turns into a non-retryable `tool_fatal` that ends the run.
 */
const DIALECT_ONLY_SCHEMA = { $schema: "http://json-schema.org/draft-07/schema#" };

const open: { close(): void }[] = [];

function idleClient(): McpClient {
	// Never connected: `createMcpToolDefinition` only needs the handle to close over.
	const instance = new McpClient({
		name: "idle",
		transport: { command: process.execPath, args: [SERVER], env: { FAKE_MCP_MODE: "ok" } },
	});
	open.push(instance);
	return instance;
}

function manager(mode: string): McpManager {
	const instance = new McpManager({
		servers: [{ name: "obsidian", command: process.execPath, args: [SERVER], env: { FAKE_MCP_MODE: mode } }],
	});
	open.push(instance);
	return instance;
}

afterEach(() => {
	while (open.length > 0) open.pop()?.close();
});

describe("createMcpToolDefinition parameter root", () => {
	it("gives a dialect-only schema an object root", () => {
		// Given: a server tool whose inputSchema declares no type and no properties
		const definition = createMcpToolDefinition("obsidian", idleClient(), {
			name: "read_notes",
			inputSchema: DIALECT_ONLY_SCHEMA,
		});
		// When: the harness reads the parameters it will forward to a provider
		const parameters = definition.parameters as unknown as Record<string, unknown>;
		// Then: the root is an object schema and the server's dialect key survives
		expect(parameters).toEqual({ ...DIALECT_ONLY_SCHEMA, type: "object", properties: {} });
	});

	it("gives a missing inputSchema an object root", () => {
		// Given: a server tool that omits inputSchema entirely
		const definition = createMcpToolDefinition("obsidian", idleClient(), { name: "read_notes" });
		// When: the parameters are read
		const parameters = definition.parameters as unknown as Record<string, unknown>;
		// Then: the root is an object schema with an empty property map
		expect(parameters).toEqual({ type: "object", properties: {} });
	});

	it("collapses a non-object root type", () => {
		// Given: a server that types the root as a string
		const definition = createMcpToolDefinition("srv", idleClient(), {
			name: "odd",
			inputSchema: { type: "string" },
		});
		// When: the parameters are read
		const parameters = definition.parameters as unknown as Record<string, unknown>;
		// Then: the root is object-typed, because tool arguments arrive as a JSON object
		expect(parameters).toEqual({ type: "object", properties: {} });
	});

	it("passes a valid schema through unchanged and does not mutate the server's object", () => {
		// Given: a well-formed schema
		const inputSchema = {
			type: "object",
			properties: { paths: { type: "array", items: { type: "string" } } },
			required: ["paths"],
		};
		const frozen = structuredClone(inputSchema);
		const definition = createMcpToolDefinition("srv", idleClient(), { name: "read", inputSchema });
		// When: the parameters are read
		const parameters = definition.parameters as unknown as Record<string, unknown>;
		// Then: the declared fields are intact and the source object was not written to
		expect(parameters).toEqual(frozen);
		expect(inputSchema).toEqual(frozen);
	});
});

describe("MCP tool list from a real server with broken schemas", () => {
	it("exposes every tool with an object-rooted schema", async () => {
		// Given: a live stdio server that ships the obsidian-shaped schemas
		const m = manager("broken-schema");
		// When: the manager lists the tool definitions it will register
		const tools = await m.listToolDefinitions();
		// Then: all three tools are usable, each with an object root
		expect(tools.map((tool) => tool.name)).toEqual(["obsidian__read_notes", "obsidian__no_schema", "obsidian__echo"]);
		for (const tool of tools) {
			const parameters = tool.parameters as unknown as Record<string, unknown>;
			expect(parameters.type).toBe("object");
			expect(parameters.properties).toBeTypeOf("object");
		}
		const echo = tools.find((tool) => tool.name === "obsidian__echo");
		expect((echo?.parameters as unknown as Record<string, unknown>).properties).toMatchObject({
			message: { type: "string" },
		});
	});

	it("still forwards call arguments after normalization", async () => {
		// Given: a normalized tool from the broken-schema server
		const m = manager("broken-schema");
		const tools = await m.listToolDefinitions();
		const readNotes = tools.find((tool) => tool.name === "obsidian__read_notes");
		expect(readNotes).toBeDefined();
		// When: the model calls it with arguments the schema never described
		const result = await readNotes?.execute("call-1", { paths: ["a.md"] }, undefined, undefined, {} as never);
		// Then: the server receives them unchanged
		expect(result?.content).toEqual([{ type: "text", text: '{"paths":["a.md"]}' }]);
		expect(result?.details).toMatchObject({ server: "obsidian", tool: "read_notes", isError: false });
	});
});

describe("TypeBox-authored definitions are untouched", () => {
	it("keeps a generated object schema as the normalization reference", () => {
		// Given: the shape harness tools produce
		const generated = Type.Object({ query: Type.String() }) as unknown as Record<string, unknown>;
		// When: an MCP server ships the same shape
		const definition = createMcpToolDefinition("srv", idleClient(), { name: "search", inputSchema: generated });
		// Then: normalization is a no-op on it
		expect(definition.parameters).toBe(generated);
	});
});
