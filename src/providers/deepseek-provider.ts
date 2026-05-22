import type {
  AgentProvider,
  AgentRunInput,
  AgentRunResult,
  CostEstimate,
  ProviderHealth,
  ProviderKind,
} from "./provider.js";
import type { TaskRunner, TaskResult } from "../contracts/orchestration.js";
import type { DagNode } from "../orchestration/dag.js";

const READ_ONLY_ROLES = new Set([
  "explorer",
  "researcher",
  "reviewer",
  "qa",
  "tester",
  "documenter",
  "writer",
  "planner",
]);

const WRITE_ROLES = new Set([
  "coder",
  "executor",
  "refactorer",
]);

export interface DeepSeekProviderOptions {
  runner: TaskRunner;
  priority?: number;
  maxRetries?: number;
}

export function createDeepSeekProvider(options: DeepSeekProviderOptions): AgentProvider {
  const { runner, priority = 50, maxRetries = 2 } = options;

  return {
    id: "deepseek",
    kind: "openai-compatible" as ProviderKind,
    priority,

    supports(task: DagNode): boolean {
      const role = task.role?.toLowerCase() ?? "";
      if (READ_ONLY_ROLES.has(role)) return true;
      if (WRITE_ROLES.has(role) && task.routing?.readOnly) return true;
      return false;
    },

    async run(input: AgentRunInput): Promise<AgentRunResult> {
      let lastError: unknown;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const result: TaskResult = await runner.run(input.node, input.env, input.signal);
          return {
            success: result.success,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            metadata: result.metadata,
          };
        } catch (err) {
          lastError = err;
          if (isTransientError(err)) continue;
          throw err;
        }
      }
      throw lastError;
    },

    async estimateCost(input: AgentRunInput): Promise<CostEstimate> {
      const estimatedTokens = Number(input.node.routing?.contextBudget) || 4000;
      return {
        inputTokens: estimatedTokens,
        outputTokens: Math.floor(estimatedTokens * 0.3),
        estimatedCostUsd: estimatedTokens * 0.000002,
        currency: "USD",
      };
    },

    async health(): Promise<ProviderHealth> {
      return {
        available: true,
        lastCheckedAt: Date.now(),
      };
    },
  };
}

function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("429") ||
      msg.includes("503") ||
      msg.includes("timeout") ||
      msg.includes("overloaded")
    );
  }
  return false;
}
