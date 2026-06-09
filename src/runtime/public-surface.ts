/**
 * Public Surface Compression — Phase 1 of OMK Weakness Remediation.
 *
 * Takes a candidate set of runtime surfaces, scores each item,
 * enforces mandatory anchors, applies budget K, and returns
 * public surface S and hidden set H.
 *
 * Also enforces the 5-step flow invariant:
 *   goal → dag → route → verify → replay
 */

// ── Types ───────────────────────────────────────────────────────

/** A candidate surface item (e.g., a tool, MCP server, skill, or runtime). */
export interface SurfaceItem {
  readonly id: string;
  readonly name: string;
  readonly category: "tool" | "mcp" | "skill" | "runtime" | "hook";
  /** How often this surface is invoked per 100 turns. */
  readonly usage: number;
  /** Contribution score from verified runs [0, 1]. */
  readonly verifiedRunContribution: number;
  /** Contribution score from evidence items [0, 1]. */
  readonly evidenceContribution: number;
  /** Onboarding difficulty/cost [0, 1]. */
  readonly onboardingCost: number;
  /** Explainability burden [0, 1]. */
  readonly explainabilityCost: number;
  /** Risk of lineage drift [0, 1]. */
  readonly lineageRisk: number;
}

/** Scored surface item with computed score. */
export interface ScoredSurfaceItem extends SurfaceItem {
  readonly score: number;
}

/** Mandatory anchor identifiers. */
export type MandatoryAnchor = "goal" | "dag" | "route" | "verify" | "replay";

/** Compression result: public surface S and hidden set H. */
export interface CompressionResult {
  readonly publicSurface: readonly ScoredSurfaceItem[];
  readonly hiddenSet: readonly ScoredSurfaceItem[];
  readonly mandatoryAnchors: readonly MandatoryAnchor[];
  readonly budget: number;
  readonly invariantPassed: boolean;
  readonly invariantViolations: readonly string[];
}

// ── Constants ───────────────────────────────────────────────────

const MANDATORY_ANCHORS: readonly MandatoryAnchor[] = [
  "goal",
  "dag",
  "route",
  "verify",
  "replay",
];

const DEFAULT_BUDGET = 5;

// ── Scoring ─────────────────────────────────────────────────────

/**
 * Compute surface score from item metrics.
 *
 * Formula:
 *   0.30 * usage
 * + 0.30 * verifiedRunContribution
 * + 0.20 * evidenceContribution
 * - 0.10 * onboardingCost
 * - 0.05 * explainabilityCost
 * - 0.05 * lineageRisk
 */
export function computeSurfaceScore(item: SurfaceItem): number {
  const raw =
    0.30 * item.usage +
    0.30 * item.verifiedRunContribution +
    0.20 * item.evidenceContribution -
    0.10 * item.onboardingCost -
    0.05 * item.explainabilityCost -
    0.05 * item.lineageRisk;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, raw));
}

// ── Invariant Enforcement ───────────────────────────────────────

/**
 * Validate the 5-step flow invariant against the public surface.
 *
 * Invariant: The public surface must contain all mandatory anchors
 * in order: goal → dag → route → verify → replay.
 *
 * Returns violations as human-readable strings.
 */
export function enforceFlowInvariant(
  publicSurface: readonly ScoredSurfaceItem[],
): { readonly passed: boolean; readonly violations: readonly string[] } {
  const violations: string[] = [];
  const ids = publicSurface.map((s) => s.id);

  for (const anchor of MANDATORY_ANCHORS) {
    if (!ids.includes(anchor)) {
      violations.push(`Missing mandatory anchor: ${anchor}`);
    }
  }

  if (violations.length === 0) {
    const orderIndices = MANDATORY_ANCHORS.map((a) => ids.indexOf(a));
    for (let i = 1; i < orderIndices.length; i++) {
      if (orderIndices[i]! < orderIndices[i - 1]!) {
        violations.push(
          `Flow order violation: ${MANDATORY_ANCHORS[i - 1]} must precede ${MANDATORY_ANCHORS[i]}`,
        );
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations: Object.freeze(violations) as readonly string[],
  };
}

// ── PublicSurfaceCompressor ─────────────────────────────────────

export interface PublicSurfaceCompressorOptions {
  /** Maximum number of items in the public surface (default 5). */
  readonly budget?: number;
  /** Optional custom scoring function. */
  readonly scoreFn?: (item: SurfaceItem) => number;
}

/**
 * Compresses a candidate surface set into public (S) and hidden (H) subsets.
 *
 * Rules:
 * 1. Mandatory anchors A = {goal, dag, route, verify, replay} are always in S.
 * 2. Remaining slots are filled by highest score until budget K is reached.
 * 3. The 5-step flow invariant is enforced and reported.
 */
export class PublicSurfaceCompressor {
  private readonly budget: number;
  private readonly scoreFn: (item: SurfaceItem) => number;

  constructor(options: PublicSurfaceCompressorOptions = {}) {
    this.budget = Math.max(
      MANDATORY_ANCHORS.length,
      options.budget ?? DEFAULT_BUDGET,
    );
    this.scoreFn = options.scoreFn ?? computeSurfaceScore;
  }

  /**
   * Compress candidates into public surface S and hidden set H.
   *
   * @param candidates All candidate surface items.
   * @returns CompressionResult with S, H, and invariant status.
   */
  compress(
    candidates: readonly SurfaceItem[],
  ): CompressionResult {
    const scored = candidates.map((item): ScoredSurfaceItem => ({
      ...item,
      score: this.scoreFn(item),
    }));

    // Partition mandatory vs elective
    const mandatoryItems: ScoredSurfaceItem[] = [];
    const electiveItems: ScoredSurfaceItem[] = [];

    for (const item of scored) {
      if (MANDATORY_ANCHORS.includes(item.id as MandatoryAnchor)) {
        mandatoryItems.push(item);
      } else {
        electiveItems.push(item);
      }
    }

    // Ensure all mandatory anchors are present; inject placeholders if missing
    const presentIds = new Set(mandatoryItems.map((m) => m.id));
    for (const anchor of MANDATORY_ANCHORS) {
      if (!presentIds.has(anchor)) {
        mandatoryItems.push({
          id: anchor,
          name: anchor,
          category: "runtime",
          usage: 0,
          verifiedRunContribution: 0,
          evidenceContribution: 0,
          onboardingCost: 0,
          explainabilityCost: 0,
          lineageRisk: 0,
          score: 0,
        });
      }
    }

    // Sort mandatory by canonical order, electives by score desc
    const orderedMandatory = MANDATORY_ANCHORS.map((anchor) =>
      mandatoryItems.find((m) => m.id === anchor)!,
    );

    electiveItems.sort((a, b) => b.score - a.score);

    const remainingSlots = Math.max(0, this.budget - orderedMandatory.length);
    const publicSurface = Object.freeze([
      ...orderedMandatory,
      ...electiveItems.slice(0, remainingSlots),
    ]) as readonly ScoredSurfaceItem[];

    const hiddenSet = Object.freeze(
      electiveItems.slice(remainingSlots),
    ) as readonly ScoredSurfaceItem[];

    const invariant = enforceFlowInvariant(publicSurface);

    return Object.freeze({
      publicSurface,
      hiddenSet,
      mandatoryAnchors: MANDATORY_ANCHORS,
      budget: this.budget,
      invariantPassed: invariant.passed,
      invariantViolations: invariant.violations,
    }) as CompressionResult;
  }
}
