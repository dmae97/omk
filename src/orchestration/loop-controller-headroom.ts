import { evaluateLoopDecision } from "./loop-controller.js";
import type { EvaluateLoopDecisionInput, LoopDecision } from "./loop-state.js";
import { evaluateHeadroomAwareLoopDecision, type HeadroomLoopAction } from "../runtime/headroom-aware-loop-decision.js";
import type { HeadroomDecisionHistoryEntry } from "../runtime/headroom-loop-risk.js";

export interface HeadroomAwareLoopControllerInput extends EvaluateLoopDecisionInput {
  readonly headroomHistory: readonly HeadroomDecisionHistoryEntry[];
}

function toHeadroomAction(action: LoopDecision["action"]): HeadroomLoopAction {
  switch (action) {
    case "close":
      return "continue";
    case "verify-only":
      return "continue";
    case "handoff":
      return "block";
    default:
      return action;
  }
}

export function evaluateHeadroomAwareLoopController(input: HeadroomAwareLoopControllerInput): LoopDecision {
  const baseDecision = evaluateLoopDecision(input);
  const headroomAware = evaluateHeadroomAwareLoopDecision({
    baseAction: toHeadroomAction(baseDecision.action),
    baseReason: baseDecision.reason,
    baseConfidence: baseDecision.confidence,
    headroomHistory: input.headroomHistory,
  });

  return {
    ...baseDecision,
    action: headroomAware.action === "context-adjustment" ? "continue" : headroomAware.action,
    reason: headroomAware.reason,
    confidence: headroomAware.confidence,
    risk: {
      ...baseDecision.risk,
      headroom: headroomAware.risk?.headroom,
    } as unknown as LoopDecision["risk"],
  };
}
