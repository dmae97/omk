import type { RunState, NextAction } from "../contracts/orchestration.js";
import type { GoalSpec, GoalEvidence, IntentFrame } from "../contracts/goal.js";
import { evaluateMissingCriteria, suggestNextAction } from "../goal/eval-criteria.js";
import { scoreGoal } from "../goal/scoring.js";
import { renderPromptDigest } from "../goal/prompt-digest.js";
import { applyPersonaWeights, type PersonaWeightState } from "./hedge-persona-weights.js";

export interface DecisionCandidate {
  id: string;
  perspective: string;
  weight: number;
}

export interface EnsembleDecisionPolicy {
  enabled?: boolean;
  maxCandidates?: number;
  quorumRatio?: number;
  candidates?: DecisionCandidate[];
  extraVotes?: EnsembleDecisionCandidateVote[];
  intentFrame?: IntentFrame;
  personaWeights?: PersonaWeightState;
}

export interface EnsembleDecisionResult {
  action: NextAction;
  confidence: number;
  rationale: string;
  candidateVotes: Array<{ id: string; action: NextAction; weight: number; reason: string }>;
  shouldContinue: boolean;
  nextPrompt?: string;
  divergence?: boolean;
}

export interface EnsembleDecisionCandidateVote {
  id: string;
  action: NextAction;
  weight: number;
  reason: string;
}

const DEFAULT_CANDIDATES: DecisionCandidate[] = [
  { id: "progress-analyst", perspective: "Evaluate success-criteria completion rate and blocker severity", weight: 1.0 },
  { id: "risk-evaluator", perspective: "Assess failure modes, retry exhaustion, and rollback risk", weight: 0.9 },
  { id: "resource-optimizer", perspective: "Judge worker utilization efficiency vs elapsed time and progress", weight: 0.7 },
  { id: "quality-assessor", perspective: "Check evidence-gate pass rate, review coverage, and test results", weight: 0.8 },
];

export function buildEnsembleCandidates(intentFrame: IntentFrame | undefined, runState: RunState): DecisionCandidate[] {
  const voterSet = new Set<string>();
  const candidates: DecisionCandidate[] = [];

  for (const voter of intentFrame?.capabilityHints.ensembleVoters ?? []) {
    if (voterSet.has(voter)) continue;
    voterSet.add(voter);
    switch (voter) {
      case "security-evaluator":
        candidates.push({ id: "security-evaluator", perspective: "Assess security posture, secret exposure, and guardrail coverage", weight: 1.0 });
        break;
      case "test-evaluator":
        candidates.push({ id: "test-evaluator", perspective: "Evaluate test coverage, regression risk, and verification gaps", weight: 1.0 });
        break;
      case "capability-mcp":
        candidates.push({ id: "capability-mcp", perspective: "Judge whether MCP and tool scope matches pending work", weight: 0.9 });
        break;
      case "capability-hook":
        candidates.push({ id: "capability-hook", perspective: "Judge whether hook constraints are satisfied for pending work", weight: 0.9 });
        break;
      case "quality-assessor":
        candidates.push({ id: "quality-assessor", perspective: "Check evidence-gate pass rate, review coverage, and test results", weight: 0.8 });
        break;
      case "progress-analyst":
        candidates.push({ id: "progress-analyst", perspective: "Evaluate success-criteria completion rate and blocker severity", weight: 1.0 });
        break;
      case "risk-evaluator":
        candidates.push({ id: "risk-evaluator", perspective: "Assess failure modes, retry exhaustion, and rollback risk", weight: 0.9 });
        break;
      case "resource-optimizer":
        candidates.push({ id: "resource-optimizer", perspective: "Judge worker utilization efficiency vs elapsed time and progress", weight: 0.7 });
        break;
    }
  }

  const pendingNodes = runState.nodes.filter((n) => n.status === "pending" || n.status === "running");
  if (pendingNodes.length > 0) {
    candidates.push({ id: "capability-router", perspective: "Vote based on whether pending nodes have properly scoped MCP/skills/hooks routing", weight: 0.85 });
  }

  const fallbackCandidates: DecisionCandidate[] = [
    { id: "progress-analyst", perspective: "Evaluate success-criteria completion rate and blocker severity", weight: 1.0 },
    { id: "risk-evaluator", perspective: "Assess failure modes, retry exhaustion, and rollback risk", weight: 0.9 },
    { id: "resource-optimizer", perspective: "Judge worker utilization efficiency vs elapsed time and progress", weight: 0.7 },
    { id: "quality-assessor", perspective: "Check evidence-gate pass rate, review coverage, and test results", weight: 0.8 },
  ];
  for (const fallback of fallbackCandidates) {
    if (!voterSet.has(fallback.id)) {
      candidates.push(fallback);
    }
  }

  return candidates.slice(0, 8);
}

