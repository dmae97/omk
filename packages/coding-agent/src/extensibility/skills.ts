import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { skillCapability } from "../capability/skill";
import type { SourceMeta } from "../capability/types";
import type { SkillsSettings } from "../config/settings-manager";
import type { Skill as CapabilitySkill, SkillFrontmatter as ImportedSkillFrontmatter } from "../discovery";
import { loadCapability } from "../discovery";
import { parseFrontmatter } from "../utils/frontmatter";

// Re-export SkillFrontmatter for backward compatibility
export type { ImportedSkillFrontmatter as SkillFrontmatter };

export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	source: string;
	/** Source metadata for display */
	_source?: SourceMeta;
}

export interface SkillWarning {
	skillPath: string;
	message: string;
}

export interface LoadSkillsResult {
	skills: Skill[];
	warnings: SkillWarning[];
}

export interface LoadSkillsFromDirOptions {
	/** Directory to scan for skills */
	dir: string;
	/** Source identifier for these skills */
	source: string;
}

/**
 * Load skills from a directory recursively.
 * Skills are directories containing a SKILL.md file with frontmatter including a description.
 */
export async function loadSkillsFromDir(options: LoadSkillsFromDirOptions): Promise<LoadSkillsResult> {
	const skills: Skill[] = [];
	const warnings: SkillWarning[] = [];
	const seenPaths = new Set<string>();

	async function addSkill(skillFile: string, skillDir: string, dirName: string): Promise<void> {
		if (seenPaths.has(skillFile)) return;
		try {
			const content = await fs.readFile(skillFile, "utf-8");
			const { frontmatter } = parseFrontmatter(content, { source: skillFile });
			const name = (frontmatter.name as string) || dirName;
			const description = frontmatter.description as string;

			if (description) {
				seenPaths.add(skillFile);
				skills.push({
					name,
					description,
					filePath: skillFile,
					baseDir: skillDir,
					source: options.source,
				});
			}
		} catch (error) {
			logger.warn("Failed to load skill", { path: skillFile, error: String(error) });
		}
	}

	async function scanDir(dir: string): Promise<void> {
		try {
			const entries = await fs.readdir(dir, { withFileTypes: true });
			const tasks: Promise<void>[] = [];

			for (const entry of entries) {
				if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					const skillFile = path.join(fullPath, "SKILL.md");
					tasks.push(
						fs
							.stat(skillFile)
							.then((s) => {
								if (s.isFile()) {
									return addSkill(skillFile, fullPath, entry.name);
								}
							})
							.catch(() => {
								// No SKILL.md in this directory
							}),
					);
					tasks.push(scanDir(fullPath));
				} else if (entry.isFile() && entry.name === "SKILL.md") {
					tasks.push(addSkill(fullPath, dir, path.basename(dir)));
				}
			}

			await Promise.all(tasks);
		} catch (err) {
			warnings.push({ skillPath: dir, message: `Failed to read directory: ${err}` });
		}
	}

	await scanDir(options.dir);

	return { skills, warnings };
}

/**
 * Scan a directory for SKILL.md files recursively.
 * Used internally by loadSkills for custom directories.
 */
async function scanDirectoryForSkills(dir: string): Promise<LoadSkillsResult> {
	const skills: Skill[] = [];
	const warnings: SkillWarning[] = [];
	const seenPaths = new Set<string>();

	async function addSkill(skillFile: string, skillDir: string, dirName: string): Promise<void> {
		if (seenPaths.has(skillFile)) return;
		try {
			const content = await fs.readFile(skillFile, "utf-8");
			const { frontmatter } = parseFrontmatter(content, { source: skillFile });
			const name = (frontmatter.name as string) || dirName;
			const description = frontmatter.description as string;

			if (description) {
				seenPaths.add(skillFile);
				skills.push({
					name,
					description,
					filePath: skillFile,
					baseDir: skillDir,
					source: "custom",
				});
			}
		} catch (error) {
			logger.warn("Failed to load skill", { path: skillFile, error: String(error) });
		}
	}

	async function scanDir(currentDir: string): Promise<void> {
		try {
			const entries = await fs.readdir(currentDir, { withFileTypes: true });
			const tasks: Promise<void>[] = [];

			for (const entry of entries) {
				if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

				const fullPath = path.join(currentDir, entry.name);
				if (entry.isDirectory()) {
					const skillFile = path.join(fullPath, "SKILL.md");
					tasks.push(
						fs
							.stat(skillFile)
							.then((s) => {
								if (s.isFile()) {
									return addSkill(skillFile, fullPath, entry.name);
								}
							})
							.catch(() => {
								// No SKILL.md in this directory
							}),
					);
					tasks.push(scanDir(fullPath));
				} else if (entry.isFile() && entry.name === "SKILL.md") {
					tasks.push(addSkill(fullPath, currentDir, path.basename(currentDir)));
				}
			}

			await Promise.all(tasks);
		} catch (err) {
			warnings.push({ skillPath: currentDir, message: `Failed to read directory: ${err}` });
		}
	}

	await scanDir(dir);

	return { skills, warnings };
}

export interface LoadSkillsOptions extends SkillsSettings {
	/** Working directory for project-local skills. Default: process.cwd() */
	cwd?: string;
}

/**
 * Load skills from all configured locations.
 * Returns skills and any validation warnings.
 */
