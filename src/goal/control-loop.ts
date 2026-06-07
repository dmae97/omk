import { join } from "path";
import type { RunState, NextAction } from "../contracts/orchestration.js";
import type {
  GoalSpec,
  GoalEvidence,
  MissingCriterion,
  NextActionSuggestion,
  NextActionContract,
  PromptNoveltyReport,
} from "../contracts/goal.js";
import { scoreGoal } from "./scoring.js";
import { checkGoalEvidence } from "./evidence.js";
import { getProjectRoot } from "../util/fs.js";
import { MemoryStore } from "../memory/memory-store.js";
import {
  evaluateEnsembleDecision,
  buildEnsembleCandidates,
  detectEnsembleDivergence,
  type EnsembleDecisionCandidateVote,
  type EnsembleDecisionResult,
} from "../orchestration/ensemble-decision.js";
import { buildCapabilityVotes } from "../orchestration/capability-agents.js";
import { evaluateMissingCriteria, suggestNextAction } from "./eval-criteria.js";
import { saveEnsembleDecision, recallRecentEnsembleDecisions, type SavedEnsembleDecision } from "./ensemble-memory.js";
import { renderPromptDigest } from "./prompt-digest.js";
import {
  buildIntentFrameFromGoal,
  buildNextActionContract,
  evaluatePromptNovelty,
  renderActionDigest,
} from "./intent-frame.js";
import {
  checkDeepSeekBalance,
  DeepSeekClient,
  DEEPSEEK_V4_PRO_MODEL,
  getDeepSeekProviderStatus,
  resolveDeepSeekApiKey,
} from "../providers/index.js";

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  reason: string,
  options: { signal?: AbortSignal; onTimeout?: () => void } = {}
): Promise<T> {
  if (options.signal?.aborted) {
    return Promise.reject(options.signal.reason ?? new Error(`Aborted: ${reason}`));
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const cleanup = (): void => {
    if (timer) clearTimeout(timer);
    if (abortHandler) options.signal?.removeEventListener("abort", abortHandler);
  };

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      options.onTimeout?.();
      reject(new Error(`Timeout after ${ms}ms: ${reason}`));
    }, ms);
    timer.unref?.();
    abortHandler = () => reject(options.signal?.reason ?? new Error(`Aborted: ${reason}`));
    options.signal?.addEventListener("abort", abortHandler, { once: true });
  });

  return Promise.race([promise, timeout]).finally(cleanup);
}

const deepseekFailureCounts = new Map<string, number>();
const CONTROL_LOOP_RUN_TTL_MS = 24 * 60 * 60 * 1000;
const CONTROL_LOOP_MAX_TRACKED_RUNS = 128;
const controlLoopRunTouchedAt = new Map<string, number>();

function releaseControlLoopRun(runId: string): void {
  deepseekFailureCounts.delete(runId);
  adaptiveLoopHistory.delete(runId);
  controlLoopRunTouchedAt.delete(runId);
}

function touchControlLoopRun(runId: string, now = Date.now()): void {
  controlLoopRunTouchedAt.set(runId, now);
  pruneControlLoopRunCaches(now);
}

export function cleanupControlLoopRun(runId: string): void {
  releaseControlLoopRun(runId);
}

export function pruneControlLoopRunCaches(now = Date.now()): void {
  for (const [runId, touchedAt] of controlLoopRunTouchedAt) {
    if (now - touchedAt > CONTROL_LOOP_RUN_TTL_MS) {
      releaseControlLoopRun(runId);
    }
  }

  const ordered = [...controlLoopRunTouchedAt.entries()].sort((a, b) => a[1] - b[1]);
  while (ordered.length > CONTROL_LOOP_MAX_TRACKED_RUNS) {
    const [runId] = ordered.shift()!;
    releaseControlLoopRun(runId);
  }

  for (const runId of deepseekFailureCounts.keys()) {
    if (!controlLoopRunTouchedAt.has(runId)) deepseekFailureCounts.delete(runId);
  }
  for (const runId of adaptiveLoopHistory.keys()) {
    if (!controlLoopRunTouchedAt.has(runId)) adaptiveLoopHistory.delete(runId);
  }
}

export function getControlLoopCacheStats(): { trackedRuns: number; deepseekFailureRuns: number; adaptiveHistoryRuns: number } {
  pruneControlLoopRunCaches();
  return {
    trackedRuns: controlLoopRunTouchedAt.size,
    deepseekFailureRuns: deepseekFailureCounts.size,
    adaptiveHistoryRuns: adaptiveLoopHistory.size,
  };
}

function recordDeepSeekFailure(runId: string): void {
  touchControlLoopRun(runId);
  deepseekFailureCounts.set(runId, (deepseekFailureCounts.get(runId) ?? 0) + 1);
}

interface AdaptiveLoopHistory {
  actions: NextAction[];
  progressDeltas: number[];
  confidence: number | undefined;
  consecutiveStrongPositive: number;
  replanDepth: number;
  effectiveMaxIterations: number | undefined;
}

const adaptiveLoopHistory = new Map<string, AdaptiveLoopHistory>();

function getAdaptiveHistory(runId: string): AdaptiveLoopHistory {
  touchControlLoopRun(runId);
  if (!adaptiveLoopHistory.has(runId)) {
    adaptiveLoopHistory.set(runId, {
      actions: [],
      progressDeltas: [],
      confidence: undefined,
      consecutiveStrongPositive: 0,
      replanDepth: 0,
      effectiveMaxIterations: undefined,
    });
  }
  return adaptiveLoopHistory.get(runId)!;
}

function updateAdaptiveHistory(
  runId: string,
  nextAction: NextAction,
  progressDelta: GoalProgressDelta,
  confidence: number
): void {
  const history = getAdaptiveHistory(runId);
  history.actions.push(nextAction);
  if (history.actions.length > 8) history.actions.shift();
  history.progressDeltas.push(progressDelta.value);
  if (history.progressDeltas.length > 4) history.progressDeltas.shift();
  history.confidence = confidence;
}

function detectOscillationDampen(actions: NextAction[]): { dampened: boolean; action: NextAction; hint?: string } {
  if (actions.length < 4) return { dampened: false, action: "continue" };
  const pairs: Array<[NextAction, NextAction]> = [];
  for (let i = 1; i < actions.length; i++) {
    pairs.push([actions[i - 1], actions[i]]);
  }
  const oscillatingPairs = pairs.filter(([a, b]) =>
    (a === "continue" && b === "replan") ||
    (a === "replan" && b === "continue") ||
    (a === "continue" && b === "block") ||
    (a === "block" && b === "continue")
  );
  if (oscillatingPairs.length >= 2) {
    const counts = new Map<NextAction, number>();
    for (const action of actions) {
      counts.set(action, (counts.get(action) ?? 0) + 1);
    }
    let leastFrequent: NextAction = "continue";
    let minCount = Infinity;
    for (const [action, count] of counts) {
      if (count < minCount) {
        minCount = count;
        leastFrequent = action;
      }
    }
    return { dampened: true, action: leastFrequent, hint: "Cooldown: pause 1 iteration to break oscillation pattern." };
  }
  return { dampened: false, action: "continue" };
}

