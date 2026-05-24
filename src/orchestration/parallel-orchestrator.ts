/**
 * ParallelOrchestrator — 병렬 에이전트 오케스트레이션 핵심 로직
 *
 * ExecutionPlanner, StateManager, LogStreamer, AgentWorker를 통합하여
 * DAG 기반 병렬 실행을 관리합니다.
 */

import { join } from "path";
import type { Dag, DagNode } from "./dag.js";
// TaskResult removed — unused in this file
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

import { checkEvidenceGates, type EvidenceGate, type EvidenceResult } from "./evidence-gate.js";

export interface ParallelOrchestratorOptions {
  dag: Dag;
  runId: string;
  maxWorkers: number;
  cwd?: string;
  timeout?: number;
  onProgress?: (state: ParallelOrchestrationState) => void;
  onLog?: (entry: LogEntry) => void;
}

export interface ParallelOrchestrationState {
  runId: string;
  status: "initializing" | "running" | "paused" | "completed" | "failed" | "cancelled";
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
  workers: WorkerState[];
  nodeRuntimes?: Record<string, string>;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface ParallelOrchestrationResult {
  success: boolean;
  state: ParallelOrchestrationState;
  executionPlan: ExecutionPlan;
  events: OrchestrationEvent[];
  error?: string;
}

export class ParallelOrchestrator {
  private dag: Dag;
  private runId: string;
  private maxWorkers: number;
  private cwd: string;
  private timeout: number;
  private executionPlan: ExecutionPlan;
  private stateManager: OrchestrationStateManager;
  private logStreamer: LogStreamer;
  private activeWorkers: Map<string, AgentWorker> = new Map();
  private completedNodes: Set<string> = new Set();
  private failedNodes: Set<string> = new Set();
  private nodeRuntimeMap: Map<string, string> = new Map();
  private onProgress?: (state: ParallelOrchestrationState) => void;
  private onLog?: (entry: LogEntry) => void;
  private abortController: AbortController | null = null;
  private runtimeRouter: ReturnType<typeof createRuntimeRouter>;
  private adaptiveMaxWorkers: number;
  private consecutiveFailures: number = 0;
  private lastBatchCompletedAt: number = 0;

  constructor(options: ParallelOrchestratorOptions) {
    this.dag = options.dag;
    this.runId = options.runId;
    this.maxWorkers = options.maxWorkers;
    this.cwd = options.cwd ?? process.cwd();
    this.timeout = options.timeout ?? 600000; // 10분 기본
    this.onProgress = options.onProgress;
    this.onLog = options.onLog;

    // 실행 계획 생성
    this.executionPlan = createExecutionPlan({
      dag: this.dag.nodes,
      maxWorkers: this.maxWorkers,
    });

    // 상태 관리자 초기화
    this.stateManager = new OrchestrationStateManager({
      runId: this.runId,
      nodes: this.dag.nodes,
      workerCount: this.maxWorkers,
      basePath: this.cwd,
    });

    // 로그 스트리머 초기화
    this.logStreamer = new LogStreamer({
      logDir: join(this.cwd, ".omk/logs"),
    });
    if (this.onLog) {
      this.logStreamer.onLog(this.onLog);
    }

    this.runtimeRouter = createRuntimeRouter();
    this.adaptiveMaxWorkers = options.maxWorkers;
  }

  /**
   * 오케스트레이션 실행
   */
  async execute(): Promise<ParallelOrchestrationResult> {
    this.abortController = new AbortController();

    try {
      // 초기화
      await this.initialize();

      // 상태 업데이트: 실행 중
      this.stateManager.setStatus("running");
      this.emitProgress();

      // 실행 계획 로깅
      this.logStreamer.log("info", `Execution plan:\n${formatExecutionPlan(this.executionPlan)}`);

      // 메인 실행 루프
      await this.executeLoop();

      // 완료 확인
      const success = this.verifyCompletion();

      // 상태 업데이트: 완료
      this.stateManager.setStatus(success ? "completed" : "failed");
      this.stateManager.setCompletedAt(new Date().toISOString());

      // 결과 반환
      return this.createResult(success);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logStreamer.log("error", `Orchestration failed: ${message}`);
      this.stateManager.setStatus("failed");
      this.stateManager.setError(message);

      return this.createResult(false, message);
    } finally {
      // 정리
      await this.cleanup();
    }
  }

