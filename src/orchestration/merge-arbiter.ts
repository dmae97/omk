/**
 * Merge Arbiter — patch scoring + conflict detection + winner selection.
 *
 * Pipeline:
 *   CollectCandidatePatches → NormalizeDiffs → RunEvidenceSuite → ScorePatch
 *   → DetectConflicts → SelectWinnerOrHybrid → ProduceMergeRationale
 */

import { readdir } from "fs/promises";
import { join } from "path";
import { runShell } from "../util/shell.js";
import { runQualityGate } from "../mcp/quality-gate.js";


// ─── Types ─────────────────────────────────────────────────────────────────

export interface CandidatePatch {
  id: string;
  name: string;
  path: string;
  diff: string;
  normalizedDiff: string;
  fileScopes: string[];
  diffLines: number;
  canApply: boolean;
  conflictsWith: string[];
  evidence: PatchEvidence;
  scores: PatchScores;
  compositeScore: number;
}

export interface PatchEvidence {
  testsPassed: boolean;
  lintPassed: boolean;
  typecheckPassed: boolean;
  reviewerScore?: number;
  reviewerReason?: string;
  evidenceTrustScore: number;
}

export interface PatchScores {
  testPassScore: number;
  evidenceTrustScore: number;
  minimalityScore: number;
  lintTypecheckScore: number;
  conflictFreeScore: number;
  reviewerAgreementScore: number;
}

export interface MergeArbiterResult {
  winner: CandidatePatch | null;
  requiresHumanApproval: boolean;
  rationale: MergeRationale;
  trace: MergeTrace;
}

export interface MergeRationale {
  summary: string;
  winnerId: string | null;
  scoreBreakdown: Record<string, number>;
  conflicts: string[];
  threshold: number;
  humanApprovalReason?: string;
}

export interface MergeTrace {
  steps: MergeTraceStep[];
  timestamp: string;
}

export interface MergeTraceStep {
  step: string;
  candidateId: string;
  detail: string;
  durationMs?: number;
}

export interface MergeArbiterOptions {
  /** Minimum composite score (0–1) for auto-approval. */
  threshold?: number;
  /** Max diff lines before minimality score hits zero. */
  maxDiffLines?: number;
  /** Timeout for test execution in worktrees (ms). */
  testTimeoutMs?: number;
  /** Timeout for git apply --check (ms). */
  applyCheckTimeoutMs?: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 0.6;
const DEFAULT_MAX_DIFF_LINES = 500;
const DEFAULT_TEST_TIMEOUT_MS = 120_000;
const DEFAULT_APPLY_CHECK_TIMEOUT_MS = 15_000;

const SCORE_WEIGHTS = {
  testPass: 0.35,
  evidenceTrust: 0.25,
  minimality: 0.15,
  lintTypecheck: 0.10,
  conflictFree: 0.10,
  reviewerAgreement: 0.05,
} as const;

// ─── Pipeline: CollectCandidatePatches ─────────────────────────────────────

export async function collectCandidatePatches(
  worktreesDir: string,
  currentBranch: string,
  options?: MergeArbiterOptions
): Promise<CandidatePatch[]> {
  const workerNames = await readdir(worktreesDir, { withFileTypes: true }).then((e) =>
    e.filter((d) => d.isDirectory()).map((d) => d.name)
  );

  const candidates: CandidatePatch[] = [];
  for (const name of workerNames) {
    const wtPath = join(worktreesDir, name);
    const diffResult = await runShell("git", ["-C", wtPath, "diff", currentBranch], {
      timeout: options?.applyCheckTimeoutMs ?? DEFAULT_APPLY_CHECK_TIMEOUT_MS,
    });
    if (diffResult.failed || !diffResult.stdout.trim()) continue;

    const diff = diffResult.stdout;
    const normalizedDiff = normalizeDiff(diff);
    const fileScopes = extractFileScopes(normalizedDiff);
    const diffLines = diff.split("\n").length;

    candidates.push({
      id: `candidate-${name}`,
      name,
      path: wtPath,
      diff,
      normalizedDiff,
      fileScopes,
      diffLines,
      canApply: true,
      conflictsWith: [],
      evidence: {
        testsPassed: false,
        lintPassed: false,
        typecheckPassed: false,
        evidenceTrustScore: 0.5,
      },
      scores: {
        testPassScore: 0,
        evidenceTrustScore: 0.5,
        minimalityScore: 0,
        lintTypecheckScore: 0,
        conflictFreeScore: 1,
        reviewerAgreementScore: 0.5,
      },
      compositeScore: 0,
    });
  }

  return candidates;
}

// ─── Pipeline: NormalizeDiffs ──────────────────────────────────────────────

export function normalizeDiff(diff: string): string {
  return diff
    .split("\n")
    .map((line) => {
      // Strip index timestamps: "index 1234..5678 100644" → "index <hash>..<hash> <mode>"
      if (line.startsWith("index ")) {
        const parts = line.split(" ");
        if (parts.length >= 3) {
          return `index <hash>..<hash> ${parts[2]}`;
        }
      }
      // Strip ---/+++ timestamps: "--- a/file\t2024-01-01 00:00:00.000000000 +0000"
      if (line.startsWith("--- ") || line.startsWith("+++ ")) {
        const tabIdx = line.indexOf("\t");
        if (tabIdx > 0) {
          return line.slice(0, tabIdx);
        }
      }
      return line;
    })
    .join("\n");
}

// ─── Pipeline: ExtractFileScopes ───────────────────────────────────────────

export function extractFileScopes(diff: string): string[] {
  const scopes = new Set<string>();
  const lines = diff.split("\n");
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(\S+) b\/(\S+)$/);
      if (match) {
        scopes.add(match[1]);
      }
    } else if (line.startsWith("--- a/") || line.startsWith("+++ b/")) {
      const prefix = line.startsWith("--- a/") ? "--- a/" : "+++ b/";
      const path = line.slice(prefix.length).split("\t")[0];
      if (path && path !== "/dev/null") {
        scopes.add(path);
      }
    }
  }
  return [...scopes];
}