type CandidateVote = EnsembleDecisionCandidateVote;

function runDecisionCandidate(candidate: DecisionCandidate, goal: GoalSpec, runState: RunState, evidence: GoalEvidence[]): CandidateVote {
  const missing = evaluateMissingCriteria(goal, evidence);
  const failedNodes = runState.nodes.filter((n) => n.status === "failed");
  const doneNodes = runState.nodes.filter((n) => n.status === "done");
  const totalNodes = runState.nodes.length;
  const blockedNodes = runState.nodes.filter((n) => n.status === "blocked");

  switch (candidate.id) {
    case "progress-analyst": {
      const completionRate = goal.successCriteria.length > 0
        ? (goal.successCriteria.length - missing.length) / goal.successCriteria.length
        : doneNodes.length / Math.max(1, totalNodes);
      if (completionRate >= 0.95 && missing.length === 0) {
        return { id: candidate.id, action: "close", weight: candidate.weight, reason: `completionRate=${completionRate.toFixed(2)}, all criteria satisfied` };
      }
      if (blockedNodes.length > 0 && failedNodes.length > 0) {
        return { id: candidate.id, action: "block", weight: candidate.weight, reason: `${blockedNodes.length} blocked, ${failedNodes.length} failed` };
      }
      if (runState.completedAt && missing.length > 0) {
        return { id: candidate.id, action: "handoff", weight: candidate.weight, reason: `run completed but ${missing.length} criteria remain` };
      }
      return { id: candidate.id, action: "continue", weight: candidate.weight, reason: `completionRate=${completionRate.toFixed(2)}, ${missing.length} missing` };
    }
    case "risk-evaluator": {
      const criticalFailures = failedNodes.filter((n) => n.failurePolicy?.blockDependents !== false);
      const retryExhausted = failedNodes.filter((n) => n.retries >= n.maxRetries);
      if (retryExhausted.length > 0 && criticalFailures.length > 0) {
        return { id: candidate.id, action: "block", weight: candidate.weight, reason: `${retryExhausted.length} retries exhausted with critical failures` };
      }
      if (goal.riskLevel === "high" && failedNodes.length > 0) {
        return { id: candidate.id, action: "block", weight: candidate.weight, reason: `high-risk goal with ${failedNodes.length} failures` };
      }
      if (failedNodes.length > 0 && missing.length > 0) {
        return { id: candidate.id, action: "replan", weight: candidate.weight, reason: `${failedNodes.length} failures suggest replanning` };
      }
      return { id: candidate.id, action: "continue", weight: candidate.weight, reason: `risk acceptable (${failedNodes.length} failures, ${criticalFailures.length} critical)` };
    }
    case "resource-optimizer": {
      const nodeProgress = totalNodes > 0 ? doneNodes.length / totalNodes : 0;
      const elapsedMs = runState.startedAt ? Date.now() - Date.parse(runState.startedAt) : 0;
      const etaRemaining = runState.estimate?.estimatedRemainingMs ?? 0;
      const isStuck = elapsedMs > 300_000 && nodeProgress < 0.1;
      if (isStuck) {
        return { id: candidate.id, action: "replan", weight: candidate.weight, reason: `stuck: ${(elapsedMs / 1000).toFixed(0)}s elapsed, progress=${nodeProgress.toFixed(2)}` };
      }
      if (etaRemaining > 600_000 && nodeProgress < 0.3) {
        return { id: candidate.id, action: "replan", weight: candidate.weight, reason: `ETA too high (${(etaRemaining / 1000).toFixed(0)}s) for current progress` };
      }
      if (nodeProgress >= 0.9 && !runState.completedAt) {
        return { id: candidate.id, action: "continue", weight: candidate.weight, reason: `near completion (${(nodeProgress * 100).toFixed(0)}%)` };
      }
      return { id: candidate.id, action: "continue", weight: candidate.weight, reason: `progress=${nodeProgress.toFixed(2)}, elapsed=${(elapsedMs / 1000).toFixed(0)}s` };
    }
    case "quality-assessor": {
      const score = scoreGoal(goal, evidence);
      const evidenceGates = runState.nodes.flatMap((n) => n.evidence ?? []);
      const passedGates = evidenceGates.filter((e) => e.passed);
      const gateRate = evidenceGates.length > 0 ? passedGates.length / evidenceGates.length : 1;
      if (score.overall === "pass" && gateRate >= 0.9) {
        return { id: candidate.id, action: "close", weight: candidate.weight, reason: `quality score=pass, gateRate=${gateRate.toFixed(2)}` };
      }
      if (score.overall === "fail" && gateRate < 0.5) {
        return { id: candidate.id, action: "block", weight: candidate.weight, reason: `quality score=fail, gateRate=${gateRate.toFixed(2)}` };
      }
      if (gateRate < 0.7 && missing.length > 0) {
        return { id: candidate.id, action: "replan", weight: candidate.weight, reason: `low gateRate=${gateRate.toFixed(2)}, replan recommended` };
      }
      return { id: candidate.id, action: "continue", weight: candidate.weight, reason: `quality score=${score.overall}, gateRate=${gateRate.toFixed(2)}` };
    }
    case "capability-router": {
      const pendingNodes = runState.nodes.filter((n) => n.status === "pending" || n.status === "running");
      const unscopedNodes = pendingNodes.filter((n) => {
        const r = n.routing;
        if (!r) return true;
        const hasHints = (r.skills && r.skills.length > 0) || (r.mcpServers && r.mcpServers.length > 0) || (r.hooks && r.hooks.length > 0);
        return !hasHints;
      });
      if (unscopedNodes.length > 0) {
        return { id: candidate.id, action: "replan", weight: candidate.weight, reason: `${unscopedNodes.length} pending nodes lack routing hints` };
      }
      return { id: candidate.id, action: "continue", weight: candidate.weight, reason: `all ${pendingNodes.length} pending nodes have scoped routing` };
    }
    default: {
      const suggestion = suggestNextAction(goal, evidence);
      const action: NextAction = suggestion.type === "close" ? "close" : missing.length > 0 ? "continue" : "close";
      return { id: candidate.id, action, weight: candidate.weight, reason: `fallback: ${suggestion.reason}` };
    }
  }
}

