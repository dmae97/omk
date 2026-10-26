import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const cliPath = join(packageDir, "src", "cli.ts");
const sourceRunner = fileURLToPath(new URL("../../../node_modules/tsx/dist/loader.mjs", import.meta.url));
const sourceConfig = fileURLToPath(new URL("../../../tsconfig.json", import.meta.url));
const projectDocuments = [
	"AGENTS.md",
	"CLAUDE.md",
	"PRD.md",
	"ARCHITECTURE.md",
	"DESIGN.md",
	"RULES.md",
	"TASKS.md",
	"PROGRESS.md",
];
let root: string;
let agentDir: string;
let workspace: string;

function runInit(args: string[]) {
	return spawnSync(process.execPath, ["--import", sourceRunner, cliPath, "init", ...args], {
		cwd: workspace,
		env: {
			PATH: process.env.PATH,
			HOME: root,
			USERPROFILE: root,
			OMK_CODING_AGENT_DIR: agentDir,
			OMK_PACKAGE_DIR: packageDir,
			OMK_OFFLINE: "1",
			TSX_TSCONFIG_PATH: sourceConfig,
		},
		encoding: "utf8",
		timeout: 20000,
	});
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-init-"));
	agentDir = join(root, "설정 with spaces", "agent");
	workspace = join(root, "workspace");
	mkdirSync(workspace);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("omk init --global", () => {
	it("previews portable defaults without creating the config directory", () => {
		// Given an empty user config, when previewing the global setup.
		const result = runInit(["--global", "--dry-run"]);
		// Then no session, settings, or context file is created.
		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("AGENTS.md");
		expect(result.stdout).toContain("INTERNET.md");
		expect(result.stdout).toContain("CLAUDE.md");
		expect(existsSync(agentDir)).toBe(false);
		expect(readdirSync(workspace)).toEqual([]);
	});

	it("creates only the three bundled documents when explicitly requested", () => {
		// Given an empty user config, when applying the setup.
		const result = runInit(["--global"]);
		// Then the installed bytes match the portable package templates.
		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(readdirSync(agentDir).sort()).toEqual(["AGENTS.md", "CLAUDE.md", "INTERNET.md"]);
		for (const name of readdirSync(agentDir)) {
			expect(readFileSync(join(agentDir, name), "utf8")).toBe(
				readFileSync(join(packageDir, "examples", "context", name), "utf8"),
			);
		}
		expect(readdirSync(workspace)).toEqual([]);
	});

	it("preserves an existing Claude-only configuration instead of shadowing it", () => {
		// Given a user who relies on the CLAUDE.md fallback.
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "CLAUDE.md"), "# Existing user instructions\n");
		writeFileSync(join(agentDir, "settings.json"), '{"theme":"light"}\n');
		// When installing missing defaults.
		const result = runInit(["--global"]);
		// Then no higher-priority AGENTS.md is created and existing bytes survive.
		expect(result.status).toBe(0);
		expect(existsSync(join(agentDir, "AGENTS.md"))).toBe(false);
		expect(readFileSync(join(agentDir, "CLAUDE.md"), "utf8")).toBe("# Existing user instructions\n");
		expect(readFileSync(join(agentDir, "settings.json"), "utf8")).toBe('{"theme":"light"}\n');
	});

	it.each([
		{ args: [] },
		{ args: ["--force"] },
		{ args: ["--global", "--unknown"] },
		{ args: ["--global", "--project"] },
	])("rejects unscoped or unknown arguments $args", ({ args }) => {
		// Given unsupported arguments, when invoking setup.
		const result = runInit(args);
		// Then usage is reported without starting a model session or writing files.
		expect(result.status).toBe(2);
		expect(`${result.stdout}${result.stderr}`).toContain("Usage: omk init --global");
		expect(existsSync(agentDir)).toBe(false);
	});
});

describe("omk init --project", () => {
	it("previews project documents without writing into an empty repository", () => {
		const result = runInit(["--project", "--dry-run"]);
		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("PRD.md");
		expect(result.stdout).toContain("PROGRESS.md");
		expect(result.stdout).toContain("Would install pstack skills");
		expect(readdirSync(workspace)).toEqual([]);
		expect(existsSync(agentDir)).toBe(false);
	});

	it("creates the standard document set and preserves existing project content", () => {
		writeFileSync(join(workspace, "PRD.md"), "# Existing product requirements\n");
		const result = runInit(["--project"]);
		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(readdirSync(workspace).sort()).toEqual([...projectDocuments, ".omk"].sort());
		expect(readdirSync(join(workspace, ".omk", "agents")).sort()).toEqual([
			"pstack-comment-sicko.md",
			"pstack-poteto-agent.md",
		]);
		const installedSkill = join(workspace, ".omk", "skills", "pstack", "poteto-mode", "SKILL.md");
		expect(readFileSync(installedSkill, "utf8")).toContain("name: pstack-poteto-mode");
		expect(readFileSync(join(workspace, ".omk", "skills", "pstack", "LICENSE"), "utf8")).toContain(
			"Copyright (c) 2026 Lauren Tan",
		);
		expect(existsSync(agentDir)).toBe(false);
		for (const name of projectDocuments) {
			if (name === "PRD.md") continue;
			expect(readFileSync(join(workspace, name), "utf8")).toBe(
				readFileSync(join(packageDir, "examples", "project-context", name), "utf8"),
			);
		}
		expect(readFileSync(join(workspace, "PRD.md"), "utf8")).toBe("# Existing product requirements\n");
		writeFileSync(installedSkill, "# Project-local skill changes\n");

		const repeated = runInit(["--project"]);
		expect(repeated.status).toBe(0);
		expect(readdirSync(workspace).sort()).toEqual([...projectDocuments, ".omk"].sort());
		expect(readFileSync(join(workspace, "PRD.md"), "utf8")).toBe("# Existing product requirements\n");
		expect(readFileSync(installedSkill, "utf8")).toBe("# Project-local skill changes\n");
	});
});
