/**
 * EnhancedParallelOrchestrator — think, mcp, skills, variant 모드 병렬 오케스트레이터
 *
 * 단일모델 DAG subagents 알고리즘 고도화:
 *  - think:  각 서브에이전트가 CoT 추론 트레이스를 남김
 *  - mcp:    MCP 서버를 live 바인딩하여 노드에 주입
 *  - skills: 스킬 자동 할당 + 사용 증거 트래킹
 *  - variant: 동일 작업 여러 variant 실행 → ensemble/best-score 선택
 */

import { join } from "path";
import type { Dag, DagNode } from "./dag.js";
import type { RunCapabilityAssignment } from "../contracts/orchestration.js";
import {
  createExecutionPlan,
  formatExecutionPlan,
  getNextExecutableBatch,
  type ExecutionPlan,
} from "./execution-planner.js";
import {
  OrchestrationStateManager,
  type OrchestrationEvent,
  type WorkerState,
} from "./orchestration-state.js";
import { LogStreamer, type LogEntry, type WorkerLogHandle } from "./log-streamer.js";
import { AgentWorker, createAgentWorker, type WorkerOutput } from "./agent-worker.js";
import { createRuntimeRouter } from "../runtime/runtime-router.js";
import type { ContextCapsule } from "../runtime/context-capsule.js";
import {
  buildCapabilityInjection,
  applyCapabilityInjectionToRouting,
} from "../runtime/capability-injection.js";
import {
  capabilityScopesFromRouting,
  mergeCapabilityScopes,
  type NodeCapabilityScopes,
} from "./capability-routing.js";
import { assignSkills } from "./skill-assigner.js";
import { dagNodeRoutingEnv } from "./routing.js";
import { buildTaskRunContext, envFromWorkerManifest } from "../runtime/worker-manifest.js";
import type { TaskRunContext, WorkerManifest } from "../contracts/worker-context.js";
import { checkEvidenceGates, type EvidenceGate } from "./evidence-gate.js";
import {
  type EnhancedMode,
  type EnhancedModeConfig,
  type ThinkingSession,
  type ThinkingTrace,
  type SkillEvidence,
  type NodeVariant,
  type VariantResult,
  type VariantSelection,
  type ModeRoutingInjection,
  DEFAULT_ENHANCED_CONFIG,
  createThinkingSession,
  addThinkingTrace,
  createSkillEvidence,
  createNodeVariants,
  selectBestVariant,
  buildModeRoutingInjection,
} from "./enhanced-modes.js";

function formatWorkerError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

// ─── exported interfaces ────────────────────────────────────────────────────

export interface EnhancedOrchestratorOptions {
  dag: Dag;
  runId: string;
  goalId?: string;
  objective?: string;
  maxWorkers: number;
  cwd?: string;
  timeout?: number;
  /** Enhanced mode config (think, mcp, skills, variant) */
  modeConfig?: Partial<EnhancedModeConfig>;
  onProgress?: (state: EnhancedOrchestrationState) => void;
  onLog?: (entry: LogEntry) => void;
  onThinking?: (trace: ThinkingTrace) => void;
}

export interface EnhancedOrchestrationState {
  runId: string;
  status: "initializing" | "running" | "paused" | "completed" | "failed" | "cancelled";
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
  workers: WorkerState[];
  nodeRuntimes?: Record<string, string>;
  thinkingSessions?: Record<string, ThinkingSession>;
  skillEvidences?: SkillEvidence[];
  variantResults?: Record<string, VariantSelection>;
  startedAt: string;
  completedAt?: string;
  error?: string;
  activeModes: readonly EnhancedMode[];
}

export interface EnhancedOrchestrationResult {
  success: boolean;
  state: EnhancedOrchestrationState;
  executionPlan: ExecutionPlan;
  events: OrchestrationEvent[];
  /** All thinking traces collected across all nodes */
  thinkingTraces: ThinkingTrace[];
  /** All skill evidences */
  skillEvidences: SkillEvidence[];
  /** Variant selections per node */
  variantSelections: Record<string, VariantSelection>;
  error?: string;
}

// ─── 워커 capability context ───────────────────────────────────────────────

