import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runInitCli } from "../src/commands/init-cli.ts";
import { loadMcpServerConfigsWithReport, trustProjectMcpConfig } from "../src/core/mcp/config.ts";
import { McpManager } from "../src/core/mcp/manager.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { expandSkillCommand } from "../src/core/skill-admission-session.ts";
import { loadSkills } from "../src/core/skills.ts";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "mcp", "fake-adaptorch-coexist-server.mjs");
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("pstack and an existing AdaptOrch MCP configuration", () => {
	it("preserves skill and MCP trust, expands both skills, and routes a read tool through the native manager", async () => {
		const root = mkdtempSync(join(tmpdir(), "omk-pstack-adaptorch-"));
		roots.push(root);
		const project = join(root, "project");
		const agentDir = join(root, "agent");
		const home = join(root, "mcp-home");
		const projectConfig = join(project, ".omk", "mcp.json");
		const adaptorchSkillDir = join(agentDir, "skills", "adaptorch-route");
		mkdirSync(join(project, ".omk"), { recursive: true });
		mkdirSync(adaptorchSkillDir, { recursive: true });
		mkdirSync(home);
		const config = JSON.stringify({ mcpServers: { adaptorch: { command: process.execPath, args: [fixture] } } });
		writeFileSync(projectConfig, config);
		writeFileSync(
			join(adaptorchSkillDir, "SKILL.md"),
			"---\nname: adaptorch-route\ndescription: Offline routing fixture\n---\nUse a read-only capability check.\n",
		);
		const trust = trustProjectMcpConfig(project, home);
		expect(trust.state).toBe("trusted");
		const before = loadMcpServerConfigsWithReport(project, home);
		expect(before.servers.map((server) => server.name)).toEqual(["adaptorch"]);

		const init = runInitCli(["init", "--project", "--offline"], { cwd: project, agentDir, writeLine: () => {} });
		expect(init.exitCode).toBe(0);
		expect(readFileSync(projectConfig, "utf8")).toBe(config);
		const after = loadMcpServerConfigsWithReport(project, home);
		expect(after.project.state).toBe("trusted");
		expect(after.project.sha256).toBe(trust.sha256);
		expect(after.servers).toEqual(before.servers);

		const skills = loadSkills({ cwd: project, agentDir, includeDefaults: true, skillPaths: [], catalogCache: false });
		const names = skills.skills.map((skill) => skill.name);
		expect(names).toContain("adaptorch-route");
		expect(names).toContain("pstack-poteto-mode");
		const session = SessionManager.inMemory();
		for (const name of ["adaptorch-route", "pstack-poteto-mode"]) {
			const expansion = expandSkillCommand(`/skill:${name}`, skills.skills, session, "explicit", () => {});
			expect(expansion).toContain(`<skill name="${name}"`);
		}

		const manager = new McpManager({ servers: after.servers, cwd: project });
		try {
			const tools = await manager.listToolDefinitions();
			const capabilities = tools.find((tool) => tool.name === "adaptorch__adaptorch_capabilities");
			expect(capabilities).toBeDefined();
			const result = await capabilities!.execute("coexist", {}, undefined, undefined, {} as never);
			expect(result.content).toEqual([{ type: "text", text: '{"fixture":true,"correctness_claim":false}' }]);
			expect(manager.status()).toMatchObject([{ name: "adaptorch", state: "ready" }]);
		} finally {
			await manager.closeAndWait();
		}
	});
});
