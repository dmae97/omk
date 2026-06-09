/**
 * Phase 5 — Release Promotion Gate (Algorithm 8)
 *
 * Computes a release viability score R_v from ten normalized input
 * dimensions and derives a verdict: block, pre-release, or stable.
 */

import {
  RELEASE_GATE_WEIGHTS,
  type ReleasePromotionInputs,
  type ReleasePromotionResult,
  type ReleaseVerdict,
} from "../runtime/contracts/weakness-remediation.js";

/** Gate engine contract. */
export interface ReleasePromotionGate {
  /** Evaluate inputs and return scored result with verdict. */
  evaluate(inputs: ReleasePromotionInputs): ReleasePromotionResult;
}

/** Factory that creates the default release promotion gate. */
export function createReleasePromotionGate(): ReleasePromotionGate {
  return {
    evaluate(inputs: ReleasePromotionInputs): ReleasePromotionResult {
      const w = RELEASE_GATE_WEIGHTS;

      const demoRun = inputs.demoRun ?? false;
      const maturity = inputs.maturity ?? inputs.providerMinimum ?? 0;

      const rawScore: number =
        w.ci * inputs.ci +
        w.build * (inputs.build ?? 0) +
        w.types * (inputs.types ?? 0) +
        w.tests * (inputs.tests ?? 0) +
        w.install * inputs.freshInstallSmoke +
        w.demo * (demoRun ? 1 : 0) +
        w.proof * inputs.proofMedian +
        w.maturity * maturity +
        w.docs * inputs.docs -
        w.regression * inputs.regressionSeverity;

      const score = clamp01(rawScore);
      const reasons: string[] = [];

      const blocked =
        inputs.ci === 0 || inputs.freshInstallSmoke === 0 || !demoRun;

      if (blocked) {
        if (inputs.ci === 0) {
          reasons.push("CI score is 0 (blocking)");
        }
        if (inputs.freshInstallSmoke === 0) {
          reasons.push("Fresh install smoke is 0 (blocking)");
        }
        if (!demoRun) {
          reasons.push("Minimal verified demo run failed or missing (blocking)");
        }
      }

      let verdict: ReleaseVerdict;
      if (blocked) {
        verdict = "block";
      } else if (score >= 0.90 && inputs.proofMedian >= 0.85 && maturity >= 0.80) {
        verdict = "stable";
        reasons.push(
          `Score ${formatScore(score)} meets stable threshold (≥0.90) with proof≥0.85 and maturity≥0.80`,
        );
      } else if (score >= 0.75 && inputs.proofMedian >= 0.75) {
        verdict = "pre-release";
        reasons.push(`Score ${formatScore(score)} meets pre-release threshold (≥0.75) with proof≥0.75`);
      } else {
        verdict = "block";
        reasons.push(`Score ${formatScore(score)} below pre-release threshold (≥0.75) or proof below 0.75`);
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
