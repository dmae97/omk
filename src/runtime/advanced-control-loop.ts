/**
 * Advanced Control Loop — Phase 6 of OMK Weakness Remediation (Algorithm 12).
 *
 * Orchestrates Phases 1–5 into a single turn-gating engine:
 * 1. Public surface compression
 * 2. Proof bundle trust evaluation
 * 3. Provider maturity gating
 * 4. Evidence-calibrated router v2
 * 5. Release gate advisory
 */

import type {
  CompressionResult,
  SurfaceItem,
  PublicSurfaceCompressorOptions,
} from "./public-surface.js";
import { PublicSurfaceCompressor } from "./public-surface.js";
import type {
  ProofBundleScores,
  ProofBundleTrustEngine,
  TrustScoreResult,
} from "./proof-bundle-trust.js";
import { createProofBundleTrustEngine } from "./proof-bundle-trust.js";
import { TAU_PROOF } from "./contracts/weakness-remediation.js";
import type {
  MaturityResult,
  ProviderMaturityGate,
} from "./provider-maturity-gate.js";
import { createProviderMaturityGate } from "./provider-maturity-gate.js";
import type {
  RuntimeRouterDecisionV2,
  RouterV2ScoringEngine,
  EvidenceHistoryEntry,
  NodeIntent,
} from "./contracts/router-v2.js";
import { createRouterV2ScoringEngine } from "./router-v2-scoring.js";
import type {
  ReleasePromotionInputs,
  ReleasePromotionResult,
} from "./contracts/weakness-remediation.js";
import { TAU_EVIDENCE } from "./contracts/weakness-remediation.js";
import type { ReleasePromotionGate } from "../cli/release-promotion-gate.js";
import type { AdapterTestResult } from "./contracts/evidence.js";
import type { AgentRuntime } from "./agent-runtime.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type IntegrationResultKind = "verified" | "blocked" | "handoff";

export interface WeaknessRemediationState {
  readonly publicSurface: CompressionResult;
  readonly proofTrust: TrustScoreResult;
  readonly providerMaturity: MaturityResult;
  readonly routerV2Decision: RuntimeRouterDecisionV2 | null;
  readonly releaseGate: ReleasePromotionResult | null;
}

export interface AdvancedControlLoopInput {
  readonly turnId: string;
  readonly intent: NodeIntent;
  readonly surfaceItems: readonly SurfaceItem[];
  readonly proofScores: ProofBundleScores;
  readonly providerTests: readonly AdapterTestResult[];
  readonly candidates: readonly AgentRuntime[];
  readonly evidenceHistory: readonly EvidenceHistoryEntry[];
  readonly releaseInputs?: ReleasePromotionInputs;
  readonly retryBudget?: number;
}

export interface AdvancedControlLoopResult {
  readonly kind: IntegrationResultKind;
  readonly turnId: string;
  readonly state: WeaknessRemediationState;
  readonly replan?: {
    readonly triggered: boolean;
    readonly reason: string;
    readonly retryBudgetRemaining: number;
  };
  readonly evidenceContractPath: string;
}

export interface AdvancedControlLoop {
  readonly run: (input: AdvancedControlLoopInput) => Promise<AdvancedControlLoopResult>;
}

