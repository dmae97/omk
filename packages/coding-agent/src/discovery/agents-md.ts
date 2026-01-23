/**
 * AGENTS.md Provider
 *
 * Discovers standalone AGENTS.md files by walking up from cwd.
 * This handles AGENTS.md files that live in project root (not in config directories
 * like .codex/ or .gemini/, which are handled by their respective providers).
 */

import { dirname, join, sep } from "node:path";
import { type ContextFile, contextFileCapability } from "$c/capability/context-file";
import { readFile } from "$c/capability/fs";
import { registerProvider } from "$c/capability/index";
import type { LoadContext, LoadResult } from "$c/capability/types";
import { calculateDepth, createSourceMeta } from "./helpers";

const PROVIDER_ID = "agents-md";
const DISPLAY_NAME = "AGENTS.md";
const MAX_DEPTH = 20; // Prevent walking up excessively far from cwd

/**
 * Load standalone AGENTS.md files.
 */
async function loadAgentsMd(ctx: LoadContext): Promise<LoadResult<ContextFile>> {
	const items: ContextFile[] = [];
	const warnings: string[] = [];

	// Walk up from cwd looking for AGENTS.md files
	let current = ctx.cwd;
	let depth = 0;

	while (depth < MAX_DEPTH) {
		const candidate = join(current, "AGENTS.md");
		const content = await readFile(candidate);

		if (content !== null) {
			const parent = dirname(candidate);
			const baseName = parent.split(sep).pop() ?? "";

			if (!baseName.startsWith(".")) {
				const fileDir = dirname(candidate);
				const calculatedDepth = calculateDepth(ctx.cwd, fileDir, sep);

				items.push({
					path: candidate,
					content,
					level: "project",
					depth: calculatedDepth,
					_source: createSourceMeta(PROVIDER_ID, candidate, "project"),
				});
			}
		}

		// Move to parent directory
		const parent = dirname(current);
		if (parent === current) break; // Reached filesystem root
		current = parent;
		depth++;
	}

	return { items, warnings };
}

registerProvider(contextFileCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Standalone AGENTS.md files (Codex/Gemini style)",
	priority: 10,
	load: loadAgentsMd,
});
