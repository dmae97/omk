/**
 * Builtin Provider (.omp / .pi)
 *
 * Primary provider for OMP native configs. Supports all capabilities.
 * .pi is an alias for backwards compatibility.
 */

import { dirname, isAbsolute, join, resolve } from "path";
import { type ContextFile, contextFileCapability } from "$c/capability/context-file";
import { type Extension, type ExtensionManifest, extensionCapability } from "$c/capability/extension";
import { type ExtensionModule, extensionModuleCapability } from "$c/capability/extension-module";
import { readDirEntries, readFile } from "$c/capability/fs";
import { type Hook, hookCapability } from "$c/capability/hook";
import { registerProvider } from "$c/capability/index";
import { type Instruction, instructionCapability } from "$c/capability/instruction";
import { type MCPServer, mcpCapability } from "$c/capability/mcp";
import { type Prompt, promptCapability } from "$c/capability/prompt";
import { type Rule, ruleCapability } from "$c/capability/rule";
import { type Settings, settingsCapability } from "$c/capability/settings";
import { type Skill, skillCapability } from "$c/capability/skill";
import { type SlashCommand, slashCommandCapability } from "$c/capability/slash-command";
import { type SystemPrompt, systemPromptCapability } from "$c/capability/system-prompt";
import { type CustomTool, toolCapability } from "$c/capability/tool";
import type { LoadContext, LoadResult } from "$c/capability/types";
import { parseFrontmatter } from "$c/utils/frontmatter";
import {
	createSourceMeta,
	discoverExtensionModulePaths,
	expandEnvVarsDeep,
	getExtensionNameFromPath,
	loadFilesFromDir,
	loadSkillsFromDir,
	parseJSON,
	SOURCE_PATHS,
} from "./helpers";

const PROVIDER_ID = "native";
const DISPLAY_NAME = "OMP";
const DESCRIPTION = "Native OMP configuration from ~/.omp and .omp/";
const PRIORITY = 100;

const PATHS = SOURCE_PATHS.native;
const PROJECT_DIRS = [PATHS.projectDir, ...PATHS.aliases];
const USER_DIRS = [PATHS.userBase, ...PATHS.aliases];

async function getConfigDirs(ctx: LoadContext): Promise<Array<{ dir: string; level: "user" | "project" }>> {
	const result: Array<{ dir: string; level: "user" | "project" }> = [];

	for (const name of PROJECT_DIRS) {
		const projectDir = join(ctx.cwd, name);
		const entries = await readDirEntries(projectDir);
		if (entries.length > 0) {
			result.push({ dir: projectDir, level: "project" });
			break;
		}
	}

	for (const name of USER_DIRS) {
		const userDir = join(ctx.home, name, PATHS.userAgent.replace(`${PATHS.userBase}/`, ""));
		const entries = await readDirEntries(userDir);
		if (entries.length > 0) {
			result.push({ dir: userDir, level: "user" });
			break;
		}
	}

	return result;
}

