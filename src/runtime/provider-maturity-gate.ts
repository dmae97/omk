/**
 * Provider Maturity Gate — Phase 3 of OMK Weakness Remediation.
 *
 * Evaluates a provider/runtime across 8 adapter test dimensions and
 * produces a maturity score M_p, an authority class, and a pass/fail
 * verdict.
 */

import type {
  AdapterTestKind,
  AdapterTestResult,
  ProviderAuthorityClass,
} from "./contracts/evidence.js";
import type { ProviderHealthVector } from "../contracts/provider-health.js";
import { PROVIDER_CAPABILITY_ORDINAL } from "../contracts/provider-health.js";

// ── Types ───────────────────────────────────────────────────────

/** Maturity evaluation result for a single provider. */
export interface MaturityResult {
  /** Computed maturity score M_p ∈ [0, 1]. */
  readonly score: number;
  /** Authority class derived from score and sub-score constraints. */
  readonly authorityClass: ProviderAuthorityClass;
  /** Whether the provider meets minimum viability. */
  readonly passed: boolean;
  /** Sub-scores keyed by adapter test kind. */
  readonly subScores: Readonly<Record<AdapterTestKind, number>>;
}

/** Engine that evaluates provider maturity. */
export interface ProviderMaturityGate {
  /**
   * Evaluate provider maturity from adapter test results.
   *
   * Formula:
   *   M_p = 0.10·s_auth + 0.10·s_read + 0.15·s_write + 0.10·s_shell
   *       + 0.15·s_mcp + 0.15·s_merge + 0.15·s_evidence + 0.10·s_fallback
   */
  evaluate(results: readonly AdapterTestResult[]): MaturityResult;

  /** Look up a single sub-score by test kind (defaults to 0). */
  getSubScore(
    results: readonly AdapterTestResult[],
    kind: AdapterTestKind,
  ): number;
}

// ── Constants ───────────────────────────────────────────────────

const WEIGHT_AUTH = 0.10;
const WEIGHT_READ = 0.10;
const WEIGHT_WRITE = 0.15;
const WEIGHT_SHELL = 0.10;
const WEIGHT_MCP = 0.15;
const WEIGHT_MERGE = 0.15;
const WEIGHT_EVIDENCE = 0.15;
const WEIGHT_FALLBACK = 0.10;

const MERGE_AUTHORITY_THRESHOLD = 0.90;
const MERGE_SUBSCORE_THRESHOLD = 0.90;
const EVIDENCE_SUBSCORE_THRESHOLD_FOR_MERGE = 0.85;

const WRITE_AUTHORITY_THRESHOLD = 0.80;
const WRITE_SUBSCORE_THRESHOLD = 0.85;

const REVIEW_AUTHORITY_THRESHOLD = 0.70;
const READ_SUBSCORE_THRESHOLD = 0.90;

const READ_ONLY_ADVISORY_THRESHOLD = 0.55;

// ── Helpers ─────────────────────────────────────────────────────

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function computeAuthorityClass(
  score: number,
  subScores: Readonly<Record<AdapterTestKind, number>>,
): ProviderAuthorityClass {
  if (
    score >= MERGE_AUTHORITY_THRESHOLD &&
    subScores.merge >= MERGE_SUBSCORE_THRESHOLD &&
    subScores.evidence >= EVIDENCE_SUBSCORE_THRESHOLD_FOR_MERGE
  ) {
    return "merge-authority";
  }

  if (
    score >= WRITE_AUTHORITY_THRESHOLD &&
    subScores.write >= WRITE_SUBSCORE_THRESHOLD
  ) {
    return "write-authority";
  }

  if (
    score >= REVIEW_AUTHORITY_THRESHOLD &&
    subScores.read >= READ_SUBSCORE_THRESHOLD
  ) {
    return "review-authority";
  }

  if (score >= READ_ONLY_ADVISORY_THRESHOLD) {
    return "read-only-advisory";
  }

  return "disabled";
}

