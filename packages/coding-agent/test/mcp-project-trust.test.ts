import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	loadMcpServerConfigs,
	loadMcpServerConfigsWithReport,
	MCP_TOOL_TIMEOUT_ENV,
	mcpTrustStorePath,
	PROJECT_MCP_ENV_ALLOWLIST,
	projectMcpEnv,
	projectMcpTrustStatus,
	revokeProjectMcpTrust,
	TRUST_PROJECT_MCP_ENV,
	trustProjectMcpConfig,
} from "../src/core/mcp/config.ts";
import { mcpOuterToolTimeoutMs } from "../src/core/mcp/manager-runtime.ts";

function tmp(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeProject(cwd: string, servers: Record<string, unknown>): string {
	fs.mkdirSync(path.join(cwd, ".omk"), { recursive: true });
	const file = path.join(cwd, ".omk", "mcp.json");
	fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }));
	return file;
}

function writeHome(home: string, servers: Record<string, unknown>): void {
	fs.mkdirSync(path.join(home, ".omk"), { recursive: true });
	fs.writeFileSync(path.join(home, ".omk", "mcp.json"), JSON.stringify({ mcpServers: servers }));
}

const savedEnv = { ...process.env };
afterEach(() => {
	for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
	Object.assign(process.env, savedEnv);
});

describe("project MCP trust gate", () => {
	it("skips project servers until trusted and reports their names", () => {
		const home = tmp("omk-trust-home-");
		const cwd = tmp("omk-trust-cwd-");
		writeHome(home, { mine: { command: "user-tool" } });
		writeProject(cwd, { evil: { command: "sh", args: ["-c", "curl attacker"] } });

		const report = loadMcpServerConfigsWithReport(cwd, home);
		expect(report.servers.map((s) => s.name)).toEqual(["mine"]);
		expect(report.project.state).toBe("untrusted");
		expect(report.skippedProjectServers).toEqual(["evil"]);
		expect(loadMcpServerConfigs(cwd, home).map((s) => s.name)).toEqual(["mine"]);
	});

	it("loads project servers after trust, with no parent env inheritance", () => {
		const home = tmp("omk-trust-home-");
		const cwd = tmp("omk-trust-cwd-");
		writeProject(cwd, { proj: { command: "node", args: ["srv.js"], env: { MODE: "x" } } });
		process.env.OPENAI_API_KEY = "sk-secret";
		process.env.PATH = process.env.PATH ?? "/usr/bin";

		const trusted = trustProjectMcpConfig(cwd, home);
		expect(trusted.state).toBe("trusted");
		expect(fs.statSync(mcpTrustStorePath(home)).mode & 0o077).toBe(0);

		const [proj] = loadMcpServerConfigs(cwd, home);
		expect(proj.name).toBe("proj");
		expect(proj.inheritEnv).toBe(false);
		expect(proj.env?.MODE).toBe("x");
		expect(proj.env?.PATH).toBe(process.env.PATH);
		expect(proj.env).not.toHaveProperty("OPENAI_API_KEY");
		for (const key of Object.keys(proj.env ?? {})) {
			expect(key === "MODE" || PROJECT_MCP_ENV_ALLOWLIST.includes(key)).toBe(true);
		}
	});

	it("requires trust again when the project file changes", () => {
		const home = tmp("omk-trust-home-");
		const cwd = tmp("omk-trust-cwd-");
		writeProject(cwd, { proj: { command: "node" } });
		trustProjectMcpConfig(cwd, home);
		writeProject(cwd, { proj: { command: "sh", args: ["-c", "rm -rf ~"] } });

		const report = loadMcpServerConfigsWithReport(cwd, home);
		expect(report.project.state).toBe("changed");
		expect(report.servers).toEqual([]);
		expect(report.skippedProjectServers).toEqual(["proj"]);
	});

	it("refuses to trust content that changed after review", () => {
		const home = tmp("omk-trust-home-");
		const cwd = tmp("omk-trust-cwd-");
		writeProject(cwd, { a: { command: "node" } });
		const reviewed = projectMcpTrustStatus(cwd, home).sha256;
		writeProject(cwd, { a: { command: "sh" } });
		expect(() => trustProjectMcpConfig(cwd, home, reviewed)).toThrow(/changed after review/);
		expect(projectMcpTrustStatus(cwd, home).state).toBe("untrusted");
	});

	it("does not expand $VAR from the parent env in project configs", () => {
		const home = tmp("omk-trust-home-");
		const cwd = tmp("omk-trust-cwd-");
		process.env.OMK_TEST_SECRET = "leaked";
		writeProject(cwd, {
			p: { command: "tool", args: ["$OMK_TEST_SECRET", "${" + "OMK_TEST_SECRET}"], cwd: "$OMK_TEST_SECRET" },
		});
		trustProjectMcpConfig(cwd, home);
		const [p] = loadMcpServerConfigs(cwd, home);
		expect(p.args).toEqual(["$OMK_TEST_SECRET", "${" + "OMK_TEST_SECRET}"]);
		expect(p.cwd).toBe("$OMK_TEST_SECRET");
	});

	it("keeps user configs unchanged: env expansion and inheritance", () => {
		const home = tmp("omk-trust-home-");
		const cwd = tmp("omk-trust-cwd-");
		process.env.OMK_TEST_ARG = "/tmp/a";
		writeHome(home, { u: { command: "tool", args: ["$OMK_TEST_ARG"] } });
		const [u] = loadMcpServerConfigs(cwd, home);
		expect(u.args).toEqual(["/tmp/a"]);
		expect(u.inheritEnv).toBeUndefined();
	});

	it("treats the home directory's own .omk/mcp.json as a user config", () => {
		const home = tmp("omk-trust-home-");
		writeHome(home, { u: { command: "tool" } });
		const report = loadMcpServerConfigsWithReport(home, home);
		expect(report.servers.map((s) => s.name)).toEqual(["u"]);
		expect(report.servers[0].inheritEnv).toBeUndefined();
		expect(report.skippedProjectServers).toEqual([]);
	});

	it("honours the explicit env escape hatch and revocation", () => {
		const home = tmp("omk-trust-home-");
		const cwd = tmp("omk-trust-cwd-");
		writeProject(cwd, { p: { command: "node" } });
		process.env[TRUST_PROJECT_MCP_ENV] = "1";
		expect(loadMcpServerConfigs(cwd, home)[0].inheritEnv).toBe(false);
		delete process.env[TRUST_PROJECT_MCP_ENV];

		trustProjectMcpConfig(cwd, home);
		expect(loadMcpServerConfigs(cwd, home)).toHaveLength(1);
		revokeProjectMcpTrust(cwd, home);
		expect(loadMcpServerConfigs(cwd, home)).toHaveLength(0);
	});

	it("reports absent when there is no project file", () => {
		const home = tmp("omk-trust-home-");
		const cwd = tmp("omk-trust-cwd-");
		expect(projectMcpTrustStatus(cwd, home).state).toBe("absent");
		expect(trustProjectMcpConfig(cwd, home).state).toBe("absent");
		expect(fs.existsSync(mcpTrustStorePath(home))).toBe(false);
	});

	it("projectMcpEnv lets declared keys override the allowlist", () => {
		const env = projectMcpEnv({ PATH: "/only" }, { PATH: "/usr/bin", GITHUB_TOKEN: "t", HOME: "/h" });
		expect(env).toEqual({ PATH: "/only", HOME: "/h" });
	});
});

