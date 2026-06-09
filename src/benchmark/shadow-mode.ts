/**
 * Shadow Mode Engine — side-by-side router v1/v2 recording.
 */

import type { AgentRuntime } from "../runtime/agent-runtime.js";
import type { ContextCapsule } from "../runtime/context-capsule.js";
import { createRuntimeRouter } from "../runtime/runtime-router.js";
import { createRouterV2ScoringEngine, scoreRuntimes } from "../runtime/router-v2-scoring.js";
import type { EvidenceHistoryEntry, NodeIntent } from "../runtime/contracts/router-v2.js";
import type { ShadowModeRecord, BenchmarkDecisionRecord } from "./contracts.js";

export interface ShadowModeOptions {
  readonly runtimes: AgentRuntime[];
  readonly history: EvidenceHistoryEntry[];
}

export interface ShadowModeEngine {
  evaluate(taskId: string, nodeId: string, capsule: ContextCapsule): ShadowModeRecord;
  toBenchmarkDecision(record: ShadowModeRecord): BenchmarkDecisionRecord[];
}

export function createShadowModeEngine(options: ShadowModeOptions): ShadowModeEngine {
  const v1Router = createRuntimeRouter({ runtimes: options.runtimes });
  const v2Engine = createRouterV2ScoringEngine();

  function computeRegret(
    scores: { runtimeId: string; composite: number }[],
    selectedId: string,
  ): number {
    if (scores.length === 0) return 0;
    const best = Math.max(...scores.map((s) => s.composite));
    const selected = scores.find((s) => s.runtimeId === selectedId)?.composite ?? 0;
    return Math.max(0, best - selected);
  }

  function evaluate(
    taskId: string,
    nodeId: string,
    capsule: ContextCapsule,
  ): ShadowModeRecord {
    const intent = v1Router.classifyIntent(capsule);

    let v1Decision: ReturnType<typeof v1Router.selectByIntent> | null = null;
    let regretV1 = 0;
    try {
      v1Decision = v1Router.selectByIntent(capsule, options.history);
      const v1Scores = v1Decision.scores.map((s) => ({
        runtimeId: s.runtime,
        composite:
          0.35 * s.qualityScore +
          0.25 * s.evidencePassRate +
          0.15 * s.costScore +
          0.1 * s.latencyScore +
          0.15 * (1 - s.recentFailurePenalty),
      }));
      regretV1 = computeRegret(v1Scores, v1Decision.runtime.id);
    } catch {
      v1Decision = null;
      regretV1 = 1;
    }

    let v2Decision: ReturnType<typeof v2Engine.select> | null = null;
    let regretV2 = 0;
    try {
      v2Decision = v2Engine.select(options.runtimes, intent, options.history);
      const v2Scores = v2Decision.scores.map((s) => ({
        runtimeId: s.runtimeId,
        composite: s.composite,
      }));
      regretV2 = computeRegret(v2Scores, v2Decision.runtime.id);
    } catch {
      v2Decision = null;
      regretV2 = 1;
    }

    const disagreement = v1Decision?.runtime.id !== v2Decision?.runtime.id;

    return {
      taskId,
      nodeId,
      intent,
      v1Decision,
      v2Decision,
      regretV1,
      regretV2,
      disagreement,
      timestamp: new Date().toISOString(),
    };
  }

  function toBenchmarkDecision(record: ShadowModeRecord): BenchmarkDecisionRecord[] {
    const out: BenchmarkDecisionRecord[] = [];
    if (record.v1Decision) {
      out.push({
        component: "runtime-router-v1",
        selectedRuntime: record.v1Decision.runtime.id,
        bestAvailableRuntime:
          record.v2Decision?.scores[0]?.runtimeId ?? record.v1Decision.runtime.id,
        regret: record.regretV1,
        reason: record.v1Decision.reason,
      });
    }
    if (record.v2Decision) {
      out.push({
        component: "runtime-router-v2",
        selectedRuntime: record.v2Decision.runtime.id,
        bestAvailableRuntime: record.v2Decision.scores[0]?.runtimeId ?? record.v2Decision.runtime.id,
        regret: record.regretV2,
        reason: record.v2Decision.reason,
        scoresV2: record.v2Decision.scores,
      });
    }
    return out;
  }

  return { evaluate, toBenchmarkDecision };
}

export function computeRouterRegret(
  candidates: AgentRuntime[],
  intent: string,
  history: EvidenceHistoryEntry[],
  selectedId: string,
): number {
  const engine = createRouterV2ScoringEngine();
  const scores = scoreRuntimes(
    candidates,
    intent as NodeIntent,
    history,
  );
  if (scores.length === 0) return 0;
  const best = Math.max(...scores.map((s) => s.composite));
  const selected = scores.find((s) => s.runtimeId === selectedId)?.composite ?? 0;
  return Math.max(0, best - selected);
}