export interface EnhancedWorkerCapabilityContext {
  readonly node: DagNode;
  readonly scopes: NodeCapabilityScopes;
  readonly assignment: RunCapabilityAssignment;
  readonly env: Record<string, string>;
  readonly workerManifest: WorkerManifest;
  readonly runContext: TaskRunContext;
  readonly modeInjection: ModeRoutingInjection;
}

export function buildEnhancedWorkerCapabilityContext(
  node: DagNode,
  modeConfig: EnhancedModeConfig,
  dag?: Dag,
  options: {
    readonly runId?: string;
    readonly root?: string;
    readonly goalId?: string;
    readonly objective?: string;
  } = {},
): EnhancedWorkerCapabilityContext {
  const assigned = assignSkills(node);
  const scopes = mergeCapabilityScopes(
    assigned,
    capabilityScopesFromRouting(node.routing),
  );

  const modeInjection = buildModeRoutingInjection(
    node,
    modeConfig,
    [...scopes.skills],
    [...scopes.mcpServers],
    [...scopes.hooks],
    [...scopes.tools],
  );

  const injection = buildCapabilityInjection({
    mcpServers: modeInjection.mcpServers,
    skills: modeInjection.skills,
    tools: modeInjection.tools,
    hooks: modeInjection.hooks,
    requireMcp: modeInjection.requiresMcp,
    requiresToolCalling: modeInjection.requiresToolCalling,
  });

  const routedNode: DagNode = {
    ...node,
    routing: applyCapabilityInjectionToRouting(node.routing ?? {}, injection),
  };

  const runContext = buildTaskRunContext({
    runId: options.runId ?? "enhanced-parallel",
    ...(options.goalId ? { goalId: options.goalId } : {}),
    root: options.root ?? process.cwd(),
    node: routedNode,
    objective: options.objective ?? routedNode.name,
    toolPlane: {
      mcpServers: modeInjection.mcpServers,
      skills: modeInjection.skills,
      hooks: modeInjection.hooks,
      tools: modeInjection.tools,
      requiresRuntimeMcp: modeInjection.requiresMcp,
    },
  });

  return {
    node: routedNode,
    scopes,
    assignment: {
      skills: [...scopes.skills],
      mcpServers: [...scopes.mcpServers],
      hooks: [...scopes.hooks],
      ...(scopes.tools.length > 0 ? { tools: [...scopes.tools] } : {}),
      source: "enhanced-skill-assigner",
      rationale: `${injection.summary.rationale} | modeInjection: ${modeConfig.modes.join(",")}`,
    },
    env: {
      ...dagNodeRoutingEnv(routedNode, dag),
      OMK_NODE_CAPABILITY_SUMMARY: injection.summary.rationale,
      ...(modeInjection.reasoningPrompt
        ? { OMK_REASONING_PROMPT: modeInjection.reasoningPrompt }
        : {}),
    },
    workerManifest: runContext.worker,
    runContext,
    modeInjection,
  };
}

// ─── Enhanced Parallel Orchestrator ─────────────────────────────────────────

export class EnhancedParallelOrchestrator {
  private dag: Dag;
  private runId: string;
  private goalId?: string;
  private objective?: string;
  private maxWorkers: number;
  private cwd: string;
  private timeout: number;
  private modeConfig: EnhancedModeConfig;
  private executionPlan: ExecutionPlan;
  private stateManager: OrchestrationStateManager;
  private logStreamer: LogStreamer;
  private activeWorkers: Map<string, AgentWorker> = new Map();
  private completedNodes: Set<string> = new Set();
  private failedNodes: Set<string> = new Set();
  private nodeRuntimeMap: Map<string, string> = new Map();

  // Enhanced state
  private thinkingSessions: Map<string, ThinkingSession> = new Map();
  private skillEvidences: SkillEvidence[] = [];
  private variantSelections: Record<string, VariantSelection> = {};
  private allThinkingTraces: ThinkingTrace[] = [];
  private nodeVariants: Map<string, NodeVariant[]> = new Map();

  private onProgress?: (state: EnhancedOrchestrationState) => void;
  private onLog?: (entry: LogEntry) => void;
  private onThinking?: (trace: ThinkingTrace) => void;
  private abortController: AbortController | null = null;
  private runtimeRouter: ReturnType<typeof createRuntimeRouter>;
  private adaptiveMaxWorkers: number;
  private consecutiveFailures: number = 0;

