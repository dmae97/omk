import { describe, expect, it } from "vitest";
import { attachSessionTransports, mcpAttachDiagnostics, sessionControlMode } from "../src/cli/mcp-attach.ts";
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

describe("OMK_SESSION_CONTROL (default on)", () => {
	const fake = (fail: boolean) => {
		const calls: string[] = [];
		return {
			calls,
			session: {
				attachMcpServers: async () => [],
				startControl: async () => {
					calls.push("start");
					if (fail) throw new Error("Session control requires an owned persisted session");
				},
				close: async () => {
					calls.push("close");
				},
			},
		};
	};

	it("parses unset as on but not required; 0/false/off opt out; 1 is required", () => {
		expect(sessionControlMode(undefined)).toEqual({ enabled: true, required: false });
		for (const v of ["0", "false", " OFF "])
			expect(sessionControlMode(v)).toEqual({ enabled: false, required: false });
		expect(sessionControlMode("1")).toEqual({ enabled: true, required: true });
	});

	it("default: starts control, and an unsupported session keeps running without it", async () => {
		const ok = fake(false);
		await attachSessionTransports(ok.session, sessionControlMode(undefined));
		expect(ok.calls).toEqual(["start"]);
		const bad = fake(true);
		await expect(attachSessionTransports(bad.session, sessionControlMode(undefined))).resolves.toEqual([]);
		expect(bad.calls).toEqual(["start"]);
	});

	it("=0 never starts control; explicit 1 still closes and throws on failure", async () => {
		const off = fake(true);
		await attachSessionTransports(off.session, sessionControlMode("0"));
		expect(off.calls).toEqual([]);
		const req = fake(true);
		await expect(attachSessionTransports(req.session, sessionControlMode("1"))).rejects.toThrow(/owned persisted/);
		expect(req.calls).toEqual(["start", "close"]);
	});
});
