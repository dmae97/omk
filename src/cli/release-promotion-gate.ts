/**
 * Phase 5 — Release Promotion Gate (Algorithm 8)
 *
 * Computes a release viability score R_v from ten normalized input
 * dimensions and derives a verdict: block, pre-release, or stable.
 *
 * Weights are sourced from the omk.weights.v1 contract (releaseGate vector,
 * normalize:true). The historical raw weights summed to 1.05; normalization
 * divides weights, the regression penalty, and the verdict thresholds by the
 * SAME factor (1/1.05), a pure uniform scaling — verdicts are mathematically
 * identical for every input. Effective thresholds: preRelease ≈ 0.714286,
 * stable ≈ 0.857143 (printed dynamically in reason strings).
 */

import type {
  ReleasePromotionInputs,
  ReleasePromotionResult,
  ReleaseVerdict,
} from "../runtime/contracts/weakness-remediation.js";
import { releaseGateEffective } from "../runtime/weights-config.js";

/** Gate engine contract. */
export interface ReleasePromotionGate {
  /** Evaluate inputs and return scored result with verdict. */
  evaluate(inputs: ReleasePromotionInputs): ReleasePromotionResult;
}

/** Factory that creates the default release promotion gate. */
export function createReleasePromotionGate(): ReleasePromotionGate {
  const effective = releaseGateEffective();
  const w = effective.weights;
  const penalties = effective.penalties;
  const preReleaseThreshold = effective.thresholds.preRelease;
  const stableThreshold = effective.thresholds.stable;

  return {
    evaluate(inputs: ReleasePromotionInputs): ReleasePromotionResult {

      const demoRun = inputs.demoRun ?? false;
      const maturity = inputs.maturity ?? inputs.providerMinimum ?? 0;
      const versionConsistency = inputs.versionConsistency ?? inputs.semver ?? 1;
      const liveBenchmarkPass = inputs.liveBenchmarkPass ?? false;
      const sandboxViolationCount = inputs.sandboxViolationCount ?? Number.POSITIVE_INFINITY;
      const exactTagCiPass = inputs.exactTagCiPass ?? false;

      const rawScore: number =
        w.ci * inputs.ci +
        w.build * (inputs.build ?? 0) +
        w.types * (inputs.types ?? 0) +
        w.tests * (inputs.tests ?? 0) +
        w.install * inputs.freshInstallSmoke +
        w.demo * (demoRun ? 1 : 0) +
        w.proof * inputs.proofMedian +
        w.maturity * maturity +
        w.docs * inputs.docs * versionConsistency -
        penalties.regression * inputs.regressionSeverity;

      const score = clamp01(rawScore);
      const reasons: string[] = [];

      const blocked =
        inputs.ci === 0 || inputs.freshInstallSmoke === 0 || versionConsistency === 0 || !demoRun;

      if (blocked) {
        if (inputs.ci === 0) {
          reasons.push("CI score is 0 (blocking)");
        }
        if (inputs.freshInstallSmoke === 0) {
          reasons.push("Fresh install smoke is 0 (blocking)");
        }
        if (versionConsistency === 0) {
          reasons.push("Version/package/proof consistency is 0 (blocking)");
        }
        if (!demoRun) {
          reasons.push("Minimal verified demo run failed or missing (blocking)");
        }
      }

      const stableEligible = liveBenchmarkPass && sandboxViolationCount === 0 && exactTagCiPass;

      let verdict: ReleaseVerdict;
      if (blocked) {
        verdict = "block";
      } else if (score >= stableThreshold && inputs.proofMedian >= 0.85 && maturity >= 0.80 && stableEligible) {
        verdict = "stable";
        reasons.push(
          `Score ${formatScore(score)} meets stable threshold (≥${stableThreshold.toFixed(2)}) with proof≥0.85, maturity≥0.80, live benchmark pass, sandbox violations=0, and exact-tag CI pass`,
        );
      } else if (score >= preReleaseThreshold && inputs.proofMedian >= 0.75) {
        verdict = "pre-release";
        reasons.push(`Score ${formatScore(score)} meets pre-release threshold (≥${preReleaseThreshold.toFixed(2)}) with proof≥0.75`);
        if (score >= stableThreshold && inputs.proofMedian >= 0.85 && maturity >= 0.80 && !stableEligible) {
          reasons.push("Stable verdict withheld until live benchmark passes, sandboxViolationCount is 0, and exact-tag CI passes");
        }
      } else {
        verdict = "block";
        reasons.push(`Score ${formatScore(score)} below pre-release threshold (≥${preReleaseThreshold.toFixed(2)}) or proof below 0.75`);
      }

      return {
        score,
        verdict,
        blocked,
        reasons,
      };
    },
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function formatScore(n: number): string {
  return n.toFixed(4);
}