  constructor(options: EnhancedOrchestratorOptions) {
    this.dag = options.dag;
    this.runId = options.runId;
    this.goalId = options.goalId;
    this.objective = options.objective;
    this.maxWorkers = options.maxWorkers;
    this.cwd = options.cwd ?? process.cwd();
    this.timeout = options.timeout ?? 600000;
    this.modeConfig = { ...DEFAULT_ENHANCED_CONFIG, ...options.modeConfig };
    this.onProgress = options.onProgress;
    this.onLog = options.onLog;
    this.onThinking = options.onThinking;

    this.executionPlan = createExecutionPlan({
      dag: this.dag.nodes,
      maxWorkers: this.maxWorkers,
    });

    this.stateManager = new OrchestrationStateManager({
      runId: this.runId,
      nodes: this.dag.nodes,
      workerCount: this.maxWorkers,
      basePath: this.cwd,
    });

    this.logStreamer = new LogStreamer({
      logDir: join(this.cwd, ".omk/logs"),
    });
    if (this.onLog) {
      this.logStreamer.onLog(this.onLog);
    }

    this.runtimeRouter = createRuntimeRouter();
    this.adaptiveMaxWorkers = options.maxWorkers;
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  async execute(): Promise<EnhancedOrchestrationResult> {
    this.abortController = new AbortController();

    try {
      await this.initialize();
      this.stateManager.setStatus("running");
      this.emitProgress();

      this.logStreamer.log(
        "info",
        `Enhanced modes active: ${this.modeConfig.modes.join(", ")}`,
      );
      this.logStreamer.log(
        "info",
        `Execution plan:\n${formatExecutionPlan(this.executionPlan)}`,
      );

      await this.executeLoop();

      const success = this.verifyCompletion();
      this.stateManager.setStatus(success ? "completed" : "failed");
      this.stateManager.setCompletedAt(new Date().toISOString());

      return this.createResult(success);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logStreamer.log("error", `Enhanced orchestration failed: ${message}`);
      this.stateManager.setStatus("failed");
      this.stateManager.setError(message);
      return this.createResult(false, message);
    } finally {
      await this.cleanup();
    }
  }

  async abort(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }
    for (const [nodeId, worker] of this.activeWorkers.entries()) {
      this.logStreamer.log("warn", `Aborting worker: ${nodeId}`);
      worker.abort();
    }
    this.stateManager.setStatus("cancelled");
    this.logStreamer.log("warn", "Enhanced orchestration aborted");
  }

  // ─── Initialization ────────────────────────────────────────────────────

  private async initialize(): Promise<void> {
    this.logStreamer.log("info", "Initializing enhanced orchestrator...");
    this.logStreamer.log(
      "info",
      `Modes: think=${this.modeConfig.modes.includes("think")}, mcp=${this.modeConfig.modes.includes("mcp")}, skills=${this.modeConfig.modes.includes("skills")}, variant=${this.modeConfig.modes.includes("variant")}`,
    );

    this.stateManager.initialize();
    await this.logStreamer.initialize();

    for (const node of this.dag.nodes) {
      this.stateManager.initializeWorker(node.id, node.maxRetries ?? 3);

      // variant 모드: 노드별 variant 생성
      if (this.modeConfig.modes.includes("variant")) {
        const variants = createNodeVariants(
          node,
          this.modeConfig.variantCount,
          this.modeConfig,
        );
        this.nodeVariants.set(node.id, variants);
        this.logStreamer.log(
          "info",
          `Node ${node.id}: ${variants.length} variant(s) created`,
        );
      }
    }

    this.logStreamer.log(
      "info",
      `Initialized ${this.dag.nodes.length} workers with enhanced modes`,
    );
  }

  // ─── Execution Loop ────────────────────────────────────────────────────

  private async executeLoop(): Promise<void> {
    while (!this.isComplete() && !this.isAborted()) {
      const batch = getNextExecutableBatch(this.executionPlan, this.completedNodes, this.terminalNodes());

      if (!batch) {
        if (this.activeWorkers.size === 0) {
          this.logStreamer.log("error", "No executable nodes remain; stopping enhanced orchestration to avoid a stalled run");
          break;
        }
        await this.waitForCompletion();
        continue;
      }

      await this.executeEnhancedBatch(batch);
      this.emitProgress();

      if (this.isComplete()) break;
      await this.sleep(100);
    }
  }

