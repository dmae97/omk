import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { resolvePath } from "../utils/paths.ts";
import type { ContextFile } from "./context-file.ts";

const ENTRY_POINT_CANDIDATES = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
const OVERRIDE_CANDIDATES = ["AGENTS.override.md", "AGENTS.GODMODE.md", "GODMODE.md", "ENI.override.md"];
export const PROJECT_CONTEXT_DOCUMENTS = [
	"PRD.md",
	"ARCHITECTURE.md",
	"DESIGN.md",
	"RULES.md",
	"TASKS.md",
	"PROGRESS.md",
] as const;

function loadContextFileFromDir(dir: string): ContextFile | null {
	for (const filename of ENTRY_POINT_CANDIDATES) {
		const filePath = join(dir, filename);
		if (existsSync(filePath)) {
			try {
				if (!statSync(filePath).isFile()) {
					continue;
				}
				return {
					path: filePath,
					content: readFileSync(filePath, "utf-8"),
				};
			} catch (error) {
				console.error(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`));
			}
		}
	}
	return null;
}

function loadOverrideFilesFromDir(dir: string): ContextFile[] {
	const results: ContextFile[] = [];
	for (const filename of OVERRIDE_CANDIDATES) {
		const filePath = join(dir, filename);
		if (existsSync(filePath)) {
			try {
				results.push({
					path: filePath,
					content: readFileSync(filePath, "utf-8"),
				});
			} catch (error) {
				console.error(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`));
			}
		}
	}
	return results;
}

function loadProjectDocumentsFromDir(dir: string): ContextFile[] {
	const results: ContextFile[] = [];
	for (const filename of PROJECT_CONTEXT_DOCUMENTS) {
		const filePath = join(dir, filename);
		if (!existsSync(filePath)) continue;
		try {
			if (!statSync(filePath).isFile()) continue;
			results.push({ path: filePath, content: readFileSync(filePath, "utf-8") });
		} catch (error) {
			console.error(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`));
		}
	}
	return results;
}

function isGlobalContextFile(file: ContextFile, agentDir: string): boolean {
	const resolvedAgentDir = resolvePath(agentDir);
	const normalizedPath = resolve(file.path);
	const parentDir = resolve(normalizedPath, "..");
	return parentDir === resolvedAgentDir;
}

export function loadProjectContextFiles(options: { cwd: string; agentDir: string }): ContextFile[] {
	const resolvedCwd = resolvePath(options.cwd);
	const resolvedAgentDir = resolvePath(options.agentDir);

	const contextFiles: ContextFile[] = [];
	const seenPaths = new Set<string>();

	const globalContext = loadContextFileFromDir(resolvedAgentDir);
	if (globalContext) {
		contextFiles.push({ ...globalContext, isGlobal: true });
		seenPaths.add(globalContext.path);
	}

	const globalOverrides = loadOverrideFilesFromDir(resolvedAgentDir);
	for (const override of globalOverrides) {
		if (!seenPaths.has(override.path)) {
			contextFiles.push({ ...override, isGlobal: true });
			seenPaths.add(override.path);
		}
	}

	const ancestorContextFiles: ContextFile[] = [];

	let currentDir = resolvedCwd;
	const root = resolve("/");

	while (true) {
		const contextFile = loadContextFileFromDir(currentDir);
		const hasCurrentEntryPoint = contextFile !== null && !seenPaths.has(contextFile.path);
		if (contextFile && hasCurrentEntryPoint) {
			ancestorContextFiles.unshift({
				...contextFile,
				isGlobal: isGlobalContextFile(contextFile, resolvedAgentDir),
			});
			seenPaths.add(contextFile.path);
		}

		const projectDocuments = loadProjectDocumentsFromDir(currentDir);
		const currentDocuments: ContextFile[] = [];
		for (const document of projectDocuments) {
			if (!seenPaths.has(document.path)) {
				currentDocuments.push({
					...document,
					isGlobal: isGlobalContextFile(document, resolvedAgentDir),
				});
				seenPaths.add(document.path);
			}
		}
		ancestorContextFiles.splice(hasCurrentEntryPoint ? 1 : 0, 0, ...currentDocuments);

		const dirOverrides = loadOverrideFilesFromDir(currentDir);
		for (const override of dirOverrides) {
			if (!seenPaths.has(override.path)) {
				ancestorContextFiles.unshift({
					...override,
					isGlobal: isGlobalContextFile(override, resolvedAgentDir),
				});
				seenPaths.add(override.path);
			}
		}

		if (currentDir === root) break;

		const parentDir = resolve(currentDir, "..");
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}

	contextFiles.push(...ancestorContextFiles);

	return contextFiles;
}
