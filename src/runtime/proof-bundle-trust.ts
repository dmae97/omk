/**
 * Proof Bundle Trust Score — Phase 2 of OMK Weakness Remediation.
 *
 * Evaluates a curated proof bundle across 8 dimensions and produces
 * a trust score T_b, a permission level, and a pass/fail verdict
 * against τ_proof.
 */

import type { ClaimPermissionLevel, EvidenceVerdict } from "./contracts/evidence.js";
import { TAU_PROOF } from "./contracts/weakness-remediation.js";

// ── Types ───────────────────────────────────────────────────────

/** The 8 scored dimensions of a proof bundle. */
export interface ProofBundleScores {
  /** Schema conformance of evidence items [0, 1]. */
  readonly schema: number;
  /** Hash integrity / tamper evidence [0, 1]. */
  readonly hashes: number;
  /** Command trace coverage and correctness [0, 1]. */
  readonly commands: number;
  /** Stdout / stderr capture completeness [0, 1]. */
  readonly stdout: number;
  /** Decision record quality and count [0, 1]. */
  readonly decisions: number;
  /** Evidence item confidence and verdict strength [0, 1]. */
  readonly evidence: number;
  /** Acknowledged limitations documented [0, 1]. */
  readonly limitations: number;
  /** Replay reproducibility score [0, 1]. */
  readonly replay: number;
}

/** Result of evaluating a proof bundle. */
export interface TrustScoreResult {
  /** Computed trust score T_b ∈ [0, 1]. */
  readonly score: number;
  /** Permission level derived from score thresholds. */
  readonly permissionLevel: ClaimPermissionLevel;
  /** Whether score meets τ_proof. */
  readonly passed: boolean;
  /** Individual dimension contributions. */
  readonly breakdown: ProofBundleScores;
}

/** Engine that evaluates proof bundle trust. */
export interface ProofBundleTrustEngine {
  /**
   * Evaluate a proof bundle from its 8 dimension scores.
   *
   * Formula:
   *   T_b = 0.15·schema + 0.15·hashes + 0.15·commands + 0.10·stdout
   *       + 0.15·decisions + 0.15·evidence + 0.05·limitations + 0.10·replay
   */
  evaluate(scores: ProofBundleScores): TrustScoreResult;

  /** Derive dimension scores from a raw evidence verdict and coverage. */
  deriveScores(
    verdict: EvidenceVerdict,
    coveragePercent: number,
    options?: DeriveScoresOptions,
  ): ProofBundleScores;
}

/** Options for automatic score derivation. */
export interface DeriveScoresOptions {
  /** Override schema conformance (default inferred from verdict). */
  readonly schema?: number;
  /** Override hash integrity (default 1.0). */
  readonly hashes?: number;
  /** Override command trace score (default inferred from coverage). */
  readonly commands?: number;
  /** Override stdout completeness (default inferred from coverage). */
  readonly stdout?: number;
  /** Override decision record score (default inferred from verdict). */
  readonly decisions?: number;
  /** Override evidence strength (default inferred from verdict). */
  readonly evidence?: number;
  /** Override limitations documentation (default 0.5). */
  readonly limitations?: number;
  /** Override replay score (default inferred from verdict). */
  readonly replay?: number;
}

// ── Constants ───────────────────────────────────────────────────

const WEIGHT_SCHEMA = 0.15;
const WEIGHT_HASHES = 0.15;
const WEIGHT_COMMANDS = 0.15;
const WEIGHT_STDOUT = 0.10;
const WEIGHT_DECISIONS = 0.15;
const WEIGHT_EVIDENCE = 0.15;
const WEIGHT_LIMITATIONS = 0.05;
const WEIGHT_REPLAY = 0.10;

const STRONG_PUBLIC_THRESHOLD = 0.90;
const QUALIFIED_PUBLIC_THRESHOLD = 0.75;
const INTERNAL_CLAIM_THRESHOLD = 0.60;

// ── Helpers ─────────────────────────────────────────────────────

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function permissionLevelFromScore(score: number): ClaimPermissionLevel {
  if (score >= STRONG_PUBLIC_THRESHOLD) {
    return "strong-public-claim";
  }
  if (score >= QUALIFIED_PUBLIC_THRESHOLD) {
    return "qualified-public-claim";
  }
  if (score >= INTERNAL_CLAIM_THRESHOLD) {
    return "internal-claim-only";
  }
  return "no-claim";
}

function verdictToBaseScore(verdict: EvidenceVerdict): number {
  switch (verdict) {
    case "pass":
      return 1.0;
    case "partial":
      return 0.65;
    case "pending":
      return 0.35;
    case "fail":
      return 0.0;
    default:
      return 0.0;
  }
}

// ── Engine Factory ──────────────────────────────────────────────

/**
 * Create a ProofBundleTrustEngine with default weights and thresholds.
 */
export function createProofBundleTrustEngine(): ProofBundleTrustEngine {
  return {
    evaluate(scores: ProofBundleScores): TrustScoreResult {
      const clamped: ProofBundleScores = {
        schema: clamp01(scores.schema),
        hashes: clamp01(scores.hashes),
        commands: clamp01(scores.commands),
        stdout: clamp01(scores.stdout),
        decisions: clamp01(scores.decisions),
        evidence: clamp01(scores.evidence),
        limitations: clamp01(scores.limitations),
        replay: clamp01(scores.replay),
      };

      const score =
        WEIGHT_SCHEMA * clamped.schema +
        WEIGHT_HASHES * clamped.hashes +
        WEIGHT_COMMANDS * clamped.commands +
        WEIGHT_STDOUT * clamped.stdout +
        WEIGHT_DECISIONS * clamped.decisions +
        WEIGHT_EVIDENCE * clamped.evidence +
        WEIGHT_LIMITATIONS * clamped.limitations +
        WEIGHT_REPLAY * clamped.replay;

      const finalScore = clamp01(score);
      const permissionLevel = permissionLevelFromScore(finalScore);

      return Object.freeze({
        score: finalScore,
        permissionLevel,
        passed: finalScore >= TAU_PROOF,
        breakdown: clamped,
      }) as TrustScoreResult;
    },

    deriveScores(
      verdict: EvidenceVerdict,
      coveragePercent: number,
      options: DeriveScoresOptions = {},
    ): ProofBundleScores {
      const base = verdictToBaseScore(verdict);
      const cov = clamp01(coveragePercent / 100);

      return Object.freeze({
        schema: clamp01(options.schema ?? base),
        hashes: clamp01(options.hashes ?? 1.0),
        commands: clamp01(options.commands ?? cov),
        stdout: clamp01(options.stdout ?? cov),
        decisions: clamp01(options.decisions ?? base),
        evidence: clamp01(options.evidence ?? base),
        limitations: clamp01(options.limitations ?? 0.5),
        replay: clamp01(options.replay ?? base),
      }) as ProofBundleScores;
    },
  };
}