  private async executeEnhancedBatch(batch: DagNode[]): Promise<void> {
    // Adaptive pool sizing
    if (this.consecutiveFailures >= 3 && this.adaptiveMaxWorkers > 1) {
      this.adaptiveMaxWorkers = Math.max(1, this.adaptiveMaxWorkers - 1);
      this.logStreamer.log("warn", `Reducing worker pool to ${this.adaptiveMaxWorkers}`);
    }
    if (this.consecutiveFailures === 0 && this.adaptiveMaxWorkers < this.maxWorkers) {
      this.adaptiveMaxWorkers++;
      this.logStreamer.log("info", `Increasing worker pool to ${this.adaptiveMaxWorkers}`);
    }

    const cappedBatch = batch.slice(0, this.adaptiveMaxWorkers);
    this.logStreamer.log(
      "info",
      `Executing enhanced batch: ${cappedBatch.map((n) => n.id).join(", ")}`,
    );

    const workerPromises = cappedBatch.map((node) =>
      this.modeConfig.modes.includes("variant")
        ? this.executeNodeWithVariants(node)
        : this.executeEnhancedWorker(node),
    );

    await Promise.all(workerPromises);
    this.logStreamer.log(
      "info",
      `Enhanced batch completed: ${cappedBatch.map((n) => n.id).join(", ")}`,
    );
  }

  // ─── Variant Execution ─────────────────────────────────────────────────

  private async executeNodeWithVariants(node: DagNode): Promise<void> {
    const variants = this.nodeVariants.get(node.id) ?? [
      { index: 0, node, routingOverride: {}, priority: node.priority ?? 0 },
    ];

    this.logStreamer.log(
      "info",
      `Node ${node.id}: executing ${variants.length} variants in parallel`,
    );

    // 모든 variant 병렬 실행
    const variantResults: VariantResult[] = [];
    const variantPromises = variants.map(async (variant) => {
      const result = await this.executeSingleVariant(variant);
      variantResults.push(result);
      return result;
    });

    await Promise.all(variantPromises);

    // 최적 variant 선택
    const selection = selectBestVariant(
      variantResults,
      this.modeConfig.variantStrategy,
    );
    this.variantSelections[node.id] = selection;

    this.logStreamer.log(
      "info",
      `Node ${node.id} variant selection: ${selection.rationale}`,
    );

    // 선택된 variant 결과로 완료 처리
    if (selection.selected.success) {
      this.completedNodes.add(node.id);
      this.consecutiveFailures = 0;
    } else {
      this.failedNodes.add(node.id);
      this.consecutiveFailures++;
    }

    // Emit variant selection event
    this.stateManager.emitEvent({
      type: "worker_completed",
      nodeId: node.id,
      timestamp: new Date().toISOString(),
      data: {
        variantSelection: {
          selected: selection.selected.variant.index,
          totalVariants: variants.length,
          strategy: selection.strategy,
          rationale: selection.rationale,
          scores: variantResults.map((r) => ({
            variant: r.variant.index,
            score: r.score,
            success: r.success,
          })),
        },
      },
    });
  }

