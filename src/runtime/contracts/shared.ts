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

export interface RuntimeHealthVector {
  runtimeOk: boolean;
  authOk: boolean;
  modelOk: boolean;
  quotaOk: boolean;
  rateLimitOk?: boolean;
  latencyMs?: number;
}

export interface RuntimeHealth {
  runtimeId: RuntimeId;
  available: boolean;
  reason?: string;
  checkedAt: string;
  /** Structured health signals beyond a binary available flag. */
  vector?: RuntimeHealthVector;
}
