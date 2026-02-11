/**
 * YAML schema parsing, validation, and normalized types for swarm definitions.
 */
import YAML from "yaml";

// ============================================================================
// Raw YAML shape (snake_case, optional fields)
// ============================================================================

interface RawSwarmAgentConfig {
	role: string;
	task: string;
	extra_context?: string;
	reports_to?: string[];
	waits_for?: string[];
}

interface RawSwarmConfig {
	name: string;
	workspace: string;
	mode?: string;
	target_count?: number;
	model?: string;
	agents: Record<string, RawSwarmAgentConfig>;
}

// ============================================================================
// Normalized types (camelCase, defaults applied)
// ============================================================================

export type SwarmMode = "pipeline" | "parallel" | "sequential";

export interface SwarmAgent {
	name: string;
	role: string;
	task: string;
	extraContext?: string;
	reportsTo: string[];
	waitsFor: string[];
}

export interface SwarmDefinition {
	name: string;
	workspace: string;
	mode: SwarmMode;
	targetCount: number;
	model?: string;
	agents: Map<string, SwarmAgent>;
	/** Preserves YAML declaration order for implicit pipeline sequencing. */
	agentOrder: string[];
}

// ============================================================================
// Parsing
// ============================================================================

const VALID_MODES = new Set<string>(["pipeline", "parallel", "sequential"]);

export function parseSwarmYaml(content: string): SwarmDefinition {
	const raw = YAML.parse(content) as { swarm?: RawSwarmConfig } | null;
	if (!raw?.swarm) {
		throw new Error("YAML must have a top-level 'swarm' key");
	}
	const swarm = raw.swarm;

	if (!swarm.name || typeof swarm.name !== "string") {
		throw new Error("swarm.name is required and must be a string");
	}
	if (!swarm.workspace || typeof swarm.workspace !== "string") {
		throw new Error("swarm.workspace is required and must be a string");
	}
	if (!swarm.agents || typeof swarm.agents !== "object" || Object.keys(swarm.agents).length === 0) {
		throw new Error("swarm.agents must contain at least one agent");
	}

	const mode = swarm.mode ?? "sequential";
	if (!VALID_MODES.has(mode)) {
		throw new Error(`Invalid mode '${mode}'. Must be one of: ${[...VALID_MODES].join(", ")}`);
	}

	const agentOrder: string[] = [];
	const agents = new Map<string, SwarmAgent>();

	for (const [name, config] of Object.entries(swarm.agents)) {
		if (!config.role || typeof config.role !== "string") {
			throw new Error(`Agent '${name}': 'role' is required`);
		}
		if (!config.task || typeof config.task !== "string") {
			throw new Error(`Agent '${name}': 'task' is required`);
		}

		agentOrder.push(name);
		agents.set(name, {
			name,
			role: config.role,
			task: config.task.trim(),
			extraContext: config.extra_context?.trim(),
			reportsTo: Array.isArray(config.reports_to) ? config.reports_to : [],
			waitsFor: Array.isArray(config.waits_for) ? config.waits_for : [],
		});
	}

	return {
		name: swarm.name,
		workspace: swarm.workspace,
		mode: mode as SwarmMode,
		targetCount: swarm.target_count ?? 1,
		model: swarm.model,
		agents,
		agentOrder,
	};
}

// ============================================================================
// Validation (semantic — references, constraints)
// ============================================================================

export function validateSwarmDefinition(def: SwarmDefinition): string[] {
	const errors: string[] = [];
	const agentNames = new Set(def.agents.keys());

	for (const [name, agent] of def.agents) {
		for (const dep of agent.waitsFor) {
			if (!agentNames.has(dep)) {
				errors.push(`Agent '${name}' waits_for unknown agent '${dep}'`);
			}
			if (dep === name) {
				errors.push(`Agent '${name}' cannot wait for itself`);
			}
		}
		for (const target of agent.reportsTo) {
			if (!agentNames.has(target)) {
				errors.push(`Agent '${name}' reports_to unknown agent '${target}'`);
			}
			if (target === name) {
				errors.push(`Agent '${name}' cannot report to itself`);
			}
		}
	}

	if (def.targetCount < 1) {
		errors.push("target_count must be at least 1");
	}

	return errors;
}