  private async executeSingleVariant(variant: NodeVariant): Promise<VariantResult> {
    const variantNode: DagNode = {
      ...variant.node,
      routing: {
        ...variant.node.routing,
        ...variant.routingOverride,
      },
    };

    const logHandle = this.logStreamer.createWorkerHandle(variantNode.id);

    // Think mode: thinking session 초기화
    let thinkingSession: ThinkingSession | undefined;
    if (this.modeConfig.modes.includes("think")) {
      thinkingSession = createThinkingSession(
        variant.node.id,
        this.runId,
        variant.index,
      );
      this.thinkingSessions.set(variantNode.id, thinkingSession);
    }

    // Skills mode: skill evidence 초기화
    const skillEvidences: SkillEvidence[] = [];
    if (this.modeConfig.modes.includes("skills")) {
      const scopes = capabilityScopesFromRouting(variantNode.routing);
      for (const skill of scopes.skills) {
        skillEvidences.push(createSkillEvidence(skill, variantNode.id, this.runId));
      }
    }

    try {
      const capabilityContext = buildEnhancedWorkerCapabilityContext(
        variantNode,
        this.modeConfig,
        this.dag,
        {
          runId: this.runId,
          root: this.cwd,
          goalId: this.goalId,
          objective: this.objective,
        },
      );

      // Intent classification
      const capsule = {
        nodeId: capabilityContext.node.id,
        goal: capabilityContext.node.name,
        task: capabilityContext.node.name,
        system: "",
        node: capabilityContext.node,
      } as unknown as ContextCapsule;

      const intent = this.runtimeRouter.classifyIntent(capsule);
      let selectedRuntime = "runtime-backed";
      try {
        selectedRuntime = this.runtimeRouter.select(capsule).runtime.id;
      } catch {
        this.logStreamer.log("warn", `Runtime preselection deferred for ${capabilityContext.node.id}`);
      }

      const workerRunContext = buildTaskRunContext({
        runId: this.runId,
        ...(this.goalId ? { goalId: this.goalId } : {}),
        root: this.cwd,
        node: capabilityContext.node,
        objective: this.objective ?? capabilityContext.node.name,
        toolPlane: {
          mcpServers: capabilityContext.scopes.mcpServers,
          skills: capabilityContext.scopes.skills,
          hooks: capabilityContext.scopes.hooks,
          tools: capabilityContext.scopes.tools,
          requiresRuntimeMcp: capabilityContext.node.routing?.requiresMcp,
        },
        selectedRuntimeId: selectedRuntime,
      });

      // Think mode reasoning prompt
      if (this.modeConfig.modes.includes("think") && thinkingSession) {
        addThinkingTrace(
          thinkingSession,
          `[START] Variant ${variant.index}: ${variantNode.name} (role: ${variantNode.role})`,
        );
        addThinkingTrace(
          thinkingSession,
          `[INTENT] classified as ${intent}, runtime: ${selectedRuntime}`,
        );
        addThinkingTrace(
          thinkingSession,
          `[CAPABILITIES] skills=[${capabilityContext.modeInjection.skills.join(",")}], mcp=[${capabilityContext.modeInjection.mcpServers.join(",")}], hooks=[${capabilityContext.modeInjection.hooks.join(",")}]`,
        );
        if (capabilityContext.modeInjection.reasoningPrompt) {
          addThinkingTrace(
            thinkingSession,
            `[REASONING] ${capabilityContext.modeInjection.reasoningPrompt.slice(0, 200)}...`,
          );
        }
      }

      // Create and execute worker
      const worker = await createAgentWorker(capabilityContext.node, this.runId, logHandle, {
        cwd: this.cwd,
        env: {
          ...capabilityContext.env,
          ...envFromWorkerManifest(workerRunContext.worker),
        },
        runContext: workerRunContext,
      });

      const output = await worker.execute();

      // Think mode: final traces
      if (thinkingSession) {
        addThinkingTrace(
          thinkingSession,
          `[RESULT] success=${output.success}, exitCode=${output.exitCode}`,
        );
        thinkingSession.completedAt = new Date().toISOString();
        this.allThinkingTraces.push(...thinkingSession.traces);
        if (this.onThinking) {
          for (const trace of thinkingSession.traces) {
            this.onThinking(trace);
          }
        }
      }

      // Skills mode: mark as used
      for (const evidence of skillEvidences) {
        evidence.used = output.success;
        evidence.evidenceRef = `worker-${variantNode.id}-output`;
      }
      this.skillEvidences.push(...skillEvidences);

      const score = this.calculateVariantScore(output, variant);

      return {
        variant,
        success: output.success,
        score,
        stdout: output.stdout,
        stderr: output.stderr,
        thinkingSession,
        skillEvidences,
        metadata: output.metadata,
      };
    } catch (error) {
      const message = formatWorkerError(error);
      logHandle.log("error", `Variant ${variant.index} failed: ${message}`);

      if (thinkingSession) {
        addThinkingTrace(thinkingSession, `[ERROR] ${message}`);
        thinkingSession.completedAt = new Date().toISOString();
      }

      return {
        variant,
        success: false,
        score: 0,
        stdout: "",
        stderr: message,
        thinkingSession,
        skillEvidences,
      };
    } finally {
      logHandle.close();
    }
  }

  // ─── Standard Enhanced Worker ──────────────────────────────────────────