// MCP
async function loadMCPServers(ctx: LoadContext): Promise<LoadResult<MCPServer>> {
	const items: MCPServer[] = [];
	const warnings: string[] = [];

	const parseMcpServers = (content: string, path: string, level: "user" | "project"): MCPServer[] => {
		const result: MCPServer[] = [];
		const data = parseJSON<{ mcpServers?: Record<string, unknown> }>(content);
		if (!data?.mcpServers) return result;

		const expanded = expandEnvVarsDeep(data.mcpServers);
		for (const [serverName, config] of Object.entries(expanded)) {
			const serverConfig = config as Record<string, unknown>;
			result.push({
				name: serverName,
				command: serverConfig.command as string | undefined,
				args: serverConfig.args as string[] | undefined,
				env: serverConfig.env as Record<string, string> | undefined,
				url: serverConfig.url as string | undefined,
				headers: serverConfig.headers as Record<string, string> | undefined,
				transport: serverConfig.type as "stdio" | "sse" | "http" | undefined,
				_source: createSourceMeta(PROVIDER_ID, path, level),
			});
		}
		return result;
	};

	const projectDirs = await Promise.all(
		PROJECT_DIRS.map(async (name) => {
			const dir = join(ctx.cwd, name);
			const entries = await readDirEntries(dir);
			return entries.length > 0 ? dir : null;
		}),
	);
	const userPaths = USER_DIRS.map((name) => join(ctx.home, name, "mcp.json"));

	const projectDir = projectDirs.find((dir) => dir !== null);
	if (projectDir) {
		const projectCandidates = ["mcp.json", ".mcp.json"].map((filename) => join(projectDir, filename));
		const projectContents = await Promise.all(projectCandidates.map((path) => readFile(path)));
		for (let i = 0; i < projectCandidates.length; i++) {
			const content = projectContents[i];
			if (content) {
				items.push(...parseMcpServers(content, projectCandidates[i], "project"));
				break;
			}
		}
	}

	const userContents = await Promise.all(userPaths.map((path) => readFile(path)));
	for (let i = 0; i < userPaths.length; i++) {
		const content = userContents[i];
		if (content) {
			items.push(...parseMcpServers(content, userPaths[i], "user"));
			break;
		}
	}

	return { items, warnings };
}

registerProvider<MCPServer>(mcpCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: DESCRIPTION,
	priority: PRIORITY,
	load: loadMCPServers,
});

// System Prompt (SYSTEM.md)
async function loadSystemPrompt(ctx: LoadContext): Promise<LoadResult<SystemPrompt>> {
	const items: SystemPrompt[] = [];

	const userPaths = USER_DIRS.map((name) =>
		join(ctx.home, name, PATHS.userAgent.replace(`${PATHS.userBase}/`, ""), "SYSTEM.md"),
	);
	const userContents = await Promise.all(userPaths.map((p) => readFile(p)));
	for (let i = 0; i < userPaths.length; i++) {
		const content = userContents[i];
		if (content) {
			items.push({
				path: userPaths[i],
				content,
				level: "user",
				_source: createSourceMeta(PROVIDER_ID, userPaths[i], "user"),
			});
			break;
		}
	}

	const ancestors: string[] = [];
	let current = ctx.cwd;
	while (true) {
		ancestors.push(current);
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	for (const dir of ancestors) {
		const configDirs = PROJECT_DIRS.map((name) => join(dir, name));
		const entriesResults = await Promise.all(configDirs.map((d) => readDirEntries(d)));
		const validConfigDir = configDirs.find((_, i) => entriesResults[i].length > 0);
		if (!validConfigDir) continue;

		const projectPath = join(validConfigDir, "SYSTEM.md");
		const content = await readFile(projectPath);
		if (content) {
			items.push({
				path: projectPath,
				content,
				level: "project",
				_source: createSourceMeta(PROVIDER_ID, projectPath, "project"),
			});
		}
		break;
	}

	return { items, warnings: [] };
}

registerProvider<SystemPrompt>(systemPromptCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Custom system prompt from SYSTEM.md",
	priority: PRIORITY,
	load: loadSystemPrompt,
});

// Skills
async function loadSkills(ctx: LoadContext): Promise<LoadResult<Skill>> {
	const configDirs = await getConfigDirs(ctx);
	const results = await Promise.all(
		configDirs.map(({ dir, level }) =>
			loadSkillsFromDir(ctx, {
				dir: join(dir, "skills"),
				providerId: PROVIDER_ID,
				level,
				requireDescription: true,
			}),
		),
	);

	return {
		items: results.flatMap((r) => r.items),
		warnings: results.flatMap((r) => r.warnings ?? []),
	};
}

registerProvider<Skill>(skillCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: DESCRIPTION,
	priority: PRIORITY,
	load: loadSkills,
});

// Slash Commands
async function loadSlashCommands(ctx: LoadContext): Promise<LoadResult<SlashCommand>> {
	const items: SlashCommand[] = [];
	const warnings: string[] = [];

	for (const { dir, level } of await getConfigDirs(ctx)) {
		const commandsDir = join(dir, "commands");
		const result = await loadFilesFromDir<SlashCommand>(ctx, commandsDir, PROVIDER_ID, level, {
			extensions: ["md"],
			transform: (name, content, path, source) => ({
				name: name.replace(/\.md$/, ""),
				path,
				content,
				level,
				_source: source,
			}),
		});
		items.push(...result.items);
		if (result.warnings) warnings.push(...result.warnings);
	}

	return { items, warnings };
}

