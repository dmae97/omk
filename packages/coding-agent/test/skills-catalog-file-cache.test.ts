import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type LoadSkillsOptions, loadSkills } from "../src/core/skills.ts";
import { fingerprintSkillDir, readSkillCatalog, writeSkillCatalog } from "../src/core/skills-catalog-cache.ts";

// Auto-discovery hands loadSkills one SKILL.md path per skill, so the
// directory fingerprint cache never applied and every start re-read every file.
const skill = (name: string, description = `Complete description for ${name}`) =>
	`---\nname: ${name}\ndescription: ${description}\n---\nBody for ${name}\n`;
const cacheFile = (agentDir: string) => join(agentDir, "cache", "skill-catalog-v2.json");
const fileKeys = (agentDir: string) => Object.keys(readSkillCatalog(agentDir)).filter((k) => k.startsWith("file:"));

let root: string;
let agentDir: string;
let skillsRoot: string;

function writeSkill(name: string, content = skill(name)): string {
	const dir = join(skillsRoot, name);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "SKILL.md");
	writeFileSync(path, content);
	return path;
}

function options(skillPaths: string[], extra: Partial<LoadSkillsOptions> = {}): LoadSkillsOptions {
	return { cwd: root, agentDir, skillPaths, includeDefaults: false, catalogCache: true, ...extra };
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-file-cache-"));
	agentDir = join(root, "agent");
	skillsRoot = join(root, "auto-skills");
	mkdirSync(agentDir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("skill catalog cache for per-skill file paths", () => {
	it("stores one entry per SKILL.md path and serves the next start from it", () => {
		const paths = [writeSkill("alpha"), writeSkill("beta")];
		loadSkills(options(paths));
		expect(fileKeys(agentDir).sort()).toEqual(paths.map((p) => `file:${resolve(p)}`).sort());

		// Doctor the cached description: if the second start re-read the file it would not show up.
		const raw = JSON.parse(readFileSync(cacheFile(agentDir), "utf8"));
		raw[`file:${resolve(paths[0])}`].result.skill.description = "served from cache";
		writeFileSync(cacheFile(agentDir), JSON.stringify(raw));

		const second = loadSkills(options(paths));
		expect(second.skills.find((s) => s.name === "alpha")?.description).toBe("served from cache");
	});

	it("returns byte-identical results to the uncached path, warnings and dropped skills included", () => {
		const paths = [
			writeSkill("alpha"),
			writeSkill("Bad_Name", skill("Bad_Name")),
			writeSkill("no-desc", "---\nname: no-desc\n---\nbody\n"),
			writeSkill("hidden", "---\nname: hidden\ndescription: d\ndisable-model-invocation: true\n---\n"),
			writeSkill("broken", "---\nname: [unclosed\n---\n"),
		];
		const resolveSourceInfo = (path: string) => ({
			path,
			source: "auto",
			scope: "user" as const,
			origin: "top-level" as const,
			baseDir: undefined,
		});
		const uncached = loadSkills(options(paths, { catalogCache: false, resolveSourceInfo }));
		const cold = loadSkills(options(paths, { resolveSourceInfo }));
		const warm = loadSkills(options(paths, { resolveSourceInfo }));
		expect(fileKeys(agentDir)).toHaveLength(paths.length);
		expect(JSON.stringify(cold)).toBe(JSON.stringify(uncached));
		expect(JSON.stringify(warm)).toBe(JSON.stringify(uncached));
		expect(warm).toStrictEqual(uncached);
	});

	it("never caches source info, which belongs to the caller and not to the file", () => {
		const path = writeSkill("alpha");
		loadSkills(options([path]));
		const warm = loadSkills(
			options([path], {
				resolveSourceInfo: (p) => ({ path: p, source: "npm:pkg", scope: "project", origin: "package" }),
			}),
		);
		expect(warm.skills[0].sourceInfo).toEqual({ path, source: "npm:pkg", scope: "project", origin: "package" });
	});

	it("invalidates a same-size edit even when the mtime is restored", () => {
		const path = writeSkill("alpha", skill("alpha", "AAAA"));
		const { atime, mtime } = statSync(path);
		loadSkills(options([path]));
		writeFileSync(path, skill("alpha", "ZZZZ"));
		utimesSync(path, atime, mtime);
		expect(loadSkills(options([path])).skills[0].description).toBe("ZZZZ");
	});

	it("follows edits, removal and additions without manual cache clearing", () => {
		const alpha = writeSkill("alpha");
		const beta = writeSkill("beta");
		loadSkills(options([alpha, beta]));

		writeFileSync(alpha, skill("alpha", "rewritten description that is longer"));
		expect(loadSkills(options([alpha, beta])).skills[0].description).toBe("rewritten description that is longer");

		rmSync(beta);
		const afterRemove = loadSkills(options([alpha, beta]));
		expect(afterRemove).toEqual(loadSkills(options([alpha, beta], { catalogCache: false })));
		expect(afterRemove.skills.map((s) => s.name)).toEqual(["alpha"]);

		writeFileSync(beta, skill("beta", "recreated"));
		const gamma = writeSkill("gamma");
		const afterAdd = loadSkills(options([alpha, beta, gamma]));
		expect(afterAdd.skills.map((s) => [s.name, s.description])).toEqual([
			["alpha", "rewritten description that is longer"],
			["beta", "recreated"],
			["gamma", "Complete description for gamma"],
		]);
	});

	it("keeps file entries from earlier starts and moves hits to the most-recent end", () => {
		const alpha = writeSkill("alpha");
		const beta = writeSkill("beta");
		loadSkills(options([alpha, beta]));
		loadSkills(options([alpha])); // a start that only sees alpha must not forget beta
		expect(fileKeys(agentDir)).toEqual([`file:${resolve(beta)}`, `file:${resolve(alpha)}`]);
	});

	it("a start without skill paths leaves the existing catalog alone", () => {
		const path = writeSkill("alpha");
		loadSkills(options([path]));
		loadSkills(options([]));
		expect(fileKeys(agentDir)).toEqual([`file:${resolve(path)}`]);
	});

	it("bounds file entries separately from directory roots, sized for thousands of skills", () => {
		const dir = join(root, "d");
		mkdirSync(dir);
		const fingerprint = fingerprintSkillDir(dir);
		const dirs = Array.from({ length: 65 }, (_, i) => [join(dir, `${i}`), { fingerprint, result: i }]);
		const files = Array.from({ length: 4097 }, (_, i) => [
			`file:${join(dir, `${i}.md`)}`,
			{ fingerprint, result: i },
		]);
		writeSkillCatalog(agentDir, Object.fromEntries([...dirs, ...files]));
		const restored = readSkillCatalog(agentDir);
		const keys = Object.keys(restored);
		expect(keys.filter((k) => !k.startsWith("file:"))).toHaveLength(64);
		expect(keys.filter((k) => k.startsWith("file:"))).toHaveLength(4096);
		expect(restored[`file:${join(dir, "0.md")}`]).toBeUndefined();
		expect(restored[`file:${join(dir, "4096.md")}`].result).toBe(4096);
		expect(restored[join(dir, "0")]).toBeUndefined();
	});
});

describe("skill catalog file cache robustness", () => {
	it("treats a malformed cached result as a miss instead of failing the load", () => {
		const path = writeSkill("alpha");
		const baseline = loadSkills(options([path], { catalogCache: false }));
		loadSkills(options([path]));
		const raw = JSON.parse(readFileSync(cacheFile(agentDir), "utf8"));
		raw[`file:${resolve(path)}`].result = 1;
		writeFileSync(cacheFile(agentDir), JSON.stringify(raw));
		expect(loadSkills(options([path]))).toEqual(baseline);
	});
});