  private async executeEnhancedWorker(node: DagNode): Promise<void> {
    const logHandle = this.logStreamer.createWorkerHandle(node.id);
    let workerNode = node;

    // Think mode: thinking session 초기화
    let thinkingSession: ThinkingSession | undefined;
    if (this.modeConfig.modes.includes("think")) {
      thinkingSession = createThinkingSession(node.id, this.runId, 0);
      this.thinkingSessions.set(node.id, thinkingSession);
    }

    // Skills mode: skill evidence 초기화
    const nodeSkillEvidences: SkillEvidence[] = [];
    if (this.modeConfig.modes.includes("skills")) {
      const scopes = capabilityScopesFromRouting(node.routing);
      for (const skill of scopes.skills) {
        nodeSkillEvidences.push(createSkillEvidence(skill, node.id, this.runId));
      }
    }

    try {
      const capabilityContext = buildEnhancedWorkerCapabilityContext(
        node,
        this.modeConfig,
        this.dag,
        {
          runId: this.runId,
          root: this.cwd,
          goalId: this.goalId,
          objective: this.objective,
        },
      );
      workerNode = capabilityContext.node;

      // Intent classification + runtime routing
      const capsule = {
        nodeId: workerNode.id,
        goal: workerNode.name,
        task: workerNode.name,
        system: "",
        node: workerNode,
      } as unknown as ContextCapsule;

      const intent = this.runtimeRouter.classifyIntent(capsule);
      let selectedRuntime = "runtime-backed";
      try {
        selectedRuntime = this.runtimeRouter.select(capsule).runtime.id;
      } catch {
        this.logStreamer.log("warn", `Runtime preselection deferred for ${workerNode.id}`);
      }
      this.logStreamer.log("info", `Node ${workerNode.id}: intent=${intent}, runtime=${selectedRuntime}`);
      this.nodeRuntimeMap.set(workerNode.id, selectedRuntime);

      // Think mode reasoning traces
      if (thinkingSession) {
        addThinkingTrace(thinkingSession, `[START] ${workerNode.name} (role: ${workerNode.role})`);
        addThinkingTrace(thinkingSession, `[INTENT] classified as ${intent}, runtime: ${selectedRuntime}`);
        addThinkingTrace(thinkingSession, `[CAPABILITIES] skills=[${capabilityContext.modeInjection.skills.join(",")}], mcp=[${capabilityContext.modeInjection.mcpServers.join(",")}], hooks=[${capabilityContext.modeInjection.hooks.join(",")}]`);
        if (capabilityContext.modeInjection.reasoningPrompt) {
          addThinkingTrace(thinkingSession, `[REASONING] activated (level: ${this.modeConfig.thinkingLevel})`);
        }
      }

      const nodeMeta = this.executionPlan.nodeMeta.get(workerNode.id);
      const providerPolicy = nodeMeta?.providerPolicy;
      const capabilities = nodeMeta?.capabilities;

      const workerRunContext = buildTaskRunContext({
        runId: this.runId,
        ...(this.goalId ? { goalId: this.goalId } : {}),
        root: this.cwd,
        node: workerNode,
        objective: this.objective ?? workerNode.name,
        toolPlane: {
          mcpServers: capabilityContext.scopes.mcpServers,
          skills: capabilityContext.scopes.skills,
          hooks: capabilityContext.scopes.hooks,
          tools: capabilityContext.scopes.tools,
          requiresRuntimeMcp: workerNode.routing?.requiresMcp,
        },
        providerPolicy,
        capabilities,
        selectedRuntimeId: selectedRuntime,
      });

      const workerEnv = {
        ...capabilityContext.env,
        ...envFromWorkerManifest(workerRunContext.worker),
      };

      // Update state
      this.stateManager.startWorker(workerNode.id, capabilityContext.assignment);
      this.stateManager.emitEvent({
        type: "worker_started",
        nodeId: workerNode.id,
        timestamp: new Date().toISOString(),
        data: {
          intent,
          selectedRuntime,
          capabilityScopes: capabilityContext.scopes,
          activeModes: this.modeConfig.modes,
        },
      });

      // Create and execute worker
      const worker = await createAgentWorker(workerNode, this.runId, logHandle, {
        cwd: this.cwd,
        env: workerEnv,
        runContext: workerRunContext,
      });

      this.activeWorkers.set(workerNode.id, worker);
      const output = await worker.execute();

      // Process result
      await this.handleEnhancedWorkerResult(workerNode, output, logHandle, thinkingSession, nodeSkillEvidences);

      this.activeWorkers.delete(workerNode.id);
    } catch (error) {
      const message = formatWorkerError(error);
      logHandle.log("error", `Worker failed: ${message}`);

      if (thinkingSession) {
        addThinkingTrace(thinkingSession, `[ERROR] ${message}`);
      }

      await this.handleEnhancedWorkerFailure(workerNode, message, logHandle, thinkingSession);
      this.activeWorkers.delete(workerNode.id);
    } finally {
      logHandle.close();
    }
  }