registerProvider<SlashCommand>(slashCommandCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: DESCRIPTION,
	priority: PRIORITY,
	load: loadSlashCommands,
});

// Rules
async function loadRules(ctx: LoadContext): Promise<LoadResult<Rule>> {
	const items: Rule[] = [];
	const warnings: string[] = [];

	for (const { dir, level } of await getConfigDirs(ctx)) {
		const rulesDir = join(dir, "rules");
		const result = await loadFilesFromDir<Rule>(ctx, rulesDir, PROVIDER_ID, level, {
			extensions: ["md", "mdc"],
			transform: (name, content, path, source) => {
				const { frontmatter, body } = parseFrontmatter(content, { source: path });
				return {
					name: name.replace(/\.(md|mdc)$/, ""),
					path,
					content: body,
					globs: frontmatter.globs as string[] | undefined,
					alwaysApply: frontmatter.alwaysApply as boolean | undefined,
					description: frontmatter.description as string | undefined,
					ttsrTrigger: typeof frontmatter.ttsr_trigger === "string" ? frontmatter.ttsr_trigger : undefined,
					_source: source,
				};
			},
		});
		items.push(...result.items);
		if (result.warnings) warnings.push(...result.warnings);
	}

	return { items, warnings };
}

registerProvider<Rule>(ruleCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: DESCRIPTION,
	priority: PRIORITY,
	load: loadRules,
});

// Prompts
async function loadPrompts(ctx: LoadContext): Promise<LoadResult<Prompt>> {
	const items: Prompt[] = [];
	const warnings: string[] = [];

	for (const { dir, level } of await getConfigDirs(ctx)) {
		const promptsDir = join(dir, "prompts");
		const result = await loadFilesFromDir<Prompt>(ctx, promptsDir, PROVIDER_ID, level, {
			extensions: ["md"],
			transform: (name, content, path, source) => ({
				name: name.replace(/\.md$/, ""),
				path,
				content,
				_source: source,
			}),
		});
		items.push(...result.items);
		if (result.warnings) warnings.push(...result.warnings);
	}

	return { items, warnings };
}

registerProvider<Prompt>(promptCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: DESCRIPTION,
	priority: PRIORITY,
	load: loadPrompts,
});

