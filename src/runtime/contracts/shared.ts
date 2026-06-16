/**
 * Shared runtime contracts used by both AgentRuntime and RuntimeAdapter.
 *
 * AgentRuntime — internal runtime implementation interface (src/runtime/agent-runtime.ts)
 *   Used by concrete runtimes (KimiApi, DeepSeek, Codex, WireProtocol, etc.)
 *   Operates on ContextCapsule and supports optional execute()/health() hooks.
 *
 * RuntimeAdapter — provider-routing interface (src/runtime/adapter.ts)
 *   Used by the provider routing layer to select and dispatch to runtimes.
 *   Operates on AgentRunRequest and requires mandatory health()/supports()/runNode().
 */

export type RuntimeId = string;

export type RuntimeKind = "cli" | "api" | "mcp" | "local" | "composite";

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

export type HealthState = "pass" | "fail" | "unknown";

export type RuntimeHealthProbeKind = "none" | "static" | "cheap-call" | "live-call";

export interface RuntimeHealthVector {
  /** Legacy boolean dimensions retained for backward compatibility. */
  runtimeOk?: boolean;
  authOk?: boolean;
  modelOk?: boolean;
  quotaOk?: boolean;
  rateLimitOk?: boolean;
  /** Tri-state dimensions used by health-aware routing v2. */
  runtime?: HealthState;
  auth?: HealthState;
  model?: HealthState;
  quota?: HealthState;
  rateLimit?: HealthState;
  latencyMs?: number;
  lastProbeKind?: RuntimeHealthProbeKind;
  checkedAt?: string;
  expiresAt?: string;
}

export interface RuntimeHealthProbeRequest {
  readonly probeKind: RuntimeHealthProbeKind;
  readonly taskRisk?: string;
  readonly highRisk: boolean;
}

export interface RuntimeHealth {
  runtimeId: RuntimeId;
  available: boolean;
  reason?: string;
  checkedAt: string;
  /** Structured health signals beyond a binary available flag. */
  vector?: RuntimeHealthVector;
}