  private async handleEnhancedWorkerResult(
    node: DagNode,
    output: WorkerOutput,
    logHandle: WorkerLogHandle,
    thinkingSession?: ThinkingSession,
    skillEvidences?: SkillEvidence[],
  ): Promise<void> {
    if (output.success) {
      logHandle.log("info", `Worker succeeded (exit code: ${output.exitCode})`);

      // Evidence gate check
      const evidenceGates = (node as DagNode & { evidenceGates?: EvidenceGate[] }).evidenceGates;
      if (evidenceGates && evidenceGates.length > 0) {
        const gateResult = await checkEvidenceGates(evidenceGates, {
          cwd: this.cwd,
          stdout: output.stdout,
          nodeId: node.id,
          runId: this.runId,
        });
        if (!gateResult.passed) {
          this.stateManager.failWorker(node.id, `Evidence gate failed`);
          this.failedNodes.add(node.id);
          this.consecutiveFailures++;
          return;
        }
      }

      this.consecutiveFailures = 0;
      this.completedNodes.add(node.id);
      this.stateManager.completeWorker(node.id, output);

      // Think mode: final traces
      if (thinkingSession) {
        addThinkingTrace(thinkingSession, `[RESULT] success=true, exitCode=${output.exitCode}`);
        thinkingSession.completedAt = new Date().toISOString();
        this.allThinkingTraces.push(...thinkingSession.traces);
        if (this.onThinking) {
          for (const trace of thinkingSession.traces) {
            this.onThinking(trace);
          }
        }
      }

      // Skills mode: mark as used
      if (skillEvidences) {
        for (const evidence of skillEvidences) {
          evidence.used = true;
          evidence.evidenceRef = `node-${node.id}-output`;
        }
        this.skillEvidences.push(...skillEvidences);
      }

      this.stateManager.emitEvent({
        type: "worker_completed",
        nodeId: node.id,
        timestamp: new Date().toISOString(),
        data: {
          success: true,
          exitCode: output.exitCode,
          selectedRuntime: this.nodeRuntimeMap.get(node.id),
          activeModes: this.modeConfig.modes,
        },
      });
    } else {
      await this.handleEnhancedWorkerFailure(
        node,
        `Exit code: ${output.exitCode}\n${output.stderr}`,
        logHandle,
        thinkingSession,
      );
    }
  }

