import type { DagNode, DagNodeRouting } from "./dag.js";

export interface NodeCapabilityScopes {
  readonly skills: readonly string[];
  readonly mcpServers: readonly string[];
  readonly tools: readonly string[];
  readonly hooks: readonly string[];
}

export interface CapabilityRoutingEntry extends NodeCapabilityScopes {
  readonly nodeId: string;
  readonly name: string;
  readonly role: string;
  readonly provider: string;
  readonly fallbackProvider?: string;
  readonly candidateProviders: readonly string[];
  readonly assignedModel?: string;
  readonly authority?: string;
  readonly routeSource?: string;
  readonly rationale?: string;
  readonly actionAtom?: DagNodeRouting["actionAtom"];
}

export interface CapabilityRoutingIdentity {
  readonly owner: "omk";
  readonly identity: "OMK root orchestrator";
  readonly doctrine: "Models execute. OMK routes, verifies, measures, and controls.";
  readonly goal?: string;
  readonly capabilityAssignment: "goal-scoped";
}

export interface CapabilityRoutingArtifact {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly nodes: readonly CapabilityRoutingEntry[];
  readonly orchestrator: CapabilityRoutingIdentity;
}

export function uniqueCapabilityNames(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

export function capabilityScopesFromRouting(
  routing: DagNodeRouting | undefined,
  fallback: Partial<NodeCapabilityScopes> = {}
): NodeCapabilityScopes {
  const assigned = routing?.assignedCapabilities;
  return {
    skills: uniqueCapabilityNames(routing?.skills ?? assigned?.skills ?? fallback.skills ?? []),
    mcpServers: uniqueCapabilityNames(routing?.mcpServers ?? assigned?.mcpServers ?? fallback.mcpServers ?? []),
    tools: uniqueCapabilityNames(routing?.tools ?? assigned?.tools ?? fallback.tools ?? []),
    hooks: uniqueCapabilityNames(routing?.hooks ?? assigned?.hooks ?? fallback.hooks ?? []),
  };
}

export function mergeCapabilityScopes(
  ...scopes: readonly (Partial<NodeCapabilityScopes> | undefined)[]
): NodeCapabilityScopes {
  return {
    skills: uniqueCapabilityNames(scopes.flatMap((scope) => scope?.skills ?? [])),
    mcpServers: uniqueCapabilityNames(scopes.flatMap((scope) => scope?.mcpServers ?? [])),
    tools: uniqueCapabilityNames(scopes.flatMap((scope) => scope?.tools ?? [])),
    hooks: uniqueCapabilityNames(scopes.flatMap((scope) => scope?.hooks ?? [])),
  };
}

export function attachAssignedCapabilities(routing: DagNodeRouting): DagNodeRouting {
  const assignedCapabilities = capabilityScopesFromRouting(routing);
  return {
    ...routing,
    assignedCapabilities: {
      skills: [...assignedCapabilities.skills],
      mcpServers: [...assignedCapabilities.mcpServers],
      tools: [...assignedCapabilities.tools],
      hooks: [...assignedCapabilities.hooks],
    },
  };
}

export function capabilityRoutingEntry(node: DagNode): CapabilityRoutingEntry {
  const scopes = capabilityScopesFromRouting(node.routing);
  const provider = node.routing?.assignedProvider ?? node.routing?.provider ?? "auto";
  return {
    nodeId: node.id,
    name: node.name,
    role: node.role,
    provider,
    fallbackProvider: node.routing?.fallbackProvider,
    candidateProviders: uniqueCapabilityNames(node.routing?.candidateProviders ?? []),
    assignedModel: node.routing?.assignedModel ?? node.routing?.providerModel,
    authority: node.routing?.assignedProviderAuthority,
    routeSource: node.routing?.routeSource,
    rationale: node.routing?.rationale,
    actionAtom: node.routing?.actionAtom,
    ...scopes,
  };
}

export function renderCapabilityRoutingArtifact(
  nodes: readonly DagNode[],
  options: string | {
    readonly generatedAt?: string;
    readonly goal?: string;
  } = {}
): CapabilityRoutingArtifact {
  const metadata = typeof options === "string" ? { generatedAt: options } : options;
  return {
    schemaVersion: 1,
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
    orchestrator: {
      owner: "omk",
      identity: "OMK root orchestrator",
      doctrine: "Models execute. OMK routes, verifies, measures, and controls.",
      goal: metadata.goal,
      capabilityAssignment: "goal-scoped",
    },
    nodes: nodes.map(capabilityRoutingEntry),
  };
}
