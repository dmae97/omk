import crypto from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fingerprintSkillDir, readSkillCatalog, writeSkillCatalog } from "../src/core/skills-catalog-cache.ts";

let root: string;
let dir: string;
let cacheDir: string;
const cacheFile = "skill-catalog-v2.json";
const uuid = "00000000-0000-4000-8000-000000000000";
const store = (value: string) => ({ [resolve(dir)]: { fingerprint: fingerprintSkillDir(dir), result: value } });

beforeEach(() => {
	root = fs.mkdtempSync(join(tmpdir(), "omk-cache-storage-"));
	dir = join(root, "skills");
	cacheDir = join(root, "cache");
	fs.mkdirSync(dir);
	fs.mkdirSync(cacheDir);
	fs.writeFileSync(join(dir, "SKILL.md"), "skill");
});
afterEach(() => {
	vi.restoreAllMocks();
	syncBuiltinESMExports();
	fs.rmSync(root, { recursive: true, force: true });
});

describe("skill catalog publication ownership", () => {
	it("does not reuse legacy fingerprints or overwrite the v1 catalog", () => {
		const legacy = JSON.stringify(store("legacy"));
		const path = join(cacheDir, "skill-catalog-v1.json");
		fs.writeFileSync(path, legacy);
		expect(readSkillCatalog(root)).toEqual({});
		writeSkillCatalog(root, store("fresh"));
		expect(fs.readFileSync(path, "utf8")).toBe(legacy);
		expect(readSkillCatalog(root)[resolve(dir)].result).toBe("fresh");
	});

	it("uses independent temp files when another writer publishes before rename", () => {
		const rename = fs.renameSync;
		const temporaryPaths: string[] = [];
		vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
			temporaryPaths.push(String(from));
			if (temporaryPaths.length === 1) writeSkillCatalog(root, store("inner"));
			rename(from, to);
		});
		syncBuiltinESMExports();
		writeSkillCatalog(root, store("outer"));
		expect(readSkillCatalog(root)[resolve(dir)].result).toBe("outer");
		expect(new Set(temporaryPaths).size).toBe(2);
		expect(fs.readdirSync(cacheDir)).toEqual([cacheFile]);
	});

	it.skipIf(process.platform === "win32")("publishes owner-only cache files", () => {
		writeSkillCatalog(root, store("value"));
		expect(fs.statSync(join(cacheDir, cacheFile)).mode & 0o777).toBe(0o600);
	});

	it("leaves the previous snapshot intact and cleans up its own file if rename fails", () => {
		writeSkillCatalog(root, store("previous"));
		vi.spyOn(fs, "renameSync").mockImplementation(() => {
			throw new Error("simulated rename failure");
		});
		syncBuiltinESMExports();
		expect(() => writeSkillCatalog(root, store("next"))).not.toThrow();
		expect(readSkillCatalog(root)[resolve(dir)].result).toBe("previous");
		expect(fs.readdirSync(cacheDir)).toEqual([cacheFile]);
	});

	it("never removes a temp path it failed to acquire exclusively", () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(uuid);
		syncBuiltinESMExports();
		const collision = join(cacheDir, `${cacheFile}.${process.pid}.${uuid}.tmp`);
		fs.writeFileSync(collision, "another writer");
		writeSkillCatalog(root, store("new"));
		expect(fs.readFileSync(collision, "utf8")).toBe("another writer");
		expect(readSkillCatalog(root)).toEqual({});
	});

	it("drops malformed current-version entries and bounds roots, not skill counts", () => {
		fs.writeFileSync(join(cacheDir, cacheFile), JSON.stringify({ [resolve(dir)]: { fingerprint: {}, result: 1 } }));
		expect(readSkillCatalog(root)).toEqual({});
		const fingerprint = fingerprintSkillDir(dir);
		const entries = Object.fromEntries(
			Array.from({ length: 65 }, (_, i) => [join(dir, `${i}`), { fingerprint, result: i }]),
		);
		writeSkillCatalog(root, entries);
		const restored = readSkillCatalog(root);
		expect(Object.keys(restored)).toHaveLength(64);
		expect(restored[join(dir, "0")]).toBeUndefined();
		expect(restored[join(dir, "64")].result).toBe(64);
	});
});