  private async handleEnhancedWorkerFailure(
    node: DagNode,
    error: string,
    logHandle: WorkerLogHandle,
    thinkingSession?: ThinkingSession,
  ): Promise<void> {
    const worker = this.stateManager.getWorker(node.id);
    const retryCount = worker?.retryCount ?? 0;
    const maxRetries = node.maxRetries ?? 3;

    const canRetry = this.stateManager.retryWorker(node.id);
    if (canRetry && worker) {
      const backoffMs = Math.min(30000, 1000 * Math.pow(2, worker.retryCount));
      this.logStreamer.log("warn", `Retrying node ${node.id} in ${backoffMs}ms (${worker.retryCount}/${maxRetries})`);

      if (thinkingSession) {
        addThinkingTrace(thinkingSession, `[RETRY] attempt ${worker.retryCount}/${maxRetries}, backoff=${backoffMs}ms`);
      }

      await this.sleep(backoffMs);
      this.stateManager.emitEvent({
        type: "worker_retrying",
        nodeId: node.id,
        timestamp: new Date().toISOString(),
        data: { retryCount: worker.retryCount, maxRetries },
      });
      this.failedNodes.delete(node.id);
      return;
    }

    logHandle.log("error", `Worker failed after ${maxRetries} retries`);
    this.failedNodes.add(node.id);
    this.stateManager.failWorker(node.id, error);

    if (thinkingSession) {
      addThinkingTrace(thinkingSession, `[FAILED] after ${maxRetries} retries: ${error}`);
      thinkingSession.completedAt = new Date().toISOString();
      this.allThinkingTraces.push(...thinkingSession.traces);
    }

    this.stateManager.emitEvent({
      type: "worker_failed",
      nodeId: node.id,
      timestamp: new Date().toISOString(),
      data: { error, retryCount, maxRetries, selectedRuntime: this.nodeRuntimeMap.get(node.id) },
    });
    this.consecutiveFailures++;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private calculateVariantScore(output: WorkerOutput, _variant: NodeVariant): number {
    let score = 0;
    if (output.success) score += 50;
    if (output.exitCode === 0) score += 20;
    // stdout 길이가 충분한지 (의미 있는 출력)
    if (output.stdout && output.stdout.length > 50) score += 10;
    if (output.stdout && output.stdout.length > 500) score += 10;
    // stderr 없는지
    if (!output.stderr || output.stderr.length === 0) score += 10;
    return score;
  }

  private async waitForCompletion(): Promise<void> {
    if (this.activeWorkers.size === 0) return;
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.activeWorkers.size === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  private isComplete(): boolean {
    const totalNodes = this.dag.nodes.length;
    return this.completedNodes.size + this.failedNodes.size >= totalNodes;
  }

  private terminalNodes(): Set<string> {
    return new Set([...this.completedNodes, ...this.failedNodes]);
  }

  private isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  private verifyCompletion(): boolean {
    for (const node of this.dag.nodes) {
      if (!this.completedNodes.has(node.id)) {
        this.logStreamer.log("error", `Node ${node.id} did not complete`);
        return false;
      }
    }
    this.logStreamer.log("info", "All enhanced nodes completed successfully");
    return true;
  }

  private emitProgress(): void {
    if (!this.onProgress) return;

    const thinkingSessionMap: Record<string, ThinkingSession> = {};
    for (const [id, session] of this.thinkingSessions.entries()) {
      thinkingSessionMap[id] = session;
    }

    const state: EnhancedOrchestrationState = {
      runId: this.runId,
      status: this.stateManager.getStatus(),
      progress: {
        completed: this.completedNodes.size,
        total: this.dag.nodes.length,
        percentage: (this.completedNodes.size / this.dag.nodes.length) * 100,
      },
      workers: this.stateManager.getAllWorkers(),
      nodeRuntimes: Object.fromEntries(this.nodeRuntimeMap),
      thinkingSessions: thinkingSessionMap,
      skillEvidences: [...this.skillEvidences],
      variantResults: { ...this.variantSelections },
      startedAt: this.stateManager.getStartedAt(),
      completedAt: this.stateManager.getCompletedAt(),
      error: this.stateManager.getError(),
      activeModes: this.modeConfig.modes,
    };

    this.onProgress(state);
  }

  private createResult(success: boolean, error?: string): EnhancedOrchestrationResult {
    return {
      success,
      state: {
        runId: this.runId,
        status: this.stateManager.getStatus(),
        progress: {
          completed: this.completedNodes.size,
          total: this.dag.nodes.length,
          percentage: (this.completedNodes.size / this.dag.nodes.length) * 100,
        },
        workers: this.stateManager.getAllWorkers(),
        nodeRuntimes: Object.fromEntries(this.nodeRuntimeMap),
        startedAt: this.stateManager.getStartedAt(),
        completedAt: this.stateManager.getCompletedAt(),
        error: error ?? this.stateManager.getError(),
        activeModes: this.modeConfig.modes,
      },
      executionPlan: this.executionPlan,
      events: this.stateManager.getEvents(),
      thinkingTraces: this.allThinkingTraces,
      skillEvidences: this.skillEvidences,
      variantSelections: this.variantSelections,
      error,
    };
  }

  private async cleanup(): Promise<void> {
    for (const worker of this.activeWorkers.values()) {
      worker.abort();
    }
    this.activeWorkers.clear();
    await this.stateManager.save();
    await this.logStreamer.close();
    this.logStreamer.log("info", "Enhanced orchestrator cleanup complete");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
