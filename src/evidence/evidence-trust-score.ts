/**
 * Evidence Trust Score (ETS) v2 — Algorithm 10
 *
 * Pipeline:
 *   ClaimExtractor(output) → RequiredEvidence(claim, taskType, risk)
 *   → EvidenceCollector(runArtifacts) → EvidenceVerifier(required, collected)
 *   → EvidenceTrustScore() → Pass | Warn | Fail
 *
 * Formula:
 *   ETS = 0.30*reproducibility + 0.25*independence + 0.20*coverage_relevance
 *       + 0.15*provenance_integrity + 0.10*freshness
 *       - gaming_penalty - stale_result_penalty - unverifiable_claim_penalty
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceItem, EvidenceKind, EvidenceVerdict } from "../runtime/contracts/evidence.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/** A claim extracted from agent output. */
export interface EtsClaim {
  readonly claimId: string;
  readonly text: string;
  readonly category: EtsClaimCategory;
  readonly confidence: number;
}

export type EtsClaimCategory =
  | "test"
  | "build"
  | "typecheck"
  | "lint"
  | "behavioral"
  | "security"
  | "performance"
  | "docs";

/** Task type that produced the output. */
export type EtsTaskType =
  | "feature"
  | "bugfix"
  | "refactor"
  | "docs"
  | "test"
  | "review"
  | "security"
  | "release";

/** Risk tier for the task. */
export type EtsRiskTier = "low" | "medium" | "high" | "critical";

/** Required evidence for a claim. */
export interface RequiredEvidenceItem {
  readonly evidenceId: string;
  readonly kind: EvidenceKind;
  readonly description: string;
  readonly minConfidence: number;
}

/** Metadata about a run artifact. */
export interface RunArtifactMeta {
  readonly runId: string;
  readonly nodeId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly cwd?: string;
  readonly treeHashBefore?: string;
  readonly treeHashAfter?: string;
  readonly commandHash?: string;
  readonly timestamp: string;
  readonly command?: string;
}

/** Collected evidence with provenance. */
export interface CollectedEvidence {
  readonly items: readonly EvidenceItem[];
  readonly meta: RunArtifactMeta;
}

/** Result of verifying required vs collected evidence. */
export interface EvidenceVerificationResult {
  readonly satisfied: readonly string[];
  readonly missing: readonly string[];
  readonly partial: readonly string[];
}

/** ETS v2 result. */
export interface EtsV2Result {
  readonly score: number;
  readonly reproducibility: number;
  readonly independence: number;
  readonly coverageRelevance: number;
  readonly provenanceIntegrity: number;
  readonly freshness: number;
  readonly gamingPenalty: number;
  readonly staleResultPenalty: number;
  readonly unverifiableClaimPenalty: number;
  readonly verdict: "pass" | "warn" | "fail";
  readonly reasons: readonly string[];
}

/** ETS v2 engine. */
export interface EtsV2Engine {
  evaluate(params: EtsV2Params): Promise<EtsV2Result>;
}