export interface GoalProgress {
  status: GoalSpec["status"];
  score: import("../contracts/goal.js").GoalScore;
  nextAction: NextAction;
}

export interface GoalProgressDelta {
  value: number;
  newlyPassedCriteria: string[];
  newlyPassedOptionalCriteria: string[];
  newlyValidArtifacts: string[];
  newlyFailedCriteria: string[];
  failedCriteria: string[];
  missingRequiredCriteria: string[];
  blockedNodes: string[];
  repeatedFailures: string[];
  recommendation: NextAction;
  reason: string;
  targetCriterionId?: string;
  targetNodeId?: string;
  preserveEvidence: boolean;
}

export async function evaluateGoalProgress(
  goal: GoalSpec,
  runState: RunState
): Promise<GoalProgress> {
  const root = getProjectRoot();
  const evidence = await checkGoalEvidence(goal, { root, runState });
  const score = scoreGoal(goal, evidence);
  const progressDelta = evaluateGoalProgressDelta(goal, evidence, runState);

  let nextAction: NextAction;
  if (score.overall === "pass") {
    nextAction = "close";
  } else if (score.overall === "fail" && isHardGoalFailure(progressDelta)) {
    nextAction = "block";
  } else if (runState.completedAt) {
    nextAction = "handoff";
  } else {
    nextAction = "continue";
  }

  return {
    status: goal.status,
    score,
    nextAction,
  };
}

export interface EnsembleGoalProgress extends GoalProgress {
  ensemble: ReturnType<typeof evaluateEnsembleDecision> & {
    preservedEvidence?: Array<{ nodeId: string; evidence: string }>;
    replanDepth?: number;
  };
  noveltyReport?: PromptNoveltyReport;
  progressDelta: GoalProgressDelta;
}

export interface DeepSeekGoalDecisionContext {
  goal: GoalSpec;
  runState: RunState;
  evidence: GoalEvidence[];
  score: import("../contracts/goal.js").GoalScore;
  signal?: AbortSignal;
}

export type DeepSeekGoalDecisionAdvisor = (
  context: DeepSeekGoalDecisionContext
) => Promise<EnsembleDecisionCandidateVote | undefined>;

export interface DeepSeekGoalDecisionOptions {
  enabled?: boolean;
  weight?: number;
  timeoutMs?: number;
  maxTokens?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  advisor?: DeepSeekGoalDecisionAdvisor;
  signal?: AbortSignal;
}

export interface GoalProgressEnsembleOptions {
  deepseek?: false | DeepSeekGoalDecisionOptions;
  signal?: AbortSignal;
}

export function evaluateLoopGuard(runState: RunState): { shouldStop: boolean; reason?: string } {
  const { iterationCount, maxIterations } = runState;
  if (
    typeof iterationCount === "number" &&
    typeof maxIterations === "number" &&
    maxIterations > 0 &&
    iterationCount > 0 &&
    iterationCount >= maxIterations
  ) {
    return { shouldStop: true, reason: "max-iterations-reached" };
  }
  return { shouldStop: false };
}

export function evaluateAdaptiveLoopGuard(
  runState: RunState,
  progressDelta: GoalProgressDelta,
  _ensemble: ReturnType<typeof evaluateEnsembleDecision>
): { shouldStop: boolean; reason?: string; forcedNextAction?: NextAction } {
  const history = getAdaptiveHistory(runState.runId);

  let effectiveMax = history.effectiveMaxIterations ?? runState.maxIterations ?? 10;

  // Accelerate: strongly positive delta (>5) for 2 consecutive iterations
  if (progressDelta.value > 5) {
    history.consecutiveStrongPositive++;
    if (history.consecutiveStrongPositive >= 2) {
      effectiveMax = Math.max(1, Math.floor(effectiveMax * 0.8));
      history.effectiveMaxIterations = effectiveMax;
    }
  } else {
    history.consecutiveStrongPositive = 0;
  }

  // Back off: blocked nodes exist but repairable nodes remain
  const repairableNodeExists = (runState.nodes ?? []).some((node) =>
    node.status === "pending" ||
    node.status === "running" ||
    (node.status === "failed" && node.retries < node.maxRetries && node.failurePolicy?.retryable !== false)
  );
  if (progressDelta.blockedNodes.length > 0 && repairableNodeExists) {
    effectiveMax = Math.ceil(effectiveMax * 1.25);
    history.effectiveMaxIterations = effectiveMax;
  }

  // Detect oscillation: nextAction flips between continue and replan >2 times
  const recentActions = history.actions.slice(-6);
  let flipCount = 0;
  for (let i = 1; i < recentActions.length; i++) {
    const prev = recentActions[i - 1];
    const curr = recentActions[i];
    if ((prev === "continue" && curr === "replan") || (prev === "replan" && curr === "continue")) {
      flipCount++;
    }
  }
  if (flipCount > 2) {
    return { shouldStop: false, reason: "oscillation-detected-forcing-replan", forcedNextAction: "replan" };
  }

  const iterationCount = runState.iterationCount ?? 0;
  if (iterationCount > 0 && iterationCount >= effectiveMax) {
    return { shouldStop: true, reason: "max-iterations-reached" };
  }

  return { shouldStop: false };
}

