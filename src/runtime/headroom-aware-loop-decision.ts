import { computeHeadroomLoopRiskSignal, type HeadroomDecisionHistoryEntry, type HeadroomLoopRiskSignal } from "./headroom-loop-risk.js";

export type HeadroomLoopAction = "continue" | "block" | "replan" | "context-adjustment";

export interface HeadroomAwareLoopDecision {
  readonly action: HeadroomLoopAction;
  readonly reason: string;
  readonly confidence: number;
  readonly contextAdjustment?: {
    readonly dropLowPriorityGraphMemory: boolean;
    readonly reduceFileSlices: boolean;
    readonly forceStructuredFallback: boolean;
  };
  readonly risk?: {
    readonly headroom: HeadroomLoopRiskSignal;
  };
}

export function evaluateHeadroomAwareLoopDecision(input: {
  readonly baseAction: HeadroomLoopAction;
  readonly baseReason: string;
  readonly baseConfidence: number;
  readonly headroomHistory: readonly HeadroomDecisionHistoryEntry[];
}): HeadroomAwareLoopDecision {
  const headroomRisk = computeHeadroomLoopRiskSignal(input.headroomHistory);

  if (headroomRisk.kind === "none") {
    return {
      action: input.baseAction,
      reason: input.baseReason,
      confidence: input.baseConfidence,
      risk: { headroom: headroomRisk },
    };
  }

  if (headroomRisk.recommendedAction === "block") {
    return {
      action: "block",
      reason: headroomRisk.reason,
      confidence: Math.max(input.baseConfidence, headroomRisk.severity),
      risk: { headroom: headroomRisk },
    };
  }

  if (headroomRisk.recommendedAction === "replan") {
    return {
      action: input.baseAction === "continue" || input.baseAction === "context-adjustment" ? "replan" : input.baseAction,
      reason: `${input.baseReason}; ${headroomRisk.reason}`,
      confidence: Math.max(input.baseConfidence, headroomRisk.severity),
      risk: { headroom: headroomRisk },
    };
  }

  if (headroomRisk.recommendedAction === "summarize-or-drop-low-priority-context") {
    return {
      action: "continue",
      reason: `${input.baseReason}; ${headroomRisk.reason}`,
      confidence: Math.max(input.baseConfidence, headroomRisk.severity),
      contextAdjustment: {
        dropLowPriorityGraphMemory: true,
        reduceFileSlices: true,
        forceStructuredFallback: true,
      },
      risk: { headroom: headroomRisk },
    };
  }

  return {
    action: input.baseAction,
    reason: input.baseReason,
    confidence: input.baseConfidence,
    risk: { headroom: headroomRisk },
  };
}
