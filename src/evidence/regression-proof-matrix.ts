/**
 * Regression Proof Matrix — Algorithm 9
 *
 * Verifies that Algorithms 1~8 are alive via tests, proof bundles,
 * decision traces, and CLI surfaces.
 */

import type { ProofTrustResult } from "./proof-trust.js";
import { TAU_EVIDENCE } from "../runtime/contracts/weakness-remediation.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/** Specification for a single algorithm in the regression matrix. */
export interface AlgorithmSpec {
  readonly name: string;
  readonly tests: number;
  readonly proofBundles: number;
  readonly decisionTraces: number;
  readonly cliSurface: "reachable" | "unreachable";
}

/** Release candidate global gate inputs. */
export interface ReleaseCandidate {
  readonly medianProofTrust: number;
  readonly routerShadowSafety: number;
  readonly providerAuthorityInvariant: number;
  readonly minimalVerifiedDemo: number;
}

/** Result of evaluating the regression proof matrix. */
export interface RegressionProofMatrixResult {
  readonly verdict: "pass" | "fail";
  readonly coverageByAlgorithm: Readonly<Record<string, number>>;
  readonly reasons: readonly string[];
}

/** Engine interface. */
export interface RegressionProofMatrixEngine {
  evaluate(
    algorithmSet: readonly AlgorithmSpec[],
    testSuite: { readonly testsByAlgorithm: Readonly<Record<string, number>> },
    proofBundles: ReadonlyArray<Readonly<{ algorithm: string } & Partial<ProofTrustResult>>>,
    releaseCandidate: ReleaseCandidate
  ): RegressionProofMatrixResult;
}

/** Optional configuration for the engine factory. */
export interface RegressionProofMatrixOptions {
  readonly coverageThreshold?: number;
  readonly proofTrustThreshold?: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_COVERAGE_THRESHOLD = TAU_EVIDENCE; // 0.75
const DEFAULT_PROOF_TRUST_THRESHOLD = TAU_EVIDENCE; // 0.75

// ─── Factory ───────────────────────────────────────────────────────────────

export function createRegressionProofMatrixEngine(
  options?: RegressionProofMatrixOptions
): RegressionProofMatrixEngine {
  const coverageThreshold = options?.coverageThreshold ?? DEFAULT_COVERAGE_THRESHOLD;
  const proofTrustThreshold = options?.proofTrustThreshold ?? DEFAULT_PROOF_TRUST_THRESHOLD;

  return {
    evaluate(
      algorithmSet: readonly AlgorithmSpec[],
      testSuite: { readonly testsByAlgorithm: Readonly<Record<string, number>> },
      proofBundles: ReadonlyArray<Readonly<{ algorithm: string } & Partial<ProofTrustResult>>>,
      releaseCandidate: ReleaseCandidate
    ): RegressionProofMatrixResult {
      const reasons: string[] = [];
      const coverageByAlgorithm: Record<string, number> = {};

      // Compute median proof trust from proof bundle scores when available
      const proofTrustScores: number[] = [];
      for (const pb of proofBundles) {
        if (typeof pb.trustScore === "number") {
          proofTrustScores.push(pb.trustScore);
        }
      }

      // Evaluate each algorithm using algorithmSet directly
      for (const alg of algorithmSet) {
        const coverage =
          0.35 * (alg.tests > 0 ? 1 : 0) +
          0.30 * (alg.proofBundles > 0 ? 1 : 0) +
          0.20 * (alg.decisionTraces > 0 ? 1 : 0) +
          0.15 * (alg.cliSurface === "reachable" ? 1 : 0);

        coverageByAlgorithm[alg.name] = Math.round(coverage * 100) / 100;

        if (coverage < coverageThreshold) {
          reasons.push(
            `Algorithm "${alg.name}" coverage ${coverage.toFixed(2)} < threshold ${coverageThreshold}`
          );
        }
      }

      // Global gates
      const medianProofTrust: number =
        proofTrustScores.length > 0
          ? computeMedian(proofTrustScores)
          : releaseCandidate.medianProofTrust;

      if (medianProofTrust < proofTrustThreshold) {
        reasons.push(
          `medianProofTrust ${medianProofTrust.toFixed(2)} < threshold ${proofTrustThreshold}`
        );
      }
      if (releaseCandidate.routerShadowSafety !== 1) {
        reasons.push(
          `routerShadowSafety ${releaseCandidate.routerShadowSafety} !== 1`
        );
      }
      if (releaseCandidate.providerAuthorityInvariant !== 1) {
        reasons.push(
          `providerAuthorityInvariant ${releaseCandidate.providerAuthorityInvariant} !== 1`
        );
      }
      if (releaseCandidate.minimalVerifiedDemo !== 1) {
        reasons.push(
          `minimalVerifiedDemo ${releaseCandidate.minimalVerifiedDemo} !== 1`
        );
      }

      const verdict: "pass" | "fail" = reasons.length === 0 ? "pass" : "fail";

      return {
        verdict,
        coverageByAlgorithm: Object.freeze(coverageByAlgorithm),
        reasons: Object.freeze(reasons),
      };
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function computeMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}
