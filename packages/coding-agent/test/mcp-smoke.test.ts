import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/mcp-smoke.mjs", import.meta.url));
const server = fileURLToPath(new URL("./mcp/startup-diagnostic-server.mjs", import.meta.url));
const temporary: string[] = [];

afterEach(() => {
	for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function smoke(mode: string, names: string[] = [], handshake?: string) {
	const home = mkdtempSync(join(tmpdir(), "omk-mcp-smoke-"));
	temporary.push(home);
	mkdirSync(join(home, ".omk"));
	writeFileSync(
		join(home, ".omk", "mcp.json"),
		JSON.stringify({
			mcpServers: {
				browser: { command: process.execPath, args: [server, mode] },
				disabled: { command: "omk-fixture-secret-missing", disabled: true },
			},
		}),
	);
	return spawnSync(process.execPath, [script, ...names], {
		cwd: home,
		env: {
			PATH: process.env.PATH,
			HOME: home,
			USERPROFILE: home,
			...(handshake === undefined ? {} : { OMK_MCP_SMOKE_HANDSHAKE_MS: handshake }),
		},
		encoding: "utf8",
		timeout: 20_000,
	});
}

describe("MCP smoke exit contract", () => {
	it("fails the process when an enabled server exits, without printing stderr", () => {
		const result = smoke("crash");
		expect(result.status, result.stderr).toBe(1);
		expect(result.stdout).toContain("mcp.server_exited");
		expect(result.stdout + result.stderr).not.toContain("fixture-secret");
	});

	it("skips disabled servers and succeeds when every enabled server is ready", () => {
		const result = smoke("ok");
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain("1/1 servers ready");
		expect(result.stdout).not.toContain("FAIL");
	});

	it("fails for a requested name absent from configuration", () => {
		const result = smoke("ok", ["missing"]);
		expect(result.status, result.stderr).toBe(1);
		expect(result.stderr).toContain("Unknown MCP server");
	});

	it("rejects an invalid deadline override before starting servers", () => {
		const result = smoke("ok", [], "1.5");
		expect(result.status, result.stderr).toBe(1);
		expect(result.stderr).toContain("OMK_MCP_SMOKE_HANDSHAKE_MS");
		expect(result.stdout).not.toContain("Connecting");
	});
});