// ─── Pipeline: RunEvidenceSuite ────────────────────────────────────────────

export async function runEvidenceSuite(
  candidate: CandidatePatch,
  projectRoot: string,
  config: string,
  options?: MergeArbiterOptions
): Promise<CandidatePatch> {
  const testTimeout = options?.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;

  // 1. git apply --check
  const applyCheck = await runShell("git", ["apply", "--check"], {
    cwd: projectRoot,
    input: candidate.diff,
    timeout: options?.applyCheckTimeoutMs ?? DEFAULT_APPLY_CHECK_TIMEOUT_MS,
  });
  candidate.canApply = !applyCheck.failed;

  // 2. Run tests in worktree
  const testResult = await runShell(
    "sh",
    ["-c", "npm test 2>/dev/null || pnpm test 2>/dev/null || yarn test 2>/dev/null || true"],
    { cwd: candidate.path, timeout: testTimeout }
  );
  candidate.evidence.testsPassed = !testResult.failed;

  // 3. Run quality gate (lint + typecheck) in worktree
  const qgResult = await runQualityGate(candidate.path, config);
  candidate.evidence.lintPassed = qgResult.lint.status === "passed" || qgResult.lint.status === "skipped";
  candidate.evidence.typecheckPassed = qgResult.typecheck.status === "passed" || qgResult.typecheck.status === "skipped";

  // 4. Compute evidence trust score from suite results
  let trust = 0.5;
  if (candidate.evidence.testsPassed) trust += 0.15;
  if (candidate.evidence.lintPassed) trust += 0.10;
  if (candidate.evidence.typecheckPassed) trust += 0.10;
  if (candidate.canApply) trust += 0.15;
  candidate.evidence.evidenceTrustScore = Math.min(1, trust);

  return candidate;
}

// ─── Pipeline: ScorePatch ──────────────────────────────────────────────────

export function scorePatch(
  candidate: CandidatePatch,
  options?: MergeArbiterOptions
): CandidatePatch {
  const maxLines = options?.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES;

  const testPassScore = candidate.evidence.testsPassed ? 1 : 0;
  const evidenceTrustScore = clamp01(candidate.evidence.evidenceTrustScore);
  const minimalityScore = clamp01(1 - candidate.diffLines / maxLines);
  const lintTypecheckScore =
    (candidate.evidence.lintPassed ? 0.5 : 0) +
    (candidate.evidence.typecheckPassed ? 0.5 : 0);
  const conflictFreeScore = candidate.canApply && candidate.conflictsWith.length === 0 ? 1 : 0;
  const reviewerAgreementScore =
    candidate.evidence.reviewerScore !== undefined
      ? clamp01(candidate.evidence.reviewerScore / 100)
      : 0.5;

  const composite =
    SCORE_WEIGHTS.testPass * testPassScore +
    SCORE_WEIGHTS.evidenceTrust * evidenceTrustScore +
    SCORE_WEIGHTS.minimality * minimalityScore +
    SCORE_WEIGHTS.lintTypecheck * lintTypecheckScore +
    SCORE_WEIGHTS.conflictFree * conflictFreeScore +
    SCORE_WEIGHTS.reviewerAgreement * reviewerAgreementScore;

  candidate.scores = {
    testPassScore,
    evidenceTrustScore,
    minimalityScore,
    lintTypecheckScore,
    conflictFreeScore,
    reviewerAgreementScore,
  };
  candidate.compositeScore = Math.round(clamp01(composite) * 1000) / 1000;
  return candidate;
}

