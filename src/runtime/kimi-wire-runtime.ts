/**
 * KimiWireRuntime — wraps KimiWireClient (kimi --wire JSON-RPC).
 *
 * Uses the wire protocol for structured tool-call interaction.
 * Currently incomplete — wire-mode tool handling is not fully implemented.
 */

import type { AgentRuntime, AgentRunResult } from "./agent-runtime.js";
import type { ContextCapsule } from "./context-capsule.js";
import { KimiWireClient } from "../kimi/wire-client.js";
import { CappedOutputBuffer } from "../util/output-buffer.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";

export interface KimiWireRuntimeOptions {
  readonly agentFile?: string;
  readonly configFile?: string;
  readonly mcpConfigFile?: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

export function createKimiWireRuntime(options: KimiWireRuntimeOptions = {}): AgentRuntime {
  return {
    id: "kimi-wire",
    priority: 90,

    supports(_capsule: ContextCapsule): boolean {
      return true;
    },

    async runNode(capsule: ContextCapsule, signal: AbortSignal): Promise<AgentRunResult> {
      const resources = await getOmkResourceSettings();
      const client = new KimiWireClient({
        agentFile: options.agentFile,
        configFile: options.configFile,
        mcpConfigFile: options.mcpConfigFile,
        cwd: options.cwd,
        env: options.env,
      });

      const stdout = new CappedOutputBuffer(resources.wireOutputBytes, "wire stdout");
      const stderr = new CappedOutputBuffer(resources.wireOutputBytes, "wire stderr");
      const startedAt = Date.now();

      try {
        await client.start();

        const offEvent = client.onEvent((event) => {
          if (signal.aborted) return;
          if (event.type === "message") {
            stdout.append(`${event.content}\n`);
          } else if (event.type === "error") {
            stderr.append(`${event.message}\n`);
          } else if (event.type === "tool_result") {
            stdout.append(`${JSON.stringify(event.output)}\n`);
          }
        });

        const promptParts: string[] = [
          capsule.system,
          capsule.task,
        ];

        if (capsule.dependencySummaries.length > 0) {
          promptParts.push(`\nDependency outputs:\n${capsule.dependencySummaries.join("\n---\n")}`);
        }
        if (capsule.evidenceRequirements.length > 0) {
          promptParts.push(`\nEvidence required:\n${capsule.evidenceRequirements.map((e) => `- ${e.gate}: ${e.ref ?? "(any)"}`).join("\n")}`);
        }
        if (capsule.relevantFiles.length > 0) {
          const fileSection = capsule.relevantFiles
            .map((f) => `### ${f.path}${f.startLine > 0 ? ` (lines ${f.startLine}-${f.endLine})` : ""}\n${f.content}`)
            .join("\n\n");
          promptParts.push(`\nRelevant files:\n${fileSection}`);
        }
        if (capsule.graphMemory.length > 0) {
          const memorySection = capsule.graphMemory
            .map((m) => `- [${m.kind}] ${m.subject} ${m.predicate} ${m.object} (confidence: ${m.confidence})`)
            .join('\n');
          promptParts.push(`\nProject knowledge:\n${memorySection}`);
        }
        if (capsule.priorAttempts.length > 0) {
          const attemptSection = capsule.priorAttempts
            .slice(-3)
            .map((a) => `- attempt ${a.attempt} (${a.provider}): ${a.status}${a.failureSummary ? ` — ${a.failureSummary.slice(0, 200)}` : ""}`)
            .join("\n");
          promptParts.push(`\nPrior attempts:\n${attemptSection}`);
        }

        const prompt = promptParts.filter(Boolean).join("\n\n");
        if (!prompt.trim()) {
          throw new Error("[omk] KimiWireRuntime refused to send an empty prompt to the wire client.");
        }

        const result = await client.prompt(prompt);
        offEvent();

        const durationMs = Date.now() - startedAt;
        const success = result.status === "finished" && !signal.aborted;

        return {
          success,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          metadata: {
            runtime: "kimi-wire",
            durationMs,
            capsuleTokens: capsule.budget.maxInputTokens,
          },
        };
      } catch (err) {
        stderr.append(`\n${String(err)}`);
        return {
          success: false,
          exitCode: 1,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          metadata: { runtime: "kimi-wire", error: String(err) },
        };
      } finally {
        await client.stop();
      }
    },
  };
}
