/**
 * Claude Code Provider
 *
 * Loads configuration from .claude directories.
 * Priority: 80 (tool-specific, below builtin but above shared standards)
 */

import { join, sep } from "node:path";
import { type ContextFile, contextFileCapability } from "$c/capability/context-file";
import { type ExtensionModule, extensionModuleCapability } from "$c/capability/extension-module";
import { readFile } from "$c/capability/fs";
import { type Hook, hookCapability } from "$c/capability/hook";
import { registerProvider } from "$c/capability/index";
import { type MCPServer, mcpCapability } from "$c/capability/mcp";
import { type Settings, settingsCapability } from "$c/capability/settings";
import { type Skill, skillCapability } from "$c/capability/skill";
import { type SlashCommand, slashCommandCapability } from "$c/capability/slash-command";
import { type SystemPrompt, systemPromptCapability } from "$c/capability/system-prompt";
import { type CustomTool, toolCapability } from "$c/capability/tool";
import type { LoadContext, LoadResult } from "$c/capability/types";
import {
	calculateDepth,
	createSourceMeta,
	discoverExtensionModulePaths,
	expandEnvVarsDeep,
	getExtensionNameFromPath,
	loadFilesFromDir,
	loadSkillsFromDir,
	parseJSON,
} from "./helpers";

const PROVIDER_ID = "claude";
const DISPLAY_NAME = "Claude Code";
const PRIORITY = 80;
const CONFIG_DIR = ".claude";

/**
 * Get user-level .claude path.
 */
function getUserClaude(ctx: LoadContext): string {
	return join(ctx.home, CONFIG_DIR);
}

/**
 * Get project-level .claude path (cwd only).
 */
function getProjectClaude(ctx: LoadContext): string {
	return join(ctx.cwd, CONFIG_DIR);
}

// =============================================================================
// MCP Servers
// =============================================================================

async function loadMCPServers(ctx: LoadContext): Promise<LoadResult<MCPServer>> {
	const items: MCPServer[] = [];
	const warnings: string[] = [];

	const userBase = getUserClaude(ctx);
	const userClaudeJson = join(ctx.home, ".claude.json");
	const userMcpJson = join(userBase, "mcp.json");

	const projectBase = join(ctx.cwd, CONFIG_DIR);
	const projectMcpJson = join(projectBase, ".mcp.json");
	const projectMcpJsonAlt = join(projectBase, "mcp.json");

	const userPaths = [
		{ path: userClaudeJson, level: "user" as const },
		{ path: userMcpJson, level: "user" as const },
	];
	const projectPaths = [
		{ path: projectMcpJson, level: "project" as const },
		{ path: projectMcpJsonAlt, level: "project" as const },
	];

	const allPaths = [...userPaths, ...projectPaths];
	const contents = await Promise.all(allPaths.map(({ path }) => readFile(path)));

	const parseMcpServers = (content: string | null, path: string, level: "user" | "project"): MCPServer[] => {
		if (!content) return [];
		const json = parseJSON<{ mcpServers?: Record<string, unknown> }>(content);
		if (!json?.mcpServers) return [];

		const mcpServers = expandEnvVarsDeep(json.mcpServers);
		return Object.entries(mcpServers).map(([name, config]) => {
			const serverConfig = config as Record<string, unknown>;
			return {
				name,
				command: serverConfig.command as string | undefined,
				args: serverConfig.args as string[] | undefined,
				env: serverConfig.env as Record<string, string> | undefined,
				url: serverConfig.url as string | undefined,
				headers: serverConfig.headers as Record<string, string> | undefined,
				transport: serverConfig.type as "stdio" | "sse" | "http" | undefined,
				_source: createSourceMeta(PROVIDER_ID, path, level),
			};
		});
	};

	for (let i = 0; i < userPaths.length; i++) {
		const servers = parseMcpServers(contents[i], userPaths[i].path, userPaths[i].level);
		if (servers.length > 0) {
			items.push(...servers);
			break;
		}
	}

	const projectOffset = userPaths.length;
	for (let i = 0; i < projectPaths.length; i++) {
		const servers = parseMcpServers(contents[projectOffset + i], projectPaths[i].path, projectPaths[i].level);
		if (servers.length > 0) {
			items.push(...servers);
			break;
		}
	}

	return { items, warnings };
}

// =============================================================================
// Context Files (CLAUDE.md)
// =============================================================================

async function loadContextFiles(ctx: LoadContext): Promise<LoadResult<ContextFile>> {
	const items: ContextFile[] = [];
	const warnings: string[] = [];

	const userBase = getUserClaude(ctx);
	const userClaudeMd = join(userBase, "CLAUDE.md");

	const userContent = await readFile(userClaudeMd);
	if (userContent !== null) {
		items.push({
			path: userClaudeMd,
			content: userContent,
			level: "user",
			_source: createSourceMeta(PROVIDER_ID, userClaudeMd, "user"),
		});
	}

	const projectBase = getProjectClaude(ctx);
	const projectClaudeMd = join(projectBase, "CLAUDE.md");
	const projectContent = await readFile(projectClaudeMd);
	if (projectContent !== null) {
		const depth = calculateDepth(ctx.cwd, projectBase, sep);
		items.push({
			path: projectClaudeMd,
			content: projectContent,
			level: "project",
			depth,
			_source: createSourceMeta(PROVIDER_ID, projectClaudeMd, "project"),
		});
	}

	return { items, warnings };
}

