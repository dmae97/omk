import { join } from "path";
import { MemoryStore } from "../memory/memory-store.js";
import type { GoalSpec } from "../contracts/goal.js";
import type { RunState } from "../contracts/orchestration.js";
import type { EnsembleDecisionResult } from "../orchestration/ensemble-decision.js";

export interface SavedEnsembleDecision {
  goalId: string;
  runId: string;
  timestamp: string;
  action: string;
  confidence: number;
  shouldContinue: boolean;
  candidateVotes: Array<{ id: string; action: string; weight: number; reason: string }>;
  rationale: string;
  nextPrompt?: string;
  divergence?: boolean;
  confidenceTrend?: "rising" | "falling" | "stable";
}

export async function saveEnsembleDecision(
  goal: GoalSpec,
  runState: RunState,
  ensemble: EnsembleDecisionResult,
  root: string,
  meta?: { divergence?: boolean; confidenceTrend?: "rising" | "falling" | "stable" }
): Promise<void> {
  const memoryStore = new MemoryStore(join(root, ".omk", "memory"), {
    projectRoot: root,
    source: "ensemble-goal",
  });

  const timestamp = new Date().toISOString();
  const payload: SavedEnsembleDecision = {
    goalId: goal.goalId,
    runId: runState.runId,
    timestamp,
    action: ensemble.action,
    confidence: ensemble.confidence,
    shouldContinue: ensemble.shouldContinue,
    candidateVotes: ensemble.candidateVotes,
    rationale: ensemble.rationale,
    nextPrompt: ensemble.nextPrompt,
    divergence: meta?.divergence ?? ensemble.divergence,
    confidenceTrend: meta?.confidenceTrend,
  };

  const content = JSON.stringify(payload, null, 2);
  const path = `ensemble/${goal.goalId}/${runState.runId}/${timestamp}.json`;

  try {
    await memoryStore.write(path, content);
  } catch (err) {
    // Non-fatal: log but do not block goal evaluation
    console.warn(
      `[ensemble-memory] Failed to save ensemble decision: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function recallRecentEnsembleDecisions(
  goalId: string,
  root: string,
  limit = 5
): Promise<SavedEnsembleDecision[]> {
  const memoryStore = new MemoryStore(join(root, ".omk", "memory"), {
    projectRoot: root,
    source: "ensemble-goal",
  });

  try {
    const results = await memoryStore.search(`ensemble ${goalId}`, limit);
    return results
      .map((r) => {
        try {
          return JSON.parse(r.content) as SavedEnsembleDecision;
        } catch {
          return null;
        }
      })
      .filter((d): d is SavedEnsembleDecision => d !== null)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  } catch {
    return [];
  }
}
