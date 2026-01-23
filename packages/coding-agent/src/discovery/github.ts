/**
 * GitHub Copilot Provider
 *
 * Loads configuration from GitHub Copilot's config directories.
 * Priority: 30 (shared standard provider)
 *
 * Sources:
 * - Project: .github/ (project-only, no user-level discovery)
 *
 * Capabilities:
 * - context-files: copilot-instructions.md in .github/
 * - instructions: *.instructions.md in .github/instructions/ with applyTo frontmatter
 */

import { basename, dirname, sep } from "node:path";
import { type ContextFile, contextFileCapability } from "$c/capability/context-file";
import { readFile } from "$c/capability/fs";
import { registerProvider } from "$c/capability/index";
import { type Instruction, instructionCapability } from "$c/capability/instruction";
import type { LoadContext, LoadResult, SourceMeta } from "$c/capability/types";
import { parseFrontmatter } from "$c/utils/frontmatter";
import { calculateDepth, createSourceMeta, getProjectPath, loadFilesFromDir } from "./helpers";

const PROVIDER_ID = "github";
const DISPLAY_NAME = "GitHub Copilot";
const PRIORITY = 30;

// =============================================================================
// Context Files
// =============================================================================

async function loadContextFiles(ctx: LoadContext): Promise<LoadResult<ContextFile>> {
	const items: ContextFile[] = [];
	const warnings: string[] = [];

	const copilotInstructionsPath = getProjectPath(ctx, "github", "copilot-instructions.md");
	if (copilotInstructionsPath) {
		const content = await readFile(copilotInstructionsPath);
		if (content) {
			const fileDir = dirname(copilotInstructionsPath);
			const depth = calculateDepth(ctx.cwd, fileDir, sep);

			items.push({
				path: copilotInstructionsPath,
				content,
				level: "project",
				depth,
				_source: createSourceMeta(PROVIDER_ID, copilotInstructionsPath, "project"),
			});
		}
	}

	return { items, warnings };
}

// =============================================================================
// Instructions
// =============================================================================

async function loadInstructions(ctx: LoadContext): Promise<LoadResult<Instruction>> {
	const items: Instruction[] = [];
	const warnings: string[] = [];

	const instructionsDir = getProjectPath(ctx, "github", "instructions");
	if (instructionsDir) {
		const result = await loadFilesFromDir<Instruction>(ctx, instructionsDir, PROVIDER_ID, "project", {
			extensions: ["md"],
			transform: transformInstruction,
		});
		items.push(...result.items);
		if (result.warnings) warnings.push(...result.warnings);
	}

	return { items, warnings };
}

function transformInstruction(name: string, content: string, path: string, source: SourceMeta): Instruction | null {
	// Only process .instructions.md files
	if (!name.endsWith(".instructions.md")) {
		return null;
	}

	const { frontmatter, body } = parseFrontmatter(content, { source: path });

	// Extract applyTo glob pattern from frontmatter
	const applyTo = typeof frontmatter.applyTo === "string" ? frontmatter.applyTo : undefined;

	// Derive name from filename (strip .instructions.md suffix)
	const instructionName = basename(name, ".instructions.md");

	return {
		name: instructionName,
		path,
		content: body,
		applyTo,
		_source: source,
	};
}

// =============================================================================
// Provider Registration
// =============================================================================

registerProvider(contextFileCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load copilot-instructions.md from .github/",
	priority: PRIORITY,
	load: loadContextFiles,
});

registerProvider(instructionCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load *.instructions.md from .github/instructions/ with applyTo frontmatter",
	priority: PRIORITY,
	load: loadInstructions,
});
