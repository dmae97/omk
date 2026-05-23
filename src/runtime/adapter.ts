export type RuntimeId = string;

export type RuntimeKind =
  | "cli"
  | "api"
  | "mcp"
  | "local"
  | "composite";

export type RuntimeAuthority =
  | "read"
  | "write"
  | "shell"
  | "mcp"
  | "patch"
  | "review"
  | "merge"
  | "vision";

export interface RuntimeCapabilities {
  read: boolean;
  write: boolean;
  shell: boolean;
  mcp: boolean;
  patch: boolean;
  review: boolean;
  merge: boolean;
  vision: boolean;
  maxContextTokens?: number;
  supportsStreaming?: boolean;
  supportsStructuredOutput?: boolean;
  supportsToolCalling?: boolean;
}

export interface RuntimeHealth {
  runtimeId: RuntimeId;
  available: boolean;
  reason?: string;
  checkedAt: string;
}

export interface AgentRunRequest {
  runId: string;
  nodeId: string;
  role: string;
  taskType: string;
  goalDigest: string;
  contextCapsule: unknown;
  worktree: {
    root: string;
    isolated: boolean;
    branch?: string;
  };
  authority: {
    mode: "authority" | "executor" | "proposal" | "advisory" | "veto";
    allowed: RuntimeAuthority[];
  };
  routing: {
    preferredRuntime?: RuntimeId;
    candidateRuntimes: RuntimeId[];
    fallbackChain: RuntimeId[];
    reason?: string;
  };
  constraints: {
    timeoutMs?: number;
    maxTokens?: number;
    requireEvidence: boolean;
    allowNetwork: boolean;
    allowShell: boolean;
    allowFileWrite: boolean;
    allowMcp: boolean;
  };
}

export interface AgentRunResult {
  success: boolean;
  exitCode?: number;
  stdout: string;
  stderr: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeAdapter {
  id: RuntimeId;
  displayName: string;
  kind: RuntimeKind;
  priority: number;
  capabilities: RuntimeCapabilities;

  health(): Promise<RuntimeHealth>;
  supports(request: AgentRunRequest): boolean;
  runNode(request: AgentRunRequest, signal?: AbortSignal): Promise<AgentRunResult>;
}

export interface RuntimeRouteDecision {
  selectedRuntime: RuntimeId;
  candidateRuntimes: RuntimeId[];
  fallbackChain: RuntimeId[];
  authorityMode: "authority" | "executor" | "proposal" | "advisory" | "veto";
  reason: string;
  confidence: number;
  rejected?: Array<{
    runtimeId: RuntimeId;
    reason: string;
  }>;
}

export function isRuntimeId(value: unknown): value is RuntimeId {
  return typeof value === "string" && value.length > 0;
}

export function isRuntimeAdapter(value: unknown): value is RuntimeAdapter {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.displayName === "string" &&
    typeof r.priority === "number" &&
    typeof r.capabilities === "object" &&
    r.capabilities !== null &&
    typeof r.health === "function" &&
    typeof r.supports === "function" &&
    typeof r.runNode === "function"
  );
}
