import type { ChatLayout, ChatBrand } from "./utils.js";
import { appendRecentChatOutput, isKimiPromptReadyLine, mergeTodos } from "./utils.js";
import { writeChatStartupFailureArtifact, printChatExitBanner } from "./startup.js";
import {
  queueChatStatePatch,
  updateChatHeartbeat as enqueueChatHeartbeat,
  updateChatActivity,
  finalizeChatState,
} from "../../util/chat-state.js";
import { parseSetTodoListFromOutput, readTodos, writeTodos, type TodoItem } from "../../util/todo-sync.js";
import { readSessionMeta, writeSessionMeta, createOmkSessionEnv } from "../../util/session.js";
import { runShell } from "../../util/shell.js";
import { injectKimiGlobals } from "../../util/fs.js";
import { runKimiInteractive } from "../../kimi/runner.js";
import { createDag, type DagNodeDefinition } from "../../orchestration/dag.js";
import { ParallelOrchestrator } from "../../orchestration/parallel-orchestrator.js";
import { LogStreamer } from "../../orchestration/log-streamer.js";
import { createRuntimeBackedTaskRunner } from "../../runtime/runtime-backed-task-runner.js";
import { createContextBroker } from "../../runtime/context-broker.js";
import { capsuleToTask } from "../../runtime/context-broker-converter.js";
import { createRuntimeRouter } from "../../runtime/runtime-router.js";
import type { DagNode } from "../../contracts/dag.js";
import { isCockpitChild } from "../../util/chat-cockpit.js";
import { status } from "../../util/theme.js";
import { join } from "path";

export interface ChatRuntimeInput {
  root: string;
  effectiveRunId: string;
  effectiveAgentFile: string;
  sessionId: string;
  layout: ChatLayout;
  brand: ChatBrand;
  currentMode: import("../../util/mode-preset.js").OmkMode;
  providerPolicy: string;
  modelArg: ReturnType<typeof import("../../providers/model-registry.js").parseProviderModelArg>;
  mcpScope: "all" | "project" | "none";
  effectiveResources: Awaited<ReturnType<typeof import("../../util/resource-profile.js").getOmkResourceSettings>>;
  effectiveWorkers: string;
  executionPrompt: string;
  chatRuntimeMcpAllowlist: string[] | undefined;
}

export function shouldUseDirectKimiFallback(
  providerPolicy: string | undefined,
  env: { OMK_LEGACY_CHAT?: string } = process.env
): boolean {
  const normalizedProviderPolicy = providerPolicy?.trim().toLowerCase() || "auto";
  return normalizedProviderPolicy === "kimi" || env.OMK_LEGACY_CHAT === "1";
}

