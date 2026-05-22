import type { DagNodeDefinition, DagNodeRouting } from "./dag.js";
import type { RunState } from "../contracts/orchestration.js";
import type { EnsembleDecisionCandidateVote } from "./ensemble-decision.js";
import { selectTaskRouting } from "./routing.js";
import { DEFAULT_FALLBACK_PROVIDER } from "../providers/types.js";

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
    name: input.seedName ?? "Route active capabilities for action digest",
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
  const scopedTools = tools.filter((tool) => tool !== "SearchWeb" && tool !== "FetchURL");
  const hooks = routing.hooks ?? [];

  if (skills.length > 0) {
    lanes.push({
      id: "capability-skill-agent",
      name: "Activate relevant skills for action digest",
      role: "explorer",
      source: "skill",
      outputName: "skill activation handoff",
      routing: {
        provider: "auto",
        fallbackProvider: DEFAULT_FALLBACK_PROVIDER,
        providerReason: "Kimi owns skill activation and synthesis for auto-spawned capability lanes",
        autoSpawned: true,
        spawnReason: "active skill inventory matched the orchestration goal",
        routeSource: "skill",
        assignedCapabilities: {
          skills,
          mcpServers: [],
          tools: [],
          hooks: [],
        },
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

  if (mcpServers.length > 0 || scopedTools.length > 0) {
    lanes.push({
      id: "capability-mcp-agent",
      name: "Use active MCP/tools for action digest",
      role: "researcher",
      source: "mcp",
      outputName: "mcp tool handoff",
      routing: {
        provider: "auto",
        fallbackProvider: DEFAULT_FALLBACK_PROVIDER,
        providerReason: "Kimi required because this capability lane may use live MCP/tool authority",
        autoSpawned: true,
        spawnReason: "active MCP/tool inventory matched the orchestration goal",
        routeSource: "mcp",
        assignedCapabilities: {
          skills: [],
          mcpServers,
          tools: scopedTools,
          hooks: [],
        },
        requiresMcp: mcpServers.length > 0,
        requiresToolCalling: scopedTools.length > 0,
        readOnly: true,
        evidenceRequired: false,
        contextBudget: "tiny",
        skills: [],
        mcpServers,
        tools: scopedTools,
        hooks: [],
        rationale: `mcp=${mcpServers.join(",")}; tools=${scopedTools.join(",")}`,
      },
    });
  }

  if (hooks.length > 0) {
    lanes.push({
      id: "capability-hook-agent",
      name: "Apply active hook constraints for action digest",
      role: "reviewer",
      source: "hook",
      outputName: "hook constraint handoff",
      routing: {
        provider: "auto",
        fallbackProvider: DEFAULT_FALLBACK_PROVIDER,
        providerReason: "Kimi owns hook-aware guardrails and final synthesis for auto-spawned capability lanes",
        autoSpawned: true,
        spawnReason: "active hook inventory matched the orchestration goal",
        routeSource: "hook",
        assignedCapabilities: {
          skills: [],
          mcpServers: [],
          tools: [],
          hooks,
        },
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

export function buildCapabilityVotes(
  capabilityNodes: RunState["nodes"],
  runState: RunState
): EnsembleDecisionCandidateVote[] {
  const votes: EnsembleDecisionCandidateVote[] = [];
  const pendingNodes = runState.nodes.filter((n) => n.status === "pending" || n.status === "running");

  for (const node of capabilityNodes) {
    if (node.status === "failed") {
      votes.push({
        id: node.id,
        action: "replan",
        weight: 0.7,
        reason: `Capability lane ${node.id} failed`,
      });
      continue;
    }
    if (node.status === "done") {
      votes.push({
        id: node.id,
        action: "continue",
        weight: 0.5,
        reason: `Capability lane ${node.id} is ready`,
      });
      continue;
    }
    if (pendingNodes.length > 0) {
      const hasRouting = node.routing && (
        (node.routing.skills && node.routing.skills.length > 0) ||
        (node.routing.mcpServers && node.routing.mcpServers.length > 0) ||
        (node.routing.hooks && node.routing.hooks.length > 0)
      );
      votes.push({
        id: node.id,
        action: hasRouting ? "continue" : "replan",
        weight: 0.6,
        reason: hasRouting
          ? `Capability lane ${node.id} has scoped routing for pending work`
          : `Capability lane ${node.id} lacks routing hints for pending work`,
      });
    }
  }

  return votes;
}