  /**
   * 오케스트레이션 중단
   */
  async abort(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }

    // 모든 활성 워커 중단
    for (const [nodeId, worker] of this.activeWorkers.entries()) {
      this.logStreamer.log("warn", `Aborting worker: ${nodeId}`);
      worker.abort();
    }

    this.stateManager.setStatus("cancelled");
    this.logStreamer.log("warn", "Orchestration aborted");
  }

  /**
   * 초기화
   */
  private async initialize(): Promise<void> {
    this.logStreamer.log("info", "Initializing orchestrator...");

    // 상태 관리자 초기화
    this.stateManager.initialize();

    // 로그 스트리머 초기화
    await this.logStreamer.initialize();

    // DAG 노드 상태 초기화
    for (const node of this.dag.nodes) {
      this.stateManager.initializeWorker(node.id, node.maxRetries ?? 3);
    }

    this.logStreamer.log("info", `Initialized ${this.dag.nodes.length} workers`);
  }

  /**
   * 메인 실행 루프
   */
  private async executeLoop(): Promise<void> {
    while (!this.isComplete() && !this.isAborted()) {
      // 다음 실행 가능한 배치 찾기
      const batch = getNextExecutableBatch(this.executionPlan, this.completedNodes);

      if (!batch) {
        // 실행할 배치가 없으면 대기
        await this.waitForCompletion();
        continue;
      }

      // 배치 실행
      await this.executeBatch(batch);

      // 진행 상황 업데이트
      this.emitProgress();

      // 완료 확인
      if (this.isComplete()) {
        break;
      }

      // 잠시 대기 (CPU 부하 방지)
      await this.sleep(100);
    }
  }

  /**
   * 배치 실행
   */
  private async executeBatch(batch: DagNode[]): Promise<void> {
    // Adaptive pool sizing
    if (this.consecutiveFailures >= 3 && this.adaptiveMaxWorkers > 1) {
      this.adaptiveMaxWorkers = Math.max(1, this.adaptiveMaxWorkers - 1);
      this.logStreamer.log("warn", `Reducing worker pool to ${this.adaptiveMaxWorkers} due to consecutive failures`);
    }
    if (this.consecutiveFailures === 0 && this.adaptiveMaxWorkers < this.maxWorkers) {
      this.adaptiveMaxWorkers++;
      this.logStreamer.log("info", `Increasing worker pool to ${this.adaptiveMaxWorkers}`);
    }

    const cappedBatch = batch.slice(0, this.adaptiveMaxWorkers);

    this.logStreamer.log(
      "info",
      `Executing batch: ${cappedBatch.map((n) => n.id).join(", ")}`
    );

    // 병렬로 모든 워커 시작
    const workerPromises = cappedBatch.map((node) => this.executeWorker(node));

    // 모든 워커 완료 대기
    await Promise.all(workerPromises);

    this.logStreamer.log(
      "info",
      `Batch completed: ${cappedBatch.map((n) => n.id).join(", ")}`
    );
  }