// Extension Modules
async function loadExtensionModules(ctx: LoadContext): Promise<LoadResult<ExtensionModule>> {
	const items: ExtensionModule[] = [];
	const warnings: string[] = [];

	const resolveExtensionPath = (rawPath: string): string => {
		if (rawPath.startsWith("~/")) {
			return join(ctx.home, rawPath.slice(2));
		}
		if (rawPath.startsWith("~")) {
			return join(ctx.home, rawPath.slice(1));
		}
		if (isAbsolute(rawPath)) {
			return rawPath;
		}
		return resolve(ctx.cwd, rawPath);
	};

	const createExtensionModule = (extPath: string, level: "user" | "project"): ExtensionModule => ({
		name: getExtensionNameFromPath(extPath),
		path: extPath,
		level,
		_source: createSourceMeta(PROVIDER_ID, extPath, level),
	});

	const configDirs = await getConfigDirs(ctx);

	const [discoveredResults, settingsResults] = await Promise.all([
		Promise.all(configDirs.map(({ dir }) => discoverExtensionModulePaths(ctx, join(dir, "extensions")))),
		Promise.all(configDirs.map(({ dir }) => readFile(join(dir, "settings.json")))),
	]);

	for (let i = 0; i < configDirs.length; i++) {
		const { level } = configDirs[i];
		for (const extPath of discoveredResults[i]) {
			items.push(createExtensionModule(extPath, level));
		}
	}

	const settingsExtensions: Array<{
		resolvedPath: string;
		settingsPath: string;
		level: "user" | "project";
	}> = [];

	for (let i = 0; i < configDirs.length; i++) {
		const { dir, level } = configDirs[i];
		const settingsContent = settingsResults[i];
		if (!settingsContent) continue;

		const settingsPath = join(dir, "settings.json");
		const settingsData = parseJSON<{ extensions?: unknown }>(settingsContent);
		const extensions = settingsData?.extensions;
		if (!Array.isArray(extensions)) continue;

		for (const entry of extensions) {
			if (typeof entry !== "string") {
				warnings.push(`Invalid extension path in ${settingsPath}: ${String(entry)}`);
				continue;
			}
			settingsExtensions.push({
				resolvedPath: resolveExtensionPath(entry),
				settingsPath,
				level,
			});
		}
	}

	const [entriesResults, fileContents] = await Promise.all([
		Promise.all(settingsExtensions.map(({ resolvedPath }) => readDirEntries(resolvedPath))),
		Promise.all(settingsExtensions.map(({ resolvedPath }) => readFile(resolvedPath))),
	]);

	const dirDiscoveryPromises: Array<{
		promise: Promise<string[]>;
		level: "user" | "project";
	}> = [];

	for (let i = 0; i < settingsExtensions.length; i++) {
		const { resolvedPath, level } = settingsExtensions[i];
		const entries = entriesResults[i];
		const content = fileContents[i];

		if (entries.length > 0) {
			dirDiscoveryPromises.push({
				promise: discoverExtensionModulePaths(ctx, resolvedPath),
				level,
			});
		} else if (content !== null) {
			items.push(createExtensionModule(resolvedPath, level));
		} else {
			warnings.push(`Extension path not found: ${resolvedPath}`);
		}
	}

	const dirDiscoveryResults = await Promise.all(dirDiscoveryPromises.map((d) => d.promise));
	for (let i = 0; i < dirDiscoveryPromises.length; i++) {
		const { level } = dirDiscoveryPromises[i];
		for (const extPath of dirDiscoveryResults[i]) {
			items.push(createExtensionModule(extPath, level));
		}
	}

	return { items, warnings };
}

registerProvider<ExtensionModule>(extensionModuleCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: DESCRIPTION,
	priority: PRIORITY,
	load: loadExtensionModules,
});

// Extensions
async function loadExtensions(ctx: LoadContext): Promise<LoadResult<Extension>> {
	const items: Extension[] = [];
	const warnings: string[] = [];

	const configDirs = await getConfigDirs(ctx);
	const entriesResults = await Promise.all(configDirs.map(({ dir }) => readDirEntries(join(dir, "extensions"))));

	const manifestCandidates: Array<{
		extDir: string;
		manifestPath: string;
		entryName: string;
		level: "user" | "project";
	}> = [];

	for (let i = 0; i < configDirs.length; i++) {
		const { dir, level } = configDirs[i];
		const entries = entriesResults[i];
		const extensionsDir = join(dir, "extensions");

		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			if (!entry.isDirectory()) continue;

			const extDir = join(extensionsDir, entry.name);
			manifestCandidates.push({
				extDir,
				manifestPath: join(extDir, "gemini-extension.json"),
				entryName: entry.name,
				level,
			});
		}
	}

	const manifestContents = await Promise.all(manifestCandidates.map(({ manifestPath }) => readFile(manifestPath)));

	for (let i = 0; i < manifestCandidates.length; i++) {
		const content = manifestContents[i];
		if (!content) continue;

		const { extDir, manifestPath, entryName, level } = manifestCandidates[i];
		const manifest = parseJSON<ExtensionManifest>(content);
		if (!manifest) {
			warnings.push(`Failed to parse ${manifestPath}`);
			continue;
		}

		items.push({
			name: manifest.name || entryName,
			path: extDir,
			manifest,
			level,
			_source: createSourceMeta(PROVIDER_ID, manifestPath, level),
		});
	}

	return { items, warnings };
}

registerProvider<Extension>(extensionCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: DESCRIPTION,
	priority: PRIORITY,
	load: loadExtensions,
});

