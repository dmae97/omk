/**
 * KimiPrintRuntime — legacy compatibility adapter for kimi --print.
 *
 * Provider-neutral OMK paths do not register this runtime. It is available only
 * when an explicit legacy fallback chain requests a Kimi CLI adapter.
 */

import type { AgentRuntime, AgentRunResult } from "./agent-runtime.js";
import type { ContextCapsule } from "./context-capsule.js";
import type { DagNode } from "../orchestration/dag.js";
import { dagNodeRoutingEnv } from "../orchestration/routing.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { createKimiTaskRunner, type KimiTaskRunnerOptions } from "../kimi/runner.js";

export type KimiPrintRuntimeOptions = KimiTaskRunnerOptions;

export function createKimiPrintRuntime(options: KimiPrintRuntimeOptions = {}): AgentRuntime {
  return {
    id: "kimi-print",
    providerId: "kimi",
    legacy: true,
    runtimeMode: "print",
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

      const routing = capsule.node?.routing;
      const approvalPolicy = routing?.approvalPolicy ?? routing?.executionPrompt;
      const sandboxMode = routing?.sandboxMode;
      const capabilities = routing?.assignedProviderCapabilities ?? [];
      const isAdvisory =
        sandboxMode === "read-only" ||
        capabilities.length === 0 ||
        capabilities.every((c) => ["read", "review"].includes(c));
      const requiresWriteShellMerge = capabilities.some((c) =>
        ["write", "patch", "shell", "merge"].includes(c)
      );
      if (requiresWriteShellMerge && isAdvisory) {
        const errorMsg = `[omk] kimi-print runtime is advisory/read-only and does not receive write, patch, shell, or merge authority`;
        process.stderr.write(`${errorMsg}\n`);
        return {
          success: false,
          exitCode: 1,
          stdout: `[ERROR] ${errorMsg}`,
          stderr: errorMsg,
          metadata: { runtime: "kimi-print", error: errorMsg, authorityMode: "advisory" },
        };
      }

      const runner = createKimiTaskRunner(options);

      const resources = await getOmkResourceSettings();
      const env: Record<string, string> = {
        OMK_RUN_ID: capsule.runId,
        OMK_NODE_ID: capsule.nodeId,
        OMK_ROLE: capsule.node?.role ?? "",
        OMK_MCP_ENABLED: resources.mcpScope === "none" ? "false" : "true",
        OMK_SKILLS_ENABLED: resources.skillsScope === "none" ? "false" : "true",
        OMK_HOOKS_ENABLED: resources.hooksScope === "none" ? "false" : "true",
        OMK_CONTEXT_BUDGET: capsule.budget.compression,
        OMK_TOTAL_TOKENS: String(capsule.budget.maxInputTokens),
        OMK_APPROVAL_POLICY: approvalPolicy ?? "",
        OMK_SANDBOX_MODE: sandboxMode ?? (isAdvisory ? "read-only" : "workspace-write"),
        ...(capsule.node ? dagNodeRoutingEnv(capsule.node) : {}),
      };

      const node: DagNode = {
        ...capsule.node,
        name: capsule.task,
      };

      const startedAt = Date.now();

      try {
        const result = await runner.run(node, env, signal);

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
