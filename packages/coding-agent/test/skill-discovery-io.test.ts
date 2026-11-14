import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { loadSkillsFromDir } from "../src/core/skills.ts";

const probes = vi.hoisted(() => [] as string[]);
vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();
	return {
		...fs,
		existsSync: (path: Parameters<typeof fs.existsSync>[0]) => {
			probes.push(String(path));
			return fs.existsSync(path);
		},
	};
});
vi.mock("fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("fs")>();
	return {
		...fs,
		existsSync: (path: Parameters<typeof fs.existsSync>[0]) => {
			probes.push(String(path));
			return fs.existsSync(path);
		},
	};
});

let root: string;
let skillsDir: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-skill-io-"));
	skillsDir = join(root, "agent", "skills");
	for (const name of ["keep", "ignored", "nested/keep-nested", "nested/ignored-nested"]) {
		const dir = join(skillsDir, name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "SKILL.md"), `---\nname: ${basename(name)}\ndescription: Test skill\n---\n`);
	}
	writeFileSync(join(skillsDir, ".gitignore"), "ignored/\n");
	writeFileSync(join(root, "ignore-rules"), "ignored-nested/\n");
	symlinkSync(join(root, "ignore-rules"), join(skillsDir, "nested", ".ignore"));
	probes.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function expectNoIgnoreProbes(): void {
	expect(
		probes.filter(
			(path) => path.startsWith(skillsDir) && [".gitignore", ".ignore", ".fdignore"].includes(basename(path)),
		),
	).toEqual([]);
}

describe("skill discovery filesystem work", () => {
	it("uses directory entries for ignore controls while loading skills", () => {
		const loaded = loadSkillsFromDir({ dir: skillsDir, source: "test" });
		expect(loaded.skills.map((skill) => skill.name).sort()).toEqual(["keep", "keep-nested"]);
		expectNoIgnoreProbes();
	});

	it("uses directory entries for ignore controls during package discovery", async () => {
		const manager = new DefaultPackageManager({
			cwd: root,
			agentDir: join(root, "agent"),
			settingsManager: SettingsManager.inMemory(),
		});
		const resolved = await manager.resolve();
		expect(
			resolved.skills
				.filter((skill) => skill.path.startsWith(skillsDir))
				.map((skill) => basename(join(skill.path, "..")))
				.sort(),
		).toEqual(["keep", "keep-nested"]);
		expectNoIgnoreProbes();
	});
});
