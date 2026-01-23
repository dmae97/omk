import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadSkills, loadSkillsFromDir, type Skill } from "$c/extensibility/skills";

const fixturesDir = resolve(__dirname, "fixtures/skills");
const collisionFixturesDir = resolve(__dirname, "fixtures/skills-collision");

describe("skills", () => {
	describe("loadSkillsFromDir", () => {
		it("should load a valid skill", () => {
			const { skills, warnings } = loadSkillsFromDir({
				dir: join(fixturesDir, "valid-skill"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("valid-skill");
			expect(skills[0].description).toBe("A valid skill for testing purposes.");
			expect(skills[0].source).toBe("test");
			expect(warnings).toHaveLength(0);
		});

		it("should load skill when name doesn't match parent directory", () => {
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "name-mismatch"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("different-name");
		});

		it("should load skill with invalid name characters", () => {
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "invalid-name-chars"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
		});

		it("should load skill when name exceeds 64 characters", () => {
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "long-name"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
		});

		it("should skip skill when description is missing", () => {
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "missing-description"),
				source: "test",
			});

			expect(skills).toHaveLength(0);
		});

		it("should load skill with unknown frontmatter fields", () => {
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "unknown-field"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
		});

		it("should load nested skills recursively", () => {
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "nested"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("child-skill");
		});

		it("should skip files without frontmatter description", () => {
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "no-frontmatter"),
				source: "test",
			});

			// no-frontmatter has no description, so it should be skipped
			expect(skills).toHaveLength(0);
		});

		it("should load skill with consecutive hyphens in name", () => {
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "consecutive-hyphens"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
		});

		it("should load all skills from fixture directory", () => {
			const { skills } = loadSkillsFromDir({
				dir: fixturesDir,
				source: "test",
			});

			// Should load all skills that have descriptions (even with warnings)
			// valid-skill, name-mismatch, invalid-name-chars, long-name, unknown-field, nested/child-skill, consecutive-hyphens
			// NOT: missing-description, no-frontmatter (both missing descriptions)
			expect(skills.length).toBeGreaterThanOrEqual(6);
		});

		it("should return empty for non-existent directory", () => {
			const { skills } = loadSkillsFromDir({
				dir: "/non/existent/path",
				source: "test",
			});

			expect(skills).toHaveLength(0);
		});

		it("should use parent directory name when name not in frontmatter", () => {
			// The no-frontmatter fixture has no name in frontmatter, so it should use "no-frontmatter"
			// But it also has no description, so it won't load
			// Let's test with a valid skill that relies on directory name
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "valid-skill"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("valid-skill");
		});
	});

	describe("loadSkills with options", () => {
		it("should load from customDirectories only when built-ins disabled", async () => {
			const { skills } = await loadSkills({
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: false,
				enablePiProject: false,
				customDirectories: [fixturesDir],
			});
			expect(skills.length).toBeGreaterThan(0);
			// Custom directory skills have source "custom:user"
			expect(skills.every((s) => s.source.startsWith("custom"))).toBe(true);
		});

		it("should filter out ignoredSkills", async () => {
			const { skills } = await loadSkills({
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: false,
				enablePiProject: false,
				customDirectories: [join(fixturesDir, "valid-skill")],
				ignoredSkills: ["valid-skill"],
			});
			expect(skills).toHaveLength(0);
		});

		it("should support glob patterns in ignoredSkills", async () => {
			const { skills } = await loadSkills({
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: false,
				enablePiProject: false,
				customDirectories: [fixturesDir],
				ignoredSkills: ["valid-*"],
			});
			expect(skills.every((s) => !s.name.startsWith("valid-"))).toBe(true);
		});

		it("should have ignoredSkills take precedence over includeSkills", async () => {
			const { skills } = await loadSkills({
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: false,
				enablePiProject: false,
				customDirectories: [fixturesDir],
				includeSkills: ["valid-*"],
				ignoredSkills: ["valid-skill"],
			});
			// valid-skill should be excluded even though it matches includeSkills
			expect(skills.every((s) => s.name !== "valid-skill")).toBe(true);
		});

		it("should expand ~ in customDirectories", async () => {
			const homeSkillsDir = join(homedir(), ".omp/agent/skills");
			const { skills: withTilde } = await loadSkills({
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: false,
				enablePiProject: false,
				customDirectories: ["~/.omp/agent/skills"],
			});
			const { skills: withoutTilde } = await loadSkills({
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: false,
				enablePiProject: false,
				customDirectories: [homeSkillsDir],
			});
			expect(withTilde.length).toBe(withoutTilde.length);
		});

		it("should return empty when all sources disabled and no custom dirs", async () => {
			const { skills } = await loadSkills({
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: false,
				enablePiProject: false,
			});
			expect(skills).toHaveLength(0);
		});

		it("should filter skills with includeSkills glob patterns", async () => {
			// Load all skills from fixtures
			const { skills: allSkills } = await loadSkills({
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: false,
				enablePiProject: false,
				customDirectories: [fixturesDir],
			});
			expect(allSkills.length).toBeGreaterThan(0);

			// Filter to only include "valid-skill"
			const { skills: filtered } = await loadSkills({
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: false,
				enablePiProject: false,
				customDirectories: [fixturesDir],
				includeSkills: ["valid-skill"],
			});
			expect(filtered).toHaveLength(1);
			expect(filtered[0].name).toBe("valid-skill");
		});

		it("should support glob patterns in includeSkills", async () => {
			const { skills } = await loadSkills({
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: false,
				enablePiProject: false,
				customDirectories: [fixturesDir],
				includeSkills: ["valid-*"],
			});
			expect(skills.length).toBeGreaterThan(0);
			expect(skills.every((s) => s.name.startsWith("valid-"))).toBe(true);
		});

		it("should return all skills when includeSkills is empty", async () => {
			const { skills: withEmpty } = await loadSkills({
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: false,
				enablePiProject: false,
				customDirectories: [fixturesDir],
				includeSkills: [],
			});
			const { skills: withoutOption } = await loadSkills({
				enableCodexUser: false,
				enableClaudeUser: false,
				enableClaudeProject: false,
				enablePiUser: false,
				enablePiProject: false,
				customDirectories: [fixturesDir],
			});
			expect(withEmpty.length).toBe(withoutOption.length);
		});
	});

	describe("collision handling", () => {
		it("should detect name collisions and keep first skill", () => {
			// Load from first directory
			const first = loadSkillsFromDir({
				dir: join(collisionFixturesDir, "first"),
				source: "first",
			});

			const second = loadSkillsFromDir({
				dir: join(collisionFixturesDir, "second"),
				source: "second",
			});

			// Both directories should have loaded one skill each
			expect(first.skills).toHaveLength(1);
			expect(second.skills).toHaveLength(1);

			// Both have the same name "calendar"
			expect(first.skills[0].name).toBe("calendar");
			expect(second.skills[0].name).toBe("calendar");

			// Simulate the collision behavior from loadSkills()
			const skillMap = new Map<string, Skill>();
			const collisionWarnings: Array<{ skillPath: string; message: string }> = [];

			for (const skill of first.skills) {
				skillMap.set(skill.name, skill);
			}

			for (const skill of second.skills) {
				const existing = skillMap.get(skill.name);
				if (existing) {
					collisionWarnings.push({
						skillPath: skill.filePath,
						message: `name collision: "${skill.name}" already loaded from ${existing.filePath}`,
					});
				} else {
					skillMap.set(skill.name, skill);
				}
			}

			expect(skillMap.size).toBe(1);
			expect(skillMap.get("calendar")?.source).toBe("first");
			expect(collisionWarnings).toHaveLength(1);
			expect(collisionWarnings[0].message).toContain("name collision");
		});
	});
});