export async function loadSkills(options: LoadSkillsOptions = {}): Promise<LoadSkillsResult> {
	const {
		cwd = process.cwd(),
		enabled = true,
		enableCodexUser = true,
		enableClaudeUser = true,
		enableClaudeProject = true,
		enablePiUser = true,
		enablePiProject = true,
		customDirectories = [],
		ignoredSkills = [],
		includeSkills = [],
	} = options;

	// Early return if skills are disabled
	if (!enabled) {
		return { skills: [], warnings: [] };
	}

	// Helper to check if a source is enabled
	function isSourceEnabled(source: SourceMeta): boolean {
		const { provider, level } = source;
		if (provider === "codex" && level === "user") return enableCodexUser;
		if (provider === "claude" && level === "user") return enableClaudeUser;
		if (provider === "claude" && level === "project") return enableClaudeProject;
		if (provider === "native" && level === "user") return enablePiUser;
		if (provider === "native" && level === "project") return enablePiProject;
		// For other providers (gemini, cursor, etc.) or custom, default to enabled
		return true;
	}

	// Use capability API to load all skills
	const result = await loadCapability<CapabilitySkill>(skillCapability.id, { cwd });

	const skillMap = new Map<string, Skill>();
	const realPathSet = new Set<string>();
	const collisionWarnings: SkillWarning[] = [];

	// Check if skill name matches any of the include patterns
	function matchesIncludePatterns(name: string): boolean {
		if (includeSkills.length === 0) return true;
		return includeSkills.some((pattern) => new Bun.Glob(pattern).match(name));
	}

	// Check if skill name matches any of the ignore patterns
	function matchesIgnorePatterns(name: string): boolean {
		if (ignoredSkills.length === 0) return false;
		return ignoredSkills.some((pattern) => new Bun.Glob(pattern).match(name));
	}

	// Filter skills by source and patterns first
	const filteredSkills = result.items.filter((capSkill) => {
		if (!isSourceEnabled(capSkill._source)) return false;
		if (matchesIgnorePatterns(capSkill.name)) return false;
		if (!matchesIncludePatterns(capSkill.name)) return false;
		return true;
	});

	// Batch resolve all real paths in parallel
	const realPaths = await Promise.all(
		filteredSkills.map(async (capSkill) => {
			try {
				return await fs.realpath(capSkill.path);
			} catch {
				return capSkill.path;
			}
		}),
	);

	// Process skills with resolved paths
	for (let i = 0; i < filteredSkills.length; i++) {
		const capSkill = filteredSkills[i];
		const resolvedPath = realPaths[i];

		// Skip silently if we've already loaded this exact file (via symlink)
		if (realPathSet.has(resolvedPath)) {
			continue;
		}

		const existing = skillMap.get(capSkill.name);
		if (existing) {
			collisionWarnings.push({
				skillPath: capSkill.path,
				message: `name collision: "${capSkill.name}" already loaded from ${existing.filePath}, skipping this one`,
			});
		} else {
			// Transform capability skill to legacy format
			const skill: Skill = {
				name: capSkill.name,
				description: capSkill.frontmatter?.description || "",
				filePath: capSkill.path,
				baseDir: capSkill.path.replace(/\/SKILL\.md$/, ""),
				source: `${capSkill._source.provider}:${capSkill.level}`,
				_source: capSkill._source,
			};
			skillMap.set(capSkill.name, skill);
			realPathSet.add(resolvedPath);
		}
	}

	// Process custom directories - scan directly without using full provider system
	const allCustomSkills: Array<{ skill: Skill; path: string }> = [];
	const customScanResults = await Promise.all(customDirectories.map((dir) => scanDirectoryForSkills(dir)));
	for (const customSkills of customScanResults) {
		for (const s of customSkills.skills) {
			if (matchesIgnorePatterns(s.name)) continue;
			if (!matchesIncludePatterns(s.name)) continue;
			allCustomSkills.push({
				skill: {
					name: s.name,
					description: s.description,
					filePath: s.filePath,
					baseDir: s.filePath.replace(/\/SKILL\.md$/, ""),
					source: "custom:user",
					_source: { provider: "custom", providerName: "Custom", path: s.filePath, level: "user" },
				},
				path: s.filePath,
			});
		}
		collisionWarnings.push(...customSkills.warnings);
	}

	// Batch resolve custom skill paths
	const customRealPaths = await Promise.all(
		allCustomSkills.map(async ({ path }) => {
			try {
				return await fs.realpath(path);
			} catch {
				return path;
			}
		}),
	);

	for (let i = 0; i < allCustomSkills.length; i++) {
		const { skill } = allCustomSkills[i];
		const resolvedPath = customRealPaths[i];
		if (realPathSet.has(resolvedPath)) continue;

		const existing = skillMap.get(skill.name);
		if (existing) {
			collisionWarnings.push({
				skillPath: skill.filePath,
				message: `name collision: "${skill.name}" already loaded from ${existing.filePath}, skipping this one`,
			});
		} else {
			skillMap.set(skill.name, skill);
			realPathSet.add(resolvedPath);
		}
	}

	return {
		skills: Array.from(skillMap.values()),
		warnings: [...result.warnings.map((w) => ({ skillPath: "", message: w })), ...collisionWarnings],
	};
}