// ─── Pipeline: DetectConflicts ─────────────────────────────────────────────

export function detectConflicts(candidates: CandidatePatch[]): CandidatePatch[] {
  // Reset conflict state
  for (const c of candidates) {
    c.conflictsWith = [];
  }

  const scopeMap = new Map<string, string[]>();
  for (const c of candidates) {
    for (const scope of c.fileScopes) {
      const list = scopeMap.get(scope) ?? [];
      list.push(c.id);
      scopeMap.set(scope, list);
    }
  }

  for (const c of candidates) {
    const conflicting = new Set<string>();
    for (const scope of c.fileScopes) {
      const owners = scopeMap.get(scope) ?? [];
      for (const ownerId of owners) {
        if (ownerId !== c.id) {
          conflicting.add(ownerId);
        }
      }
    }
    c.conflictsWith = [...conflicting];
    if (c.conflictsWith.length > 0) {
      c.scores.conflictFreeScore = 0;
      c.compositeScore = recalcComposite(c.scores);
    }
  }

  return candidates;
}

function recalcComposite(scores: PatchScores): number {
  return Math.round(clamp01(
    SCORE_WEIGHTS.testPass * scores.testPassScore +
    SCORE_WEIGHTS.evidenceTrust * scores.evidenceTrustScore +
    SCORE_WEIGHTS.minimality * scores.minimalityScore +
    SCORE_WEIGHTS.lintTypecheck * scores.lintTypecheckScore +
    SCORE_WEIGHTS.conflictFree * scores.conflictFreeScore +
    SCORE_WEIGHTS.reviewerAgreement * scores.reviewerAgreementScore
  ) * 1000) / 1000;
}

// ─── Pipeline: SelectWinnerOrHybrid ────────────────────────────────────────

export function selectWinnerOrHybrid(
  candidates: CandidatePatch[],
  options?: MergeArbiterOptions
): { winner: CandidatePatch | null; requiresHumanApproval: boolean; reason?: string } {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;

  if (candidates.length === 0) {
    return { winner: null, requiresHumanApproval: true, reason: "No candidates available." };
  }

  // Sort by composite score descending
  const sorted = [...candidates].sort((a, b) => b.compositeScore - a.compositeScore);
  const best = sorted[0];

  if (best.compositeScore < threshold) {
    return {
      winner: null,
      requiresHumanApproval: true,
      reason: `Best candidate "${best.name}" score ${best.compositeScore} below threshold ${threshold}.`,
    };
  }

  // If top candidate has conflicts, check whether a conflict-free candidate
  // meets the threshold; otherwise require human approval.
  if (best.conflictsWith.length > 0) {
    const cleanWinner = sorted.find((c) => c.compositeScore >= threshold && c.conflictsWith.length === 0);
    if (cleanWinner) {
      return { winner: cleanWinner, requiresHumanApproval: false };
    }
    return {
      winner: null,
      requiresHumanApproval: true,
      reason: `Best candidate "${best.name}" has scope conflicts and no clean alternative meets threshold ${threshold}.`,
    };
  }

  return { winner: best, requiresHumanApproval: false };
}

// ─── Pipeline: ProduceMergeRationale ───────────────────────────────────────