export function evaluateGoalProgressDelta(
  goal: GoalSpec,
  currentEvidence: GoalEvidence[],
  runState?: RunState,
  previousEvidence: GoalEvidence[] = []
): GoalProgressDelta {
  const current = latestGoalEvidenceByCriterion(currentEvidence);
  const previous = latestGoalEvidenceByCriterion(previousEvidence);
  const newlyPassedCriteria: string[] = [];
  const newlyPassedOptionalCriteria: string[] = [];
  const newlyFailedCriteria: string[] = [];
  const failedCriteria: string[] = [];
  const missingRequiredCriteria: string[] = [];

  for (const criterion of goal.successCriteria) {
    const currentEvidenceItem = current.get(criterion.id);
    const previousEvidenceItem = previous.get(criterion.id);
    if (currentEvidenceItem?.passed && !previousEvidenceItem?.passed) {
      if (criterion.requirement === "required") {
        newlyPassedCriteria.push(criterion.id);
      } else {
        newlyPassedOptionalCriteria.push(criterion.id);
      }
    }
    if (!currentEvidenceItem?.passed && criterion.requirement === "required") {
      missingRequiredCriteria.push(criterion.id);
    }
    if (currentEvidenceItem && !currentEvidenceItem.passed && isHardFailureEvidence(currentEvidenceItem)) {
      failedCriteria.push(criterion.id);
      if (previousEvidenceItem?.passed || !previousEvidenceItem) {
        newlyFailedCriteria.push(criterion.id);
      }
    }
  }

  const newlyValidArtifacts = goal.expectedArtifacts
    .map((artifact) => `artifact:${artifact.name}`)
    .filter((criterionId) => current.get(criterionId)?.passed && !previous.get(criterionId)?.passed);

  const blockedNodes = (runState?.nodes ?? [])
    .filter((node) =>
      node.status === "blocked" ||
      (
        node.status === "failed" &&
        node.retries >= node.maxRetries &&
        node.failurePolicy?.blockDependents !== false &&
        !node.outputs?.every((output) => output.required === false)
      )
    )
    .map((node) => node.id);

  const repeatedFailures = (runState?.nodes ?? [])
    .filter((node) => {
      if (node.status !== "failed") return false;
      const failedAttempts = node.attempts?.filter((attempt) => attempt.status === "failed").length ?? 0;
      return node.retries > 1 || failedAttempts > 1;
    })
    .map((node) => node.id);

  const value =
    newlyPassedCriteria.length * 3 +
    newlyPassedOptionalCriteria.length +
    newlyValidArtifacts.length * 2 -
    newlyFailedCriteria.length * 3 -
    blockedNodes.length * 2 -
    repeatedFailures.length;

  const repairableNodeExists = (runState?.nodes ?? []).some((node) =>
    node.status === "pending" ||
    node.status === "running" ||
    (node.status === "failed" && node.retries < node.maxRetries && node.failurePolicy?.retryable !== false)
  );
  const targetCriterionId = failedCriteria[0] ?? missingRequiredCriteria[0];
  const targetNodeId = blockedNodes[0] ?? repeatedFailures[0];

  let recommendation: NextAction = "continue";
  let reason = value > 0
    ? `evidence delta advanced by ${value}`
    : "no positive evidence delta detected";
  if (blockedNodes.length > 0 && !repairableNodeExists) {
    recommendation = "block";
    reason = `non-repairable blocked nodes: ${blockedNodes.join(", ")}`;
  } else if (runState?.completedAt && missingRequiredCriteria.length > 0) {
    recommendation = "handoff";
    reason = `run completed with missing criteria: ${missingRequiredCriteria.join(", ")}`;
  } else if (value <= 0 && (blockedNodes.length > 0 || repeatedFailures.length > 0)) {
    recommendation = "replan";
    reason = `stalled on ${targetNodeId ?? targetCriterionId ?? "goal"} without positive evidence delta`;
  }

  return {
    value,
    newlyPassedCriteria,
    newlyPassedOptionalCriteria,
    newlyValidArtifacts,
    newlyFailedCriteria,
    failedCriteria,
    missingRequiredCriteria,
    blockedNodes,
    repeatedFailures,
    recommendation,
    reason,
    targetCriterionId,
    targetNodeId,
    preserveEvidence: true,
  };
}

/**
 * Evaluate goal progress using an ensemble of decision candidates.
 * Returns the consensus next action without requiring human STOP/CONTINUE input.
 */
export async function evaluateGoalProgressEnsemble(
  goal: GoalSpec,
  runState: RunState,
  iterationContext?: { iterationCount: number; maxIterations: number },
  options: GoalProgressEnsembleOptions = {}
): Promise<EnsembleGoalProgress> {
  const timeoutController = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  const innerOptions: GoalProgressEnsembleOptions = {
    ...options,
    signal,
    deepseek: options.deepseek === false
      ? false
      : {
          ...(options.deepseek ?? {}),
          signal: options.deepseek?.signal ? AbortSignal.any([signal, options.deepseek.signal]) : signal,
        },
  };
  return withTimeout(
    evaluateGoalProgressEnsembleInner(goal, runState, iterationContext, innerOptions),
    120_000,
    "evaluateGoalProgressEnsemble",
    {
      signal,
      onTimeout: () => timeoutController.abort(new Error("evaluateGoalProgressEnsemble timed out")),
    }
  ).catch((err: unknown) => {
    const isTimeout = err instanceof Error &&
      (err.message.includes("Timeout after 120000ms") || err.message.includes("evaluateGoalProgressEnsemble timed out"));
    if (!isTimeout) throw err;
    console.warn(`[goal-control-loop] Ensemble evaluation timed out after 120s, forcing replan with narrow scope`);
    const score = scoreGoal(goal, []);
    const progressDelta = evaluateGoalProgressDelta(goal, [], runState);
    const ensemble = evaluateEnsembleDecision(goal, runState, [], { enabled: false });
    return {
      status: goal.status,
      score,
      nextAction: "replan" as NextAction,
      ensemble: {
        ...ensemble,
        nextPrompt: `Ensemble evaluation timed out after 120s. Narrow scope and retry.`,
        rationale: "timeout: forced replan",
      },
      progressDelta,
      noveltyReport: evaluatePromptNovelty({
        goal,
        runState,
        previousPrompt: ensemble.nextPrompt,
        evidence: [],
        action: "replan",
      }),
    };
  });
}