  /**
   * 개별 워커 실행
   */
  private async executeWorker(node: DagNode): Promise<void> {
    const logHandle = this.logStreamer.createWorkerHandle(node.id);

    try {
      // Intent classification + runtime routing
      const capsule = {
        nodeId: node.id,
        goal: node.name,
        task: node.name,
        system: "",
        node,
      } as unknown as ContextCapsule;

      const decision = this.runtimeRouter.select(capsule);
      const intent = decision.intent;
      const selectedRuntime = decision.runtime.id;
      this.logStreamer.log("info", `Node ${node.id} classified as intent: ${intent}, selected runtime: ${selectedRuntime}`);
      this.nodeRuntimeMap.set(node.id, selectedRuntime);

      // Capability manifest
      const assignment = node.routing ? {
        skills: [...(node.routing.skills ?? [])],
        mcpServers: [...(node.routing.mcpServers ?? [])],
        hooks: [...(node.routing.hooks ?? [])],
      } : undefined;

      // Derive per-node ProviderPolicy and CapabilityManifest from execution plan
      const nodeMeta = this.executionPlan.nodeMeta.get(node.id);
      const providerPolicy = nodeMeta?.providerPolicy;
      const capabilities = nodeMeta?.capabilities;

      // Build worker env with policy and capabilities
      const workerEnv: Record<string, string> = { ...process.env as Record<string, string> };
      if (providerPolicy) {
        workerEnv.OMK_NODE_PROVIDER_POLICY = JSON.stringify(providerPolicy);
      }
      if (capabilities) {
        workerEnv.OMK_NODE_CAPABILITIES = JSON.stringify(capabilities);
      }

      // 워커 상태 업데이트: 실행 중
      this.stateManager.startWorker(node.id, assignment);
      this.stateManager.emitEvent({
        type: "worker_started",
        nodeId: node.id,
        timestamp: new Date().toISOString(),
        data: { intent, selectedRuntime, providerPolicy, capabilities },
      });

      // 워커 생성
      // TODO: Update AgentWorker/AgentWorkerOptions to accept providerPolicy and capabilities natively
      const worker = await createAgentWorker(node, this.runId, logHandle, {
        cwd: this.cwd,
        env: workerEnv,
      });

      this.activeWorkers.set(node.id, worker);

      // 워커 실행
      const output = await worker.execute();

      // 결과 처리
      await this.handleWorkerResult(node, output, logHandle);

      // 활성 워커 목록에서 제거
      this.activeWorkers.delete(node.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logHandle.log("error", `Worker failed: ${message}`);

      // 실패 처리
      await this.handleWorkerFailure(node, message, logHandle);

      // 활성 워커 목록에서 제거
      this.activeWorkers.delete(node.id);
    } finally {
      logHandle.close();
    }
  }

  /**
   * 워커 결과 처리
   */
  private async handleWorkerResult(node: DagNode, output: WorkerOutput, logHandle: WorkerLogHandle): Promise<void> {
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
          this.logStreamer.log("error", `Evidence gate failed for ${node.id}: ${gateResult.evidence.map((e: EvidenceResult) => e.message).join("; ")}`);
          // Treat as failure for node completion
          this.stateManager.failWorker(node.id, `Evidence gate failed: ${gateResult.evidence.filter((e: EvidenceResult) => !e.passed).map((e: EvidenceResult) => e.message).join("; ")}`);
          this.failedNodes.add(node.id);
          this.consecutiveFailures++;
          return;
        }
      }

      this.consecutiveFailures = 0; // reset on success

      // 완료 처리
      this.completedNodes.add(node.id);
      this.stateManager.completeWorker(node.id, output);
      const selectedRuntime = this.nodeRuntimeMap.get(node.id);
      this.stateManager.emitEvent({
        type: "worker_completed",
        nodeId: node.id,
        timestamp: new Date().toISOString(),
        data: { success: true, exitCode: output.exitCode, selectedRuntime },
      });

