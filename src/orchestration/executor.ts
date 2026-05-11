import type { Dag, DagNode } from "./dag.js";
import type { DagExecutor, RunOptions, RunProgressEstimate, RunResult, RunState, TaskRunner, TaskResult } from "../contracts/orchestration.js";
import { createScheduler } from "./scheduler.js";
import type { StatePersister } from "./state-persister.js";
import { createStatePersister } from "./state-persister.js";
import { createEnsembleTaskRunner, type EnsemblePolicy } from "./ensemble.js";
import { estimateRunProgress } from "./eta.js";
import { dagNodeRoutingEnv } from "./routing.js";
import { checkEvidenceGates } from "./evidence-gate.js";
import { invalidateTaskDagGraph } from "./task-graph.js";
import { resolveTimeoutMs } from "../util/timeout-config.js";
import { createNodeMonitorEngine } from "./node-monitor.js";
import type { DeepSeekModelTier, DeepSeekParticipation, ProviderId } from "../providers/types.js";

export interface ExecutorOptions {
  persister?: StatePersister;
  ensemble?: false | EnsemblePolicy;
  signal?: AbortSignal;
  resumeFromState?: RunState;
}

export function createExecutor(executorOptions: ExecutorOptions = {}): DagExecutor {
  const scheduler = createScheduler();
  const persister = executorOptions.persister ?? createStatePersister();
  const stateChangeHandlers: Array<(state: RunState) => void> = [];
  const nodeStartHandlers: Array<(node: DagNode) => void> = [];
  const nodeCompleteHandlers: Array<(node: DagNode, result: TaskResult) => void> = [];
  let commitQueue: Promise<void> = Promise.resolve();
  let commitQueueSize = 0;
  const MAX_COMMIT_QUEUE = 10;
  const activeTimers = new Map<string, { progress: ReturnType<typeof setInterval>; persist: ReturnType<typeof setInterval> }>();
  let aborting = false;

  const monitor = createNodeMonitorEngine({
    heartbeatIntervalMs: 30_000,
    stallThresholdMultiplier: 3,
    onStall: (m) => {
      process.stderr.write(`[omk] node ${m.nodeId} stalled (no heartbeat for ${m.stallThresholdMs}ms)\n`);
    },
  });

  function buildState(dag: Dag, options: RunOptions): RunState {
    const startedAt = new Date().toISOString();
    return {
      schemaVersion: 1,
      runId: options.runId,
      nodes: dag.nodes.map((n) => ({
        ...n,
        dependsOn: [...n.dependsOn],
        outputs: n.outputs ? n.outputs.map((o) => ({ ...o })) : undefined,
        routing: n.routing ? { ...n.routing } : undefined,
        failurePolicy: n.failurePolicy ? { ...n.failurePolicy } : undefined,
      })),
      startedAt,
      updatedAt: startedAt,
      lastActivityAt: startedAt,
      lastHeartbeatAt: startedAt,
      activitySeq: 0,
      estimate: estimateRunProgress({
        nodes: dag.nodes,
        startedAt,
        workerCount: options.workers,
      }),
    };
  }

  function refreshState(state: RunState, dag: Dag, options: RunOptions): void {
    state.nodes = dag.nodes.map((n) => ({
      ...n,
      dependsOn: [...n.dependsOn],
      outputs: n.outputs ? n.outputs.map((o) => ({ ...o })) : undefined,
      routing: n.routing ? { ...n.routing } : undefined,
      failurePolicy: n.failurePolicy ? { ...n.failurePolicy } : undefined,
      attempts: n.attempts?.map((attempt) => ({ ...attempt })),
    }));
    state.estimate = estimateRunProgress({
      nodes: dag.nodes,
      startedAt: state.startedAt,
      workerCount: options.workers,
    });
    state.updatedAt = new Date().toISOString();
  }

  function bumpActivity(state: RunState): void {
    const now = new Date().toISOString();
    state.lastActivityAt = now;
    state.lastHeartbeatAt = now;
    state.activitySeq = (state.activitySeq ?? 0) + 1;
  }

  function cloneState(state: RunState): RunState {
    return {
      ...state,
      nodes: state.nodes.map((n) => ({
        ...n,
        dependsOn: [...n.dependsOn],
        outputs: n.outputs ? n.outputs.map((o) => ({ ...o })) : undefined,
        routing: n.routing ? { ...n.routing } : undefined,
        failurePolicy: n.failurePolicy ? { ...n.failurePolicy } : undefined,
        attempts: n.attempts?.map((attempt) => ({ ...attempt })),
      })),
      estimate: state.estimate ? { ...state.estimate } : undefined,
    };
  }

  let latestSnapshot: RunState | undefined;

  async function commitState(state: RunState, opts?: { mustPersist?: boolean }): Promise<void> {
    latestSnapshot = cloneState(state);
    // Coalesce: skip intermediate snapshots when queue is full,
    // but always persist final/must-persist snapshots.
    if (!opts?.mustPersist && commitQueueSize >= MAX_COMMIT_QUEUE) {
      return;
    }
    commitQueueSize++;
    const snap = latestSnapshot;
    commitQueue = commitQueue
      .then(async () => {
        commitQueueSize--;
        await persister.save(snap);
      })
      .catch((err: unknown) => {
        commitQueueSize--;
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[omk] state persist warning: ${message}
`);
      });
    // Only await when mustPersist (caller needs durability guarantee)
    if (opts?.mustPersist) await commitQueue;
  }

  function emit(state: RunState): void {
    for (const h of stateChangeHandlers) {
      try {
        h(state);
      } catch {
        // ignore handler errors
      }
    }
  }

  function markNodeStarted(node: DagNode): void {
    const startedAt = new Date().toISOString();
    const attemptNumber = node.retries + 1;
    node.startedAt = startedAt;
    node.completedAt = undefined;
    node.durationMs = undefined;
    const attempts = node.attempts ?? [];
    attempts.push({ attempt: attemptNumber, startedAt });
    node.attempts = attempts;
  }

  function markNodeFinished(node: DagNode, status: "done" | "failed"): void {
    const completedAt = new Date().toISOString();
    const startedAtMs = node.startedAt ? Date.parse(node.startedAt) : Date.parse(completedAt);
    const completedAtMs = Date.parse(completedAt);
    const durationMs = Math.max(0, completedAtMs - startedAtMs);
    const latestAttempt = node.attempts?.[node.attempts.length - 1];

    if (latestAttempt) {
      latestAttempt.completedAt = completedAt;
      latestAttempt.durationMs = durationMs;
      latestAttempt.status = status;
    }

    if (status === "done") {
      node.completedAt = completedAt;
      node.durationMs = durationMs;
    }
  }

  function recordProviderAttempt(node: DagNode, result: TaskResult): void {
    const latestAttempt = node.attempts?.[node.attempts.length - 1];
    if (!latestAttempt) return;
    const metadata = result.metadata ?? {};
    const provider = metadata.provider;
    const requestedProvider = metadata.requestedProvider;
    if (isProviderId(provider)) latestAttempt.provider = provider;
    if (isProviderId(requestedProvider)) latestAttempt.requestedProvider = requestedProvider;
    if (typeof metadata.providerModel === "string") latestAttempt.providerModel = metadata.providerModel;
    if (isDeepSeekModelTier(metadata.providerModelTier)) latestAttempt.providerModelTier = metadata.providerModelTier;
    if (isDeepSeekParticipation(metadata.providerParticipation)) {
      latestAttempt.providerParticipation = metadata.providerParticipation;
    }

    const fallback = metadata.providerFallback;
    if (isProviderFallback(fallback)) {
      latestAttempt.fallbackFrom = fallback.from;
      latestAttempt.fallbackReason = fallback.reason;
    }
  }

  function etaEnv(estimate: RunProgressEstimate | undefined): Record<string, string> {
    if (!estimate) return {};
    return {
      OMK_ETA_REMAINING_MS: String(estimate.estimatedRemainingMs ?? 0),
      OMK_ETA_COMPLETED_AT: estimate.estimatedCompletedAt ?? "",
      OMK_ETA_CONFIDENCE: estimate.confidence,
      OMK_PROGRESS_PERCENT: String(estimate.percentComplete),
      OMK_PROGRESS_NODES: `${estimate.completedNodes}/${estimate.totalNodes}`,
    };
  }

  function emitNodeStart(node: DagNode): void {
    for (const h of nodeStartHandlers) {
      try { h(node); } catch { /* ignore */ }
    }
  }

  function emitNodeComplete(node: DagNode, result: TaskResult): void {
    for (const h of nodeCompleteHandlers) {
      try { h(node, result); } catch { /* ignore */ }
    }
  }

  async function checkNodeEvidence(
    node: DagNode,
    result: TaskResult,
    options: RunOptions
  ): Promise<{ passed: boolean; evidence: import("./dag.js").DagNodeEvidence[] }> {
    const gates: import("./evidence-gate.js").EvidenceGate[] = [];

    for (const output of node.outputs ?? []) {
      switch (output.gate) {
        case "file-exists":
          if (output.ref) gates.push({ type: "file-exists", path: output.ref });
          break;
        case "test-pass":
          gates.push({ type: "command-pass", command: output.ref ?? "npm test" });
          break;
        case "command-pass":
          gates.push({ type: "command-pass", command: output.ref ?? "" });
          break;
        case "review-pass":
        case "summary":
          gates.push({ type: "summary-present", summaryMarker: output.ref ?? "## Summary" });
          break;
        case "none":
        default:
          break;
      }
    }

    const hasCommandGate = (node.outputs ?? []).some(
      (o) => o.gate === "command-pass" || o.gate === "test-pass"
    );
    if (node.routing?.evidenceRequired && !hasCommandGate) {
      gates.push({ type: "summary-present", summaryMarker: "## Evidence" });
    }

    if (gates.length === 0) {
      return { passed: true, evidence: [] };
    }

    const latestAttempt = node.attempts?.[node.attempts.length - 1];
    const attemptId = latestAttempt ? `${node.id}__${latestAttempt.attempt}` : `${node.id}__1`;

    return checkEvidenceGates(gates, {
      cwd: options.worktreeRoot ?? process.cwd(),
      stdout: result.stdout,
      nodeId: node.id,
      runId: options.runId,
      attemptId,
    });
  }

  async function runNode(
    node: DagNode,
    dag: Dag,
    runner: TaskRunner,
    options: RunOptions,
    state: RunState
  ): Promise<void> {
    scheduler.updateNodeStatus(dag, node.id, "running", options.runId);
    markNodeStarted(node);
    refreshState(state, dag, options);
    await commitState(state);
    emitNodeStart(node);

    const env: Record<string, string> = {
      OMK_NODE_ID: node.id,
      OMK_RUN_ID: options.runId,
      OMK_ROLE: node.role,
      ...dagNodeRoutingEnv(node),
      ...etaEnv(state.estimate),
    };

    let result: TaskResult;
    node.thinking = undefined;

    // Use fork() if available for parallel-safe isolated thinking callbacks.
    const nodeRunner = runner.fork
      ? runner.fork((thinking: string) => {
          node.thinking = thinking;
        })
      : {
          ...runner,
          onThinking: (thinking: string) => {
            node.thinking = thinking;
          },
          run: runner.run.bind(runner),
        };

    // Sync thinking back to state.nodes periodically so the live UI
    // can show ensemble / runner progress while the node is running.
    const progressTimer = setInterval(() => {
      if (node.status !== "running") return;
      const stateNode = state.nodes.find((sn) => sn.id === node.id);
      if (stateNode) stateNode.thinking = node.thinking;
      bumpActivity(state);
      emit(cloneState(state));
    }, 500);

    // Persist live activity to disk less frequently to avoid I/O thrash.
    const persistTimer = setInterval(() => {
      void commitState(state);
    }, 2000);

    activeTimers.set(node.id, { progress: progressTimer, persist: persistTimer });

    monitor.register(node.id, options.runId);
    const heartbeatTimer = setInterval(() => {
      if (node.status === "running") {
        monitor.heartbeat(node.id, options.runId);
        state.lastHeartbeatAt = new Date().toISOString();
      }
    }, 30_000);

    try {
      const timeoutPreset = node.timeoutPreset ?? options.timeoutPreset;
      const nodeTimeoutMs = await resolveTimeoutMs({
        timeoutMs: node.timeoutMs ?? (timeoutPreset ? undefined : options.nodeTimeoutMs),
        timeoutPreset,
      });
      const runPromise = nodeRunner.run(node, env);
      if (nodeTimeoutMs > 0) {
        let timeoutHandle: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(`Node ${node.id} timed out after ${nodeTimeoutMs}ms`)), nodeTimeoutMs);
        });
        result = await Promise.race([runPromise, timeoutPromise]);
        clearTimeout(timeoutHandle!);
      } else {
        result = await runPromise;
      }
      recordProviderAttempt(node, result);
      if (result.success) {
        const evidenceCheck = await checkNodeEvidence(node, result, options);
        node.evidence = evidenceCheck.evidence;
        if (evidenceCheck.passed) {
          markNodeFinished(node, "done");
          scheduler.updateNodeStatus(dag, node.id, "done", options.runId);
        } else {
          markNodeFinished(node, "failed");
          scheduler.updateNodeStatus(dag, node.id, "failed", options.runId);
        }
      } else {
        markNodeFinished(node, "failed");
        scheduler.updateNodeStatus(dag, node.id, "failed", options.runId);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result = {
        success: false,
        exitCode: 1,
        stdout: `[ERROR] ${errorMessage}`,
        stderr: errorMessage,
      };
      recordProviderAttempt(node, result);
      markNodeFinished(node, "failed");
      scheduler.updateNodeStatus(dag, node.id, "failed", options.runId);
    } finally {
      clearInterval(progressTimer);
      clearInterval(persistTimer);
      clearInterval(heartbeatTimer);
      monitor.unregister(node.id, options.runId);
      activeTimers.delete(node.id);
      const stateNode = state.nodes.find((sn) => sn.id === node.id);
      if (stateNode) stateNode.thinking = node.thinking;
      bumpActivity(state);
    }

    if (aborting) {
      // Skip final emit/persist so the abort state is not overwritten
      // by a late-finishing node after execute() has already returned.
      return;
    }

    emitNodeComplete(node, result);
    refreshState(state, dag, options);
    await commitState(state);
  }

  return {
    onStateChange(handler: (state: RunState) => void): () => void {
      stateChangeHandlers.push(handler);
      return () => {
        const idx = stateChangeHandlers.indexOf(handler);
        if (idx !== -1) stateChangeHandlers.splice(idx, 1);
      };
    },

    onNodeStart(handler: (node: DagNode) => void): () => void {
      nodeStartHandlers.push(handler);
      return () => {
        const idx = nodeStartHandlers.indexOf(handler);
        if (idx !== -1) nodeStartHandlers.splice(idx, 1);
      };
    },

    onNodeComplete(handler: (node: DagNode, result: TaskResult) => void): () => void {
      nodeCompleteHandlers.push(handler);
      return () => {
        const idx = nodeCompleteHandlers.indexOf(handler);
        if (idx !== -1) nodeCompleteHandlers.splice(idx, 1);
      };
    },

    async execute(dag: Dag, runner: TaskRunner, options: RunOptions): Promise<RunResult> {
      if (!Number.isInteger(options.workers) || options.workers < 1) {
        throw new TypeError(`options.workers must be a positive integer, got ${options.workers}`);
      }
      const effectiveRunner = executorOptions.ensemble === false
        ? runner
        : createEnsembleTaskRunner(runner, executorOptions.ensemble ?? {});

      let state: RunState;
      if (executorOptions.resumeFromState) {
        state = cloneState(executorOptions.resumeFromState);
        const stateNodeById = new Map(state.nodes.map((n) => [n.id, n]));
        for (const node of dag.nodes) {
          const saved = stateNodeById.get(node.id);
          if (saved) {
            // Do not restore non-terminal running state; reset to pending so
            // the scheduler can re-dispatch it. Only preserve terminal states.
            node.status = saved.status === "running" ? "pending" : saved.status;
            node.retries = saved.retries;
            node.startedAt = saved.startedAt;
            node.completedAt = saved.completedAt;
            node.durationMs = saved.durationMs;
            node.attempts = saved.attempts?.map((a) => ({ ...a }));
            node.evidence = saved.evidence?.map((e) => ({ ...e }));
            node.blockedReason = saved.blockedReason;
          }
        }
      } else {
        state = buildState(dag, options);
      }
      await commitState(state);

      const runningMap = new Map<string, Promise<void>>();
      let resolveDone: (value: RunResult) => void;
      const donePromise = new Promise<RunResult>((resolve) => {
        resolveDone = resolve;
      });
      let settled = false;
      function resolveOnce(result: RunResult): void {
        if (settled) return;
        settled = true;
        resolveDone(result);
      }

      const fallbackNodes = new Map<string, DagNode>();

      async function tick(): Promise<void> {
        if (settled) return;
        // Handle fallback nodes FIRST, before isFailed check, so that a
        // terminal failure with a fallbackRole does not immediately fail the run.
        let fallbackCreated = false;
        for (const node of dag.nodes) {
          if (node.status === "failed" && node.retries >= node.maxRetries && node.failurePolicy?.fallbackRole && !fallbackNodes.has(node.id)) {
            let fallbackId = `${node.id}--fallback`;
            let fallbackCounter = 1;
            while (dag.nodes.some((n) => n.id === fallbackId)) {
              fallbackId = `${node.id}--fallback-${fallbackCounter++}`;
            }
            const fallbackNode: DagNode = {
              id: fallbackId,
              name: `${node.name} (fallback)`,
              role: node.failurePolicy.fallbackRole,
              dependsOn: [...node.dependsOn],
              status: "pending",
              retries: 0,
              maxRetries: 1,
              timeoutMs: node.timeoutMs,
              timeoutPreset: node.timeoutPreset,
              priority: node.priority,
              cost: node.cost,
              inputs: node.inputs?.map((input) => ({ ...input })),
              outputs: node.outputs?.map((output) => ({ ...output })),
              routing: node.routing ? { ...node.routing } : undefined,
              failurePolicy: { retryable: false, blockDependents: true },
            };
            dag.nodes.push(fallbackNode);
            fallbackNodes.set(node.id, fallbackNode);
            state.nodes.push({ ...fallbackNode });
            // Mark original node as skipped so dependents can proceed via fallback
            node.status = "skipped";
            node.blockedReason = `fallback created: ${fallbackId}`;
            invalidateTaskDagGraph(dag);
            // Redirect dependents from original node to fallback node
            for (const dep of dag.nodes) {
              if (dep.dependsOn.includes(node.id)) {
                if (dep.status === "blocked") {
                  dep.status = "pending";
                  dep.blockedReason = undefined;
                }
                dep.dependsOn = dep.dependsOn.filter((id) => id !== node.id);
                if (!dep.dependsOn.includes(fallbackId)) {
                  dep.dependsOn.push(fallbackId);
                }
              }
            }
            fallbackCreated = true;
          }
        }
        if (fallbackCreated) {
          refreshState(state, dag, options);
          await commitState(state);
          tick().catch(() => {});
          return;
        }

        if (executorOptions.signal?.aborted) {
          aborting = true;
          for (const [, timers] of activeTimers) {
            clearInterval(timers.progress);
            clearInterval(timers.persist);
          }
          activeTimers.clear();
          for (const node of dag.nodes) {
            if (node.status === "running" || node.status === "pending") {
              node.status = "blocked";
              node.blockedReason = "cancelled";
            }
          }
          state.completedAt = new Date().toISOString();
          refreshState(state, dag, options);
          await commitState(state, { mustPersist: true });
          monitor.dispose();
          resolveOnce({ state, success: false });
          return;
        }

        if (runningMap.size === 0 && scheduler.isComplete(dag)) {
          state.completedAt = new Date().toISOString();
          refreshState(state, dag, options);
          await commitState(state, { mustPersist: true });
          monitor.dispose();
          resolveOnce({ state, success: true });
          return;
        }

        if (runningMap.size === 0 && scheduler.isFailed(dag)) {
          state.completedAt = new Date().toISOString();
          refreshState(state, dag, options);
          await commitState(state, { mustPersist: true });
          monitor.dispose();
          resolveOnce({ state, success: false });
          return;
        }

        if (scheduler.isFailed(dag)) return;

        const runnable = scheduler.getRunnableNodes(dag);
        const availableSlots = Math.max(0, options.workers - runningMap.size);
        const toRun = runnable
          .filter((node) => !runningMap.has(node.id) && !fallbackNodes.has(node.id))
          .slice(0, availableSlots);

        for (const node of toRun) {
          const promise = runNode(node, dag, effectiveRunner, options, state)
            .catch(() => {
              // runNode already marks node as failed on runner errors;
              // swallow persist/emit errors to allow tick() to continue
            })
            .finally(() => {
              runningMap.delete(node.id);
              tick().catch(() => {});
            });
          runningMap.set(node.id, promise);
        }

        if (runningMap.size === 0 && toRun.length === 0 && runnable.length === 0) {
          // Deadlock or nothing to do — treat as failure
          state.completedAt = new Date().toISOString();
          refreshState(state, dag, options);
          await commitState(state, { mustPersist: true });
          monitor.dispose();
          resolveOnce({ state, success: false });
        }
      }

      tick().catch(() => {});
      return donePromise;
    },
  };
}

function isProviderId(value: unknown): value is ProviderId {
  return value === "kimi" || value === "deepseek";
}

function isDeepSeekModelTier(value: unknown): value is DeepSeekModelTier {
  return value === "flash" || value === "pro";
}

function isDeepSeekParticipation(value: unknown): value is DeepSeekParticipation {
  return value === "direct" || value === "advisory";
}

function isProviderFallback(value: unknown): value is { from: ProviderId; reason: string } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isProviderId(record.from) && typeof record.reason === "string";
}
