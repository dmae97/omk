import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadSkillsWithBundled } from "../src/core/bundled-skills.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const pkg = fileURLToPath(new URL("..", import.meta.url));
let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-tencent-distribution-"));
	vi.stubEnv("OMK_PACKAGE_DIR", pkg);
	vi.stubEnv("OMK_BUNDLED_SKILLS", "1");
	vi.stubEnv("OMK_TENCENT_MEMORY", "1");
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	rmSync(root, { recursive: true, force: true });
});

it.each(["default", "disabled", "no-extensions"])("respects %s built-in loading without any network", async (mode) => {
	if (mode === "disabled") vi.stubEnv("OMK_TENCENT_MEMORY", "off");
	const network = vi.fn(() => {
		throw new Error("Startup must not fetch");
	});
	vi.stubGlobal("fetch", network);
	const loader = new DefaultResourceLoader({
		cwd: root,
		agentDir: root,
		noExtensions: mode === "no-extensions",
		noSkills: true,
		noContextFiles: true,
		settingsManager: SettingsManager.inMemory(),
	});
	await loader.reload();
	expect(loader.getExtensions().extensions.some((entry) => entry.path === "<builtin:tencent-memory>")).toBe(
		mode === "default",
	);
	expect(network).not.toHaveBeenCalled();
});

it("ships the setup skill and resolvable documentation with upstream attribution", () => {
	const result = loadSkillsWithBundled(false, { cwd: root, agentDir: root, skillPaths: [], includeDefaults: false });
	const skill = result.skills.find((entry) => entry.name === "omk-tencent-memory");
	expect(skill?.filePath).toBe(join(pkg, "resources/skills/omk-tencent-memory/SKILL.md"));
	const dir = dirname(skill!.filePath);
	expect(readFileSync(join(dir, "SOURCE.md"), "utf8")).toContain("badbd2179d06f4e0e1f2133bd3482880beab8a02");
	expect(readFileSync(join(dir, "LICENSE"), "utf8")).toContain("Copyright (C) 2026 Tencent");
	expect(readFileSync(join(dir, "../../../docs/tencent-memory.md"), "utf8")).toContain("allowWrites");
	const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
	expect(manifest.files).toEqual(expect.arrayContaining(["dist", "resources", "docs"]));
});

it("preserves user skill overrides and the bundled opt-out", () => {
	const path = join(root, "SKILL.md");
	writeFileSync(path, "---\nname: omk-tencent-memory\ndescription: User memory policy\n---\nLocal override\n");
	const options = { cwd: root, agentDir: root, includeDefaults: false, skillPaths: [path] };
	expect(
		loadSkillsWithBundled(false, options).skills.find((entry) => entry.name === "omk-tencent-memory")?.filePath,
	).toBe(path);
	expect(loadSkillsWithBundled(true, { ...options, skillPaths: [] }).skills).toEqual([]);
});