function buildRationale(votes: CandidateVote[], bestAction: NextAction, confidence: number, quorum: number, divergence?: boolean): string {
  const lines = [
    `# Ensemble Decision`,
    `Consensus: ${bestAction} (confidence=${confidence.toFixed(2)}, quorum=${quorum.toFixed(2)})`,
    ...(divergence ? ["⚠️ Divergence warning: top actions are within 15%"] : []),
    ``,
    `| Candidate | Action | Weight | Reason |`,
    `|---|---|---:|---|`,
  ];
  for (const v of votes) {
    const marker = v.action === bestAction ? "✓" : " ";
    lines.push(`| ${marker} ${v.id} | ${v.action} | ${v.weight.toFixed(2)} | ${v.reason} |`);
  }
  return lines.join("\n");
}

function buildAutoPrompt(goal: GoalSpec, runState: RunState, evidence: GoalEvidence[], action: NextAction): string {
  const missing = evaluateMissingCriteria(goal, evidence);
  const failedNodes = runState.nodes.filter((n) => n.status === "failed");
  const doneNodes = runState.nodes.filter((n) => n.status === "done");
  const blockedNodes = runState.nodes.filter((n) => n.status === "blocked");
  const lines: string[] = [
    `# Auto-Generated Context Prompt`,
    ``,
    `## Kimi Context Synthesis`,
    `Use this as follow-up context for the next run, not as a prompt to repeat verbatim.`,
    `Infer the next concrete action from completed work, failed/blocked nodes, missing criteria, and evidence.`,
    `Do not repeat the original goal verbatim or redo completed nodes unless their evidence is invalid.`,
    ``,
    `## Goal Reference (non-verbatim)`,
    renderPromptDigest("Original objective digest", goal.objective),
    ``,
    `## Ensemble Decision`,
    `- Action: ${action}`,
    `- Completed nodes: ${doneNodes.length}/${runState.nodes.length}`,
    `- Failed nodes: ${failedNodes.length}`,
    `- Blocked nodes: ${blockedNodes.length}`,
    `- Missing criteria: ${missing.length}`,
    ``,
  ];
  if (doneNodes.length > 0) {
    lines.push(`## Completed Work to Preserve`, ...doneNodes.slice(0, 8).map((n) => `- ${n.id}: ${n.name}`), ``);
  }
  if (missing.length > 0) {
    lines.push(`## Missing Criteria`, ...missing.map((m) => `- [ ] ${m.description} (${m.requirement})`), ``);
  }
  if (failedNodes.length > 0) {
    lines.push(`## Failed Nodes to Retry`, ...failedNodes.map((n) => `- ${n.id}: ${n.name}${n.blockedReason ? ` (${n.blockedReason})` : ""}`), ``);
  }
  if (blockedNodes.length > 0) {
    lines.push(`## Blocked Nodes to Unblock`, ...blockedNodes.map((n) => `- ${n.id}: ${n.name}${n.blockedReason ? ` (${n.blockedReason})` : ""}`), ``);
  }
  if (action === "replan") {
    lines.push(
      `## Replan Instructions`,
      `The previous plan did not succeed. Re-analyze the goal with current context and produce a revised plan.`,
      `- Preserve completed work where possible.`,
      `- Address the failed nodes first.`,
      `- Split remaining work into smaller, independent scopes.`,
      `- Include verification gates for each new scope.`,
      ``
    );
  } else if (action === "continue") {
    lines.push(
      `## Continue Instructions`,
      `Continue working toward the objective. Focus on:`,
      `1. Highest-priority missing criteria`,
      `2. Failed nodes (retry with adjusted scope)`,
      `3. Memory recall for related context`,
      ``
    );
  }
  lines.push(`## Memory Recall`, `Call omk_memory_mindmap or omk_search_memory before planning.`, ``);
  return lines.join("\n");
}