export function produceMergeRationale(
  candidates: CandidatePatch[],
  selection: { winner: CandidatePatch | null; requiresHumanApproval: boolean; reason?: string },
  options?: MergeArbiterOptions
): { rationale: MergeRationale; trace: MergeTrace } {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const winner = selection.winner;

  const scoreBreakdown: Record<string, number> = {};
  if (winner) {
    scoreBreakdown[winner.name] = winner.compositeScore;
  }
  for (const c of candidates) {
    if (c.id !== winner?.id) {
      scoreBreakdown[c.name] = c.compositeScore;
    }
  }

  const conflictPairs = new Set<string>();
  for (const c of candidates) {
    for (const otherId of c.conflictsWith) {
      const other = candidates.find((x) => x.id === otherId);
      const pair = [c.name, other?.name ?? otherId].sort().join(" ↔ ");
      conflictPairs.add(pair);
    }
  }
  const uniqueConflicts = [...conflictPairs];

  const summary = winner
    ? `Selected "${winner.name}" with score ${winner.compositeScore} (threshold ${threshold}).`
    : `No winner selected. ${selection.reason ?? ""}`;

  const rationale: MergeRationale = {
    summary,
    winnerId: winner?.id ?? null,
    scoreBreakdown,
    conflicts: uniqueConflicts,
    threshold,
    ...(selection.requiresHumanApproval && selection.reason
      ? { humanApprovalReason: selection.reason }
      : {}),
  };

  const trace: MergeTrace = {
    timestamp: new Date().toISOString(),
    steps: candidates.map((c) => ({
      step: "score",
      candidateId: c.id,
      detail: `${c.name}: composite=${c.compositeScore}, tests=${c.evidence.testsPassed}, lint=${c.evidence.lintPassed}, typecheck=${c.evidence.typecheckPassed}, conflicts=${c.conflictsWith.length}`,
    })),
  };

  if (winner) {
    trace.steps.push({
      step: "select-winner",
      candidateId: winner.id,
      detail: `Winner "${winner.name}" selected with score ${winner.compositeScore}`,
    });
  } else {
    trace.steps.push({
      step: "require-human-approval",
      candidateId: "none",
      detail: selection.reason ?? "Human approval required.",
    });
  }

  return { rationale, trace };
}

// ─── Orchestrator: runMergeArbiter ─────────────────────────────────────────

export async function runMergeArbiter(
  worktreesDir: string,
  currentBranch: string,
  projectRoot: string,
  config: string,
  options?: MergeArbiterOptions
): Promise<MergeArbiterResult> {
  const traceSteps: MergeTraceStep[] = [];
  // 1. Collect
  const collectStart = Date.now();
  let candidates = await collectCandidatePatches(worktreesDir, currentBranch, options);
  traceSteps.push({
    step: "collect",
    candidateId: "all",
    detail: `Collected ${candidates.length} candidate patches`,
    durationMs: Date.now() - collectStart,
  });

  if (candidates.length === 0) {
    const selection = selectWinnerOrHybrid(candidates, options);
    const { rationale, trace } = produceMergeRationale(candidates, selection, options);
    return {
      winner: null,
      requiresHumanApproval: true,
      rationale,
      trace: { timestamp: new Date().toISOString(), steps: [...traceSteps, ...trace.steps] },
    };
  }

  // 2. Normalize (already done during collect)
  traceSteps.push({
    step: "normalize",
    candidateId: "all",
    detail: "Diffs normalized (timestamps stripped, paths cleaned)",
  });

  // 3. Detect conflicts (file-scope overlap)
  const conflictStart = Date.now();
  candidates = detectConflicts(candidates);
  traceSteps.push({
    step: "detect-conflicts",
    candidateId: "all",
    detail: `File-scope overlap analyzed for ${candidates.length} candidates`,
    durationMs: Date.now() - conflictStart,
  });

  // 4. Run evidence suite per candidate
  for (const c of candidates) {
    const evStart = Date.now();
    await runEvidenceSuite(c, projectRoot, config, options);
    traceSteps.push({
      step: "evidence-suite",
      candidateId: c.id,
      detail: `apply=${c.canApply}, tests=${c.evidence.testsPassed}, lint=${c.evidence.lintPassed}, typecheck=${c.evidence.typecheckPassed}`,
      durationMs: Date.now() - evStart,
    });
  }

  // 5. Score each candidate
  for (const c of candidates) {
    scorePatch(c, options);
    traceSteps.push({
      step: "score",
      candidateId: c.id,
      detail: `composite=${c.compositeScore}`,
    });
  }

  // 6. Select winner
  const selection = selectWinnerOrHybrid(candidates, options);

  // 7. Produce rationale
  const { rationale, trace } = produceMergeRationale(candidates, selection, options);

  return {
    winner: selection.winner,
    requiresHumanApproval: selection.requiresHumanApproval,
    rationale,
    trace: {
      timestamp: new Date().toISOString(),
      steps: [...traceSteps, ...trace.steps],
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
