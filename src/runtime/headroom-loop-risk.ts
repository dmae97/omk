export type HeadroomLoopRiskKind =
  | "none"
  | "compaction-contract-drift"
  | "headroom-no-apply"
  | "low-compaction-yield";

export type HeadroomLoopRecommendedAction =
  | "continue"
  | "block"
  | "replan"
  | "summarize-or-drop-low-priority-context";

export interface HeadroomDecisionHistoryEntry {
  readonly attempted?: boolean;
  readonly applied?: boolean;
  readonly validated?: boolean;
  readonly compactedTextProduced?: boolean;
  readonly beforeTokens?: number | null;
  readonly afterTokens?: number | null;
  readonly reason?: string;
  readonly missingSections?: readonly string[];
}

export interface HeadroomLoopRiskSignal {
  readonly kind: HeadroomLoopRiskKind;
  readonly severity: number;
  readonly recommendedAction: HeadroomLoopRecommendedAction;
  readonly reason: string;
}

export function computeHeadroomLoopRiskSignal(
  history: readonly HeadroomDecisionHistoryEntry[],
): HeadroomLoopRiskSignal {
  const recent = history.slice(-3);
  if (recent.length < 2) {
    return noHeadroomLoopRisk("not enough headroom decision history");
  }

  const failedApplyCount = recent.filter((entry) => entry.attempted === true && entry.applied !== true).length;
  const validationFailureCount = recent.filter((entry) =>
    entry.compactedTextProduced === true && entry.validated !== true
  ).length;
  const lowYieldCount = recent.filter((entry) => {
    if (entry.applied !== true) return false;
    const before = Math.max(1, entry.beforeTokens ?? 0);
    const after = Math.max(0, entry.afterTokens ?? 0);
    return after / before > 0.85;
  }).length;

  if (validationFailureCount >= 2) {
    return {
      kind: "compaction-contract-drift",
      severity: 0.9,
      recommendedAction: "block",
      reason: "structured compaction repeatedly stripped or mismatched required contract sections",
    };
  }

  if (failedApplyCount >= 3) {
    return {
      kind: "headroom-no-apply",
      severity: 0.8,
      recommendedAction: "replan",
      reason: "headroom crossed the threshold repeatedly but no compacted capsule was applied",
    };
  }

  if (lowYieldCount >= 2) {
    return {
      kind: "low-compaction-yield",
      severity: 0.6,
      recommendedAction: "summarize-or-drop-low-priority-context",
      reason: "compaction applied repeatedly but did not reduce context enough",
    };
  }

  return noHeadroomLoopRisk("headroom decisions show no repeated compaction risk");
}

function noHeadroomLoopRisk(reason: string): HeadroomLoopRiskSignal {
  return { kind: "none", severity: 0, recommendedAction: "continue", reason };
}