export function detectEnsembleDivergence(votes: CandidateVote[]): boolean {
  const actionScores = new Map<NextAction, number>();
  for (const vote of votes) {
    actionScores.set(vote.action, (actionScores.get(vote.action) ?? 0) + vote.weight);
  }
  const sortedScores = [...actionScores.entries()].sort((a, b) => b[1] - a[1]);
  if (sortedScores.length < 2) return false;
  const topScore = sortedScores[0][1];
  const secondScore = sortedScores[1][1];
  if (topScore === 0) return false;
  return Math.abs(topScore - secondScore) / topScore <= 0.15;
}

function calibrateVoteWeights(votes: CandidateVote[], _runState: RunState, evidence: GoalEvidence[]): CandidateVote[] {
  const now = Date.now();

  const hasFreshPassing = evidence.some((e) => {
    if (!e.passed) return false;
    const checkedAt = Date.parse(e.checkedAt);
    if (!Number.isFinite(checkedAt)) return false;
    return now - checkedAt < 300_000;
  });

  const hasStale = evidence.some((e) => {
    const checkedAt = Date.parse(e.checkedAt);
    if (!Number.isFinite(checkedAt)) return false;
    return now - checkedAt > 900_000;
  });

  const multiplier = hasFreshPassing ? 1.2 : hasStale ? 0.8 : 1.0;
  return votes.map((vote) => ({ ...vote, weight: Math.min(3, vote.weight * multiplier) }));
}

export function evaluateEnsembleDecision(goal: GoalSpec, runState: RunState, evidence: GoalEvidence[], policy: EnsembleDecisionPolicy = {}): EnsembleDecisionResult {
  const baseCandidates = policy.candidates ?? (policy.intentFrame ? buildEnsembleCandidates(policy.intentFrame, runState) : DEFAULT_CANDIDATES);
  const candidates = baseCandidates.slice(0, policy.maxCandidates ?? baseCandidates.length);
  let votes: CandidateVote[] = [
    ...candidates.map((candidate) => runDecisionCandidate(candidate, goal, runState, evidence)),
    ...(policy.extraVotes ?? []).map(normalizeExtraVote).filter((vote): vote is CandidateVote => Boolean(vote)),
  ];

  votes = calibrateVoteWeights(votes, runState, evidence);
  if (policy.personaWeights) {
    votes = applyPersonaWeights(votes, policy.personaWeights);
  }

  const actionScores = new Map<NextAction, number>();
  for (const vote of votes) {
    actionScores.set(vote.action, (actionScores.get(vote.action) ?? 0) + vote.weight);
  }
  const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);
  const quorum = totalWeight * (policy.quorumRatio ?? 0.5);
  let bestAction: NextAction = "continue";
  let bestScore = -1;
  for (const [action, score] of actionScores) {
    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }
  }

  let confidence = Math.min(1, bestScore / Math.max(1, totalWeight));
  const divergence = detectEnsembleDivergence(votes);
  if (divergence) {
    confidence = Math.max(0, confidence * 0.85);
  }

  const shouldContinue = bestAction === "continue" || bestAction === "replan";
  const rationale = buildRationale(votes, bestAction, confidence, quorum, divergence);
  return {
    action: bestAction,
    confidence,
    rationale,
    candidateVotes: votes.map((v) => ({ id: v.id, action: v.action, weight: v.weight, reason: v.reason })),
    shouldContinue,
    nextPrompt: shouldContinue ? buildAutoPrompt(goal, runState, evidence, bestAction) : undefined,
    divergence,
  };
}

function normalizeExtraVote(vote: EnsembleDecisionCandidateVote): CandidateVote | undefined {
  if (!isNextAction(vote.action)) return undefined;
  const weight = Number(vote.weight);
  if (!Number.isFinite(weight) || weight <= 0) return undefined;
  return {
    id: String(vote.id || "external-candidate").slice(0, 80),
    action: vote.action,
    weight: Math.min(3, weight),
    reason: String(vote.reason || "external ensemble vote").replace(/\s+/g, " ").trim().slice(0, 240),
  };
}

function isNextAction(value: string): value is NextAction {
  return value === "continue" || value === "replan" || value === "block" || value === "handoff" || value === "close";
}