// =============================================================================
// Skills
// =============================================================================

async function loadSkills(ctx: LoadContext): Promise<LoadResult<Skill>> {
	const userSkillsDir = join(getUserClaude(ctx), "skills");
	const projectSkillsDir = join(getProjectClaude(ctx), "skills");

	const results = await Promise.all([
		loadSkillsFromDir(ctx, { dir: userSkillsDir, providerId: PROVIDER_ID, level: "user" }),
		loadSkillsFromDir(ctx, { dir: projectSkillsDir, providerId: PROVIDER_ID, level: "project" }),
	]);

	return {
		items: results.flatMap((r) => r.items),
		warnings: results.flatMap((r) => r.warnings ?? []),
	};
}

// =============================================================================
// Extension Modules
// =============================================================================

async function loadExtensionModules(ctx: LoadContext): Promise<LoadResult<ExtensionModule>> {
	const items: ExtensionModule[] = [];
	const warnings: string[] = [];

	const userBase = getUserClaude(ctx);
	const userExtensionsDir = join(userBase, "extensions");
	const projectExtensionsDir = join(ctx.cwd, CONFIG_DIR, "extensions");

	const dirsToDiscover: { dir: string; level: "user" | "project" }[] = [
		{ dir: userExtensionsDir, level: "user" },
		{ dir: projectExtensionsDir, level: "project" },
	];

	const pathsByLevel = await Promise.all(
		dirsToDiscover.map(async ({ dir, level }) => {
			const paths = await discoverExtensionModulePaths(ctx, dir);
			return paths.map((extPath) => ({ extPath, level }));
		}),
	);

	for (const extensions of pathsByLevel) {
		for (const { extPath, level } of extensions) {
			items.push({
				name: getExtensionNameFromPath(extPath),
				path: extPath,
				level,
				_source: createSourceMeta(PROVIDER_ID, extPath, level),
			});
		}
	}

	return { items, warnings };
}

// =============================================================================
// Slash Commands
// =============================================================================

async function loadSlashCommands(ctx: LoadContext): Promise<LoadResult<SlashCommand>> {
	const items: SlashCommand[] = [];
	const warnings: string[] = [];

	const userBase = getUserClaude(ctx);
	const userCommandsDir = join(userBase, "commands");

	const userResult = await loadFilesFromDir<SlashCommand>(ctx, userCommandsDir, PROVIDER_ID, "user", {
		extensions: ["md"],
		transform: (name, content, path, source) => {
			const cmdName = name.replace(/\.md$/, "");
			return {
				name: cmdName,
				path,
				content,
				level: "user",
				_source: source,
			};
		},
	});

	items.push(...userResult.items);
	if (userResult.warnings) warnings.push(...userResult.warnings);

	const projectCommandsDir = join(ctx.cwd, CONFIG_DIR, "commands");

	const projectResult = await loadFilesFromDir<SlashCommand>(ctx, projectCommandsDir, PROVIDER_ID, "project", {
		extensions: ["md"],
		transform: (name, content, path, source) => {
			const cmdName = name.replace(/\.md$/, "");
			return {
				name: cmdName,
				path,
				content,
				level: "project",
				_source: source,
			};
		},
	});

	items.push(...projectResult.items);
	if (projectResult.warnings) warnings.push(...projectResult.warnings);

	return { items, warnings };
}

// =============================================================================
// Hooks
// =============================================================================

async function loadHooks(ctx: LoadContext): Promise<LoadResult<Hook>> {
	const items: Hook[] = [];
	const warnings: string[] = [];

	const userBase = getUserClaude(ctx);
	const userHooksDir = join(userBase, "hooks");
	const projectBase = getProjectClaude(ctx);
	const projectHooksDir = join(projectBase, "hooks");

	const hookTypes = ["pre", "post"] as const;

	const loadTasks: { dir: string; hookType: "pre" | "post"; level: "user" | "project" }[] = [];
	for (const hookType of hookTypes) {
		loadTasks.push({ dir: join(userHooksDir, hookType), hookType, level: "user" });
	}
	for (const hookType of hookTypes) {
		loadTasks.push({ dir: join(projectHooksDir, hookType), hookType, level: "project" });
	}

	const results = await Promise.all(
		loadTasks.map(({ dir, hookType, level }) =>
			loadFilesFromDir<Hook>(ctx, dir, PROVIDER_ID, level, {
				transform: (name, _content, path, source) => {
					const toolName = name.replace(/\.(sh|bash|zsh|fish)$/, "");
					return {
						name,
						path,
						type: hookType,
						tool: toolName,
						level,
						_source: source,
					};
				},
			}),
		),
	);

	for (const result of results) {
		items.push(...result.items);
		if (result.warnings) warnings.push(...result.warnings);
	}

	return { items, warnings };
}