async function evaluateGoalProgressEnsembleInner(
  goal: GoalSpec,
  runState: RunState,
  iterationContext?: { iterationCount: number; maxIterations: number },
  options: GoalProgressEnsembleOptions = {}
): Promise<EnsembleGoalProgress> {
  const root = getProjectRoot();
  const evidence = await checkGoalEvidence(goal, { root, runState });
  const score = scoreGoal(goal, evidence);
  const progressDelta = evaluateGoalProgressDelta(goal, evidence, runState);
  const intentFrame = buildIntentFrameFromGoal(goal);
  const candidates = buildEnsembleCandidates(intentFrame, runState);
  const capabilityVotes = buildCapabilityVotes(
    runState.nodes.filter((n) => n.id.startsWith("capability-")),
    runState
  );
  const deepseekVote = await resolveDeepSeekGoalDecisionVote(goal, runState, evidence, score, options.deepseek);

  const baseExtraVotes: EnsembleDecisionCandidateVote[] = [
    ...(deepseekVote ? [deepseekVote] : []),
    ...capabilityVotes,
  ];

  const effectiveState: RunState = iterationContext
    ? { ...runState, iterationCount: iterationContext.iterationCount, maxIterations: iterationContext.maxIterations }
    : runState;

  // Context-aware maxIterations adjustment (enhancement 4)
  const hasExplicitMax = typeof iterationContext?.maxIterations === "number" && iterationContext.maxIterations > 0;
  if (!hasExplicitMax && (typeof runState.maxIterations !== "number" || runState.maxIterations <= 0)) {
    const nodeCount = runState.nodes?.length ?? 0;
    const complexityBasedMax = goal.successCriteria.length * 2 + goal.expectedArtifacts.length + nodeCount;
    runState.maxIterations = Math.max(3, complexityBasedMax);
    if (iterationContext) {
      effectiveState.maxIterations = runState.maxIterations;
    }
  }

  // Run ensemble decision engine early so adaptive guard can use it
  let ensemble: EnsembleDecisionResult & { preservedEvidence?: Array<{ nodeId: string; evidence: string }>; replanDepth?: number } = evaluateEnsembleDecision(goal, runState, evidence, {
    enabled: true,
    quorumRatio: 0.5,
    candidates,
    intentFrame,
    extraVotes: baseExtraVotes.length > 0 ? baseExtraVotes : undefined,
  });

  // Adaptive loop guard (enhancement 1)
  const guard = evaluateAdaptiveLoopGuard(effectiveState, progressDelta, ensemble);
  if (guard.shouldStop) {
    const forcedNextAction: NextAction = score.overall === "pass"
      ? "close"
      : isHardGoalFailure(progressDelta)
        ? "block"
        : "handoff";
    console.warn(`[goal-control-loop] Loop guard triggered: ${guard.reason}. Forcing nextAction="${forcedNextAction}".`);
    return {
      status: goal.status,
      score,
      nextAction: forcedNextAction,
      ensemble,
      progressDelta,
      noveltyReport: evaluatePromptNovelty({
        goal,
        runState: effectiveState,
        previousPrompt: ensemble.nextPrompt,
        evidence,
        action: forcedNextAction,
      }),
    };
  }

  // If ensemble has high confidence (>0.7), trust it; otherwise fall back to basic logic
  let nextAction: NextAction;
  if (score.overall === "pass") {
    nextAction = "close";
  } else if (score.overall === "fail" && isHardGoalFailure(progressDelta)) {
    nextAction = "block";
  } else if (ensemble.confidence >= 0.7) {
    nextAction = ensemble.action;
  } else if (runState.completedAt) {
    nextAction = "handoff";
  } else {
    nextAction = "continue";
  }
  if (nextAction === "block" && !isHardGoalFailure(progressDelta)) {
    nextAction = runState.completedAt ? "handoff" : "continue";
  }

  // Loop oscillation detection and dampening (enhancement 3)
  const history = getAdaptiveHistory(runState.runId);
  const oscillation = detectOscillationDampen(history.actions);
  if (oscillation.dampened && nextAction !== "close" && nextAction !== "block") {
    nextAction = oscillation.action;
    ensemble = {
      ...ensemble,
      nextPrompt: ensemble.nextPrompt
        ? `${ensemble.nextPrompt}\n\n## Oscillation Dampen\n${oscillation.hint}`
        : oscillation.hint,
    };
  }

  // Apply forced next action from adaptive guard oscillation override
  if (guard.forcedNextAction) {
    nextAction = guard.forcedNextAction;
  }

  let noveltyReport = evaluatePromptNovelty({
    goal,
    runState,
    previousPrompt: ensemble.nextPrompt,
    evidence,
    action: nextAction,
  });

  // Replan path with smart enhancements (enhancement 2)
  if (
    nextAction === "continue" &&
    progressDelta.value <= 0 &&
    (noveltyReport.recommendation === "replan" || progressDelta.recommendation === "replan")
  ) {
    nextAction = "replan";
    ensemble = {
      ...ensemble,
      action: "replan",
      shouldContinue: true,
      rationale: `${ensemble.rationale}\nEvidence delta guard: ${progressDelta.reason}\nNovelty guard: ${noveltyReport.reason}`,
      nextPrompt: appendEvidenceDeltaReplanPrompt(ensemble.nextPrompt, progressDelta, noveltyReport),
    };
    noveltyReport = { ...noveltyReport, recommendation: "replan" };
  }

  if (nextAction === "replan") {
    const currentDepth = history.replanDepth;
    if (currentDepth >= 3) {
      nextAction = "handoff";
      ensemble = { ...ensemble, action: "handoff", shouldContinue: false };
    } else {
      history.replanDepth++;
      const preservedEvidence = (runState.nodes ?? [])
        .filter((node) => node.status === "done")
        .flatMap((node) =>
          (node.evidence ?? []).map((ev) => ({
            nodeId: node.id,
            evidence: `${ev.gate}: ${ev.passed ? "passed" : "failed"}`,
          }))
        );
      ensemble = { ...ensemble, preservedEvidence, replanDepth: currentDepth + 1 };

      if (progressDelta.repeatedFailures.length > 1) {
        const targetAtom = intentFrame.actionAtoms.find((atom) => atom.id === progressDelta.targetNodeId) ?? intentFrame.actionAtoms[0];
        if (targetAtom) {
          ensemble = {
            ...ensemble,
            nextPrompt: `${ensemble.nextPrompt ?? ""}\n\n## Atom Split Suggestion\nTarget atom '${targetAtom.label}' has repeated failures. Consider splitting into smaller sub-atoms:\n- ${targetAtom.label}-part-a\n- ${targetAtom.label}-part-b`,
          };
        }
      }
    }
  }

  // Ensemble confidence decay tracking (enhancement 7)
  if (history.confidence !== undefined && ensemble.confidence < history.confidence - 0.20) {
    const decayWarning = `Warning: ensemble confidence dropped from ${history.confidence.toFixed(2)} to ${ensemble.confidence.toFixed(2)}. Consider narrower scope or handoff.`;
    ensemble = {
      ...ensemble,
      nextPrompt: ensemble.nextPrompt
        ? `${ensemble.nextPrompt}\n\n## Confidence Decay Warning\n${decayWarning}`
        : decayWarning,
    };
  }

  // Persist important ensemble decisions to the configured graph memory backend.
  if (ensemble.confidence >= 0.5) {
    const recentDecisions = await recallRecentEnsembleDecisions(goal.goalId, root, 3).catch(() => [] as SavedEnsembleDecision[]);
    const previousConfidence = recentDecisions[0]?.confidence;
    const confidenceTrend: "rising" | "falling" | "stable" = previousConfidence === undefined
      ? "stable"
      : ensemble.confidence > previousConfidence + 0.05
        ? "rising"
        : ensemble.confidence < previousConfidence - 0.05
          ? "falling"
          : "stable";
    await saveEnsembleDecision(goal, runState, ensemble, root, {
      divergence: ensemble.divergence ?? detectEnsembleDivergence(ensemble.candidateVotes),
      confidenceTrend,
    }).catch(() => {
      // ignore persistence failures
    });
  }

  // Update adaptive history
  updateAdaptiveHistory(runState.runId, nextAction, progressDelta, ensemble.confidence);
  if (runState.completedAt || nextAction === "close" || nextAction === "block" || nextAction === "handoff") {
    cleanupControlLoopRun(runState.runId);
  }

  return {
    status: goal.status,
    score,
    nextAction,
    ensemble,
    noveltyReport,
    progressDelta,
  };
}

