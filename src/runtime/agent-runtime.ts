/**
 * AgentRuntime — interface for runtime implementations.
 *
 * Each runtime wraps a specific Kimi/provider invocation mode.
 */

import type { TaskResult } from "../contracts/orchestration.js";
import type { ContextCapsule } from "./context-capsule.js";
import { sanitizeRuntimeStderrResult } from "./private-stderr.js";
import type {
  RuntimeCapabilities as SharedRuntimeCapabilities,
  RuntimeHealth as SharedRuntimeHealth,
  RuntimeHealthProbeRequest,
  RuntimeId,
  RuntimeKind,
} from "./contracts/shared.js";

export type { RuntimeAuthority, RuntimeId, RuntimeKind } from "./contracts/shared.js";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface ToolCallRecord {
  readonly name: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly durationMs: number;
  readonly success: boolean;
  /** SHA-256 hash from AuditRecord for dedup/correlation */
  readonly auditHash?: string;
  /** Whether secrets were redacted by governance */
  readonly redacted?: boolean;
  /** Path to evidence artifact file (.omk/runs/<runId>/artifacts/mcp/<auditId>.json) */
  readonly evidenceRef?: string;
}

export interface AgentRunResult {
  readonly success: boolean;
  readonly exitCode?: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly metadata?: Record<string, unknown>;
  readonly tokenUsage?: TokenUsage;
  readonly toolCalls?: readonly ToolCallRecord[];
}

export interface RuntimeCapabilities extends SharedRuntimeCapabilities {
  readonly toolCalling?: boolean;
  readonly streaming?: boolean;
  readonly maxTokens?: number;
  readonly live?: boolean;
  readonly advisory?: boolean;
  readonly dryRun?: boolean;
}

export type RuntimeHealth = SharedRuntimeHealth;

export interface ToolManifestEntry {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly readOnly?: boolean;
  readonly parallelSafe?: boolean;
  readonly stormExempt?: boolean;
  readonly skipRetentionSave?: boolean;
}

export interface ToolManifest {
  readonly available: readonly ToolManifestEntry[];
  readonly mcpServers?: readonly string[];
  readonly skills?: readonly string[];
  readonly hooks?: readonly string[];
}

export interface AgentTaskSafety {
  readonly risk: string;
  readonly riskTrace?: unknown;
  readonly approvalPolicy: string;
  readonly sandboxMode: string;
  readonly evidenceRequired: boolean;
  readonly authorityMode: string;
}

export interface AgentContextCompaction {
  readonly schemaVersion: "omk.task-compaction.v1";
  readonly contract: unknown;
  readonly diagnostics: Readonly<Record<string, unknown>>;
  readonly artifactRef?: string;
}

export interface AgentContext {
  readonly runId: string;
  readonly nodeId: string;
  readonly role?: string;
  readonly goal?: string;
  readonly system?: string;
  readonly files?: readonly string[];
  readonly memory?: ReadonlyArray<{ key: string; source: string; summary: string }>;
  readonly goalContext?: unknown;
  readonly workerManifest?: unknown;
  readonly compaction?: AgentContextCompaction;
  readonly abortSignal?: AbortSignal;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly providerModel?: string;
  readonly risk?: string;
  readonly approvalPolicy?: string;
  readonly sandboxMode?: string;
  readonly onOutput?: (text: string) => void;
}

export interface ProviderPolicy {
  readonly strategy: "priority-first" | "cost-first" | "latency-first" | "manual" | string;
  readonly preferredProviders: readonly string[];
  readonly fallbackChain: readonly string[];
  readonly maxCost?: number;
  readonly maxLatencyMs?: number;
}

export interface CapabilityManifest extends RuntimeCapabilities {
  readonly structuredOutput?: boolean;
}

export interface AgentTaskAttachment {
  readonly name: string;
  readonly path?: string;
  readonly mimeType: string;
  readonly dataUri: string;
  readonly ext: string;
  readonly source: "clipboard" | "file" | "drag";
}

export interface AgentTask {
  readonly prompt: string;
  readonly context: AgentContext;
  readonly tools: ToolManifest;
  readonly providerPolicy: ProviderPolicy;
  readonly capabilities: CapabilityManifest;
  readonly safety: AgentTaskSafety;
  /** Images/files attached to this task (clipboard paste, --image, drag). */
  readonly attachments?: readonly AgentTaskAttachment[];
}

export interface AgentResult {
  readonly output: string;
  readonly exitCode: number;
  readonly metadata?: Record<string, unknown>;
  readonly thinking?: string;
  readonly tokenUsage?: TokenUsage;
  readonly toolCalls?: readonly ToolCallRecord[];
}

export interface AgentRuntime {
  readonly id: RuntimeId;
  readonly providerId?: string;
  readonly displayName?: string;
  readonly kind?: RuntimeKind;
  readonly legacy?: boolean;
  readonly runtimeMode: string;
  readonly priority: number;
  readonly capabilities?: RuntimeCapabilities;
  supports(capsule: ContextCapsule): boolean;
  health?(input?: RuntimeHealthProbeRequest): Promise<RuntimeHealth>;
  runNode(capsule: ContextCapsule, signal: AbortSignal): Promise<AgentRunResult>;
  execute?(task: AgentTask): Promise<AgentResult>;
}

export function toTaskResult(result: AgentRunResult): TaskResult {
  const runtimeId = typeof result.metadata?.selectedRuntime === "string"
    ? result.metadata.selectedRuntime
    : typeof result.metadata?.runtime === "string"
      ? result.metadata.runtime
      : undefined;
  const sanitized = sanitizeRuntimeStderrResult(result, {
    runId: typeof result.metadata?.runId === "string" ? result.metadata.runId : process.env.OMK_RUN_ID,
    nodeId: typeof result.metadata?.nodeId === "string" ? result.metadata.nodeId : process.env.OMK_NODE_ID,
    runtimeId,
    root: process.env.OMK_PROJECT_ROOT ?? process.cwd(),
    env: process.env,
  });
  return {
    success: sanitized.success,
    exitCode: sanitized.exitCode,
    stdout: sanitized.stdout,
    stderr: sanitized.stderr,
    metadata: {
      ...sanitized.metadata,
      ...(sanitized.tokenUsage != null && { tokenUsage: sanitized.tokenUsage }),
      ...(sanitized.toolCalls != null && sanitized.toolCalls.length > 0 && { toolCalls: sanitized.toolCalls }),
    },
  };
}