// =============================================================================
// Custom Tools
// =============================================================================

async function loadTools(ctx: LoadContext): Promise<LoadResult<CustomTool>> {
	const items: CustomTool[] = [];
	const warnings: string[] = [];

	const userBase = getUserClaude(ctx);
	const userToolsDir = join(userBase, "tools");

	const userResult = await loadFilesFromDir<CustomTool>(ctx, userToolsDir, PROVIDER_ID, "user", {
		transform: (name, _content, path, source) => {
			const toolName = name.replace(/\.(ts|js|sh|bash|py)$/, "");

			return {
				name: toolName,
				path,
				level: "user",
				_source: source,
			};
		},
	});

	items.push(...userResult.items);
	if (userResult.warnings) warnings.push(...userResult.warnings);

	const projectBase = getProjectClaude(ctx);
	const projectToolsDir = join(projectBase, "tools");

	const projectResult = await loadFilesFromDir<CustomTool>(ctx, projectToolsDir, PROVIDER_ID, "project", {
		transform: (name, _content, path, source) => {
			const toolName = name.replace(/\.(ts|js|sh|bash|py)$/, "");

			return {
				name: toolName,
				path,
				level: "project",
				_source: source,
			};
		},
	});

	items.push(...projectResult.items);
	if (projectResult.warnings) warnings.push(...projectResult.warnings);

	return { items, warnings };
}

// =============================================================================
// System Prompts
// =============================================================================

async function loadSystemPrompts(ctx: LoadContext): Promise<LoadResult<SystemPrompt>> {
	const items: SystemPrompt[] = [];
	const warnings: string[] = [];

	const userBase = getUserClaude(ctx);
	const userSystemMd = join(userBase, "SYSTEM.md");

	const content = await readFile(userSystemMd);
	if (content !== null) {
		items.push({
			path: userSystemMd,
			content,
			level: "user",
			_source: createSourceMeta(PROVIDER_ID, userSystemMd, "user"),
		});
	}

	return { items, warnings };
}

// =============================================================================
// Settings
// =============================================================================

async function loadSettings(ctx: LoadContext): Promise<LoadResult<Settings>> {
	const items: Settings[] = [];
	const warnings: string[] = [];

	const userBase = getUserClaude(ctx);
	const userSettingsJson = join(userBase, "settings.json");

	const userContent = await readFile(userSettingsJson);
	if (userContent) {
		const data = parseJSON<Record<string, unknown>>(userContent);
		if (data) {
			items.push({
				path: userSettingsJson,
				data,
				level: "user",
				_source: createSourceMeta(PROVIDER_ID, userSettingsJson, "user"),
			});
		} else {
			warnings.push(`Failed to parse JSON in ${userSettingsJson}`);
		}
	}

	const projectBase = getProjectClaude(ctx);
	const projectSettingsJson = join(projectBase, "settings.json");
	const projectContent = await readFile(projectSettingsJson);
	if (projectContent) {
		const data = parseJSON<Record<string, unknown>>(projectContent);
		if (data) {
			items.push({
				path: projectSettingsJson,
				data,
				level: "project",
				_source: createSourceMeta(PROVIDER_ID, projectSettingsJson, "project"),
			});
		} else {
			warnings.push(`Failed to parse JSON in ${projectSettingsJson}`);
		}
	}

	return { items, warnings };
}

// =============================================================================
// Provider Registration
// =============================================================================

registerProvider<MCPServer>(mcpCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load MCP servers from .claude.json and .claude/mcp.json",
	priority: PRIORITY,
	load: loadMCPServers,
});

registerProvider<ContextFile>(contextFileCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load CLAUDE.md files from .claude/ directories",
	priority: PRIORITY,
	load: loadContextFiles,
});

registerProvider<Skill>(skillCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load skills from .claude/skills/*/SKILL.md",
	priority: PRIORITY,
	load: loadSkills,
});

registerProvider<ExtensionModule>(extensionModuleCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load extension modules from .claude/extensions",
	priority: PRIORITY,
	load: loadExtensionModules,
});

registerProvider<SlashCommand>(slashCommandCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load slash commands from .claude/commands/*.md",
	priority: PRIORITY,
	load: loadSlashCommands,
});

registerProvider<Hook>(hookCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load hooks from .claude/hooks/pre/ and .claude/hooks/post/",
	priority: PRIORITY,
	load: loadHooks,
});

registerProvider<CustomTool>(toolCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load custom tools from .claude/tools/",
	priority: PRIORITY,
	load: loadTools,
});

registerProvider<Settings>(settingsCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load settings from .claude/settings.json",
	priority: PRIORITY,
	load: loadSettings,
});

registerProvider<SystemPrompt>(systemPromptCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load system prompt from .claude/SYSTEM.md",
	priority: PRIORITY,
	load: loadSystemPrompts,
});
