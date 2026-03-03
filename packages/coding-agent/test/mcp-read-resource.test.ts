import { describe, expect, it } from "bun:test";
import type { MCPManager } from "../src/mcp/manager";
import type { MCPResource, MCPResourceReadResult, MCPResourceTemplate } from "../src/mcp/types";
import { McpReadResourceTool } from "../src/tools/mcp-read-resource";

function createMockManager(opts: {
	servers?: string[];
	resources?: Map<string, { resources: MCPResource[]; templates: MCPResourceTemplate[] }>;
	readResult?: MCPResourceReadResult | undefined;
	readError?: Error;
}) {
	return {
		getConnectedServers: () => opts.servers ?? [],
		getServerResources: (name: string) => opts.resources?.get(name),
		readServerResource: async (_name: string, _uri: string) => {
			if (opts.readError) throw opts.readError;
			return opts.readResult;
		},
	} as unknown as MCPManager;
}

describe("McpReadResourceTool", () => {
	it("returns error when no MCP manager is available", async () => {
		const tool = new McpReadResourceTool(() => undefined);
		const result = await tool.execute("call-1", { uri: "test://resource" });

		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text).toContain("No MCP manager");
		expect(result.details?.isError).toBe(true);
		expect(result.details?.uri).toBe("test://resource");
	});

	it("returns error listing available resources when no server matches", async () => {
		const resources = new Map<string, { resources: MCPResource[]; templates: MCPResourceTemplate[] }>();
		resources.set("server-a", {
			resources: [{ uri: "file://known", name: "known-resource" }],
			templates: [],
		});
		const manager = createMockManager({ servers: ["server-a"], resources });
		const tool = new McpReadResourceTool(() => manager);
		const result = await tool.execute("call-1", { uri: "test://missing" });

		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text).toContain("No MCP server has resource");
		expect(text).toContain("file://known");
		expect(text).toContain("server-a");
		expect(result.details?.isError).toBe(true);
	});

	it("reads resource by exact URI match", async () => {
		const resources = new Map<string, { resources: MCPResource[]; templates: MCPResourceTemplate[] }>();
		resources.set("my-server", {
			resources: [{ uri: "test://doc", name: "doc" }],
			templates: [],
		});
		const manager = createMockManager({
			servers: ["my-server"],
			resources,
			readResult: { contents: [{ uri: "test://doc", text: "hello world" }] },
		});
		const tool = new McpReadResourceTool(() => manager);
		const result = await tool.execute("call-1", { uri: "test://doc" });

		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text).toBe("hello world");
		expect(result.details?.serverName).toBe("my-server");
		expect(result.details?.isError).toBeUndefined();
	});

	it("falls back to template scheme matching when no exact URI match", async () => {
		const resources = new Map<string, { resources: MCPResource[]; templates: MCPResourceTemplate[] }>();
		resources.set("tmpl-server", {
			resources: [],
			templates: [{ uriTemplate: "test://{id}", name: "test-template" }],
		});
		const manager = createMockManager({
			servers: ["tmpl-server"],
			resources,
			readResult: { contents: [{ uri: "test://foo", text: "from template" }] },
		});
		const tool = new McpReadResourceTool(() => manager);
		const result = await tool.execute("call-1", { uri: "test://foo" });

		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text).toBe("from template");
		expect(result.details?.serverName).toBe("tmpl-server");
	});

	it("does not match template with different scheme prefix", async () => {
		const resources = new Map<string, { resources: MCPResource[]; templates: MCPResourceTemplate[] }>();
		resources.set("tmpl-server", {
			resources: [],
			templates: [{ uriTemplate: "testing://{id}", name: "testing-template" }],
		});
		const manager = createMockManager({ servers: ["tmpl-server"], resources });
		const tool = new McpReadResourceTool(() => manager);
		const result = await tool.execute("call-1", { uri: "test://foo" });

		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text).toContain("No MCP server has resource");
		expect(result.details?.isError).toBe(true);
	});

	it("returns error when readServerResource returns undefined", async () => {
		const resources = new Map<string, { resources: MCPResource[]; templates: MCPResourceTemplate[] }>();
		resources.set("null-server", {
			resources: [{ uri: "test://empty", name: "empty" }],
			templates: [],
		});
		const manager = createMockManager({
			servers: ["null-server"],
			resources,
			readResult: undefined,
		});
		const tool = new McpReadResourceTool(() => manager);
		const result = await tool.execute("call-1", { uri: "test://empty" });

		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text).toContain("returned no content");
		expect(text).toContain("null-server");
		expect(result.details?.isError).toBe(true);
	});

	it("formats binary content with mime type and base64 length", async () => {
		const resources = new Map<string, { resources: MCPResource[]; templates: MCPResourceTemplate[] }>();
		resources.set("bin-server", {
			resources: [{ uri: "test://image", name: "image" }],
			templates: [],
		});
		const blobData = "iVBORw0KGgo=";
		const manager = createMockManager({
			servers: ["bin-server"],
			resources,
			readResult: {
				contents: [{ uri: "test://image", mimeType: "image/png", blob: blobData }],
			},
		});
		const tool = new McpReadResourceTool(() => manager);
		const result = await tool.execute("call-1", { uri: "test://image" });

		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text).toContain("[Binary content:");
		expect(text).toContain("image/png");
		expect(text).toContain(`base64 length ${blobData.length}`);
	});

	it("joins mixed text and binary content with --- separator", async () => {
		const resources = new Map<string, { resources: MCPResource[]; templates: MCPResourceTemplate[] }>();
		resources.set("mix-server", {
			resources: [{ uri: "test://mixed", name: "mixed" }],
			templates: [],
		});
		const manager = createMockManager({
			servers: ["mix-server"],
			resources,
			readResult: {
				contents: [
					{ uri: "test://mixed", text: "part one" },
					{ uri: "test://mixed", blob: "AAAA", mimeType: "application/octet-stream" },
				],
			},
		});
		const tool = new McpReadResourceTool(() => manager);
		const result = await tool.execute("call-1", { uri: "test://mixed" });

		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text).toContain("part one");
		expect(text).toContain("\n---\n");
		expect(text).toContain("[Binary content:");
	});

	it("returns (empty resource) when content items have neither text nor blob", async () => {
		const resources = new Map<string, { resources: MCPResource[]; templates: MCPResourceTemplate[] }>();
		resources.set("empty-server", {
			resources: [{ uri: "test://blank", name: "blank" }],
			templates: [],
		});
		const manager = createMockManager({
			servers: ["empty-server"],
			resources,
			readResult: {
				contents: [{ uri: "test://blank" }],
			},
		});
		const tool = new McpReadResourceTool(() => manager);
		const result = await tool.execute("call-1", { uri: "test://blank" });

		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text).toBe("(empty resource)");
		expect(result.details?.isError).toBeUndefined();
	});

	it("returns error with message when readServerResource throws", async () => {
		const resources = new Map<string, { resources: MCPResource[]; templates: MCPResourceTemplate[] }>();
		resources.set("err-server", {
			resources: [{ uri: "test://fail", name: "fail" }],
			templates: [],
		});
		const manager = createMockManager({
			servers: ["err-server"],
			resources,
			readError: new Error("connection refused"),
		});
		const tool = new McpReadResourceTool(() => manager);
		const result = await tool.execute("call-1", { uri: "test://fail" });

		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text).toContain("MCP resource read error:");
		expect(text).toContain("connection refused");
		expect(result.details?.isError).toBe(true);
		expect(result.details?.serverName).toBe("err-server");
	});

	it("picks the first server with a matching resource", async () => {
		const resources = new Map<string, { resources: MCPResource[]; templates: MCPResourceTemplate[] }>();
		resources.set("first", {
			resources: [{ uri: "test://shared", name: "shared" }],
			templates: [],
		});
		resources.set("second", {
			resources: [{ uri: "test://shared", name: "shared" }],
			templates: [],
		});
		const manager = createMockManager({
			servers: ["first", "second"],
			resources,
			readResult: { contents: [{ uri: "test://shared", text: "from first" }] },
		});
		const tool = new McpReadResourceTool(() => manager);
		const result = await tool.execute("call-1", { uri: "test://shared" });

		expect(result.details?.serverName).toBe("first");
	});

	it("shows (none) when no servers have any resources", async () => {
		const manager = createMockManager({ servers: ["lonely-server"] });
		const tool = new McpReadResourceTool(() => manager);
		const result = await tool.execute("call-1", { uri: "test://anything" });

		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text).toContain("(none)");
		expect(result.details?.isError).toBe(true);
	});

	it("uses unknown for binary content without mimeType", async () => {
		const resources = new Map<string, { resources: MCPResource[]; templates: MCPResourceTemplate[] }>();
		resources.set("bin-server", {
			resources: [{ uri: "test://bin", name: "bin" }],
			templates: [],
		});
		const manager = createMockManager({
			servers: ["bin-server"],
			resources,
			readResult: {
				contents: [{ uri: "test://bin", blob: "data" }],
			},
		});
		const tool = new McpReadResourceTool(() => manager);
		const result = await tool.execute("call-1", { uri: "test://bin" });

		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text).toContain("[Binary content: unknown,");
	});
});