export interface AdvancedControlLoopOptions {
  readonly publicSurfaceBudget?: number;
  readonly tauProof?: number;
  readonly tauEvidence?: number;
  readonly releaseGate?: ReleasePromotionGate;
  readonly releaseGateEnabled?: boolean;
  readonly evidenceContractDir?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function buildState(
  publicSurface: CompressionResult,
  proofTrust: TrustScoreResult | null,
  providerMaturity: MaturityResult | null,
  routerV2Decision: RuntimeRouterDecisionV2 | null,
  releaseGate: ReleasePromotionResult | null,
): WeaknessRemediationState {
  return Object.freeze({
    publicSurface,
    proofTrust:
      proofTrust ??
      (Object.freeze({
        score: 0,
        permissionLevel: "no-claim",
        passed: false,
        breakdown: Object.freeze({
          schema: 0,
          hashes: 0,
          commands: 0,
          stdout: 0,
          decisions: 0,
          evidence: 0,
          limitations: 0,
          replay: 0,
        }),
      }) as TrustScoreResult),
    providerMaturity:
      providerMaturity ??
      (Object.freeze({
        score: 0,
        authorityClass: "disabled",
        passed: false,
        subScores: Object.freeze({
          auth: 0,
          read: 0,
          write: 0,
          shell: 0,
          mcp: 0,
          merge: 0,
          evidence: 0,
          fallback: 0,
        }),
      }) as MaturityResult),
    routerV2Decision,
    releaseGate,
  }) as WeaknessRemediationState;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createAdvancedControlLoop(
  options: AdvancedControlLoopOptions = {},
): AdvancedControlLoop {
  const {
    publicSurfaceBudget,
    tauProof = TAU_PROOF,
    tauEvidence = TAU_EVIDENCE,
    releaseGate,
    releaseGateEnabled = true,
    evidenceContractDir = ".omk/evidence",
  } = options;

  const compressorOptions: PublicSurfaceCompressorOptions = publicSurfaceBudget
    ? { budget: publicSurfaceBudget }
    : {};
  const compressor = new PublicSurfaceCompressor(compressorOptions);
  const proofEngine: ProofBundleTrustEngine = createProofBundleTrustEngine();
  const maturityGate: ProviderMaturityGate = createProviderMaturityGate();
  const routerV2Engine: RouterV2ScoringEngine = createRouterV2ScoringEngine();

  return {
    async run(input: AdvancedControlLoopInput): Promise<AdvancedControlLoopResult> {
      // Phase 1 — Public surface compression
      const publicSurface = compressor.compress(input.surfaceItems);

      if (!publicSurface.invariantPassed) {
        return Object.freeze({
          kind: "blocked",
          turnId: input.turnId,
          state: buildState(publicSurface, null, null, null, null),
          evidenceContractPath: `${evidenceContractDir}/${input.turnId}-blocked.json`,
        }) as AdvancedControlLoopResult;
      }

      // Phase 2 — Proof bundle trust evaluation
      const proofTrust = proofEngine.evaluate(input.proofScores);

      if (proofTrust.score < tauProof) {
        return Object.freeze({
          kind: "handoff",
          turnId: input.turnId,
          state: buildState(publicSurface, proofTrust, null, null, null),
          replan: {
            triggered: false,
            reason: `Proof trust ${clamp01(proofTrust.score).toFixed(3)} < τ_proof ${tauProof}`,
            retryBudgetRemaining: input.retryBudget ?? 0,
          },
          evidenceContractPath: `${evidenceContractDir}/${input.turnId}-handoff.json`,
        }) as AdvancedControlLoopResult;
      }

      // Phase 3 — Provider maturity gating
      const providerMaturity = maturityGate.evaluate(input.providerTests);

      if (!providerMaturity.passed || providerMaturity.authorityClass === "disabled") {
        return Object.freeze({
          kind: "blocked",
          turnId: input.turnId,
          state: buildState(publicSurface, proofTrust, providerMaturity, null, null),
          evidenceContractPath: `${evidenceContractDir}/${input.turnId}-blocked.json`,
        }) as AdvancedControlLoopResult;
      }

      // Phase 4 — Evidence-calibrated router v2
      const routerV2Decision = routerV2Engine.select(
        [...input.candidates],
        input.intent,
        [...input.evidenceHistory],
      );
      const bestScore = routerV2Decision.scores[0];

      if (!bestScore || bestScore.bayesianEvidenceScore < tauEvidence) {
        return Object.freeze({
          kind: "handoff",
          turnId: input.turnId,
          state: buildState(publicSurface, proofTrust, providerMaturity, routerV2Decision, null),
          replan: {
            triggered: true,
            reason: `Router v2 bayesian evidence ${bestScore ? clamp01(bestScore.bayesianEvidenceScore).toFixed(3) : "n/a"} < τ_evidence ${tauEvidence}`,
            retryBudgetRemaining: Math.max(0, (input.retryBudget ?? 1) - 1),
          },
          evidenceContractPath: `${evidenceContractDir}/${input.turnId}-handoff.json`,
        }) as AdvancedControlLoopResult;
      }

      // Phase 5 — Release gate advisory (optional)
      let releaseGateResult: ReleasePromotionResult | null = null;
      if (releaseGateEnabled && releaseGate && input.releaseInputs) {
        releaseGateResult = releaseGate.evaluate(input.releaseInputs);
      }

      return Object.freeze({
        kind: "verified",
        turnId: input.turnId,
        state: buildState(publicSurface, proofTrust, providerMaturity, routerV2Decision, releaseGateResult),
        evidenceContractPath: `${evidenceContractDir}/${input.turnId}-verified.json`,
      }) as AdvancedControlLoopResult;
    },
  };
}
