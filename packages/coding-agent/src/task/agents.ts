/**
 * Bundled agent definitions.
 *
 * Agents are embedded at build time via Bun's import with { type: "text" }.
 */
import { renderPromptTemplate } from "../config/prompt-templates";
import { parseAgentFields } from "../discovery/helpers";
import exploreMd from "../prompts/agents/explore.md" with { type: "text" };
// Embed agent markdown files at build time
import agentFrontmatterTemplate from "../prompts/agents/frontmatter.md" with { type: "text" };
import planMd from "../prompts/agents/plan.md" with { type: "text" };
import reviewerMd from "../prompts/agents/reviewer.md" with { type: "text" };
import taskMd from "../prompts/agents/task.md" with { type: "text" };
import { parseFrontmatter } from "../utils/frontmatter";
import type { AgentDefinition, AgentSource } from "./types";

interface AgentFrontmatter {
	name: string;
	description: string;
	spawns?: string;
	model?: string | string[];
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

const EMBEDDED_AGENTS: { name: string; content: string }[] = EMBEDDED_AGENT_DEFS.map(def => ({
	name: def.fileName,
	content: buildAgentContent(def),
}));

export class AgentParsingError extends Error {
	constructor(
		error: Error,
		public readonly source?: unknown,
	) {
		super(`Failed to parse agent: ${error.message}`, { cause: error });
		this.name = "AgentParsingError";
	}

	toString(): string {
		const details: string[] = [this.message];
		if (this.source !== undefined) {
			details.push(`Source: ${JSON.stringify(this.source)}`);
		}
		if (this.cause && typeof this.cause === "object" && "stack" in this.cause && this.cause.stack) {
			details.push(`Stack:\n${this.cause.stack}`);
		} else if (this.stack) {
			details.push(`Stack:\n${this.stack}`);
		}
		return details.join("\n\n");
	}
}

/**
 * Parse an agent from embedded content.
 */
export function parseAgent(
	filePath: string,
	content: string,
	source: AgentSource,
	level: "fatal" | "warn" | "off" = "fatal",
): AgentDefinition {
	const { frontmatter, body } = parseFrontmatter(content, {
		location: filePath,
		level,
	});
	const fields = parseAgentFields(frontmatter);
	if (!fields) {
		throw new AgentParsingError(new Error("Invalid agent fields"), filePath);
	}
	return {
		...fields,
		systemPrompt: body,
		source,
		filePath,
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
	bundledAgentsCache = EMBEDDED_AGENTS.map(({ name, content }) => parseAgent(`embedded:${name}`, content, "bundled"));
	return bundledAgentsCache;
}

/**
 * Get a bundled agent by name.
 */
export function getBundledAgent(name: string): AgentDefinition | undefined {
	return loadBundledAgents().find(a => a.name === name);
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
