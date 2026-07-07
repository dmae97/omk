/**
 * algorithm-vendored-maintenance-v2 — on-disk vendored pack regression (caveman opt-in + taste-skill).
 * Reads only `.omk/skills` layout/metadata; does not mutate vendored content.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../../../");
const CAVEMAN_SKILL = join(REPO_ROOT, ".omk/skills/caveman/SKILL.md");
const TASTE_SKILLS_DIR = join(REPO_ROOT, ".omk/skills/taste-skill/skills");
const TASTE_SOURCE = join(REPO_ROOT, ".omk/skills/taste-skill/SOURCE.md");
const TASTE_PINNED_COMMIT = "b17742737e796305d829b3ad39eda3add0d79060";
const CHECK_VENDORED_SCRIPT = join(REPO_ROOT, "scripts/check-vendored-skills.mjs");

function readSkillFrontmatter(path: string): { raw: string; body: string } | null {
	const content = readFileSync(path, "utf8");
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
	return match ? { raw: match[1], body: match[2] } : null;
}

function frontmatterValue(raw: string, key: string): string | null {
	const match = new RegExp(`^[ \\t]*${key}:[ \\t]*(.*)$`, "m").exec(raw);
	if (!match) return null;
	return match[1].trim().replace(/^["']|["']$/g, "");
}

function countTasteSkillMdFiles(): number {
	const entries = readdirSync(TASTE_SKILLS_DIR, { withFileTypes: true });
	let count = 0;
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const skillMd = join(TASTE_SKILLS_DIR, entry.name, "SKILL.md");
		try {
			readFileSync(skillMd, "utf8");
			count += 1;
		} catch {
			// skip dirs without SKILL.md
		}
	}
	return count;
}

describe("module-integration vendored packs (on-disk)", () => {
	it("caveman SKILL.md has disable-model-invocation: true in frontmatter", () => {
		const parsed = readSkillFrontmatter(CAVEMAN_SKILL);
		expect(parsed, "caveman SKILL.md must have YAML frontmatter").not.toBeNull();
		expect(frontmatterValue(parsed!.raw, "disable-model-invocation")).toBe("true");
	});

	it("caveman SKILL.md documents /compact prohibition (opt-in; no hijack of builtin)", () => {
		const text = readFileSync(CAVEMAN_SKILL, "utf8");
		expect(text).toMatch(/`\/compact`/);
		expect(text.toLowerCase()).toMatch(/forbidden|must never|do not alias/);
	});

	it("taste-skill has 13 SKILL.md files under skills/", () => {
		expect(countTasteSkillMdFiles()).toBe(13);
	});

	it("taste-skill SOURCE.md contains pinned commit b177427...", () => {
		const source = readFileSync(TASTE_SOURCE, "utf8");
		expect(source).toContain(TASTE_PINNED_COMMIT);
	});

	it("check-vendored-skills.mjs exits 0 when run from repo root", () => {
		const result = spawnSync(process.execPath, [CHECK_VENDORED_SCRIPT], {
			cwd: REPO_ROOT,
			encoding: "utf8",
		});
		expect(result.status, result.stderr || result.stdout).toBe(0);
	});
});
