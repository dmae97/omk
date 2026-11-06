import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mcpAttachDiagnostics } from "../../src/cli/mcp-attach.ts";
import { McpFailure, mcpExitFailure } from "../../src/core/mcp/failure.ts";
import { McpManager, type McpServerConfig } from "../../src/core/mcp/manager.ts";
import { mcpPublicDiagnostic } from "../../src/core/mcp/public-diagnostic.ts";

const server = fileURLToPath(new URL("./startup-diagnostic-server.mjs", import.meta.url));
function config(mode: string): McpServerConfig {
	return { name: "browser", command: process.execPath, args: [server, mode], inheritEnv: false };
}

async function connectFailure(overrides: Partial<McpServerConfig>, pattern: RegExp) {
	const manager = new McpManager({
		servers: [
			{ ...config("ok"), ...overrides },
			{ ...config("ok"), name: "healthy" },
		],
	});
	try {
		await manager.listToolDefinitions();
		const [failed, healthy] = manager.status();
		expect(failed).toMatchObject({ state: "failed", toolCount: 0 });
		expect(failed.error).toMatch(pattern);
		expect(healthy.state).toBe("ready");
		const diagnostics = mcpAttachDiagnostics(manager.status());
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toMatch(pattern);
		expect(failed.error).not.toContain("fixture-secret");
		return failed.error;
	} finally {
		await manager.closeAndWait();
	}
}

describe("safe native MCP startup diagnostics", () => {
	it("identifies a launcher exit without exposing its stderr and keeps peers available", async () => {
		const error = await connectFailure(config("crash"), /mcp\.server_exited.*exit=7/);
		expect(error).toContain("launcher");
	});

	it("distinguishes a missing executable from a server exit", async () => {
		const error = await connectFailure({ command: "omk-fixture-secret-missing-executable" }, /mcp\.spawn_not_found/);
		expect(error).toContain("PATH");
	});

	it("reports a missing working directory without claiming the executable alone is missing", async () => {
		const cwd = fileURLToPath(new URL("./omk-fixture-secret-missing-directory", import.meta.url));
		const error = await connectFailure({ cwd }, /mcp\.spawn_not_found/);
		expect(error).toContain("cwd");
		expect(error).not.toContain("exit=");
	});

	it.each([
		["EACCES", "mcp.spawn_permission_denied"],
		["EPERM", "mcp.spawn_permission_denied"],
		["fixture-secret", "mcp.spawn_failed"],
	])("only exposes an allowlisted classification for OS spawn code %s", (spawnErrorCode, expected) => {
		const error = mcpExitFailure("fixture-secret", { code: -1, signal: null, spawnErrorCode }, "fixture-secret");
		const diagnostic = mcpPublicDiagnostic(error, "connect");
		expect(diagnostic).toContain(expected);
		expect(diagnostic).not.toContain("fixture-secret");
		expect(diagnostic).not.toContain("exit=");
	});

	it("classifies a signal termination without echoing untrusted detail", () => {
		const error = mcpExitFailure("fixture-secret", { code: null, signal: "SIGTERM" }, "fixture-secret");
		expect(mcpPublicDiagnostic(error, "connect")).toMatch(/mcp\.server_exited/);
		expect(mcpPublicDiagnostic(error, "connect")).not.toContain("fixture-secret");
	});

	it("identifies a handshake deadline without echoing the configured server name", async () => {
		const error = await connectFailure(
			{ ...config("silent-init"), name: "fixture-secret", handshakeTimeoutMs: 200 },
			/mcp\.request_timeout/,
		);
		expect(error).toContain("startup_timeout_sec");
	});

	it("distinguishes a catalog timeout from a handshake timeout", async () => {
		const error = await connectFailure({ ...config("silent-list"), requestTimeoutMs: 200 }, /mcp\.request_timeout/);
		expect(error).toContain("tool_timeout_sec");
		expect(error).not.toContain("startup_timeout_sec");
	});

	it.each([
		["unsupported", /mcp\.unsupported_protocol/],
		["invalid", /mcp\.invalid_initialize_result/],
	])("classifies %s initialization without publishing server payloads", async (mode, pattern) => {
		await connectFailure(config(mode), pattern);
	});

	it("does not infer local failure codes from a server's JSON-RPC message", async () => {
		expect(await connectFailure(config("protocol-error"), /mcp\.connect_failed \(Error\)/)).toBe(
			"mcp.connect_failed (Error)",
		);
	});

	it("keeps arbitrary and hostile errors opaque", () => {
		for (const error of [
			new Error("fixture-secret ENOENT timed out"),
			{ code: "ENOENT" },
			Object.assign(new McpFailure("mcp.server_exited", "fixture-secret"), { code: "fixture-secret" }),
			Object.defineProperty(new McpFailure("mcp.server_exited", "fixture-secret"), "code", {
				get() {
					throw new Error("fixture-secret");
				},
			}),
			new Proxy(
				{},
				{
					getPrototypeOf() {
						throw new Error("fixture-secret");
					},
				},
			),
		]) {
			expect(mcpPublicDiagnostic(error, "connect")).toBe("mcp.connect_failed (Error)");
		}
	});
});