// Instructions
async function loadInstructions(ctx: LoadContext): Promise<LoadResult<Instruction>> {
	const items: Instruction[] = [];
	const warnings: string[] = [];

	for (const { dir, level } of await getConfigDirs(ctx)) {
		const instructionsDir = join(dir, "instructions");
		const result = await loadFilesFromDir<Instruction>(ctx, instructionsDir, PROVIDER_ID, level, {
			extensions: ["md"],
			transform: (name, content, path, source) => {
				const { frontmatter, body } = parseFrontmatter(content, { source: path });
				return {
					name: name.replace(/\.instructions\.md$/, "").replace(/\.md$/, ""),
					path,
					content: body,
					applyTo: frontmatter.applyTo as string | undefined,
					_source: source,
				};
			},
		});
		items.push(...result.items);
		if (result.warnings) warnings.push(...result.warnings);
	}

	return { items, warnings };
}

registerProvider<Instruction>(instructionCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: DESCRIPTION,
	priority: PRIORITY,
	load: loadInstructions,
});

// Hooks
async function loadHooks(ctx: LoadContext): Promise<LoadResult<Hook>> {
	const items: Hook[] = [];

	const configDirs = await getConfigDirs(ctx);
	const hookTypes = ["pre", "post"] as const;

	const typeDirRequests: Array<{
		typeDir: string;
		hookType: (typeof hookTypes)[number];
		level: "user" | "project";
	}> = [];

	for (const { dir, level } of configDirs) {
		for (const hookType of hookTypes) {
			typeDirRequests.push({
				typeDir: join(dir, "hooks", hookType),
				hookType,
				level,
			});
		}
	}

	const typeEntriesResults = await Promise.all(typeDirRequests.map(({ typeDir }) => readDirEntries(typeDir)));

	for (let i = 0; i < typeDirRequests.length; i++) {
		const { typeDir, hookType, level } = typeDirRequests[i];
		const typeEntries = typeEntriesResults[i];

		for (const entry of typeEntries) {
			if (entry.name.startsWith(".")) continue;
			if (!entry.isFile()) continue;

			const path = join(typeDir, entry.name);
			const baseName = entry.name.includes(".") ? entry.name.slice(0, entry.name.lastIndexOf(".")) : entry.name;
			const tool = baseName === "*" ? "*" : baseName;

			items.push({
				name: entry.name,
				path,
				type: hookType,
				tool,
				level,
				_source: createSourceMeta(PROVIDER_ID, path, level),
			});
		}
	}

	return { items, warnings: [] };
}

registerProvider<Hook>(hookCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: DESCRIPTION,
	priority: PRIORITY,
	load: loadHooks,
});

// Custom Tools
async function loadTools(ctx: LoadContext): Promise<LoadResult<CustomTool>> {
	const items: CustomTool[] = [];
	const warnings: string[] = [];

	const configDirs = await getConfigDirs(ctx);
	const entriesResults = await Promise.all(configDirs.map(({ dir }) => readDirEntries(join(dir, "tools"))));

	const fileLoadPromises: Array<Promise<{ items: CustomTool[]; warnings?: string[] }>> = [];
	const subDirCandidates: Array<{
		indexPath: string;
		entryName: string;
		level: "user" | "project";
	}> = [];

	for (let i = 0; i < configDirs.length; i++) {
		const { dir, level } = configDirs[i];
		const toolEntries = entriesResults[i];
		if (toolEntries.length === 0) continue;

		const toolsDir = join(dir, "tools");

		fileLoadPromises.push(
			loadFilesFromDir<CustomTool>(ctx, toolsDir, PROVIDER_ID, level, {
				extensions: ["json", "md"],
				transform: (name, content, path, source) => {
					if (name.endsWith(".json")) {
						const data = parseJSON<{ name?: string; description?: string }>(content);
						return {
							name: data?.name || name.replace(/\.json$/, ""),
							path,
							description: data?.description,
							level,
							_source: source,
						};
					}
					const { frontmatter } = parseFrontmatter(content, { source: path });
					return {
						name: (frontmatter.name as string) || name.replace(/\.md$/, ""),
						path,
						description: frontmatter.description as string | undefined,
						level,
						_source: source,
					};
				},
			}),
		);

		for (const entry of toolEntries) {
			if (entry.name.startsWith(".")) continue;
			if (!entry.isDirectory()) continue;

			subDirCandidates.push({
				indexPath: join(toolsDir, entry.name, "index.ts"),
				entryName: entry.name,
				level,
			});
		}
	}

	const [fileResults, indexContents] = await Promise.all([
		Promise.all(fileLoadPromises),
		Promise.all(subDirCandidates.map(({ indexPath }) => readFile(indexPath))),
	]);

	for (const result of fileResults) {
		items.push(...result.items);
		if (result.warnings) warnings.push(...result.warnings);
	}

	for (let i = 0; i < subDirCandidates.length; i++) {
		const indexContent = indexContents[i];
		if (indexContent !== null) {
			const { indexPath, entryName, level } = subDirCandidates[i];
			items.push({
				name: entryName,
				path: indexPath,
				description: undefined,
				level,
				_source: createSourceMeta(PROVIDER_ID, indexPath, level),
			});
		}
	}

	return { items, warnings };
}

