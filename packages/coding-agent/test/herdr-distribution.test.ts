import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadSkillsWithBundled } from "../src/core/bundled-skills.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const pkg = fileURLToPath(new URL("..", import.meta.url));
let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-herdr-distribution-"));
	vi.stubEnv("OMK_PACKAGE_DIR", pkg);
	vi.stubEnv("OMK_BUNDLED_SKILLS", "1");
	vi.stubEnv("OMK_HERDR", "1");
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

it.each(["default", "disabled", "no-extensions"])("respects %s built-in Herdr extension loading", async (mode) => {
	if (mode === "disabled") vi.stubEnv("OMK_HERDR", "off");
	const loader = new DefaultResourceLoader({
		cwd: root,
		agentDir: root,
		noExtensions: mode === "no-extensions",
		noSkills: true,
		noContextFiles: true,
		settingsManager: SettingsManager.inMemory(),
	});
	await loader.reload();
	expect(loader.getExtensions().extensions.some((entry) => entry.path === "<builtin:herdr-agent-state>")).toBe(
		mode !== "disabled",
	);
});

it("ships the Apache-2.0 herdr skill, source contract, docs, and root NOTICE attribution", () => {
	const result = loadSkillsWithBundled(false, { cwd: root, agentDir: root, skillPaths: [], includeDefaults: false });
	const skill = result.skills.find((entry) => entry.name === "herdr");
	expect(skill?.filePath).toBe(join(pkg, "resources/skills/herdr/SKILL.md"));
	const dir = dirname(skill!.filePath);
	expect(readFileSync(join(dir, "SOURCE.md"), "utf8")).toContain("e8d7d9705a7a2c89cef4dd42079379f05685af87");
	expect(readFileSync(join(dir, "LICENSE"), "utf8")).toContain("Apache License");
	expect(readFileSync(join(dir, "../../../docs/herdr.md"), "utf8")).toContain("OMK_HERDR");
	expect(readFileSync(resolve(pkg, "../../NOTICE"), "utf8")).toContain("herdrdev/herdr");
});

it("preserves user skill overrides and the bundled opt-out for herdr", () => {
	const path = join(root, "SKILL.md");
	writeFileSync(path, "---\nname: herdr\ndescription: User herdr override\n---\nLocal override\n");
	const options = { cwd: root, agentDir: root, includeDefaults: false, skillPaths: [path] };
	expect(loadSkillsWithBundled(false, options).skills.find((entry) => entry.name === "herdr")?.filePath).toBe(path);
	expect(loadSkillsWithBundled(true, { ...options, skillPaths: [] }).skills).toEqual([]);
});
