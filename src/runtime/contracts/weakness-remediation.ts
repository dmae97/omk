/**
 * Weakness Remediation contracts — shared constants and Phase 5 types.
 *
 * - Phase 2 Proof Bundle Trust, Phase 3 Provider Maturity Gate,
 *   and Phase 1 Public Surface Compression share thresholds here.
 * - Phase 5 Release Promotion Gate types live here as well.
 */

// ── Shared constants (Phase 1–3) ────────────────────────────────

/** Evidence trust threshold for standard claims. */
export const TAU_EVIDENCE = 0.75;

/** Evidence trust threshold for high-confidence claims. */
export const TAU_EVIDENCE_HIGH = 0.85;

/** Proof bundle trust threshold. */
export const TAU_PROOF = 0.85;

/** Stability/maturity threshold for fully-trusted surfaces. */
export const TAU_STABLE = 0.90;

/** Beta prior α₀ for Bayesian run-count scoring. */
export const BETA_PRIOR_ALPHA0 = 1;

/** Beta prior β₀ for Bayesian run-count scoring. */
export const BETA_PRIOR_BETA0 = 1;

/** Default public surface budget K (max items). */
export const SURFACE_BUDGET_K = 8;

// ── Phase 5 Release Promotion Gate ──────────────────────────────

/** Algorithm 8 release gate weights. */
export const RELEASE_GATE_WEIGHTS = {
  ci: 0.15,
  build: 0.10,
  types: 0.10,
  tests: 0.10,
  install: 0.10,
  demo: 0.15,
  proof: 0.15,
  maturity: 0.10,
  docs: 0.10,
  regression: 0.15,
} as const;

export type ReleaseVerdict = "block" | "pre-release" | "stable";

export interface ReleasePromotionInputs {
  readonly ci: number;
  readonly docs: number;
  readonly proofMedian: number;
  readonly regressionSeverity: number;
  readonly freshInstallSmoke: number;
  /** Backward-compat: old callers may still pass schema. */
  readonly schema?: number;
  /** Backward-compat: old callers may still pass providerMinimum. */
  readonly providerMinimum?: number;
  /** Backward-compat: old callers may still pass semver. */
  readonly semver?: number;
  /** Algorithm 8 — build dimension (0–1). */
  readonly build?: number;
  /** Algorithm 8 — type-check dimension (0–1). */
  readonly types?: number;
  /** Algorithm 8 — test dimension (0–1). */
  readonly tests?: number;
  /** Algorithm 8 — maturity dimension (0–1). Falls back to providerMinimum. */
  readonly maturity?: number;
  /** Algorithm 8 — minimal verified demo run gate. Hard block when false/undefined. */
  readonly demoRun?: boolean;
}

export interface ReleasePromotionResult {
  readonly score: number;
  readonly verdict: ReleaseVerdict;
  readonly blocked: boolean;
  readonly reasons: readonly string[];
}

export interface ReleasePromotionGate {
  evaluate(inputs: ReleasePromotionInputs): ReleasePromotionResult;
}