      // Integration lane (optional hook point)
      if (node.routing?.needsIntegration) {
        this.logStreamer.log("info", `Integration lane required for ${node.id}`);
        // Integration is a placeholder; actual implementation would spawn an integrator worker
        // For now, just log and continue
      }
    } else {
      logHandle.log(
        "error",
        `Worker failed (exit code: ${output.exitCode}): ${output.stderr}`
      );

      // 실패 처리
      await this.handleWorkerFailure(node, `Exit code: ${output.exitCode}\n${output.stderr}`, logHandle);
    }
  }

  /**
   * 워커 실패 처리 (재시도 로직 포함)
   */
  private async handleWorkerFailure(node: DagNode, error: string, logHandle: WorkerLogHandle): Promise<void> {
    const worker = this.stateManager.getWorker(node.id);
    const retryCount = worker?.retryCount ?? 0;
    const maxRetries = node.maxRetries ?? 3;

    // Retry with exponential backoff
    const canRetry = this.stateManager.retryWorker(node.id);
    if (canRetry && worker) {
      const backoffMs = Math.min(30000, 1000 * Math.pow(2, worker.retryCount));
      this.logStreamer.log("warn", `Retrying node ${node.id} in ${backoffMs}ms (attempt ${worker.retryCount}/${maxRetries})`);
      await this.sleep(backoffMs);
      this.stateManager.emitEvent({
        type: "worker_retrying",
        nodeId: node.id,
        timestamp: new Date().toISOString(),
        data: { retryCount: worker.retryCount, maxRetries },
      });
      // Re-queue the node by removing from failed set
      this.failedNodes.delete(node.id);
      return; // Worker will be re-picked in next batch
    }

    // 최종 실패
    logHandle.log(
      "error",
      `Worker failed after ${maxRetries} retries`
    );

    this.failedNodes.add(node.id);
    this.stateManager.failWorker(node.id, error);
    const selectedRuntime = this.nodeRuntimeMap.get(node.id);
    this.stateManager.emitEvent({
      type: "worker_failed",
      nodeId: node.id,
      timestamp: new Date().toISOString(),
      data: { error, retryCount, maxRetries, selectedRuntime },
    });
    this.consecutiveFailures++;
  }

  /**
   * 모든 워커 완료 대기
   */
  private async waitForCompletion(): Promise<void> {
    if (this.activeWorkers.size === 0) {
      return;
    }

    // 활성 워커 중 하나가 완료될 때까지 대기
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.activeWorkers.size === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  /**
   * 오케스트레이션 완료 확인
   */
  private isComplete(): boolean {
    const totalNodes = this.dag.nodes.length;
    const completedOrFailed = this.completedNodes.size + this.failedNodes.size;

    return completedOrFailed >= totalNodes;
  }

  /**
   * 중단 여부 확인
   */
  private isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  /**
   * 완료 검증
   */
  private verifyCompletion(): boolean {
    // 모든 노드가 완료되었는지 확인
    for (const node of this.dag.nodes) {
      if (!this.completedNodes.has(node.id)) {
        this.logStreamer.log(
          "error",
          `Node ${node.id} did not complete`
        );
        return false;
      }
    }

    this.logStreamer.log("info", "All nodes completed successfully");
    return true;
  }

  /**
   * 진행 상황 이벤트 발생
   */
  private emitProgress(): void {
    if (!this.onProgress) return;

    const state: ParallelOrchestrationState = {
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
      error: this.stateManager.getError(),
    };

    this.onProgress(state);
  }

  /**
   * 결과 생성
   */
  private createResult(success: boolean, error?: string): ParallelOrchestrationResult {
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
      },
      executionPlan: this.executionPlan,
      events: this.stateManager.getEvents(),
      error,
    };
  }

  /**
   * 정리
   */
  private async cleanup(): Promise<void> {
    // 모든 활성 워커 정리
    for (const worker of this.activeWorkers.values()) {
      worker.abort();
    }
    this.activeWorkers.clear();

    // 상태 저장
    await this.stateManager.save();

    // 로그 스트리머 종료
    await this.logStreamer.close();

    this.logStreamer.log("info", "Orchestrator cleanup complete");
  }

  /**
   * Sleep 헬퍼
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
