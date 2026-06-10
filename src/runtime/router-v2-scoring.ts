/**
 * Router V2 Scoring Engine — Bayesian-smoothed evidence calibration (Algorithm 6).
 *
 * Composite formula (omk.weights.v1 routerV2Composite vector, normalize:true):
 *   ŵ_E*E + ŵ_conf*conf + ŵ_cap*cap + ŵ_mat*mat + ŵ_lat*lat + ŵ_cost*cost
 *   - p̂_fail*pen - p̂_blast*blast
 *
 * Historical raw weights (0.25/0.15/0.20/0.15/0.10/0.10 − 0.15/0.10) had a
 * positive Σ = 0.95; normalization divides weights AND penalties by the same
 * factor (1/0.95), a pure uniform scaling. The composite is ranking-only
 * (no absolute threshold compares it), so rankings are identical.
 */

import type { AgentRuntime } from "./agent-runtime.js";
import type { RuntimeCapabilities } from "./agent-runtime.js";
import type {
  EvidenceHistoryEntry,
  NodeIntent,
  RuntimeRouterDecisionV2,
  RuntimeScoreV2,
  RouterV2Options,
  RouterV2ScoringEngine,
  BlastRadiusParams,
} from "./contracts/router-v2.js";
import { computeBlastRadiusPenalty } from "./blast-radius.js";
import { intentCapabilityWeights, routerV2CompositeEffective } from "./weights-config.js";

const ALPHA_0 = 1;
const BETA_0 = 1;

/**
 * Intent → capability emphasis vectors, sourced verbatim from the
 * omk.weights.v1 intentCapability vector family (normalize:false — sub-unit
 * sums are intentional feature-fit emphasis templates).
 */
const INTENT_CAPABILITY_WEIGHTS: Record<
  NodeIntent,
  ReadonlyArray<readonly [keyof RuntimeCapabilities | "toolCalling", number]>
> = intentCapabilityWeights();

/** Effective (normalized) composite weights/penalties — raw values ÷ 0.95. */
const COMPOSITE_EFFECTIVE = routerV2CompositeEffective();

function runtimeCapabilityEnabled(
  capabilities: RuntimeCapabilities,
  capability: keyof RuntimeCapabilities | "toolCalling",
): boolean {
  if (capability === "toolCalling") {
    return capabilities.toolCalling === true || capabilities.supportsToolCalling === true;
  }
  if (capability === "streaming") {
    return capabilities.streaming === true || capabilities.supportsStreaming === true;
  }
  return capabilities[capability as keyof RuntimeCapabilities] === true;
}

function computeCapabilityFit(runtime: AgentRuntime, intent: NodeIntent): number {
  const caps = runtime.capabilities;
  if (!caps) return 0;

  let score = 0;
  for (const [capability, weight] of INTENT_CAPABILITY_WEIGHTS[intent]) {
    if (runtimeCapabilityEnabled(caps, capability)) score += weight;
  }
  if (caps.maxTokens != null && caps.maxTokens > 0) {
    score += Math.min(0.1, caps.maxTokens / 1_000_000);
  }
  if (caps.maxContextTokens != null && caps.maxContextTokens > 0) {
    score += Math.min(0.1, caps.maxContextTokens / 1_000_000);
  }
  return score;
}

function computeMaturityScore(runtime: AgentRuntime): number {
  const caps = runtime.capabilities;
  if (!caps) return 0.5;

  const capabilityCount = [
    caps.read,
    caps.write,
    caps.shell,
    caps.patch,
    caps.review,
    caps.merge,
    caps.vision,
    caps.mcp,
    caps.toolCalling,
    caps.supportsToolCalling,
  ].filter(Boolean).length;

  const breadthScore = Math.min(1, capabilityCount / 8);
  const priorityScore = Math.max(0, Math.min(1, runtime.priority / 100));
  return 0.6 * breadthScore + 0.4 * priorityScore;
}

function computeLatencyScore(runtime: AgentRuntime): number {
  return runtime.capabilities?.supportsStreaming === true || runtime.capabilities?.streaming === true
    ? 0.85
    : 0.70;
}

function computeCostScore(runtime: AgentRuntime): number {
  return runtime.priority > 50 ? 0.75 : 0.90;
}

