import type { DagNode, DagNodeRouting } from "./dag.js";
import type { ProviderAuthorityLevel } from "../contracts/provider-health.js";

export interface NodeCapabilityScopes {
  readonly skills: readonly string[];
  readonly mcpServers: readonly string[];
  readonly tools: readonly string[];
  readonly hooks: readonly string[];
  /**
   * Provider authority for write/mutation work on this node. Defaults to the
   * authority-provider value ("full") so the primary coder/authority lane is
   * never over-blocked. Advisory/opportunistic providers carry lower levels.
   */
  readonly writeAuthority: ProviderAuthorityLevel;
  /** Provider authority for shell/CLI work on this node. Defaults to "full". */
  readonly shellAuthority: ProviderAuthorityLevel;
  /** Provider authority for MCP tool work on this node. Defaults to "full". */
  readonly mcpAuthority: ProviderAuthorityLevel;
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

/** Authority levels ordered from most restrictive (0) to most permissive (3). */
const AUTHORITY_RANK: Record<ProviderAuthorityLevel, number> = {
  none: 0,
  advisory: 1,
  direct: 2,
  full: 3,
};

/**
 * Authority levels are derived from the authority-provider doctrine: when a
 * node does not pin an explicit provider authority it inherits the
 * authority-provider level ("full") so the primary coder lane stays unblocked.
 */
export const DEFAULT_NODE_AUTHORITY: ProviderAuthorityLevel = "full";

/**
 * Map a routing `assignedProviderAuthority` token to a {@link ProviderAuthorityLevel}.
 * Returns `undefined` when the routing does not pin an authority so callers can
 * fall back to the authority-provider default.
 */
function authorityLevelFromAssigned(
  assigned: DagNodeRouting["assignedProviderAuthority"] | undefined,
): ProviderAuthorityLevel | undefined {
  switch (assigned) {
    case "authority":
      return "full";
    case "direct":
      return "direct";
    case "advisory":
      return "advisory";
    case "veto":
      return "none";
    default:
      return undefined;
  }
}

/** Pick the most restrictive defined authority level, or the fallback. */
function mostRestrictiveAuthority(
  values: readonly (ProviderAuthorityLevel | undefined)[],
  fallback: ProviderAuthorityLevel = DEFAULT_NODE_AUTHORITY,
): ProviderAuthorityLevel {
  const defined = values.filter((value): value is ProviderAuthorityLevel => value !== undefined);
  if (defined.length === 0) return fallback;
  return defined.reduce((min, value) => (AUTHORITY_RANK[value] < AUTHORITY_RANK[min] ? value : min));
}

/**
 * Resolve the write/shell/MCP authority levels for a routing entry. Used both
 * by {@link capabilityScopesFromRouting} and by the live tool-authority gate so
 * the gate consumes the same authority that routing assigned.
 */
export function resolveNodeToolAuthorities(
  routing: DagNodeRouting | undefined,
  fallback: Partial<NodeCapabilityScopes> = {},
): Pick<NodeCapabilityScopes, "writeAuthority" | "shellAuthority" | "mcpAuthority"> {
  const base = authorityLevelFromAssigned(routing?.assignedProviderAuthority);
  return {
    writeAuthority: base ?? fallback.writeAuthority ?? DEFAULT_NODE_AUTHORITY,
    shellAuthority: base ?? fallback.shellAuthority ?? DEFAULT_NODE_AUTHORITY,
    mcpAuthority: base ?? fallback.mcpAuthority ?? DEFAULT_NODE_AUTHORITY,
  };
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
    ...resolveNodeToolAuthorities(routing, fallback),
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
    writeAuthority: mostRestrictiveAuthority(scopes.map((scope) => scope?.writeAuthority)),
    shellAuthority: mostRestrictiveAuthority(scopes.map((scope) => scope?.shellAuthority)),
    mcpAuthority: mostRestrictiveAuthority(scopes.map((scope) => scope?.mcpAuthority)),
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