export async function runChatRuntime(
  options: {
    agentFile?: string;
    runId?: string;
    workers?: string;
    maxStepsPerTurn?: string;
    layout?: ChatLayout;
    brand?: ChatBrand;
    mode?: string;
    execution?: string;
    provider?: string;
    model?: string;
    cockpitRefresh?: string;
    cockpitRedraw?: "diff" | "full" | "append";
    cockpitHistory?: "off" | "static" | "watch";
    cockpitSideWidth?: string;
    cockpitHeight?: string;
    mcpScope?: string;
    smoke?: boolean;
    json?: boolean;
  },
  input: ChatRuntimeInput
): Promise<number> {
  const {
    root,
    effectiveRunId,
    effectiveAgentFile,
    sessionId,
    layout,
    providerPolicy,
    modelArg,
    mcpScope,
    effectiveResources,
    effectiveWorkers,
    currentMode,
    chatRuntimeMcpAllowlist,
  } = input;

  const isPlain = layout === "plain";
  const directKimiFallbackEnabled = shouldUseDirectKimiFallback(providerPolicy);

  // ── Live heartbeat: keep state.json fresh while chat is active ──
  const HEARTBEAT_MS = 2000;
  const pendingUpdates = new Set<Promise<void>>();
  function track(p: Promise<void>): void {
    pendingUpdates.add(p);
    p.then(() => pendingUpdates.delete(p), () => pendingUpdates.delete(p));
  }
  const heartbeat = setInterval(() => {
    track(enqueueChatHeartbeat(effectiveRunId).catch(() => {}));
  }, HEARTBEAT_MS);

  const env = createOmkSessionEnv(root, sessionId);
  env.OMK_WORKERS = effectiveWorkers;
  if (providerPolicy && providerPolicy !== "auto" && providerPolicy !== "kimi") {
    env.OMK_PROVIDER_POLICY = providerPolicy;
    if (!isPlain && !isCockpitChild()) {
      console.log(
        status.warn(
          `Provider policy '${providerPolicy}' is active in chat mode. Note: omk chat runs the primary CLI natively; external providers work best with \`omk parallel\` or \`omk run\`.`
        )
      );
    }
  }
  if (modelArg.model) {
    env.OMK_PROVIDER_MODEL = modelArg.model;
  }

  env.OMK_RUN_ID = effectiveRunId;
  env.OMK_MODE = currentMode;
  env.OMK_MCP_SCOPE = mcpScope;
  env.OMK_SKILLS_SCOPE = effectiveResources.skillsScope;
  env.OMK_HOOKS_SCOPE = effectiveResources.hooksScope;

  // Inherit into AgentWorker subprocess / in-process env
  process.env.OMK_RUN_ID = effectiveRunId;
  process.env.OMK_MODE = currentMode;
  process.env.OMK_MCP_SCOPE = mcpScope;
  process.env.OMK_SKILLS_SCOPE = effectiveResources.skillsScope;
  process.env.OMK_HOOKS_SCOPE = effectiveResources.hooksScope;
  process.env.OMK_WORKERS = effectiveWorkers;

  let lastThinking = "";
  let exitCode = 0;
  let recentChatOutput = "";
  let observedKimiSessionId: string | undefined;
  let bridgeSucceeded = false;
  // Chunk-array buffer to avoid repeated large string copies during todo parsing
  const pendingChunks: string[] = [];
  let pendingLength = 0;

  // ── Debounced TODO sync ──
  let pendingTodoSync: Promise<void> | null = null;
  let todoSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let accumulatedTodos: TodoItem[] = [];

  function flushTodoSync(): void {
    if (todoSyncTimer) {
      clearTimeout(todoSyncTimer);
      todoSyncTimer = null;
    }
    if (accumulatedTodos.length === 0) return;
    const todosToSync = accumulatedTodos;
    accumulatedTodos = [];
    const p = (async () => {
      const existing = (await readTodos(effectiveRunId).catch(() => [] as TodoItem[])) ?? [];
      const merged = mergeTodos(existing, todosToSync);
      await writeTodos(effectiveRunId, merged);
      const doneCount = merged.filter((t) => t.status === "done").length;
      const now2 = new Date().toISOString();
      const meta = await readSessionMeta(effectiveRunId).catch(() => null);
      const startedAt = meta?.startedAt ?? now2;
      await writeSessionMeta(effectiveRunId, {
        runId: effectiveRunId,
        type: "chat",
        status: "active",
        startedAt,
        updatedAt: now2,
        todoCount: merged.length,
        todoDoneCount: doneCount,
      });
      // Mark real activity in state.json via the queued writer
      await queueChatStatePatch(effectiveRunId, { lastActivityAt: now2 });
    })().catch(() => {});
    track(p);
    pendingTodoSync = p;
  }

  function scheduleTodoSync(newTodos: TodoItem[]): void {
    accumulatedTodos = mergeTodos(accumulatedTodos, newTodos);
    if (todoSyncTimer) clearTimeout(todoSyncTimer);
    todoSyncTimer = setTimeout(flushTodoSync, 500); // 500ms debounce
  }

  try {
    if (providerPolicy === "kimi") {
      bridgeSucceeded = false;
    } else if (process.env.OMK_LEGACY_CHAT !== "1") {
      try {
        const chatNodeDef: DagNodeDefinition = {
          id: "chat",
          name: "Interactive chat session",
          role: "coordinator",
          dependsOn: [],
          maxRetries: 1,
          routing: {
            provider: providerPolicy,
            mcpServers: chatRuntimeMcpAllowlist,
            contextBudget: "normal",
            readOnly: false,
          },
          executionMode: "in-process",
        } as unknown as DagNodeDefinition;
        const dag = createDag({ nodes: [chatNodeDef] });
        const orchestrator = new ParallelOrchestrator({
          dag,
          runId: effectiveRunId,
          maxWorkers: 1,
          cwd: root,
        });

        // Suppress orchestrator console logging (output is streamed manually)
        (orchestrator as unknown as Record<string, unknown>).logStreamer = new LogStreamer({
          logDir: join(root, ".omk/logs"),
          enableConsole: false,
        });

        // Bypass orchestrator runtimeRouter intent check; actual routing happens inside AgentWorker
        (orchestrator as unknown as Record<string, unknown>).runtimeRouter = {
          select: () => ({
            runtime: {
              id: "omk-chat-bypass",
              priority: 100,
              supports: () => true,
              runNode: async () => ({ success: true, exitCode: 0, stdout: "", stderr: "" }),
            },
            reason: "chat-bypass",
            fallbacks: [],
            intent: "coding",
            scores: [],
          }),
        };

        const result = await orchestrator.execute();
        const chatWorker = result.state.workers.find((w) => w.nodeId === "chat");
        const taskResult = chatWorker?.result;

        if (taskResult) {
          const resultOutput = taskResult.stdout;
          const resultExitCode = taskResult.exitCode ?? (taskResult.success ? 0 : 1);

          // Stream output from AgentResult.output (via TaskResult.stdout)
          const CHUNK_SIZE = 4096;
          for (let i = 0; i < resultOutput.length; i += CHUNK_SIZE) {
            process.stdout.write(resultOutput.slice(i, i + CHUNK_SIZE));
            if (i + CHUNK_SIZE < resultOutput.length) {
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
          }
          recentChatOutput = appendRecentChatOutput(recentChatOutput, resultOutput);

          // Parse todos from metadata
          const agentTodos = taskResult.metadata?.todos as
            | Array<{ id: string; title: string; status: "pending" | "in_progress" | "done" }>
            | undefined;
          if (agentTodos && agentTodos.length > 0) {
            scheduleTodoSync(agentTodos.map((t) => ({ title: t.title, status: t.status })));
          }

          // Parse todos from output
          const parsedTodos = parseSetTodoListFromOutput(resultOutput);
          if (parsedTodos && parsedTodos.length > 0) {
            scheduleTodoSync(parsedTodos);
          }

          // Lightweight activity sampling
          const lines = resultOutput.split("\n");
          for (const raw of lines) {
            const line = raw.trim();
            if (isKimiPromptReadyLine(line)) {
              lastThinking = "";
              track(updateChatActivity(effectiveRunId, "").catch(() => {}));
              continue;
            }
            if (!line || line.length < 3) continue;
            if (/read_file|write_file|edit_file|search_files|glob|grep|ctx_read/i.test(line)) {
              const m = line.match(/["']([^"']{1,60})["']/);
              const rawTool = m ? `📄 ${m[1].split("/").pop() ?? m[1]}` : `🔧 ${line.slice(0, 60)}`;
              lastThinking = rawTool.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
              track(updateChatActivity(effectiveRunId, lastThinking).catch(() => {}));
              continue;
            }
            const explicit = line.match(/^<think(?:ing)?>[\s:]*(.+?)(?:<\/think(?:ing)?>)?$/i);
            if (explicit) {
              lastThinking = `🧠 ${explicit[1].trim().slice(0, 100)}`;
              track(updateChatActivity(effectiveRunId, lastThinking).catch(() => {}));
              continue;
            }
          }

          exitCode = resultExitCode;
          bridgeSucceeded = true;
        }
      } catch (orchestratorErr) {
        const message = orchestratorErr instanceof Error ? orchestratorErr.message : String(orchestratorErr);
        recentChatOutput = appendRecentChatOutput(recentChatOutput, `\n[omk] orchestrator failed: ${message}\n`);
        console.error(`\n[omk] orchestrator failed: ${message}\n`);
      }
    }

    if (!bridgeSucceeded && process.env.OMK_LEGACY_CHAT !== "1") {
      try {
        const chatNode: DagNode = {
          id: "chat",
          name: "Interactive chat session",
          role: "coordinator",
          dependsOn: [],
          status: "running",
          retries: 0,
          maxRetries: 1,
          routing: {
            provider: providerPolicy,
            mcpServers: chatRuntimeMcpAllowlist,
            contextBudget: "normal",
            readOnly: false,
          },
        };

        const runner = await createRuntimeBackedTaskRunner({ cwd: root, env });

        const broker = createContextBroker({ projectRoot: root });
        const { capsule } = await broker.buildCapsule(chatNode, {
          schemaVersion: 1,
          runId: effectiveRunId,
          nodes: [chatNode],
          startedAt: new Date().toISOString(),
        });
        await capsuleToTask(capsule);

        let resultOutput: string;
        let resultExitCode: number;

        const taskResult = await runner.run(chatNode, env);
        const isNoRuntimeAvailable = !taskResult.success && taskResult.stdout.trim() === "No runtime available";

        if (!isNoRuntimeAvailable) {
          resultOutput = taskResult.stdout;
          resultExitCode = taskResult.exitCode ?? (taskResult.success ? 0 : 1);
          const agentTodos = taskResult.metadata?.todos as
            | Array<{ id: string; title: string; status: "pending" | "in_progress" | "done" }>
            | undefined;
          if (agentTodos && agentTodos.length > 0) {
            scheduleTodoSync(agentTodos.map((t) => ({ title: t.title, status: t.status })));
          }
        } else {
          const runtimeRouter = (runner as unknown as Record<string, unknown>)._runtimeRouter as ReturnType<
            typeof createRuntimeRouter
          >;
          const agentResult = await runtimeRouter.runNode(capsule, new AbortController().signal);
          resultOutput = agentResult.stdout;
          resultExitCode = agentResult.exitCode ?? (agentResult.success ? 0 : 1);
        }

        // Stream output from AgentResult.output (via TaskResult.stdout or AgentRunResult.stdout)
        const CHUNK_SIZE = 4096;
        for (let i = 0; i < resultOutput.length; i += CHUNK_SIZE) {
          process.stdout.write(resultOutput.slice(i, i + CHUNK_SIZE));
          if (i + CHUNK_SIZE < resultOutput.length) {
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
        }
        recentChatOutput = appendRecentChatOutput(recentChatOutput, resultOutput);

        // Parse todos from output (and from AgentResult.todos when available)
        const parsedTodos = parseSetTodoListFromOutput(resultOutput);
        if (parsedTodos && parsedTodos.length > 0) {
          scheduleTodoSync(parsedTodos);
        }

        // Lightweight activity sampling
        const lines = resultOutput.split("\n");
        for (const raw of lines) {
          const line = raw.trim();
          if (isKimiPromptReadyLine(line)) {
            lastThinking = "";
            track(updateChatActivity(effectiveRunId, "").catch(() => {}));
            continue;
          }
          if (!line || line.length < 3) continue;
          if (/read_file|write_file|edit_file|search_files|glob|grep|ctx_read/i.test(line)) {
            const m = line.match(/["']([^"']{1,60})["']/);
            const rawTool = m ? `📄 ${m[1].split("/").pop() ?? m[1]}` : `🔧 ${line.slice(0, 60)}`;
            lastThinking = rawTool.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
            track(updateChatActivity(effectiveRunId, lastThinking).catch(() => {}));
            continue;
          }
          const explicit = line.match(/^<think(?:ing)?>[\s:]*(.+?)(?:<\/think(?:ing)?>)?$/i);
          if (explicit) {
            lastThinking = `🧠 ${explicit[1].trim().slice(0, 100)}`;
            track(updateChatActivity(effectiveRunId, lastThinking).catch(() => {}));
            continue;
          }
        }

        exitCode = resultExitCode;
        bridgeSucceeded = true;
      } catch (bridgeErr) {
        const message = bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr);
        recentChatOutput = appendRecentChatOutput(recentChatOutput, `\n[omk] runtime bridge failed: ${message}\n`);
        console.error(`\n[omk] runtime bridge failed: ${message}\n`);
      }
    }

    if ((!bridgeSucceeded && directKimiFallbackEnabled) || providerPolicy === "kimi") {
      const args: string[] = ["--agent-file", effectiveAgentFile];
      await injectKimiGlobals(args, {
        role: "coordinator",
        mcpScope,
        skillsScope: effectiveResources.skillsScope,
        hooksScope: effectiveResources.hooksScope,
        mcpAllowlist: chatRuntimeMcpAllowlist,
      });
      if (options.maxStepsPerTurn) {
        args.push("--max-steps-per-turn", options.maxStepsPerTurn);
      }
      if (options.model) {
        args.push("--model", options.model);
      }
      if (process.env.OMK_DEBUG === "1") {
        console.error("[OMK_DEBUG] chat args:", args);
      }

      exitCode = await runKimiInteractive(args, {
        cwd: root,
        env,
        onKimiMeta: (meta) => {
          const kimiSessionId = meta.session?.trim();
          if (!kimiSessionId || kimiSessionId === observedKimiSessionId) return;
          observedKimiSessionId = kimiSessionId;
          track(
            (async () => {
              const existing = await readSessionMeta(effectiveRunId).catch(() => null);
              const now = new Date().toISOString();
              await writeSessionMeta(effectiveRunId, {
                runId: effectiveRunId,
                type: "chat",
                status: existing?.status ?? "active",
                startedAt: existing?.startedAt ?? now,
                updatedAt: now,
                endedAt: existing?.endedAt,
                goalTitle: existing?.goalTitle,
                omkSessionId: sessionId,
                kimiSessionId,
                todoCount: existing?.todoCount ?? 0,
                todoDoneCount: existing?.todoDoneCount ?? 0,
              });
            })().catch(() => {})
          );
        },
        onData: (data) => {
          recentChatOutput = appendRecentChatOutput(recentChatOutput, data);
          // Lightweight activity sampling: extract short tool/thinking snippets
          const lines = data.split("\n");
          for (const raw of lines) {
            const line = raw.trim();
            if (isKimiPromptReadyLine(line)) {
              lastThinking = "";
              track(updateChatActivity(effectiveRunId, "").catch(() => {}));
              continue;
            }
            if (!line || line.length < 3) continue;
            if (/read_file|write_file|edit_file|search_files|glob|grep|ctx_read/i.test(line)) {
              const m = line.match(/["']([^"']{1,60})["']/);
              lastThinking = m ? `📄 ${m[1].split("/").pop() ?? m[1]}` : `🔧 ${line.slice(0, 60)}`;
              track(updateChatActivity(effectiveRunId, lastThinking).catch(() => {}));
              continue;
            }
            const explicit = line.match(/^<think(?:ing)?>[\s:]*(.+?)(?:<\/think(?:ing)?>)?$/i);
            if (explicit) {
              lastThinking = `🧠 ${explicit[1].trim().slice(0, 100)}`;
              track(updateChatActivity(effectiveRunId, lastThinking).catch(() => {}));
              continue;
            }
          }

          // Parse SetTodoList from output with chunk-boundary buffering
          pendingChunks.push(data);
          pendingLength += data.length;
          // Trim from front to keep last ~4096-8192 chars without massive string copies
          while (pendingLength > 8192 && pendingChunks.length > 1) {
            const removed = pendingChunks.shift()!;
            pendingLength -= removed.length;
          }
          if (pendingLength > 8192 && pendingChunks.length === 1) {
            pendingChunks[0] = pendingChunks[0].slice(-4096);
            pendingLength = pendingChunks[0].length;
          }
          const pendingOutput = pendingChunks.join("");
          const newTodos = parseSetTodoListFromOutput(pendingOutput);
          if (newTodos && newTodos.length > 0) {
            scheduleTodoSync(newTodos);
          }
        },
      });
    } else if (!bridgeSucceeded) {
      const message =
        `[omk] runtime bridge failed and direct Kimi fallback is disabled for provider policy '${providerPolicy || "auto"}'. ` +
        `Use --provider kimi or OMK_LEGACY_CHAT=1 to allow the legacy Kimi CLI fallback.`;
      recentChatOutput = appendRecentChatOutput(recentChatOutput, `\n${message}\n`);
      console.error(`\n${message}\n`);
      exitCode = 1;
    } else if (bridgeSucceeded && providerPolicy !== "kimi") {
      const { createInterface } = await import("readline");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      process.once("SIGINT", () => rl.close());
      for await (const input_ of rl) {
        const line = input_.trim();
        if (!line || line === "/exit" || line === "/quit") break;
        const turnNode: DagNodeDefinition = {
          id: "chat-turn", name: line, role: "coordinator", dependsOn: [], maxRetries: 1,
          routing: { provider: providerPolicy, mcpServers: chatRuntimeMcpAllowlist, contextBudget: "normal" as const, readOnly: false },
          executionMode: "in-process",
          inputs: [{ name: "prompt", ref: line, required: true }],
        } as unknown as DagNodeDefinition;
        const turnOrch = new ParallelOrchestrator({
          dag: createDag({ nodes: [turnNode] }),
          runId: effectiveRunId, maxWorkers: 1, cwd: root,
        });
        try {
          const turnResult = await turnOrch.execute();
          const w = turnResult.state.workers.find((d) => d.nodeId === "chat-turn");
          if (w?.result?.stdout) process.stdout.write(w.result.stdout);
        } catch {}
      }
      rl.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recentChatOutput = appendRecentChatOutput(recentChatOutput, `\n[omk] chat failed: ${message}\n`);
    console.error(`\n[omk] chat failed: ${message}\n`);
    exitCode = 1;
  } finally {
    clearInterval(heartbeat);
    flushTodoSync();
    if (pendingTodoSync) {
      pendingUpdates.add(pendingTodoSync);
    }
    await Promise.all(pendingUpdates);
    if (exitCode !== 0) {
      await writeChatStartupFailureArtifact({
        root,
        runId: effectiveRunId,
        exitCode,
        agentFile: effectiveAgentFile,
        recentOutput: recentChatOutput,
        resources: effectiveResources,
      }).catch(() => {});
    }
    await finalizeChatState(effectiveRunId, exitCode === 0);
    // Update session.json
    try {
      const meta = await readSessionMeta(effectiveRunId).catch(() => null);
      const now = new Date().toISOString();
      if (meta) {
        meta.status = exitCode === 0 ? "completed" : "failed";
        meta.endedAt = now;
        meta.updatedAt = now;
        meta.omkSessionId ??= sessionId;
        if (observedKimiSessionId) meta.kimiSessionId = observedKimiSessionId;
        await writeSessionMeta(effectiveRunId, meta);
      } else {
        await writeSessionMeta(effectiveRunId, {
          runId: effectiveRunId,
          type: "chat",
          status: exitCode === 0 ? "completed" : "failed",
          startedAt: now,
          updatedAt: now,
          omkSessionId: sessionId,
          kimiSessionId: observedKimiSessionId,
          todoCount: 0,
          todoDoneCount: 0,
        });
      }
    } catch {
      // ignore session finalize failures
    }
    await printChatExitBanner({
      runId: effectiveRunId,
      sessionId,
      kimiSessionId: observedKimiSessionId,
      workers: options.workers,
      root,
      mcpScope,
    });
    if (isCockpitChild()) {
      const sanitized = effectiveRunId.replace(/[^a-zA-Z0-9]/g, "-");
      const session = `omk-chat-${sanitized}`;
      await runShell("tmux", ["kill-session", "-t", session], { cwd: root, timeout: 5000 }).catch(() => {});
    }
  }

  return exitCode;
}