export function createRouterV2ScoringEngine(
  options: RouterV2Options = {},
  blastRadiusFn: (params: BlastRadiusParams) => number = computeBlastRadiusPenalty,
): RouterV2ScoringEngine {
  const {
    enableBlastRadius = false,
    blastRadiusParams = { downstreamNodeCount: 0, affectedFileCount: 0, hasGlobalSideEffects: false },
  } = options;

  function score(runtime: AgentRuntime, intent: NodeIntent, history: EvidenceHistoryEntry[]): RuntimeScoreV2 {
    const runtimeHistory = history.filter((e) => e.runtime === runtime.id);

    const totalAttempts = runtimeHistory.length;
    const passedAttempts = runtimeHistory.filter((e) => e.passed).length;

    // Bayesian smoothing with α₀=1, β₀=1
    const bayesianEvidenceScore = (ALPHA_0 + passedAttempts) / (ALPHA_0 + BETA_0 + totalAttempts);

    // Confidence increases with sample size (asymptotic toward 1)
    const confidence = Math.min(1, totalAttempts / 10 + 0.1);

    const recentFailures = runtimeHistory
      .filter((e) => !e.passed)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 5);
    const recentFailurePenalty = Math.min(0.3, recentFailures.length * 0.06);

    const capabilityFit = computeCapabilityFit(runtime, intent);
    const maturityScore = computeMaturityScore(runtime);
    const latencyScore = computeLatencyScore(runtime);
    const costScore = computeCostScore(runtime);

    const blastRadiusPenalty = enableBlastRadius ? blastRadiusFn(blastRadiusParams) : 0;

    const cw = COMPOSITE_EFFECTIVE.weights;
    const cp = COMPOSITE_EFFECTIVE.penalties;
    const composite =
      cw.bayesianEvidence * bayesianEvidenceScore +
      cw.confidence * confidence +
      cw.capabilityFit * capabilityFit +
      cw.maturity * maturityScore +
      cw.latency * latencyScore +
      cw.cost * costScore -
      cp.recentFailure * recentFailurePenalty -
      cp.blastRadius * blastRadiusPenalty;

    return {
      runtimeId: runtime.id,
      bayesianEvidenceScore,
      confidence,
      capabilityFit,
      maturityScore,
      latencyScore,
      costScore,
      recentFailurePenalty,
      blastRadiusPenalty,
      composite,
    };
  }

  function select(
    candidates: AgentRuntime[],
    intent: NodeIntent,
    history: EvidenceHistoryEntry[],
  ): RuntimeRouterDecisionV2 {
    const scored = candidates.map((runtime) => ({
      runtime,
      score: score(runtime, intent, history),
    }));

    scored.sort((a, b) => b.score.composite - a.score.composite);

    const primary = scored[0].runtime;
    const fallbacks = scored.slice(1).map((s) => s.runtime);
    const bestScore = scored[0].score;

    const reason = [
      `intent=${intent}`,
      `bayesianE=${bestScore.bayesianEvidenceScore.toFixed(2)}`,
      `confidence=${bestScore.confidence.toFixed(2)}`,
      `capability=${bestScore.capabilityFit.toFixed(2)}`,
      `maturity=${bestScore.maturityScore.toFixed(2)}`,
      `latency=${bestScore.latencyScore.toFixed(2)}`,
      `cost=${bestScore.costScore.toFixed(2)}`,
      `penalty=${bestScore.recentFailurePenalty.toFixed(2)}`,
      `blast=${bestScore.blastRadiusPenalty.toFixed(2)}`,
      `composite=${bestScore.composite.toFixed(3)}`,
    ].join("; ");

    return {
      runtime: primary,
      reason,
      fallbacks,
      intent,
      scores: scored.map((s) => s.score),
    };
  }

  return { score, select };
}

export function scoreRuntimes(
  candidates: AgentRuntime[],
  intent: NodeIntent,
  history: EvidenceHistoryEntry[],
  options: RouterV2Options = {},
): RuntimeScoreV2[] {
  const engine = createRouterV2ScoringEngine(options);
  return candidates.map((runtime) => engine.score(runtime, intent, history));
}
