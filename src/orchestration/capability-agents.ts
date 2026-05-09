import type { DagNodeDefinition, DagNodeRouting } from "./dag.js";
import { selectTaskRouting } from "./routing.js";

export interface CapabilityAgentBuildInput {
  goal: string;
  dependsOn: string[];
  maxAgents?: number;
  seedId?: string;
  seedRole?: string;
  seedName?: string;
}

type CapabilityKind = "skill" | "mcp" | "hook";

interface CapabilityLane {
  id: string;
  name: string;
  role: string;
  source: CapabilityKind;
  outputName: string;
  routing: DagNodeRouting;
}

export function buildCapabilityAgentNodes(input: CapabilityAgentBuildInput): DagNodeDefinition[] {
  const maxAgents = Math.max(0, Math.min(input.maxAgents ?? 3, 3));
  if (maxAgents === 0 || input.dependsOn.length === 0) return [];

  const seed: DagNodeDefinition = {
    id: input.seedId ?? "capability-routing-seed",
    name: input.seedName ?? `Route active capabilities for: ${input.goal}`,
    role: input.seedRole ?? "router",
    dependsOn: input.dependsOn,
    maxRetries: 1,
    cost: 2,
    outputs: [{ name: "capability routing plan", gate: "summary" }],
  };
  const routing = selectTaskRouting(seed);
  const lanes = buildCapabilityLanes(input.goal, routing).slice(0, maxAgents);

  return lanes.map((lane) => ({
    id: lane.id,
    name: lane.name,
    role: lane.role,
    dependsOn: [...input.dependsOn],
    maxRetries: 1,
    priority: 2,
    cost: 1,
    failurePolicy: { retryable: true, blockDependents: false, skipOnFailure: true },
    inputs: input.dependsOn.map((from) => ({
      name: `${from} context`,
      ref: "state.json",
      from,
    })),
    outputs: [{ name: lane.outputName, gate: "none", required: false }],
    routing: lane.routing,
  }));
}

export function isCapabilityAgentNode(node: Pick<DagNodeDefinition, "id" | "routing">): boolean {
  return node.routing?.autoSpawned === true || node.id.startsWith("capability-");
}

function buildCapabilityLanes(goal: string, routing: DagNodeRouting): CapabilityLane[] {
  const lanes: CapabilityLane[] = [];
  const skills = routing.skills ?? [];
  const mcpServers = routing.mcpServers ?? [];
  const tools = routing.tools ?? [];
  const hooks = routing.hooks ?? [];

  if (skills.length > 0) {
    lanes.push({
      id: "capability-skill-agent",
      name: `Activate relevant skills: ${goal}`,
      role: "explorer",
      source: "skill",
      outputName: "skill activation handoff",
      routing: {
        provider: "auto",
        fallbackProvider: "kimi",
        providerReason: "Kimi owns skill activation and synthesis for auto-spawned capability lanes",
        autoSpawned: true,
        spawnReason: "active skill inventory matched the orchestration goal",
        routeSource: "skill",
        requiresMcp: false,
        requiresToolCalling: false,
        readOnly: true,
        evidenceRequired: false,
        contextBudget: "tiny",
        skills,
        mcpServers: [],
        tools: [],
        hooks: [],
        rationale: `skills=${skills.join(",")}`,
      },
    });
  }

  if (mcpServers.length > 0 || tools.length > 0) {
    lanes.push({
      id: "capability-mcp-agent",
      name: `Use active MCP/tools: ${goal}`,
      role: "researcher",
      source: "mcp",
      outputName: "mcp tool handoff",
      routing: {
        provider: "auto",
        fallbackProvider: "kimi",
        providerReason: "Kimi required because this capability lane may use live MCP/tool authority",
        autoSpawned: true,
        spawnReason: "active MCP/tool inventory matched the orchestration goal",
        routeSource: "mcp",
        requiresMcp: mcpServers.length > 0,
        requiresToolCalling: tools.length > 0,
        readOnly: true,
        evidenceRequired: false,
        contextBudget: "tiny",
        skills: [],
        mcpServers,
        tools,
        hooks: [],
        rationale: `mcp=${mcpServers.join(",")}; tools=${tools.join(",")}`,
      },
    });
  }

  if (hooks.length > 0) {
    lanes.push({
      id: "capability-hook-agent",
      name: `Apply active hook constraints: ${goal}`,
      role: "reviewer",
      source: "hook",
      outputName: "hook constraint handoff",
      routing: {
        provider: "auto",
        fallbackProvider: "kimi",
        providerReason: "Kimi owns hook-aware guardrails and final synthesis for auto-spawned capability lanes",
        autoSpawned: true,
        spawnReason: "active hook inventory matched the orchestration goal",
        routeSource: "hook",
        requiresMcp: false,
        requiresToolCalling: false,
        readOnly: true,
        evidenceRequired: false,
        contextBudget: "tiny",
        skills: [],
        mcpServers: [],
        tools: [],
        hooks,
        rationale: `hooks=${hooks.join(",")}`,
      },
    });
  }

  return lanes;
}