/** Input parameters for ETS v2 evaluation. */
export interface EtsV2Params {
  readonly output: string;
  readonly taskType: EtsTaskType;
  readonly risk: EtsRiskTier;
  readonly runArtifacts: CollectedEvidence;
  readonly dependencyGraphFiles?: readonly string[];
  readonly now?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const WEIGHTS = {
  reproducibility: 0.30,
  independence: 0.25,
  coverageRelevance: 0.20,
  provenanceIntegrity: 0.15,
  freshness: 0.10,
} as const;

const STALE_HOURS_BY_RISK: Record<EtsRiskTier, number> = {
  low: 72,
  medium: 48,
  high: 24,
  critical: 6,
};

const CLAIM_PATTERNS: ReadonlyArray<{ category: EtsClaimCategory; regex: RegExp }> = [
  { category: "test", regex: /\b(tests?\s+pass(?:ed|es|ing)|test\s+coverage|all\s+tests?\s+(?:ok|green)|\bnpm\s+test|\bnode\s+--test)/i },
  { category: "build", regex: /\b(build\s+(?:ok|success|succeeded|pass(?:ed|es|ing))|npm\s+run\s+build|tsc\s+.*(?:no\s+error|success)|esbuild|vite\s+build)/i },
  { category: "typecheck", regex: /\b(typecheck\s+(?:ok|pass(?:ed|es|ing)|clean)|tsc\s+--noEmit|no\s+type\s+errors?)/i },
  { category: "lint", regex: /\b(lint\s+(?:ok|pass(?:ed|es|ing)|clean)|eslint.*(?:no\s+error|0\s+(?:problem|warning))|prettier.*check)/i },
  { category: "security", regex: /\b(secur(?:ity|e)\s+(?:ok|pass(?:ed|es|ing)|scan\s+(?:clean|passed))|secret.*scan|audit.*pass|vulnerability.*0)/i },
  { category: "performance", regex: /\b(performance\s+(?:ok|pass(?:ed|es|ing)|improved)|latency.*\d+ms|throughput)/i },
  { category: "docs", regex: /\b(docs?\s+(?:ok|pass(?:ed|es|ing)|updated)|readme.*updated|changelog.*updated)/i },
  { category: "behavioral", regex: /\b(fix(?:ed|es)\s+(?:bug|issue)|feature\s+(?:works?|implemented)|behavior\s+(?:correct|as\s+expected))/i },
];

// ─── Claim Extractor ───────────────────────────────────────────────────────

export function extractClaims(output: string): readonly EtsClaim[] {
  const claims: EtsClaim[] = [];
  const seen = new Set<string>();
  let claimIndex = 0;

  for (const { category, regex } of CLAIM_PATTERNS) {
    const matches = output.match(regex);
    if (matches) {
      for (const match of matches) {
        const key = `${category}:${match.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        claims.push({
          claimId: `claim-${category}-${claimIndex++}`,
          text: match,
          category,
          confidence: 0.8,
        });
      }
    }
  }

  return Object.freeze(claims);
}

// ─── Required Evidence ─────────────────────────────────────────────────────

export function requiredEvidenceForClaim(
  claim: EtsClaim,
  taskType: EtsTaskType,
  risk: EtsRiskTier
): readonly RequiredEvidenceItem[] {
  const required: RequiredEvidenceItem[] = [];

  const baseKinds: EvidenceKind[] = ["command", "trace"];
  const categoryKindMap: Record<EtsClaimCategory, EvidenceKind[]> = {
    test: ["test", "metric"],
    build: ["metric"],
    typecheck: ["metric"],
    lint: ["metric", "audit"],
    security: ["audit", "screenshot"],
    performance: ["metric", "trace"],
    docs: ["diff", "screenshot"],
    behavioral: ["diff", "test"],
  };

  const kinds = [...baseKinds, ...(categoryKindMap[claim.category] ?? [])];

  for (let i = 0; i < kinds.length; i++) {
    required.push({
      evidenceId: `${claim.claimId}-req-${i}`,
      kind: kinds[i],
      description: `Required ${kinds[i]} evidence for ${claim.category} claim`,
      minConfidence: risk === "critical" ? 0.95 : risk === "high" ? 0.85 : risk === "medium" ? 0.75 : 0.6,
    });
  }

  // High/critical risk adds extra audit trail
  if (risk === "high" || risk === "critical") {
    required.push({
      evidenceId: `${claim.claimId}-req-audit`,
      kind: "audit",
      description: `Audit trail for ${risk} risk task`,
      minConfidence: 0.9,
    });
  }

  // Critical tasks require screenshot or review evidence
  if (risk === "critical") {
    required.push({
      evidenceId: `${claim.claimId}-req-review`,
      kind: "review",
      description: `Review evidence for critical risk task`,
      minConfidence: 0.9,
    });
  }

  return Object.freeze(required);
}

// ─── Evidence Collector ────────────────────────────────────────────────────

export async function collectEvidenceFromRunDir(
  runDir: string,
  meta: RunArtifactMeta
): Promise<CollectedEvidence> {
  const items: EvidenceItem[] = [];

  const evidenceJsonlPath = join(runDir, "evidence.jsonl");
  if (existsSync(evidenceJsonlPath)) {
    try {
      const content = await readFile(evidenceJsonlPath, "utf8");
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as unknown;
          if (isObject(parsed)) {
            const item = evidenceItemFromRecord(parsed);
            if (item) items.push(item);
          }
        } catch { /* ignore parse errors */ }
      }
    } catch { /* ignore read errors */ }
  }

  return { items: Object.freeze(items), meta };
}

function evidenceItemFromRecord(record: Record<string, unknown>): EvidenceItem | null {
  const kind = parseEvidenceKind(record.kind);
  const verdict = parseEvidenceVerdict(record.status);
  if (!kind || !verdict) return null;

  return {
    id: String(record.evidenceId ?? record.id ?? ""),
    kind,
    source: String(record.source ?? record.nodeId ?? "unknown"),
    description: String(record.message ?? record.description ?? ""),
    verdict,
    timestamp: String(record.observedAt ?? record.timestamp ?? new Date().toISOString()),
    confidence: typeof record.confidence === "number" ? record.confidence : 0.8,
    linkedTraceId: record.linkedTraceId ? String(record.linkedTraceId) : undefined,
    linkedFilePaths: Array.isArray(record.linkedFilePaths)
      ? (record.linkedFilePaths as string[])
      : record.path
        ? [String(record.path)]
        : [],
    metadata: record.metadata && isObject(record.metadata) ? record.metadata : undefined,
  };
}

function parseEvidenceKind(value: unknown): EvidenceKind | null {
  const kinds: EvidenceKind[] = ["test", "diff", "command", "screenshot", "trace", "metric", "audit", "review"];
  return kinds.find((k) => k === value) ?? null;
}

function parseEvidenceVerdict(value: unknown): EvidenceVerdict | null {
  const verdicts: EvidenceVerdict[] = ["pass", "fail", "partial", "pending"];
  // Map evidence schema statuses to verdicts
  if (value === "passed") return "pass";
  if (value === "failed") return "fail";
  if (value === "missing" || value === "skipped" || value === "blocked") return "pending";
  return verdicts.find((v) => v === value) ?? null;
}

// ─── Evidence Verifier ─────────────────────────────────────────────────────

export function verifyEvidence(
  required: readonly RequiredEvidenceItem[],
  collected: CollectedEvidence
): EvidenceVerificationResult {
  const satisfied: string[] = [];
  const missing: string[] = [];
  const partial: string[] = [];

  for (const req of required) {
    const matches = collected.items.filter(
      (item) =>
        item.kind === req.kind &&
        item.confidence >= req.minConfidence &&
        (item.verdict === "pass" || item.verdict === "partial")
    );

    if (matches.length === 0) {
      missing.push(req.evidenceId);
    } else if (matches.some((m) => m.verdict === "pass")) {
      satisfied.push(req.evidenceId);
    } else {
      partial.push(req.evidenceId);
    }
  }

  return { satisfied: Object.freeze(satisfied), missing: Object.freeze(missing), partial: Object.freeze(partial) };
}

// ─── Sub-score Computers ───────────────────────────────────────────────────

function computeReproducibility(meta: RunArtifactMeta): number {
  let score = 0;
  let max = 0;

  // commandHash present
  if (meta.commandHash && meta.commandHash.length > 0) {
    score += 0.4;
  }
  max += 0.4;

  // treeHashBefore present
  if (meta.treeHashBefore && meta.treeHashBefore.length > 0) {
    score += 0.3;
  }
  max += 0.3;

  // treeHashAfter present
  if (meta.treeHashAfter && meta.treeHashAfter.length > 0) {
    score += 0.3;
  }
  max += 0.3;

  return max > 0 ? score / max : 0;
}

function computeIndependence(collected: CollectedEvidence): number {
  if (collected.items.length === 0) return 0;

  const independentSources = new Set(["runner", "command", "shell", "test", "ci"]);
  let independentCount = 0;

  for (const item of collected.items) {
    const sourceLower = item.source.toLowerCase();
    if (
      independentSources.has(sourceLower) ||
      item.kind === "test" ||
      item.kind === "command" ||
      item.kind === "metric"
    ) {
      independentCount++;
    }
  }

  return independentCount / collected.items.length;
}

function computeCoverageRelevance(
  collected: CollectedEvidence,
  dependencyGraphFiles?: readonly string[]
): number {
  if (collected.items.length === 0) return 0;

  const linkedCount = collected.items.filter((item) => {
    if (item.linkedFilePaths.length > 0) return true;
    if (dependencyGraphFiles && dependencyGraphFiles.length > 0) {
      // If item description mentions a file in the dependency graph
      return dependencyGraphFiles.some((f) => item.description.includes(f));
    }
    return false;
  }).length;

  return linkedCount / collected.items.length;
}

function computeProvenanceIntegrity(meta: RunArtifactMeta): number {
  const fields: Array<keyof RunArtifactMeta> = [
    "runId",
    "provider",
    "model",
    "cwd",
    "treeHashBefore",
    "treeHashAfter",
    "commandHash",
  ];

  const optionalFields: Array<keyof RunArtifactMeta> = ["nodeId"];
  const allFields = [...fields, ...optionalFields];

  let present = 0;
  for (const field of allFields) {
    const value = meta[field];
    if (typeof value === "string" && value.length > 0) {
      present++;
    }
  }

  return present / allFields.length;
}

function computeFreshness(
  collected: CollectedEvidence,
  risk: EtsRiskTier,
  nowIso: string
): number {
  if (collected.items.length === 0) return 0;

  const now = new Date(nowIso).getTime();
  const staleThresholdMs = STALE_HOURS_BY_RISK[risk] * 60 * 60 * 1000;

  let totalScore = 0;
  for (const item of collected.items) {
    const itemTime = new Date(item.timestamp).getTime();
    const ageMs = now - itemTime;

    if (ageMs < 0 || Number.isNaN(ageMs)) {
      totalScore += 1.0; // Future/now timestamp = fresh
      continue;
    }

    if (ageMs <= staleThresholdMs) {
      totalScore += 1.0;
    } else {
      // Linear decay over next 2x threshold
      const decayWindow = staleThresholdMs * 2;
      const decayed = Math.max(0, 1 - (ageMs - staleThresholdMs) / decayWindow);
      totalScore += decayed;
    }
  }

  return totalScore / collected.items.length;
}

// ─── Penalty Computers ─────────────────────────────────────────────────────

function computeGamingPenalty(
  claims: readonly EtsClaim[],
  collected: CollectedEvidence,
  verification: EvidenceVerificationResult
): number {
  let penalty = 0;

  // Penalty if claims outnumber independently-sourced evidence
  const independentItems = collected.items.filter(
    (item) =>
      item.source !== "agent" &&
      item.source !== "self" &&
      item.source !== "unknown"
  );
  if (claims.length > 0 && independentItems.length === 0) {
    penalty += 0.15;
  }

  // Penalty if many claims but few verified
  const claimToVerifiedRatio =
    claims.length > 0 ? verification.satisfied.length / claims.length : 1;
  if (claimToVerifiedRatio < 0.5) {
    penalty += 0.1;
  }

  // Penalty if all evidence is self-reported (agent-sourced)
  const allAgentSourced =
    collected.items.length > 0 &&
    collected.items.every(
      (item) =>
        item.source === "agent" ||
        item.source === "self" ||
        item.source === "unknown"
    );
  if (allAgentSourced) {
    penalty += 0.1;
  }

  return Math.min(penalty, 0.3);
}

function computeStaleResultPenalty(
  collected: CollectedEvidence,
  risk: EtsRiskTier,
  nowIso: string
): number {
  const now = new Date(nowIso).getTime();
  const staleThresholdMs = STALE_HOURS_BY_RISK[risk] * 60 * 60 * 1000;

  let staleCount = 0;
  for (const item of collected.items) {
    const itemTime = new Date(item.timestamp).getTime();
    const ageMs = now - itemTime;
    if (ageMs > staleThresholdMs) {
      staleCount++;
    }
  }

  return Math.min(staleCount * 0.05, 0.2);
}

function computeUnverifiableClaimPenalty(
  claims: readonly EtsClaim[],
  verification: EvidenceVerificationResult
): number {
  if (claims.length === 0) return 0;
  const unverifiedCount = verification.missing.length;
  return Math.min(unverifiedCount * 0.05, 0.3);
}

// ─── Verdict ───────────────────────────────────────────────────────────────

function computeVerdict(score: number): "pass" | "warn" | "fail" {
  if (score >= 0.75) return "pass";
  if (score >= 0.50) return "warn";
  return "fail";
}

// ─── Engine Factory ────────────────────────────────────────────────────────

export interface EtsV2EngineOptions {
  readonly customWeights?: Partial<typeof WEIGHTS>;
  readonly now?: string;
}

export function createEvidenceTrustScoreV2Engine(
  options?: EtsV2EngineOptions
): EtsV2Engine {
  const weights = { ...WEIGHTS, ...options?.customWeights };
  const now = options?.now ?? new Date().toISOString();

  return {
    async evaluate(params: EtsV2Params): Promise<EtsV2Result> {
      const claims = extractClaims(params.output);
      const allRequired: RequiredEvidenceItem[] = [];
      for (const claim of claims) {
        allRequired.push(...requiredEvidenceForClaim(claim, params.taskType, params.risk));
      }

      const verification = verifyEvidence(allRequired, params.runArtifacts);

      const reproducibility = computeReproducibility(params.runArtifacts.meta);
      const independence = computeIndependence(params.runArtifacts);
      const coverageRelevance = computeCoverageRelevance(
        params.runArtifacts,
        params.dependencyGraphFiles
      );
      const provenanceIntegrity = computeProvenanceIntegrity(params.runArtifacts.meta);
      const freshness = computeFreshness(params.runArtifacts, params.risk, params.now ?? now);

      const gamingPenalty = computeGamingPenalty(claims, params.runArtifacts, verification);
      const staleResultPenalty = computeStaleResultPenalty(
        params.runArtifacts,
        params.risk,
        params.now ?? now
      );
      const unverifiableClaimPenalty = computeUnverifiableClaimPenalty(claims, verification);

      let score =
        weights.reproducibility * reproducibility +
        weights.independence * independence +
        weights.coverageRelevance * coverageRelevance +
        weights.provenanceIntegrity * provenanceIntegrity +
        weights.freshness * freshness -
        gamingPenalty -
        staleResultPenalty -
        unverifiableClaimPenalty;

      score = Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));

      const reasons: string[] = [];
      if (reproducibility < 0.5) reasons.push("reproducibility below 0.5");
      if (independence < 0.5) reasons.push("independence below 0.5");
      if (coverageRelevance < 0.5) reasons.push("coverage_relevance below 0.5");
      if (provenanceIntegrity < 0.5) reasons.push("provenance_integrity below 0.5");
      if (freshness < 0.5) reasons.push("freshness below 0.5");
      if (gamingPenalty > 0) reasons.push(`gaming_penalty=${gamingPenalty.toFixed(3)}`);
      if (staleResultPenalty > 0) reasons.push(`stale_result_penalty=${staleResultPenalty.toFixed(3)}`);
      if (unverifiableClaimPenalty > 0)
        reasons.push(`unverifiable_claim_penalty=${unverifiableClaimPenalty.toFixed(3)}`);
      if (verification.missing.length > 0)
        reasons.push(`missing evidence: ${verification.missing.length} items`);

      const verdict = computeVerdict(score);

      return {
        score,
        reproducibility: Math.round(reproducibility * 1000) / 1000,
        independence: Math.round(independence * 1000) / 1000,
        coverageRelevance: Math.round(coverageRelevance * 1000) / 1000,
        provenanceIntegrity: Math.round(provenanceIntegrity * 1000) / 1000,
        freshness: Math.round(freshness * 1000) / 1000,
        gamingPenalty: Math.round(gamingPenalty * 1000) / 1000,
        staleResultPenalty: Math.round(staleResultPenalty * 1000) / 1000,
        unverifiableClaimPenalty: Math.round(unverifiableClaimPenalty * 1000) / 1000,
        verdict,
        reasons: Object.freeze(reasons),
      };
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ─── Backward-compat: re-export as EvidenceTrustScore for integration ──────

export { createEvidenceTrustScoreV2Engine as createEvidenceTrustScore };
