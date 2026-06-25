import {
	CONTEXT_BUDGET_POLICY_VERSION,
	type ContextBudgetItem,
	type ContextBudgetPlan,
	type ContextBudgetPriority,
	planContextBudget,
} from "./context-budget-governor.ts";
import {
	type ContextBudgetTokenizerMode,
	createTokenCounterForMode,
	type TokenCounterAdapter,
} from "./context-budget-token-counter.ts";
import type { ContextFile } from "./resource-loader.ts";
import type { Skill } from "./skills.ts";

export interface SystemPromptContextBudgetOptions {
	readonly maxPromptTokens: number;
	readonly responseReserveTokens?: number;
	readonly modelId?: string;
	readonly tokenizerMode?: ContextBudgetTokenizerMode;
	readonly activeSkillNames?: readonly string[];
	readonly includeSkillInventory?: boolean;
	readonly includeFullContextFiles?: boolean;
	readonly tokenCounter?: TokenCounterAdapter;
}

export interface SystemPromptBudgetedResourcesInput {
	readonly basePrompt: string;
	readonly contextFiles: readonly ContextFile[];
	readonly skills: readonly Skill[];
	readonly includeSkills: boolean;
	readonly options: SystemPromptContextBudgetOptions;
}

export interface SystemPromptBudgetedResources {
	readonly text: string;
	readonly plan: ContextBudgetPlan;
}

const CONTEXT_EXCERPT_CHARS = 1200;

export function renderSystemPromptBudgetedResources(
	input: SystemPromptBudgetedResourcesInput,
): SystemPromptBudgetedResources {
	const tokenCounter =
		input.options.tokenCounter ?? createTokenCounterForMode(input.options.tokenizerMode ?? "fallback");
	const modelId = input.options.modelId ?? "unknown";
	const baseTokens = tokenCounter.countText(input.basePrompt, modelId).tokens;
	const resourceBudget = Math.max(0, input.options.maxPromptTokens - baseTokens);
	const items = createSystemPromptBudgetItems(input);
	const plan = planContextBudget({
		maxTokens: resourceBudget,
		responseReserveTokens: input.options.responseReserveTokens ?? 0,
		modelId,
		policyVersion: CONTEXT_BUDGET_POLICY_VERSION,
		items,
		tokenCounter,
	});
	const included = new Set(plan.includedItems.map((item) => item.id));
	const text = items
		.filter((item) => included.has(item.id))
		.map((item) => item.text)
		.join("\n")
		.trimEnd();
	const note = renderBudgetNote(plan, baseTokens);
	return { text: text ? `${text}\n${note}` : note, plan };
}

function createSystemPromptBudgetItems(input: SystemPromptBudgetedResourcesInput): ContextBudgetItem[] {
	const items: ContextBudgetItem[] = [];
	for (const contextFile of input.contextFiles) {
		const scope = contextFile.isGlobal ? "parent" : "project";
		const tagName = contextFile.isGlobal ? "parent_instructions" : "project_instructions";
		items.push({
			id: `context-pointer:${contextFile.path}`,
			kind: "context-pointer",
			priority: contextFile.isGlobal ? "hard" : "high",
			relevance: contextFile.isGlobal ? 1 : 0.8,
			text: renderContextPointer(contextFile, scope),
		});
		if (input.options.includeFullContextFiles !== false) {
			items.push({
				id: `context-full:${contextFile.path}`,
				kind: "context-full",
				priority: contextFile.isGlobal ? "high" : "medium",
				relevance: contextFile.isGlobal ? 0.9 : 0.6,
				redundancyKey: contextFile.path,
				text: renderContextFull(contextFile, tagName),
			});
		}
	}

	const visibleSkills = input.skills.filter((skill) => !skill.disableModelInvocation);
	if (input.includeSkills && input.options.includeSkillInventory !== false && visibleSkills.length > 0) {
		items.push({ id: "skill-header", kind: "skill-header", priority: "hard", text: renderSkillHeader() });
		const activeSkillNames = new Set(input.options.activeSkillNames ?? []);
		for (const skill of visibleSkills) {
			items.push({
				id: `skill:${skill.name}`,
				kind: "skill",
				priority: skillPriority(skill.name, activeSkillNames),
				relevance: activeSkillNames.has(skill.name) ? 1 : 0.25,
				redundancyKey: skill.name,
				text: renderSkillEntry(skill),
			});
		}
		items.push({ id: "skill-footer", kind: "skill-header", priority: "hard", text: "</available_skills>" });
	}
	return items;
}

function renderContextPointer(contextFile: ContextFile, scope: string): string {
	const marker = contextFile.containsJailbreak ? " sanitized=true" : "";
	return `<context_file_pointer scope="${escapeXml(scope)}" path="${escapeXml(contextFile.path)}"${marker} chars="${contextFile.content.length}" />`;
}

function renderContextFull(contextFile: ContextFile, tagName: string): string {
	const content =
		contextFile.content.length > CONTEXT_EXCERPT_CHARS ? boundedExcerpt(contextFile.content) : contextFile.content;
	const truncated = content.length < contextFile.content.length ? " truncated=true" : "";
	return `<${tagName} path="${escapeXml(contextFile.path)}"${truncated}>\n${content}\n</${tagName}>`;
}

function boundedExcerpt(content: string): string {
	const headChars = Math.floor(CONTEXT_EXCERPT_CHARS * 0.7);
	const tailChars = CONTEXT_EXCERPT_CHARS - headChars;
	const head = content.slice(0, headChars).trimEnd();
	const tail = content.slice(-tailChars).trimStart();
	return `${head}\n\n[...context-budget excerpt omitted ${content.length - CONTEXT_EXCERPT_CHARS} chars...]\n\n${tail}`;
}

function renderSkillHeader(): string {
	return [
		"\n\nThe following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"",
		"<available_skills>",
	].join("\n");
}

function renderSkillEntry(skill: Skill): string {
	return [
		"  <skill>",
		`    <name>${escapeXml(skill.name)}</name>`,
		`    <description>${escapeXml(skill.description)}</description>`,
		`    <location>${escapeXml(skill.filePath)}</location>`,
		"  </skill>",
	].join("\n");
}

function skillPriority(skillName: string, activeSkillNames: Set<string>): ContextBudgetPriority {
	return activeSkillNames.has(skillName) ? "hard" : "low";
}

function renderBudgetNote(plan: ContextBudgetPlan, baseTokens: number): string {
	const omitted = plan.omittedItems.length;
	return [
		"<context_budget>",
		`  <policy>${escapeXml(plan.policyVersion)}</policy>`,
		`  <plan_hash>${plan.planHash}</plan_hash>`,
		`  <base_prompt_tokens>${baseTokens}</base_prompt_tokens>`,
		`  <resource_tokens_used>${plan.usedTokens}</resource_tokens_used>`,
		`  <resource_tokens_omitted>${plan.omittedTokens}</resource_tokens_omitted>`,
		`  <omitted_items>${omitted}</omitted_items>`,
		`  <emergency>${plan.emergency ? "true" : "false"}</emergency>`,
		"  <note>Some low-priority resource inventory may be represented by pointers. Use read on referenced paths when needed.</note>",
		"</context_budget>",
	].join("\n");
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
