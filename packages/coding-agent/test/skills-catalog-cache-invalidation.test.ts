import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSkills } from "../src/core/skills.ts";
import { cachedSkillScan, fingerprintSkillDir, writeSkillCatalog } from "../src/core/skills-catalog-cache.ts";

const skill = (name: string) =>
	`---\nname: ${name}\ndescription: Complete description for ${name}\n---\nBody for ${name}\n`;
let root: string;
let agentDir: string;
let dir: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-cache-invalidation-"));
	agentDir = join(root, "agent");
	dir = join(agentDir, "skills");
	mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("skill catalog invalidation without inventory reduction", () => {
	it.each([".gitignore", ".ignore", ".fdignore"])(
		"tracks %s creation, editing and removal with the real scanner",
		(name) => {
			mkdirSync(join(dir, "group", "probe"), { recursive: true });
			writeFileSync(join(dir, "group", "probe", "SKILL.md"), skill("probe"));
			const options = { cwd: root, agentDir, skillPaths: [dir], includeDefaults: false, catalogCache: true };
			const baseline = loadSkills({ ...options, catalogCache: false });
			expect(loadSkills(options)).toEqual(baseline);
			const ignore = join(dir, "group", name);
			writeFileSync(ignore, "probe/\n");
			expect(loadSkills(options).skills).toEqual([]);
			writeFileSync(ignore, "# visible again\n");
			expect(loadSkills(options)).toEqual(baseline);
			writeFileSync(join(dir, name), "group/\n");
			expect(loadSkills(options).skills).toEqual([]);
			rmSync(join(dir, name));
			expect(loadSkills(options)).toEqual(baseline);
		},
	);

	it("does not cache partial depth fingerprints, but returns deep scanner results", () => {
		const deep = join(dir, ...Array.from({ length: 10 }, () => "nested"));
		mkdirSync(deep, { recursive: true });
		const file = join(deep, "SKILL.md");
		writeFileSync(file, skill("deep"));
		const options = { cwd: root, agentDir, skillPaths: [dir], includeDefaults: false, catalogCache: true };
		expect(loadSkills(options).skills.map((entry) => entry.name)).toEqual(["deep"]);
		writeFileSync(file, skill("edited"));
		expect(loadSkills(options)).toEqual(loadSkills({ ...options, catalogCache: false }));
		expect(loadSkills(options).skills.map((entry) => entry.name)).toEqual(["edited"]);
		expect(fingerprintSkillDir(dir)).toMatchObject({ complete: false });
	});

	it("marks an exhausted entry walk incomplete rather than trusting its prefix", () => {
		for (let i = 0; i < 20_001; i++) writeFileSync(join(dir, `.hidden-${i}`), "");
		expect(fingerprintSkillDir(dir)).toMatchObject({ complete: false });
		const scan = vi.fn(() => ["full scan result"]);
		const first = cachedSkillScan(agentDir, dir, scan);
		expect(cachedSkillScan(agentDir, dir, scan, first.store).result).toEqual(["full scan result"]);
		expect(scan).toHaveBeenCalledTimes(2);
	});

	it.skipIf(process.platform === "win32")("rejects cache reuse on cycles and broken paths", () => {
		symlinkSync(dir, join(dir, "loop"), "dir");
		expect(fingerprintSkillDir(dir)).toMatchObject({ complete: false });
		rmSync(join(dir, "loop"));
		symlinkSync(join(root, "missing"), join(dir, "broken"));
		const scan = vi.fn(() => ["scanner-owned result"]);
		const first = cachedSkillScan(agentDir, dir, scan);
		cachedSkillScan(agentDir, dir, scan, first.store);
		expect(scan).toHaveBeenCalledTimes(2);
		expect(fingerprintSkillDir(dir)).toMatchObject({ complete: false });
	});

	it.skipIf(process.platform === "win32")(
		"does not mistake two aliases for a cycle and notices symlink retargeting",
		() => {
			const target = join(root, "target");
			mkdirSync(target);
			writeFileSync(join(target, "SKILL.md"), skill("one"));
			symlinkSync(target, join(dir, "a"), "dir");
			symlinkSync(target, join(dir, "b"), "dir");
			const before = fingerprintSkillDir(dir);
			expect(before).toMatchObject({ complete: true, files: 2 });
			const other = join(root, "other");
			mkdirSync(other);
			writeFileSync(join(other, "SKILL.md"), skill("two"));
			rmSync(join(dir, "b"));
			symlinkSync(other, join(dir, "b"), "dir");
			expect(fingerprintSkillDir(dir).digest).not.toBe(before.digest);
		},
	);

	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"does not reuse a fingerprint after directory read access is lost",
		() => {
			const nested = join(dir, "private");
			mkdirSync(nested);
			writeFileSync(join(nested, "SKILL.md"), skill("probe"));
			const scan = vi.fn(() => ["original scanner result"]);
			const first = cachedSkillScan(agentDir, dir, scan);
			chmodSync(nested, 0o000);
			try {
				expect(fingerprintSkillDir(dir)).toMatchObject({ complete: false });
				expect(cachedSkillScan(agentDir, dir, scan, first.store).result).toEqual(["original scanner result"]);
				expect(first.store?.[resolve(dir)]).toBeUndefined();
				expect(scan).toHaveBeenCalledTimes(2);
			} finally {
				chmodSync(nested, 0o700);
			}
		},
	);

	it("returns a raced scan but never publishes it under an unstable fingerprint", () => {
		const file = join(dir, "SKILL.md");
		writeFileSync(file, "old");
		const scan = vi.fn(() => {
			const result = readFileSync(file, "utf8");
			if (result === "old") writeFileSync(file, "changed during scan");
			return result;
		});
		const first = cachedSkillScan(agentDir, dir, scan);
		expect(first.result).toBe("old");
		expect(first.store?.[resolve(dir)]).toBeUndefined();
		expect(cachedSkillScan(agentDir, dir, scan, first.store).result).toBe("changed during scan");
		expect(scan).toHaveBeenCalledTimes(2);
	});

	it("preserves full descriptors, hashes, source, diagnostics and ordering for 1200 actual skills", () => {
		for (let i = 0; i < 1200; i++) writeFileSync(join(dir, `skill-${i}.md`), skill(`skill-${i}`));
		const options = { cwd: root, agentDir, skillPaths: [dir], includeDefaults: false, catalogCache: true };
		const uncached = loadSkills({ ...options, catalogCache: false });
		expect(uncached.skills).toHaveLength(1200);
		expect(loadSkills(options)).toEqual(uncached);
		const hit = loadSkills(options);
		expect(hit).toEqual(uncached);
		hit.skills[0].description = "caller mutation";
		expect(loadSkills(options)).toEqual(uncached);
	});

	it("clones cache hits and invalidates removed files", () => {
		const file = join(dir, "SKILL.md");
		writeFileSync(file, skill("probe"));
		const scan = vi.fn(() => ({ names: ["probe"] }));
		const first = cachedSkillScan(agentDir, dir, scan);
		writeSkillCatalog(agentDir, first.store ?? {});
		cachedSkillScan(agentDir, dir, scan).result.names.push("mutation");
		expect(cachedSkillScan(agentDir, dir, scan).result).toEqual({ names: ["probe"] });
		expect(scan).toHaveBeenCalledTimes(1);
		rmSync(file);
		cachedSkillScan(agentDir, dir, scan);
		expect(scan).toHaveBeenCalledTimes(2);
	});
});
