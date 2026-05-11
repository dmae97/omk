/**
 * KimiPrintRuntime — wraps createKimiTaskRunner (kimi --print via execa).
 *
 * This is the active runtime used for DAG node execution.
 * Builds prompt from ContextCapsule and delegates to existing runner.
 */

import type { AgentRuntime, AgentRunResult } from "./agent-runtime.js";
import type { ContextCapsule } from "./context-capsule.js";
import type { DagNode } from "../orchestration/dag.js";
import { createKimiTaskRunner, type KimiTaskRunnerOptions } from "../kimi/runner.js";

export type KimiPrintRuntimeOptions = KimiTaskRunnerOptions;

export function createKimiPrintRuntime(options: KimiPrintRuntimeOptions = {}): AgentRuntime {
  return {
    id: "kimi-print",
    priority: 100,

    supports(_capsule: ContextCapsule): boolean {
      return true;
    },

    async runNode(capsule: ContextCapsule, signal: AbortSignal): Promise<AgentRunResult> {
      // Validate capsule task is not empty to prevent LLM provider errors
      if (!capsule.task || capsule.task.trim().length === 0) {
        const errorMsg = `Empty task for node ${capsule.nodeId}`;
        process.stderr.write(`[omk] ${errorMsg}\n`);
        return {
          success: false,
          exitCode: 1,
          stdout: `[ERROR] ${errorMsg}`,
          stderr: errorMsg,
          metadata: { runtime: "kimi-print", error: errorMsg },
        };
      }

      const runner = createKimiTaskRunner(options);

      const env: Record<string, string> = {
        OMK_RUN_ID: capsule.runId,
        OMK_NODE_ID: capsule.nodeId,
        OMK_CONTEXT_BUDGET: capsule.budget.compression,
        OMK_TOTAL_TOKENS: String(capsule.budget.maxInputTokens),
      };

      const node: DagNode = {
        ...capsule.node,
        name: capsule.task,
      };

      const startedAt = Date.now();

      try {
        const result = await runner.run(node, env);

        if (signal.aborted) {
          return {
            success: false,
            exitCode: 130,
            stdout: result.stdout,
            stderr: "Aborted by signal",
            metadata: { runtime: "kimi-print", aborted: true },
          };
        }

        const durationMs = Date.now() - startedAt;
        return {
          success: result.success,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          metadata: {
            runtime: "kimi-print",
            durationMs,
            ...result.metadata,
          },
        };
      } catch (err) {
        const errorMsg = String(err);
        return {
          success: false,
          exitCode: 1,
          stdout: `[ERROR] ${errorMsg}`,
          stderr: errorMsg,
          metadata: { runtime: "kimi-print", error: errorMsg },
        };
      }
    },
  };
}
