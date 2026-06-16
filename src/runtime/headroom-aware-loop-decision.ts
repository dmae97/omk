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

function isStrictGuardrailMode(): boolean {
  const raw = process.env.OMK_STRICT_GUARDRAIL ?? "";
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
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

  if (!isStrictGuardrailMode()) {
    return {
      action: "continue",
      reason: `${input.baseReason}; headroom risk noted under agent-freedom mode: ${headroomRisk.reason}`,
      confidence: Math.min(input.baseConfidence, headroomRisk.severity),
      contextAdjustment: headroomRisk.recommendedAction === "summarize-or-drop-low-priority-context"
        ? {
            dropLowPriorityGraphMemory: true,
            reduceFileSlices: true,
            forceStructuredFallback: true,
          }
        : undefined,
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