function appendEvidenceDeltaReplanPrompt(
  prompt: string | undefined,
  progressDelta: GoalProgressDelta,
  noveltyReport: PromptNoveltyReport
): string {
  const lines = [
    prompt ?? `Replan from the strict action DAG because ${noveltyReport.reason}.`,
    "",
    "## Evidence Delta Replan",
    `- Progress delta: ${progressDelta.value}`,
    `- Reason: ${progressDelta.reason}`,
    `- Stalled criterion: ${progressDelta.targetCriterionId ?? "auto"}`,
    `- Blocked/repeated node: ${progressDelta.targetNodeId ?? "none"}`,
    `- Preserve completed evidence: ${progressDelta.preserveEvidence ? "yes" : "no"}`,
    "- Do not re-run completed work unless evidence is stale or invalid.",
    "- Keep MCP, skills, hooks, and tool authority scoped to the next action atom.",
  ];
  return lines.join("\n");
}

function isHardGoalFailure(progressDelta: GoalProgressDelta): boolean {
  return progressDelta.failedCriteria.length > 0 || progressDelta.blockedNodes.length > 0;
}

function latestGoalEvidenceByCriterion(evidence: GoalEvidence[]): Map<string, GoalEvidence> {
  const latest = new Map<string, GoalEvidence>();
  for (const item of evidence) {
    const previous = latest.get(item.criterionId);
    if (!previous || evidenceCheckedAt(item) >= evidenceCheckedAt(previous)) {
      latest.set(item.criterionId, item);
    }
  }
  return latest;
}

