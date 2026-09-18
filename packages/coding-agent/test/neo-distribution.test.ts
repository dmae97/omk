import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runNeoCli } from "../src/commands/neo-cli.ts";
import { loadSkillsWithBundled } from "../src/core/bundled-skills.ts";
import { NEO_SKILL_NAMES, neoMcpConfig, selectNeoMcpPresets } from "../src/core/neo/catalog.ts";
import { createNeoMcpConfig } from "../src/core/neo/setup.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-neo-"));
	vi.stubEnv("HOME", root);
	vi.stubEnv("USERPROFILE", root);
	vi.stubEnv("OMK_CODING_AGENT_DIR", join(root, "agent"));
	vi.stubEnv("OMK_PACKAGE_DIR", packageDir);
	vi.stubEnv("OMK_BUNDLED_SKILLS", "1");
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

function context(output: (text: string) => void) {
	return { packageDir, cwd: root, home: join(root, "home"), output };
}

describe("Neo distribution and safe setup", () => {
	it("discovers six real bundled skills in a clean directory without writing MCP config", () => {
		const loaded = loadSkillsWithBundled(false, {
			cwd: root,
			agentDir: join(root, "agent"),
			skillPaths: [],
			includeDefaults: false,
		});
		expect(loaded.skills.map((skill) => skill.name).sort()).toEqual([...NEO_SKILL_NAMES].sort());
		expect(loaded.diagnostics).toEqual([]);
		expect(existsSync(join(root, ".omk", "mcp.json"))).toBe(false);
	});
	it("honors noSkills and the bundled-only environment opt-out", () => {
		const options = { cwd: root, agentDir: root, skillPaths: [], includeDefaults: false };
		expect(loadSkillsWithBundled(true, options).skills).toEqual([]);
		vi.stubEnv("OMK_BUNDLED_SKILLS", "off");
		expect(loadSkillsWithBundled(false, options).skills).toEqual([]);
	});
	it("keeps an explicitly supplied skill instead of its bundled namesake", () => {
		const file = join(root, "SKILL.md");
		writeFileSync(file, "---\nname: omk-site\ndescription: User owned site policy\n---\nUser policy\n");
		const options = { cwd: root, agentDir: root, skillPaths: [file], includeDefaults: false };
		const loaded = loadSkillsWithBundled(false, options);
		expect(loaded.skills).toHaveLength(6);
		expect(loaded.skills.find((skill) => skill.name === "omk-site")?.filePath).toBe(file);
		expect(loadSkillsWithBundled(true, options).skills.map((skill) => skill.filePath)).toEqual([file]);
	});
	it("connects bundled discovery to the real DefaultResourceLoader", async () => {
		const loader = new DefaultResourceLoader({
			cwd: root,
			agentDir: join(root, "agent"),
			settingsManager: SettingsManager.inMemory({}),
			noExtensions: true,
			noContextFiles: true,
		});
		await loader.reload();
		expect(
			loader
				.getSkills()
				.skills.map((skill) => skill.name)
				.sort(),
		).toEqual([...NEO_SKILL_NAMES].sort());
	});
	it("honors noSkills through DefaultResourceLoader without removing explicit skills", async () => {
		const file = join(root, "explicit.md");
		writeFileSync(file, "---\nname: explicit-only\ndescription: Explicit test skill\n---\nTest\n");
		for (const additionalSkillPaths of [[], [file]]) {
			const loader = new DefaultResourceLoader({
				cwd: root,
				agentDir: join(root, "agent"),
				settingsManager: SettingsManager.inMemory({}),
				noExtensions: true,
				noContextFiles: true,
				noSkills: true,
				additionalSkillPaths,
			});
			await loader.reload();
			expect(loader.getSkills().skills.map((skill) => skill.filePath)).toEqual(additionalSkillPaths);
		}
	});
	it("preserves final skill overrides after bundled loading", async () => {
		const loader = new DefaultResourceLoader({
			cwd: root,
			agentDir: join(root, "agent"),
			settingsManager: SettingsManager.inMemory({}),
			noExtensions: true,
			noContextFiles: true,
			skillsOverride: (result) => ({
				...result,
				skills: result.skills.filter((skill) => skill.name === "omk-site"),
			}),
		});
		await loader.reload();
		expect(loader.getSkills().skills.map((skill) => skill.name)).toEqual(["omk-site"]);
	});
	it("reports a missing bundle without losing an explicitly supplied skill", () => {
		vi.stubEnv("OMK_PACKAGE_DIR", root);
		const file = join(root, "explicit.md");
		writeFileSync(file, "---\nname: explicit-only\ndescription: Explicit test skill\n---\nTest\n");
		const loaded = loadSkillsWithBundled(false, {
			cwd: root,
			agentDir: root,
			skillPaths: [file],
			includeDefaults: false,
		});
		expect(loaded.skills.map((skill) => skill.filePath)).toEqual([file]);
		expect(loaded.diagnostics).toEqual([
			expect.objectContaining({ type: "warning", path: join(root, "resources", "neo", "skills") }),
		]);
	});
	it("does not falsely report MCP connections or perform setup during listing", () => {
		const output: string[] = [];
		expect(
			runNeoCli(
				["list"],
				context((text) => output.push(text)),
			),
		).toBe(0);
		const result = JSON.parse(output[0]);
		expect(result.mcp.connected).toBeNull();
		expect(result.mcp.offered).toHaveLength(2);
		expect(result.skills.every((skill: { packaged: boolean }) => skill.packaged)).toBe(true);
		expect(readdirSync(root)).toEqual([]);
	});
	it("previews setup without writing and emits disabled config by default", () => {
		const output: string[] = [];
		expect(
			runNeoCli(
				["setup", "playwright"],
				context((text) => output.push(text)),
			),
		).toBe(0);
		expect(JSON.parse(output[0]).status).toBe("dry_run");
		expect(readdirSync(root)).toEqual([]);
		expect(neoMcpConfig(["playwright"], false).mcpServers["neo-playwright"].disabled).toBe(true);
	});
	it("rejects unsupported and duplicate choices before any filesystem mutation", () => {
		for (const ids of [[], ["bogus"], ["playwright", "playwright"], ["--force"]]) {
			expect(() => selectNeoMcpPresets(ids)).toThrow();
			expect(() => createNeoMcpConfig(root, ids)).toThrow();
		}
		expect(readdirSync(root)).toEqual([]);
	});
	it("creates only the selected enabled stdio entries after explicit apply", () => {
		const output: string[] = [];
		expect(
			runNeoCli(
				["setup", "playwright", "context7", "--apply"],
				context((text) => output.push(text)),
			),
		).toBe(0);
		const path = join(root, ".omk", "mcp.json");
		const config = JSON.parse(readFileSync(path, "utf8"));
		expect(Object.keys(config.mcpServers)).toEqual(["neo-playwright", "neo-context7"]);
		expect(config.mcpServers["neo-playwright"].args).toContain("--sandbox");
		expect(config.mcpServers["neo-playwright"].args).not.toContain("--no-sandbox");
		expect(config.mcpServers["neo-context7"].disabled).toBe(false);
		expect(readdirSync(join(root, ".omk"))).toEqual(["mcp.json"]);
		if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(JSON.parse(output[0]).status).toBe("configured_not_connected");
	});
	it("never overwrites or exposes an existing configuration, even if malformed", () => {
		mkdirSync(join(root, ".omk"));
		const path = join(root, ".omk", "mcp.json");
		const secretSentinel = "MALFORMED PRIVATE SENTINEL";
		writeFileSync(path, secretSentinel);
		const output: string[] = [];
		expect(
			runNeoCli(
				["setup", "playwright", "--apply"],
				context((text) => output.push(text)),
			),
		).toBe(1);
		expect(readFileSync(path, "utf8")).toBe(secretSentinel);
		expect(output.join("")).not.toContain(secretSentinel);
	});
	it.skipIf(process.platform === "win32")("rejects symlinked config directories", () => {
		const other = join(root, "other");
		mkdirSync(other);
		symlinkSync(other, join(root, ".omk"), "dir");
		expect(() => createNeoMcpConfig(root, ["playwright"])).toThrow();
		expect(readdirSync(other)).toEqual([]);
	});
	it("includes resources in npm and both binary packaging paths", () => {
		const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
		expect(pkg.files).toContain("resources");
		expect(pkg.scripts["copy-binary-assets"]).toContain("shx cp -r resources dist/");
		const script = readFileSync(resolve(packageDir, "../../scripts/build-binaries.sh"), "utf8");
		expect(script).toContain('cp -r resources "$OUTPUT_DIR/$platform/"');
	});
});