registerProvider<CustomTool>(toolCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: DESCRIPTION,
	priority: PRIORITY,
	load: loadTools,
});

// Settings
async function loadSettings(ctx: LoadContext): Promise<LoadResult<Settings>> {
	const items: Settings[] = [];
	const warnings: string[] = [];

	for (const { dir, level } of await getConfigDirs(ctx)) {
		const settingsPath = join(dir, "settings.json");
		const content = await readFile(settingsPath);
		if (!content) continue;

		const data = parseJSON<Record<string, unknown>>(content);
		if (!data) {
			warnings.push(`Failed to parse ${settingsPath}`);
			continue;
		}

		items.push({
			path: settingsPath,
			data,
			level,
			_source: createSourceMeta(PROVIDER_ID, settingsPath, level),
		});
	}

	return { items, warnings };
}

registerProvider<Settings>(settingsCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: DESCRIPTION,
	priority: PRIORITY,
	load: loadSettings,
});

// Context Files (AGENTS.md)
async function loadContextFiles(ctx: LoadContext): Promise<LoadResult<ContextFile>> {
	const items: ContextFile[] = [];
	const warnings: string[] = [];

	const userPaths = USER_DIRS.map((name) =>
		join(ctx.home, name, PATHS.userAgent.replace(`${PATHS.userBase}/`, ""), "AGENTS.md"),
	);
	const userContents = await Promise.all(userPaths.map((p) => readFile(p)));
	for (let i = 0; i < userPaths.length; i++) {
		const content = userContents[i];
		if (content) {
			items.push({
				path: userPaths[i],
				content,
				level: "user",
				_source: createSourceMeta(PROVIDER_ID, userPaths[i], "user"),
			});
			break;
		}
	}

	const ancestors: Array<{ dir: string; depth: number }> = [];
	let current = ctx.cwd;
	let depth = 0;
	while (true) {
		ancestors.push({ dir: current, depth });
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
		depth++;
	}

	for (const { dir, depth: ancestorDepth } of ancestors) {
		const configDirs = PROJECT_DIRS.map((name) => join(dir, name));
		const entriesResults = await Promise.all(configDirs.map((d) => readDirEntries(d)));
		const validConfigDir = configDirs.find((_, i) => entriesResults[i].length > 0);
		if (!validConfigDir) continue;

		const projectPath = join(validConfigDir, "AGENTS.md");
		const content = await readFile(projectPath);
		if (content) {
			items.push({
				path: projectPath,
				content,
				level: "project",
				depth: ancestorDepth,
				_source: createSourceMeta(PROVIDER_ID, projectPath, "project"),
			});
			return { items, warnings };
		}
		break;
	}

	return { items, warnings };
}

registerProvider<ContextFile>(contextFileCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load AGENTS.md from .omp/ directories",
	priority: PRIORITY,
	load: loadContextFiles,
});