function evidenceCheckedAt(evidence: GoalEvidence): number {
  const timestamp = Date.parse(evidence.checkedAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function isHardFailureEvidence(evidence: GoalEvidence): boolean {
  if (evidence.passed) return false;
  const message = (evidence.message ?? "").toLocaleLowerCase();
  if (
    /required criterion missing evidence|optional criterion missing evidence|missing evidence|lacks passing evidence/.test(message)
  ) {
    return false;
  }
  return true;
}

async function resolveDeepSeekGoalDecisionVote(
  goal: GoalSpec,
  runState: RunState,
  evidence: GoalEvidence[],
  score: import("../contracts/goal.js").GoalScore,
  options: GoalProgressEnsembleOptions["deepseek"]
): Promise<EnsembleDecisionCandidateVote | undefined> {
  if (options === false) return undefined;
  const env = options?.env ?? process.env;
  if (options?.enabled === false || parseOptionalBoolean(env.OMK_DEEPSEEK_GOAL_ENSEMBLE) === false) {
    return undefined;
  }
  if (options?.signal?.aborted) {
    return deepseekUnavailableVote("aborted before DeepSeek advisory", options?.weight);
  }

  const failureCount = deepseekFailureCounts.get(runState.runId) ?? 0;
  if (failureCount > 2) {
    return deepseekUnavailableVote("circuit breaker open: too many failures in this run", options?.weight);
  }

  const context: DeepSeekGoalDecisionContext = { goal, runState, evidence, score, signal: options?.signal };
  if (options?.advisor) {
    try {
      const vote = await options.advisor(context);
      return vote ? normalizeDeepSeekDecisionVote(vote, options.weight) : undefined;
    } catch (err: unknown) {
      recordDeepSeekFailure(runState.runId);
      return deepseekUnavailableVote(`advisor failed: ${sanitizeDeepSeekMessage(err)}`, options.weight);
    }
  }

  const status = await getDeepSeekProviderStatus({ env }).catch(() => undefined);
  if (!status?.enabled || !status.apiKeySet) return undefined;

  const resolved = await resolveDeepSeekApiKey({ env }).catch(() => undefined);
  if (!resolved?.apiKey) return undefined;

  const health = await checkDeepSeekBalance({
    apiKey: resolved.apiKey,
    env,
    fetchImpl: options?.fetchImpl,
    timeoutMs: Math.min(options?.timeoutMs ?? 10_000, 20_000),
    signal: options?.signal,
  });
  if (!health.available) {
    recordDeepSeekFailure(runState.runId);
    return deepseekUnavailableVote(health.reason ?? "preflight unavailable", options?.weight);
  }

  const client = new DeepSeekClient({
    apiKey: resolved.apiKey,
    env,
    fetchImpl: options?.fetchImpl,
    model: DEEPSEEK_V4_PRO_MODEL,
    reasoningEffort: "max",
    timeoutMs: options?.timeoutMs ?? 45_000,
  });

  try {
    const content = await client.complete({
      messages: [
        {
          role: "system",
          content: [
            "You are DeepSeek inside the OMK goal-progress ensemble.",
            "The configured OMK authority provider remains the orchestrator and final authority.",
            "You have no file, shell, MCP, secret, or merge authority.",
            "Return JSON only with action, confidence, and reason.",
            "Allowed action values: continue, replan, block, handoff, close.",
          ].join(" ") || "You are DeepSeek inside OMK. Return JSON with action, confidence, and reason.",
        },
        { role: "user", content: buildDeepSeekGoalDecisionPrompt(goal, runState, evidence, score) },
      ],
      maxTokens: options?.maxTokens ?? 512,
      thinking: "max",
      signal: options?.signal,
    });

    return normalizeDeepSeekDecisionVote(parseDeepSeekDecisionVote(content, options?.weight), options?.weight);
  } catch (err: unknown) {
    recordDeepSeekFailure(runState.runId);
    return deepseekUnavailableVote(`chat failed: ${sanitizeDeepSeekMessage(err)}`, options?.weight);
  }
}

function buildDeepSeekGoalDecisionPrompt(
  goal: GoalSpec,
  runState: RunState,
  evidence: GoalEvidence[],
  score: import("../contracts/goal.js").GoalScore
): string {
  const missing = evaluateMissingCriteria(goal, evidence);
  const nodes = describeNodes(runState.nodes, 10);
  const nodeEvidence = describeNodeEvidence(runState, 10);
  const providerAttempts = describeProviderAttempts(runState, 10);
  const goalEvidence = evidence.slice(-10).map((item) => {
    const message = item.message ? ` — ${truncateLine(item.message, 160)}` : "";
    const ref = item.ref ? ` (${item.ref})` : "";
    return `- ${item.criterionId}: ${item.passed ? "passed" : "failed"}${ref}${message}`;
  });

  return [
    "# OMK Goal Progress Snapshot",
    `Goal: ${goal.title}`,
    renderPromptDigest("Objective digest", goal.objective, { maxKeywords: 18, maxPhrases: 3 }),
    `Risk level: ${goal.riskLevel}`,
    `Score: ${score.overall} required=${score.requiredPassed}/${score.requiredTotal} optional=${score.optionalScore.toFixed(2)} qualityGate=${score.qualityGatePassed}`,
    "",
    "Missing criteria:",
    ...(missing.length > 0 ? missing.slice(0, 10).map((item) => `- ${item.criterionId}: ${item.description} (${item.requirement})`) : ["- none"]),
    "",
    "Run nodes:",
    ...(nodes.length > 0 ? nodes : ["- none"]),
    "",
    "Node evidence:",
    ...(nodeEvidence.length > 0 ? nodeEvidence : ["- none"]),
    "",
    "Goal evidence:",
    ...(goalEvidence.length > 0 ? goalEvidence : ["- none"]),
    "",
    "Provider attempts:",
    ...(providerAttempts.length > 0 ? providerAttempts : ["- none"]),
    "",
    "Choose the next action for the Kimi control loop.",
    "Return compact JSON only, e.g. {\"action\":\"continue\",\"confidence\":0.82,\"reason\":\"...\"}.",
  ].join("\n");
}

function parseDeepSeekDecisionVote(content: string, fallbackWeight: number | undefined): EnsembleDecisionCandidateVote {
  const parsed = parseJsonObject(content);
  const action = isNextAction(parsed?.action) ? parsed.action : "continue";
  const confidence = clampConfidence(Number(parsed?.confidence));
  const reason = typeof parsed?.reason === "string" && parsed.reason.trim()
    ? parsed.reason
    : content;
  return {
    id: "deepseek-v4-pro",
    action,
    weight: Math.max(0.1, (fallbackWeight ?? 0.9) * confidence),
    reason: `DeepSeek advisory: ${truncateLine(reason, 180)}`,
  };
}

function parseJsonObject(content: string): Record<string, unknown> | undefined {
  const trimmed = content.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    trimmed.match(/\{[\s\S]*\}/)?.[0],
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

function normalizeDeepSeekDecisionVote(
  vote: EnsembleDecisionCandidateVote,
  fallbackWeight: number | undefined
): EnsembleDecisionCandidateVote | undefined {
  if (!isNextAction(vote.action)) return undefined;
  const weight = Number.isFinite(vote.weight) && vote.weight > 0
    ? vote.weight
    : fallbackWeight ?? 0.9;
  return {
    id: vote.id || "deepseek-v4-pro",
    action: vote.action,
    weight,
    reason: truncateLine(vote.reason || "DeepSeek advisory", 220),
  };
}

function deepseekUnavailableVote(reason: string, fallbackWeight: number | undefined): EnsembleDecisionCandidateVote {
  return {
    id: "deepseek-v4-pro",
    action: "continue",
    weight: Math.min(0.2, fallbackWeight ?? 0.2),
    reason: `DeepSeek advisory unavailable: ${truncateLine(reason, 180)}`,
  };
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function isNextAction(value: unknown): value is NextAction {
  return value === "continue" || value === "replan" || value === "block" || value === "handoff" || value === "close";
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.6;
  return Math.max(0.1, Math.min(1, value));
}

function sanitizeDeepSeekMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export interface NextPromptResult {
  prompt: string;
  missingCriteria: MissingCriterion[];
  suggestion: NextActionSuggestion;
  nextActionContract: NextActionContract;
  noveltyReport: PromptNoveltyReport;
  progressDelta: GoalProgressDelta;
  memorySummary: string;
  recommendedCommands: string[];
  recommendedSkills: string[];
  verificationGates: string[];
}

export async function recallMemoryForGoal(goal: GoalSpec, root: string, runState?: RunState, signal?: AbortSignal): Promise<string> {
  const memoryStore = new MemoryStore(join(root, ".omk", "memory"), {
    projectRoot: root,
    source: "goal-continue",
  });

  const parts: string[] = [];

  try {
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
    const mindmap = await memoryStore.mindmap(goal.title, 40);
    if (mindmap && mindmap.nodes.length > 0) {
      const relevant = mindmap.nodes
        .filter((n) => n.type === "Goal" || n.type === "Task" || n.type === "Decision" || n.type === "Evidence")
        .slice(0, 10)
        .map((n) => `- ${n.label} (${n.type})`)
        .join("\n");
      if (relevant) {
        parts.push("### Mindmap", relevant);
      }
    }
  } catch {
    // ignore mindmap failures
  }

  try {
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
    const searchResults = await memoryStore.search(goal.objective, 10);
    if (searchResults.length > 0) {
      const relevant = searchResults
        .slice(0, 5)
        .map((r) => `- ${r.path}: ${r.content.slice(0, 120)}`)
        .join("\n");
      parts.push("### Search Results", relevant);
    }
  } catch {
    // ignore search failures
  }

  // Previous ensemble decisions from memory (enhancement 5)
  try {
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
    const decisions = await recallRecentEnsembleDecisions(goal.goalId, root, 3);
    if (decisions.length > 0) {
      const lines = decisions.map((d) => `- ${d.timestamp}: action=${d.action}, confidence=${d.confidence.toFixed(2)}`);
      parts.push("### Previous Ensemble Decisions", ...lines);
    }
  } catch {
    // ignore
  }

  // Failed node patterns from run state (enhancement 5)
  if (runState) {
    const failedPatterns = runState.nodes
      .filter((n) => n.status === "failed")
      .map((n) => `- ${n.id}: ${n.blockedReason ?? "failed"} (attempts=${n.attempts?.length ?? 0})`);
    if (failedPatterns.length > 0) {
      parts.push("### Failed Node Patterns", ...failedPatterns);
    }
  }

  return parts.join("\n");
}

export async function generateNextPrompt(
  goal: GoalSpec,
  evidence: GoalEvidence[],
  runState?: RunState,
  memorySummary?: string,
  root?: string,
): Promise<NextPromptResult> {
  const timeoutController = new AbortController();
  return withTimeout(
    generateNextPromptInner(goal, evidence, runState, memorySummary, root, timeoutController.signal),
    120_000,
    "generateNextPrompt",
    {
      onTimeout: () => timeoutController.abort(new Error("generateNextPrompt timed out")),
    }
  ).catch((err: unknown) => {
    const isTimeout = err instanceof Error && (
      err.message.includes("Timeout after 120000ms") ||
      err.message.includes("generateNextPrompt timed out")
    );
    if (!isTimeout) throw err;
    console.warn(`[goal-control-loop] generateNextPrompt timed out after 120s, returning narrow replan prompt`);
    const suggestion = suggestNextAction(goal, evidence);
    return {
      prompt: `Next prompt generation timed out after 120s. Narrow scope and retry.\n\n## Timeout Replan\n- Reason: prompt generation exceeded 120s\n- Target: ${suggestion.targetId ?? "auto"}\n- Keep MCP, skills, hooks, and tool authority scoped to the next action atom.`,
      missingCriteria: evaluateMissingCriteria(goal, evidence),
      suggestion,
      nextActionContract: buildNextActionContract("replan", "atom-plan", suggestion.description, buildIntentFrameFromGoal(goal)),
      noveltyReport: evaluatePromptNovelty({ goal, runState, previousPrompt: undefined, evidence, action: "replan" }),
      progressDelta: evaluateGoalProgressDelta(goal, evidence, runState),
      memorySummary: memorySummary ?? "",
      recommendedCommands: ["npm run check", "npm run test"],
      recommendedSkills: ["omk-quality-gate", "omk-test-debug-loop"],
      verificationGates: ["Type-check passes", "Tests pass"],
    };
  });
}

async function generateNextPromptInner(
  goal: GoalSpec,
  evidence: GoalEvidence[],
  runState?: RunState,
  memorySummary?: string,
  root?: string,
  signal?: AbortSignal,
): Promise<NextPromptResult> {
  if (signal?.aborted) throw signal.reason ?? new Error("Aborted");

  let resolvedMemorySummary = memorySummary ?? "";
  if (!resolvedMemorySummary && root) {
    try {
      resolvedMemorySummary = await withTimeout(
        recallMemoryForGoal(goal, root, runState, signal),
        5_000,
        "recallMemoryForGoal",
        { signal }
      );
    } catch {
      console.warn(`[goal-control-loop] Memory recall timed out after 5s, continuing without memory context`);
      resolvedMemorySummary = "";
    }
  }

  if (signal?.aborted) throw signal.reason ?? new Error("Aborted");

  const missingCriteria = evaluateMissingCriteria(goal, evidence);
  const suggestion = suggestNextAction(goal, evidence);
  const intentFrame = buildIntentFrameFromGoal(goal);

  const completedCriteria = goal.successCriteria.filter((c) => {
    const ev = evidence.find((e) => e.criterionId === c.id);
    return ev?.passed ?? false;
  });

  const failedNodes = runState?.nodes.filter((n) => n.status === "failed") ?? [];
  const blockedNodes = runState?.nodes.filter((n) => n.status === "blocked") ?? [];
  const runningNodes = runState?.nodes.filter((n) => n.status === "running") ?? [];
  const pendingNodes = runState?.nodes.filter((n) => n.status === "pending") ?? [];
  const successNodes = runState?.nodes.filter((n) => n.status === "done") ?? [];
  const proposedAction: NextAction = suggestion.type === "close"
    ? "close"
    : failedNodes.length > 0 || blockedNodes.length > 0
      ? "replan"
      : "continue";
  const noveltyReport = evaluatePromptNovelty({
    goal,
    runState,
    previousPrompt: [
      suggestion.description,
      ...describeNodes([...(failedNodes.length > 0 ? failedNodes : pendingNodes)], 4),
    ].join("\n"),
    evidence,
    action: proposedAction,
  });
  const progressDelta = evaluateGoalProgressDelta(goal, evidence, runState);
  const contractAtom = noveltyReport.recommendation === "replan"
    ? intentFrame.actionAtoms.find((atom) => atom.label.startsWith("plan-"))
    : intentFrame.actionAtoms.find((atom) =>
      ["implement-change", "inspect-context", "test-scenario", "document-result", "produce-artifact", "verify-evidence"].includes(atom.label)
    );
  const nextActionContract = buildNextActionContract(
    noveltyReport.recommendation,
    contractAtom?.id ?? intentFrame.actionAtoms[0]?.id ?? "atom-plan",
    suggestion.description,
    intentFrame
  );

  const lines: string[] = [
    `# Context-Aware Goal Follow-up: strict-action-dag`,
    ``,
    `## Kimi Context Synthesis`,
    `Treat this document as context for the next action, not as text to repeat verbatim.`,
    `Kimi should infer the next concrete prompt from the latest evidence, failed/blocked nodes, missing criteria, and related memory.`,
    `Do not repeat the original goal verbatim. Do not restart completed work unless its evidence is invalid or stale.`,
    ``,
    `## Goal Reference (non-verbatim)`,
    renderPromptDigest("Original objective digest", goal.objective),
    ``,
    `## Strict Intent / Action Digest`,
    renderActionDigest(intentFrame),
    ``,
    `## Next Action Contract`,
    `- Action: ${nextActionContract.action}`,
    `- Target: ${nextActionContract.targetId}`,
    `- Description: ${nextActionContract.description}`,
    `- Evidence target: ${nextActionContract.evidenceTarget}`,
    `- Done condition: ${nextActionContract.doneCondition}`,
    ``,
    `## Novelty Guard`,
    `- Recommendation: ${noveltyReport.recommendation}`,
    `- Reason: ${noveltyReport.reason}`,
    `- Similarity to original: ${noveltyReport.similarityToOriginal}`,
    `- Similarity to previous: ${noveltyReport.similarityToPrevious}`,
    `- Evidence delta: ${noveltyReport.evidenceDelta}`,
    `- Progress delta: ${noveltyReport.progressDelta}`,
    `- Replay risk: ${noveltyReport.replayRisk}`,
    `- Oscillation: ${noveltyReport.oscillation}`,
    `- Target atom: ${noveltyReport.targetAtomId ?? "auto"}`,
    `- New evidence: ${noveltyReport.hasNewEvidence}`,
    ``,
    `## Immediate Focus`,
    `- Type: ${suggestion.type}`,
    `- Target: ${suggestion.targetId}`,
    `- Description: ${suggestion.description}`,
    `- Reason: ${suggestion.reason}`,
    `- Priority: ${describeImmediatePriority(missingCriteria, failedNodes, blockedNodes)}`,
    ``,
    `## Success Criteria`,
    `### Completed (${completedCriteria.length}/${goal.successCriteria.length})`,
    ...completedCriteria.map((c) => `- [x] ${c.description}`),
    ``,
    `### Missing (${missingCriteria.length})`,
    ...missingCriteria.map((c) => `- [ ] ${c.description} (${c.requirement}, priority: ${c.priority})`),
    ``,
  ];

  if (nextActionContract.action === "replan") {
    lines.push(
      `## Evidence Delta Replan`,
      `- Progress delta: ${progressDelta.value}`,
      `- Reason: ${progressDelta.reason}`,
      `- Stalled criterion: ${progressDelta.targetCriterionId ?? "auto"}`,
      `- Blocked/repeated node: ${progressDelta.targetNodeId ?? "none"}`,
      `- Preserve completed evidence: ${progressDelta.preserveEvidence ? "yes" : "no"}`,
      `- Do not re-run completed nodes unless evidence is stale or invalid.`,
      `- Keep MCP, skills, hooks, and tool authority scoped to the next action atom.`,
      ``,
    );
  }

  if (runState) {
    lines.push(
      `## Previous Run Results`,
      `- Run ID: ${runState.runId}`,
      `- Successful nodes: ${successNodes.length}`,
      `- Failed nodes: ${failedNodes.length}`,
      `- Blocked nodes: ${blockedNodes.length}`,
      `- Running nodes: ${runningNodes.length}`,
      `- Pending nodes: ${pendingNodes.length}`,
    );
    if (successNodes.length > 0) {
      lines.push(`### Completed Nodes`, ...describeNodes(successNodes));
    }
    if (failedNodes.length > 0) {
      lines.push(`### Failed Nodes`, ...describeNodes(failedNodes));
    }
    if (blockedNodes.length > 0) {
      lines.push(`### Blocked Nodes`, ...describeNodes(blockedNodes));
    }
    const evidenceSummary = describeNodeEvidence(runState);
    if (evidenceSummary.length > 0) {
      lines.push(`### Recent Evidence`, ...evidenceSummary);
    }
    const attemptSummary = describeProviderAttempts(runState);
    if (attemptSummary.length > 0) {
      lines.push(`### Provider / Fallback Notes`, ...attemptSummary);
    }
    lines.push("");
  }

  // Progress stall detection with narrower atom splitting (enhancement 6)
  if (runState) {
    const history = getAdaptiveHistory(runState.runId);
    const recentStallCount = history.progressDeltas.slice(-2).filter((v) => v <= 0).length;
    if (recentStallCount >= 2 && blockedNodes.length === 0 && pendingNodes.length > 0) {
      const targetAtom = intentFrame.actionAtoms
        .filter((atom) => !successNodes.some((n) => n.routing?.actionAtom?.id === atom.id))
        .sort((a, b) => b.label.length - a.label.length)[0];
      if (targetAtom) {
        lines.push(
          `## Recommended Atom Split`,
          `The goal has stalled for ${recentStallCount} iterations with pending work. Consider splitting '${targetAtom.label}' into:`,
          `- ${targetAtom.label}-part-a: narrower scope A`,
          `- ${targetAtom.label}-part-b: narrower scope B`,
          ``,
        );
      }
    }
  }

  if (resolvedMemorySummary) {
    lines.push(
      `## Related Memory`,
      resolvedMemorySummary,
      ``,
    );
  }

  const recommendedCommands: string[] = [];
  const recommendedSkills: string[] = [];
  const verificationGates: string[] = [];

  if (missingCriteria.length > 0) {
    recommendedCommands.push("npm run check", "npm run test");
    recommendedSkills.push("omk-quality-gate", "omk-test-debug-loop");
    verificationGates.push("Type-check passes", "Tests pass");
  }

  if (goal.expectedArtifacts.length > 0) {
    recommendedSkills.push("omk-code-review");
    verificationGates.push("Expected artifacts exist");
  }

  if (goal.constraints.length > 0) {
    recommendedSkills.push("omk-security-review");
    verificationGates.push("Constraints satisfied");
  }

  if (resolvedMemorySummary) {
    recommendedSkills.push("omk-context-broker", "omk-project-rules");
    recommendedCommands.push("omk_search_memory", "omk_memory_mindmap");
  }

  lines.push(
    `## Recommended Next Action`,
    `- Type: ${suggestion.type}`,
    `- Target: ${suggestion.targetId}`,
    `- Description: ${suggestion.description}`,
    `- Reason: ${suggestion.reason}`,
    ``,
    `## Recommended Commands`,
    ...recommendedCommands.map((c) => `- \`${c}\``),
    ``,
    `## Recommended Skills`,
    ...recommendedSkills.map((s) => `- ${s}`),
    ``,
    `## Verification Gates`,
    ...verificationGates.map((g) => `- [ ] ${g}`),
    ``,
    `## Instructions`,
    `Convert the context above into the next concrete Kimi action; do not send the same original goal prompt again.`,
    `Focus on the missing criteria and recommended next action while preserving completed nodes and valid evidence.`,
    `Run the recommended commands after making changes. Activate relevant skills for each sub-task.`,
  );

  const prompt = lines.join("\n");

  return {
    prompt,
    missingCriteria,
    suggestion,
    nextActionContract,
    noveltyReport,
    progressDelta,
    memorySummary: resolvedMemorySummary,
    recommendedCommands,
    recommendedSkills,
    verificationGates,
  };
}

function describeImmediatePriority(
  missingCriteria: MissingCriterion[],
  failedNodes: RunState["nodes"],
  blockedNodes: RunState["nodes"]
): string {
  if (blockedNodes.length > 0) return `unblock ${blockedNodes[0]?.id ?? "blocked-node"} before retrying dependent work`;
  if (failedNodes.length > 0) return `repair failed node ${failedNodes[0]?.id ?? "failed-node"} with a narrower retry plan`;
  if (missingCriteria.length > 0) return `satisfy missing criterion ${missingCriteria[0]?.criterionId ?? "criterion"}`;
  return "verify completion and close if all evidence remains valid";
}

function describeNodes(nodes: RunState["nodes"], limit = 8): string[] {
  const visible = nodes.slice(0, limit).map((node) => {
    const reason = node.blockedReason ? ` — ${truncateLine(node.blockedReason, 180)}` : "";
    const attempts = node.attempts?.length ? `, attempts=${node.attempts.length}` : "";
    return `- ${node.id}: ${node.name} (${node.role}${attempts})${reason}`;
  });
  if (nodes.length > limit) {
    visible.push(`- ... ${nodes.length - limit} more`);
  }
  return visible;
}

function describeNodeEvidence(runState: RunState, limit = 8): string[] {
  const entries = runState.nodes.flatMap((node) =>
    (node.evidence ?? []).map((evidence) => {
      const message = evidence.message ? ` — ${truncateLine(evidence.message, 180)}` : "";
      const ref = evidence.ref ? ` (${evidence.ref})` : "";
      return `- ${node.id}/${evidence.gate}: ${evidence.passed ? "passed" : "failed"}${ref}${message}`;
    })
  );
  return entries.slice(-limit);
}

function describeProviderAttempts(runState: RunState, limit = 8): string[] {
  const entries = runState.nodes.flatMap((node) =>
    (node.attempts ?? []).map((attempt) => {
      const details = [
        attempt.requestedProvider ? `requested=${attempt.requestedProvider}` : "",
        attempt.provider ? `provider=${attempt.provider}` : "",
        attempt.fallbackFrom ? `fallbackFrom=${attempt.fallbackFrom}` : "",
        attempt.fallbackReason ? `reason=${truncateLine(attempt.fallbackReason, 160)}` : "",
      ].filter(Boolean).join(" ");
      return `- ${node.id}#${attempt.attempt}: ${details}`;
    })
  ).filter((line) => line.includes("provider=") || line.includes("fallbackFrom="));
  return entries.slice(-limit);
}

function truncateLine(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}…`;
}

/**
 * Evaluate which success criteria still lack passing evidence.
 * Returns ordered list with required criteria first, then by weight desc.
 */


/**
 * Incremental evaluation: re-evaluate progress with current evidence.
 * Suitable for calling mid-run without recomputing the full run state.
 */
export function evaluateGoalProgressIncremental(
  goal: GoalSpec,
  evidence: GoalEvidence[]
): { score: import("../contracts/goal.js").GoalScore; suggestion: NextActionSuggestion } {
  const score = scoreGoal(goal, evidence);
  const suggestion = suggestNextAction(goal, evidence);
  return { score, suggestion };
}
