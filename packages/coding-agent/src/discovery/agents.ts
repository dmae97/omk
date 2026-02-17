/**
 * Agents (standard) Provider
 *
 * Loads user-level skills, rules, prompts, commands, context files, and system prompts from ~/.agent/.
 */
import * as path from "node:path";
import { registerProvider } from "../capability";
import { type ContextFile, contextFileCapability } from "../capability/context-file";
import { readFile } from "../capability/fs";
import { type Prompt, promptCapability } from "../capability/prompt";
import { type Rule, ruleCapability } from "../capability/rule";
import { type Skill, skillCapability } from "../capability/skill";
import { type SlashCommand, slashCommandCapability } from "../capability/slash-command";
import { type SystemPrompt, systemPromptCapability } from "../capability/system-prompt";
import type { LoadContext, LoadResult } from "../capability/types";
import { buildRuleFromMarkdown, createSourceMeta, loadFilesFromDir, loadSkillsFromDir } from "./helpers";

const PROVIDER_ID = "agents";
const DISPLAY_NAME = "Agents (standard)";
const PRIORITY = 70;
const USER_AGENT_DIR_CANDIDATES = [".agent", ".agents"] as const;

function getUserAgentPathCandidates(ctx: LoadContext, ...segments: string[]): string[] {
	return USER_AGENT_DIR_CANDIDATES.map(baseDir => path.join(ctx.home, baseDir, ...segments));
}

async function loadSkills(ctx: LoadContext): Promise<LoadResult<Skill>> {
	const items: Skill[] = [];
	const warnings: string[] = [];
	for (const userSkillsDir of getUserAgentPathCandidates(ctx, "skills")) {
		const result = await loadSkillsFromDir(ctx, {
			dir: userSkillsDir,
			providerId: PROVIDER_ID,
			level: "user",
		});
		items.push(...result.items);
		warnings.push(...(result.warnings ?? []));
	}
	return {
		items,
		warnings,
	};
}

registerProvider<Skill>(skillCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load skills from ~/.agent/skills (fallback ~/.agents/skills)",
	priority: PRIORITY,
	load: loadSkills,
});

// Rules
async function loadRules(ctx: LoadContext): Promise<LoadResult<Rule>> {
	const items: Rule[] = [];
	const warnings: string[] = [];
	for (const userRulesDir of getUserAgentPathCandidates(ctx, "rules")) {
		const result = await loadFilesFromDir<Rule>(ctx, userRulesDir, PROVIDER_ID, "user", {
			extensions: ["md", "mdc"],
			transform: (name, content, filePath, source) =>
				buildRuleFromMarkdown(name, content, filePath, source, { stripNamePattern: /\.(md|mdc)$/ }),
		});
		items.push(...result.items);
		warnings.push(...(result.warnings ?? []));
	}
	return {
		items,
		warnings,
	};
}

registerProvider<Rule>(ruleCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load rules from ~/.agent/rules (fallback ~/.agents/rules)",
	priority: PRIORITY,
	load: loadRules,
});

// Prompts
async function loadPrompts(ctx: LoadContext): Promise<LoadResult<Prompt>> {
	const items: Prompt[] = [];
	const warnings: string[] = [];
	for (const userPromptsDir of getUserAgentPathCandidates(ctx, "prompts")) {
		const result = await loadFilesFromDir<Prompt>(ctx, userPromptsDir, PROVIDER_ID, "user", {
			extensions: ["md"],
			transform: (name, content, filePath, source) => ({
				name: name.replace(/\.md$/, ""),
				path: filePath,
				content,
				_source: source,
			}),
		});
		items.push(...result.items);
		warnings.push(...(result.warnings ?? []));
	}
	return {
		items,
		warnings,
	};
}

registerProvider<Prompt>(promptCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load prompts from ~/.agent/prompts (fallback ~/.agents/prompts)",
	priority: PRIORITY,
	load: loadPrompts,
});

// Slash Commands
async function loadSlashCommands(ctx: LoadContext): Promise<LoadResult<SlashCommand>> {
	const items: SlashCommand[] = [];
	const warnings: string[] = [];
	for (const userCommandsDir of getUserAgentPathCandidates(ctx, "commands")) {
		const result = await loadFilesFromDir<SlashCommand>(ctx, userCommandsDir, PROVIDER_ID, "user", {
			extensions: ["md"],
			transform: (name, content, filePath, source) => ({
				name: name.replace(/\.md$/, ""),
				path: filePath,
				content,
				level: "user",
				_source: source,
			}),
		});
		items.push(...result.items);
		warnings.push(...(result.warnings ?? []));
	}
	return {
		items,
		warnings,
	};
}

registerProvider<SlashCommand>(slashCommandCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load commands from ~/.agent/commands (fallback ~/.agents/commands)",
	priority: PRIORITY,
	load: loadSlashCommands,
});

// Context Files (AGENTS.md)
async function loadContextFiles(ctx: LoadContext): Promise<LoadResult<ContextFile>> {
	const items: ContextFile[] = [];
	for (const agentsPath of getUserAgentPathCandidates(ctx, "AGENTS.md")) {
		const content = await readFile(agentsPath);
		if (!content) {
			continue;
		}
		items.push({
			path: agentsPath,
			content,
			level: "user",
			_source: createSourceMeta(PROVIDER_ID, agentsPath, "user"),
		});
	}
	return {
		items,
		warnings: [],
	};
}

registerProvider<ContextFile>(contextFileCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load AGENTS.md from ~/.agent (fallback ~/.agents)",
	priority: PRIORITY,
	load: loadContextFiles,
});

// System Prompt (SYSTEM.md)
async function loadSystemPrompt(ctx: LoadContext): Promise<LoadResult<SystemPrompt>> {
	const items: SystemPrompt[] = [];
	for (const systemPath of getUserAgentPathCandidates(ctx, "SYSTEM.md")) {
		const content = await readFile(systemPath);
		if (!content) {
			continue;
		}
		items.push({
			path: systemPath,
			content,
			level: "user",
			_source: createSourceMeta(PROVIDER_ID, systemPath, "user"),
		});
	}
	return {
		items,
		warnings: [],
	};
}

registerProvider<SystemPrompt>(systemPromptCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load SYSTEM.md from ~/.agent (fallback ~/.agents)",
	priority: PRIORITY,
	load: loadSystemPrompt,
});
