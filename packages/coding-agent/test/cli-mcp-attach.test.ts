import { describe, expect, it } from "vitest";
import { mcpAttachDiagnostics } from "../src/cli/mcp-attach.ts";
import { McpManager } from "../src/core/mcp/manager.ts";

describe("mcpAttachDiagnostics", () => {
	it("is silent for ready servers and for an empty configuration", () => {
		expect(mcpAttachDiagnostics([])).toEqual([]);
		expect(mcpAttachDiagnostics([{ name: "playwright", state: "ready" }])).toEqual([]);
	});

	it("omits intentional disablement while preserving missing-key and package failures", () => {
		// Given disabled servers alongside genuine startup failures.
		const statuses = [
			{ name: "figma-remote", state: "failed", error: "disabled by configuration" },
			{ name: "ryze", state: "failed", error: "disabled by configuration" },
			{ name: "resend", state: "failed", error: "No API key. Set RESEND_API_KEY" },
			{ name: "context7", state: "failed", error: "npm error code E404" },
			{ name: "other", state: "failed", error: "disabled by configuration: required credential missing" },
		];

		// When startup diagnostics are rendered.
		const diagnostics = mcpAttachDiagnostics(statuses);

		// Then only the exact intentional-disable reason is silent.
		expect(diagnostics).toEqual([
			{ type: "warning", message: 'MCP server "resend" failed: No API key. Set RESEND_API_KEY' },
			{ type: "warning", message: 'MCP server "context7" failed: npm error code E404' },
			{
				type: "warning",
				message: 'MCP server "other" failed: disabled by configuration: required credential missing',
			},
		]);
	});

	it("does not warn when the real manager skips a disabled server", async () => {
		// Given a disabled configuration whose command cannot be spawned.
		const manager = new McpManager({
			servers: [{ name: "off", command: "definitely-not-a-real-mcp-binary", disabled: true }],
		});
		try {
			// When the CLI's attachment path lists tools and renders manager statuses.
			const tools = await manager.listToolDefinitions();
			const diagnostics = mcpAttachDiagnostics(manager.status());

			// Then disabling contributes neither tools nor startup warnings.
			expect(tools).toEqual([]);
			expect(manager.status()[0]).toMatchObject({ error: "disabled by configuration" });
			expect(diagnostics).toEqual([]);
		} finally {
			manager.close();
		}
	});

	it("turns a failed server into a warning that names the server and the reason", () => {
		expect(
			mcpAttachDiagnostics([
				{ name: "playwright", state: "ready" },
				{ name: "serena", state: "failed", error: "spawn uvx ENOENT" },
				{ name: "slow", state: "connecting" },
			]),
		).toEqual([
			{ type: "warning", message: 'MCP server "serena" failed: spawn uvx ENOENT' },
			{ type: "warning", message: 'MCP server "slow" connecting' },
		]);
	});
});
