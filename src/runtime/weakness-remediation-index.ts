/**
 * Weakness Remediation Index — Public factory that instantiates all
 * Phase 1–6 engines with sensible defaults.
 */

export {
  type IntegrationResultKind,
  type WeaknessRemediationState,
  type AdvancedControlLoopInput,
  type AdvancedControlLoopResult,
  type AdvancedControlLoop,
  type AdvancedControlLoopOptions,
  createAdvancedControlLoop,
} from "./advanced-control-loop.js";

export {
  type SurfaceItem,
  type ScoredSurfaceItem,
  type MandatoryAnchor,
  type CompressionResult,
  type PublicSurfaceCompressorOptions,
  computeSurfaceScore,
  enforceFlowInvariant,
  PublicSurfaceCompressor,
} from "./public-surface.js";

export {
  type ProofBundleScores,
  type TrustScoreResult,
  type ProofBundleTrustEngine,
  type DeriveScoresOptions,
  createProofBundleTrustEngine,
} from "./proof-bundle-trust.js";

export {
  type MaturityResult,
  type ProviderMaturityGate,
  createProviderMaturityGate,
  evaluateProviderFromVector,
} from "./provider-maturity-gate.js";

export {
  type RuntimeScoreV2,
  type RuntimeRouterDecisionV2,
  type RouterV2Options,
  type RouterV2ScoringEngine,
  type BlastRadiusParams,
  type EvidenceHistoryEntry,
  type NodeIntent,
} from "./contracts/router-v2.js";

export {
  createRouterV2ScoringEngine,
} from "./router-v2-scoring.js";

export {
  type ReleasePromotionInputs,
  type ReleasePromotionResult,
  type ReleaseVerdict,
  RELEASE_GATE_WEIGHTS,
  TAU_EVIDENCE,
  TAU_EVIDENCE_HIGH,
  TAU_PROOF,
  TAU_STABLE,
  BETA_PRIOR_ALPHA0,
  BETA_PRIOR_BETA0,
  SURFACE_BUDGET_K,
} from "./contracts/weakness-remediation.js";

export {
  createReleasePromotionGate,
  type ReleasePromotionGate,
} from "../cli/release-promotion-gate.js";

// ─── Convenience factory ─────────────────────────────────────────────────────

import { PublicSurfaceCompressor } from "./public-surface.js";
import { createProofBundleTrustEngine } from "./proof-bundle-trust.js";
import { createProviderMaturityGate } from "./provider-maturity-gate.js";
import { createRouterV2ScoringEngine } from "./router-v2-scoring.js";
import { createReleasePromotionGate } from "../cli/release-promotion-gate.js";
import { createAdvancedControlLoop } from "./advanced-control-loop.js";

export interface WeaknessRemediationIndex {
  readonly publicSurfaceCompressor: PublicSurfaceCompressor;
  readonly proofBundleTrustEngine: ReturnType<typeof createProofBundleTrustEngine>;
  readonly providerMaturityGate: ReturnType<typeof createProviderMaturityGate>;
  readonly routerV2ScoringEngine: ReturnType<typeof createRouterV2ScoringEngine>;
  readonly releasePromotionGate: ReturnType<typeof createReleasePromotionGate>;
  readonly advancedControlLoop: ReturnType<typeof createAdvancedControlLoop>;
}

export function createWeaknessRemediationIndex(): WeaknessRemediationIndex {
  const publicSurfaceCompressor = new PublicSurfaceCompressor();
  const proofBundleTrustEngine = createProofBundleTrustEngine();
  const providerMaturityGate = createProviderMaturityGate();
  const routerV2ScoringEngine = createRouterV2ScoringEngine();
  const releasePromotionGate = createReleasePromotionGate();
  const advancedControlLoop = createAdvancedControlLoop({
    releaseGate: releasePromotionGate,
    releaseGateEnabled: true,
  });

  return {
    publicSurfaceCompressor,
    proofBundleTrustEngine,
    providerMaturityGate,
    routerV2ScoringEngine,
    releasePromotionGate,
    advancedControlLoop,
  };
}