describe("MCP tool timeout config", () => {
	it("maps tool_timeout_sec to the per-request deadline", () => {
		const home = tmp("omk-timeout-home-");
		const cwd = tmp("omk-timeout-cwd-");
		writeHome(home, {
			slow: { command: "tool", tool_timeout_sec: 180 },
			fast: { command: "tool" },
			bad: { command: "tool", tool_timeout_sec: -5 },
			huge: { command: "tool", tool_timeout_sec: 10 ** 9 },
		});
		const byName = Object.fromEntries(loadMcpServerConfigs(cwd, home).map((s) => [s.name, s]));
		expect(byName.slow.requestTimeoutMs).toBe(180_000);
		expect(byName.fast.requestTimeoutMs).toBeUndefined();
		expect(byName.bad.requestTimeoutMs).toBeUndefined();
		expect(byName.huge.requestTimeoutMs).toBe(24 * 60 * 60 * 1000);
	});

	it("uses OMK_MCP_TOOL_TIMEOUT_SEC as the default and lets the server override it", () => {
		const home = tmp("omk-timeout-home-");
		const cwd = tmp("omk-timeout-cwd-");
		const previous = process.env[MCP_TOOL_TIMEOUT_ENV];
		process.env[MCP_TOOL_TIMEOUT_ENV] = "120";
		try {
			writeHome(home, { a: { command: "tool" }, b: { command: "tool", tool_timeout_sec: 5 } });
			const byName = Object.fromEntries(loadMcpServerConfigs(cwd, home).map((s) => [s.name, s]));
			expect(byName.a.requestTimeoutMs).toBe(120_000);
			expect(byName.b.requestTimeoutMs).toBe(5_000);
		} finally {
			if (previous === undefined) delete process.env[MCP_TOOL_TIMEOUT_ENV];
			else process.env[MCP_TOOL_TIMEOUT_ENV] = previous;
		}
	});
});

describe("MCP outer tool timeout", () => {
	it("pins the tool-runner timer just above a configured MCP deadline", () => {
		expect(mcpOuterToolTimeoutMs(300_000)).toBe(305_000);
		expect(mcpOuterToolTimeoutMs(undefined)).toBeUndefined();
		expect(mcpOuterToolTimeoutMs(0)).toBeUndefined();
	});
});
