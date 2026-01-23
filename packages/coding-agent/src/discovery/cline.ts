/**
 * Cline Provider
 *
 * Loads rules from .clinerules (can be single file or directory with *.md files).
 * Project-only (no user-level config).
 */

import { dirname, resolve } from "node:path";
import { readDirEntries, readFile } from "$c/capability/fs";
import { registerProvider } from "$c/capability/index";
import type { Rule } from "$c/capability/rule";
import { ruleCapability } from "$c/capability/rule";
import type { LoadContext, LoadResult } from "$c/capability/types";
import { parseFrontmatter } from "$c/utils/frontmatter";
import { createSourceMeta, loadFilesFromDir } from "./helpers";

const PROVIDER_ID = "cline";
const DISPLAY_NAME = "Cline";
const PRIORITY = 40;

async function findClinerules(startDir: string): Promise<{ path: string; isDir: boolean } | null> {
	let current = resolve(startDir);

	while (true) {
		const entries = await readDirEntries(current);
		const entry = entries.find((e) => e.name === ".clinerules");
		if (entry) {
			return {
				path: resolve(current, ".clinerules"),
				isDir: entry.isDirectory(),
			};
		}
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

/**
 * Load rules from .clinerules
 */
async function loadRules(ctx: LoadContext): Promise<LoadResult<Rule>> {
	const items: Rule[] = [];
	const warnings: string[] = [];

	// Project-level only (Cline uses root-level .clinerules)
	const found = await findClinerules(ctx.cwd);
	if (!found) {
		return { items, warnings };
	}

	// Check if .clinerules is a directory or file
	if (found.isDir) {
		// Directory format: load all *.md files
		const result = await loadFilesFromDir(ctx, found.path, PROVIDER_ID, "project", {
			extensions: ["md"],
			transform: (name, content, path, source) => {
				const { frontmatter, body } = parseFrontmatter(content, { source: path });
				const ruleName = name.replace(/\.md$/, "");

				// Parse globs (can be array or single string)
				let globs: string[] | undefined;
				if (Array.isArray(frontmatter.globs)) {
					globs = frontmatter.globs.filter((g): g is string => typeof g === "string");
				} else if (typeof frontmatter.globs === "string") {
					globs = [frontmatter.globs];
				}

				return {
					name: ruleName,
					path,
					content: body,
					globs,
					alwaysApply: typeof frontmatter.alwaysApply === "boolean" ? frontmatter.alwaysApply : undefined,
					description: typeof frontmatter.description === "string" ? frontmatter.description : undefined,
					ttsrTrigger: typeof frontmatter.ttsr_trigger === "string" ? frontmatter.ttsr_trigger : undefined,
					_source: source,
				};
			},
		});

		items.push(...result.items);
		if (result.warnings) warnings.push(...result.warnings);
	} else {
		// Single file format
		const content = await readFile(found.path);
		if (content === null) {
			warnings.push(`Failed to read .clinerules at ${found.path}`);
			return { items, warnings };
		}

		const { frontmatter, body } = parseFrontmatter(content, { source: found.path });
		const source = createSourceMeta(PROVIDER_ID, found.path, "project");

		// Parse globs (can be array or single string)
		let globs: string[] | undefined;
		if (Array.isArray(frontmatter.globs)) {
			globs = frontmatter.globs.filter((g): g is string => typeof g === "string");
		} else if (typeof frontmatter.globs === "string") {
			globs = [frontmatter.globs];
		}

		items.push({
			name: "clinerules",
			path: found.path,
			content: body,
			globs,
			alwaysApply: typeof frontmatter.alwaysApply === "boolean" ? frontmatter.alwaysApply : undefined,
			description: typeof frontmatter.description === "string" ? frontmatter.description : undefined,
			ttsrTrigger: typeof frontmatter.ttsr_trigger === "string" ? frontmatter.ttsr_trigger : undefined,
			_source: source,
		});
	}

	return { items, warnings };
}

// Register provider
registerProvider<Rule>(ruleCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load rules from .clinerules (single file or directory)",
	priority: PRIORITY,
	load: loadRules,
});