function buildSubScoreMap(
  results: readonly AdapterTestResult[],
): Record<AdapterTestKind, number> {
  const map: Record<AdapterTestKind, number> = {
    auth: 0,
    read: 0,
    write: 0,
    shell: 0,
    mcp: 0,
    merge: 0,
    evidence: 0,
    fallback: 0,
  };

  for (const r of results) {
    map[r.kind] = clamp01(r.score);
  }

  return map;
}

// ── Engine Factory ──────────────────────────────────────────────

/**
 * Create a ProviderMaturityGate with default weights and thresholds.
 */
export interface ProviderMaturityTable {
  lookup(providerId: string): MaturityResult | undefined;
  register(providerId: string, result: MaturityResult): void;
}

export function createProviderMaturityTable(): ProviderMaturityTable {
  const table = new Map<string, MaturityResult>();
  return {
    lookup(providerId: string): MaturityResult | undefined {
      return table.get(providerId);
    },
    register(providerId: string, result: MaturityResult): void {
      table.set(providerId, result);
    },
  };
}

function vectorToAdapterResults(vector: ProviderHealthVector): AdapterTestResult[] {
  const authOrdinal = PROVIDER_CAPABILITY_ORDINAL[vector.auth];
  const binaryOrdinal = PROVIDER_CAPABILITY_ORDINAL[vector.binary];

  const authScore = authOrdinal >= PROVIDER_CAPABILITY_ORDINAL["auth_valid"] ? 1.0 : authOrdinal / PROVIDER_CAPABILITY_ORDINAL["auth_valid"];
  const readScore = vector.supportsRead ? 1.0 : 0.0;
  const writeScore = vector.supportsWrite ? 1.0 : 0.0;
  const shellScore = vector.supportsShell ? 1.0 : 0.0;
  const mcpScore = binaryOrdinal >= PROVIDER_CAPABILITY_ORDINAL["tool_contract_verified"] ? 1.0 : binaryOrdinal / PROVIDER_CAPABILITY_ORDINAL["tool_contract_verified"];
  const mergeScore = vector.evidencePassRate7d;
  const evidenceScore = vector.evidencePassRate7d;
  const fallbackScore = 1.0 - vector.failureEwma;

  return [
    { kind: "auth", passed: authScore >= 0.5, score: authScore },
    { kind: "read", passed: readScore >= 0.5, score: readScore },
    { kind: "write", passed: writeScore >= 0.5, score: writeScore },
    { kind: "shell", passed: shellScore >= 0.5, score: shellScore },
    { kind: "mcp", passed: mcpScore >= 0.5, score: mcpScore },
    { kind: "merge", passed: mergeScore >= 0.5, score: mergeScore },
    { kind: "evidence", passed: evidenceScore >= 0.5, score: evidenceScore },
    { kind: "fallback", passed: fallbackScore >= 0.5, score: fallbackScore },
  ];
}

export function createProviderMaturityGate(): ProviderMaturityGate {
  return {
    evaluate(results: readonly AdapterTestResult[]): MaturityResult {
      const subScores = Object.freeze(buildSubScoreMap(results));

      const score =
        WEIGHT_AUTH * subScores.auth +
        WEIGHT_READ * subScores.read +
        WEIGHT_WRITE * subScores.write +
        WEIGHT_SHELL * subScores.shell +
        WEIGHT_MCP * subScores.mcp +
        WEIGHT_MERGE * subScores.merge +
        WEIGHT_EVIDENCE * subScores.evidence +
        WEIGHT_FALLBACK * subScores.fallback;

      const finalScore = clamp01(score);
      const authorityClass = computeAuthorityClass(finalScore, subScores);

      return Object.freeze({
        score: finalScore,
        authorityClass,
        passed: authorityClass !== "disabled",
        subScores,
      }) as MaturityResult;
    },

    getSubScore(
      results: readonly AdapterTestResult[],
      kind: AdapterTestKind,
    ): number {
      const found = results.find((r) => r.kind === kind);
      return found ? clamp01(found.score) : 0;
    },
  };
}

export function evaluateProviderFromVector(
  gate: ProviderMaturityGate,
  vector: ProviderHealthVector,
): MaturityResult {
  return gate.evaluate(vectorToAdapterResults(vector));
}
