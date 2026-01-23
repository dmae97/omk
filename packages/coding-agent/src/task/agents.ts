/**
 * Bundled agent definitions.
 *
 * Agents are embedded at build time via Bun's import with { type: "text" }.
 */

import { renderPromptTemplate } from "$c/config/prompt-templates";
import { parseAgentFields } from "$c/discovery/helpers";
import exploreMd from "$c/prompts/agents/explore.md" with { type: "text" };
// Embed agent markdown files at build time
import agentFrontmatterTemplate from "$c/prompts/agents/frontmatter.md" with { type: "text" };
import planMd from "$c/prompts/agents/plan.md" with { type: "text" };
import reviewerMd from "$c/prompts/agents/reviewer.md" with { type: "text" };
import taskMd from "$c/prompts/agents/task.md" with { type: "text" };
import { parseFrontmatter } from "$c/utils/frontmatter";
import type { AgentDefinition, AgentSource } from "./types";

interface AgentFrontmatter {
	name: string;
	description: string;
	spawns?: string;
	model?: string;
	thinkingLevel?: string;
}

interface EmbeddedAgentDef {
	fileName: string;
	frontmatter?: AgentFrontmatter;
	template: string;
}

function buildAgentContent(def: EmbeddedAgentDef): string {
	const body = renderPromptTemplate(def.template);
	if (!def.frontmatter) return body;
	return renderPromptTemplate(agentFrontmatterTemplate, { ...def.frontmatter, body });
}

const EMBEDDED_AGENT_DEFS: EmbeddedAgentDef[] = [
	{ fileName: "explore.md", template: exploreMd },
	{ fileName: "plan.md", template: planMd },
	{ fileName: "reviewer.md", template: reviewerMd },
	{
		fileName: "task.md",
		frontmatter: {
			name: "task",
			description: "General-purpose subagent with full capabilities for delegated multi-step tasks",
			spawns: "explore",
			model: "default",
		},
		template: taskMd,
	},
	{
		fileName: "quick_task.md",
		frontmatter: {
			name: "quick_task",
			description: "Quick task for fast execution",
			model: "pi/smol",
		},
		template: taskMd,
	},
	{
		fileName: "deep_task.md",
		frontmatter: {
			name: "deep_task",
			description: "Deep task for comprehensive reasoning",
			model: "pi/slow",
		},
		template: taskMd,
	},
];

const EMBEDDED_AGENTS: { name: string; content: string }[] = EMBEDDED_AGENT_DEFS.map((def) => ({
	name: def.fileName,
	content: buildAgentContent(def),
}));

/**
 * Parse an agent from embedded content.
 */
function parseAgent(fileName: string, content: string, source: AgentSource): AgentDefinition | null {
	const { frontmatter, body } = parseFrontmatter(content, {
		source: `embedded:${fileName}`,
		level: "fatal",
	});
	const fields = parseAgentFields(frontmatter);

	if (!fields) {
		return null;
	}

	return {
		...fields,
		systemPrompt: body,
		source,
		filePath: `embedded:${fileName}`,
	};
}

/** Cache for bundled agents */
let bundledAgentsCache: AgentDefinition[] | null = null;

/**
 * Load all bundled agents from embedded content.
 * Results are cached after first load.
 */
export function loadBundledAgents(): AgentDefinition[] {
	if (bundledAgentsCache !== null) {
		return bundledAgentsCache;
	}

	const agents: AgentDefinition[] = [];

	for (const { name, content } of EMBEDDED_AGENTS) {
		const agent = parseAgent(name, content, "bundled");
		if (agent) {
			agents.push(agent);
		}
	}

	bundledAgentsCache = agents;
	return agents;
}

/**
 * Get a bundled agent by name.
 */
export function getBundledAgent(name: string): AgentDefinition | undefined {
	return loadBundledAgents().find((a) => a.name === name);
}

/**
 * Get all bundled agents as a map keyed by name.
 */
export function getBundledAgentsMap(): Map<string, AgentDefinition> {
	const map = new Map<string, AgentDefinition>();
	for (const agent of loadBundledAgents()) {
		map.set(agent.name, agent);
	}
	return map;
}

/**
 * Clear the bundled agents cache (for testing).
 */
export function clearBundledAgentsCache(): void {
	bundledAgentsCache = null;
}

// Re-export for backward compatibility
export const BUNDLED_AGENTS = loadBundledAgents;
