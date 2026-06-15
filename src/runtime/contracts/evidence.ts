/**
 * Evidence contracts for OMK Weakness Remediation.
 *
 * Core interfaces that bridge reasoning traces, runtime decisions,
 * provider maturity, and release gates into a verifiable evidence model.
 */

// ── Evidence Item ───────────────────────────────────────────────

/** Granularity of a single evidence artifact. */
export type EvidenceKind =
  | "test"
  | "diff"
  | "command"
  | "screenshot"
  | "trace"
  | "metric"
  | "audit"
  | "review";

/** Verdict state of an evidence item. */
export type EvidenceVerdict = "pass" | "fail" | "partial" | "pending";

/** A single, auditable piece of evidence. */
export interface EvidenceItem {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly source: string;
  readonly description: string;
  readonly verdict: EvidenceVerdict;
  readonly timestamp: string;
  readonly confidence: number;
  readonly linkedTraceId?: string;
  readonly linkedFilePaths: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ── Proof Bundle ────────────────────────────────────────────────

/** A curated bundle of evidence items with a collective verdict. */
export interface ProofBundle {
  readonly id: string;
  readonly name: string;
  readonly items: readonly EvidenceItem[];
  readonly createdAt: string;
  readonly verdict: EvidenceVerdict;
  readonly coveragePercent: number;
  readonly summary: string;
}

// ── Provider Maturity ───────────────────────────────────────────

/** Maturity tier for a provider or runtime surface. */
export type MaturityTier = "experimental" | "preview" | "stable" | "deprecated";

/** Maturity assessment for a provider/runtime. */
export interface ProviderMaturity {
  readonly providerId: string;
  readonly tier: MaturityTier;
  readonly runCount: number;
  readonly passRate: number;
  readonly lastVerifiedAt: string;
  readonly knownIssues: readonly string[];
  readonly recommendedBudgetFactor: number;
}

// ── Runtime Router Decision ─────────────────────────────────────

/** Normalized record of a runtime routing decision. */
export interface RuntimeRouterDecision {
  readonly decisionId: string;
  readonly turnId: string;
  readonly timestamp: string;
  readonly intentCategory: string;
  readonly selectedRuntimeId: string;
  readonly candidatesConsidered: readonly string[];
  readonly confidence: number;
  readonly fallbackUsed: boolean;
  readonly latencyMs: number;
}

// ── Claim Permission Level ──────────────────────────────────────

/** Permission level derived from a proof bundle trust score. */
export type ClaimPermissionLevel =
  | "strong-public-claim"
  | "qualified-public-claim"
  | "internal-claim-only"
  | "no-claim";

// ── Provider Authority Class ────────────────────────────────────

/** Authority class derived from provider maturity score and sub-scores. */
export type ProviderAuthorityClass =
  | "merge-authority"
  | "write-authority"
  | "review-authority"
  | "read-only-advisory"
  | "disabled";

// ── Adapter Test Result ─────────────────────────────────────────

/** Kinds of adapter tests used in provider maturity assessment. */
export type AdapterTestKind =
  | "auth"
  | "read"
  | "write"
  | "shell"
  | "mcp"
  | "merge"
  | "evidence"
  | "fallback";

/** Result of a single adapter test. */
export interface AdapterTestResult {
  readonly kind: AdapterTestKind;
  readonly passed: boolean;
  readonly score: number;
  readonly details?: string;
}

// ── Evidence Gate Requirement ───────────────────────────────────

/** Kinds of output gates that can satisfy evidence-required turns. */
export type EvidenceGateKind =
  | "file-exists"
  | "test-pass"
  | "review-pass"
  | "command-pass"
  | "summary"
  | "artifact"
  | "diff";

/** Result of checking whether a node/task produced required evidence. */
export interface EvidenceGateCheck {
  readonly required: boolean;
  readonly satisfied: boolean;
  readonly gates: readonly EvidenceGateKind[];
  readonly missing: readonly EvidenceGateKind[];
  readonly reason: string;
}

export function checkEvidenceGate(
  required: boolean | undefined,
  outputs: readonly { gate?: string; ref?: string; required?: boolean }[] | undefined,
  metadata?: Record<string, unknown> | null
): EvidenceGateCheck {
  const gateKinds: EvidenceGateKind[] = [
    "file-exists",
    "test-pass",
    "review-pass",
    "command-pass",
    "summary",
    "artifact",
    "diff",
  ];
  const satisfiedKinds = new Set<EvidenceGateKind>();

  // Direct output gates
  for (const output of outputs ?? []) {
    const kind = output.gate?.toLowerCase();
    if (kind && gateKinds.includes(kind as EvidenceGateKind) && (output.ref || output.required !== false)) {
      satisfiedKinds.add(kind as EvidenceGateKind);
    }
  }

  // Metadata-captured gates (e.g. from runtime-router or task runner)
  const metaGates = metadata?.evidenceGates;
  if (Array.isArray(metaGates)) {
    for (const g of metaGates) {
      if (gateKinds.includes(g as EvidenceGateKind)) satisfiedKinds.add(g as EvidenceGateKind);
    }
  }
  const metaCommandPass = metadata?.commandPass === true || metadata?.testPass === true || metadata?.buildPass === true;
  if (metaCommandPass) satisfiedKinds.add("command-pass");
  const metaDiff = metadata?.diff || metadata?.patch || metadata?.changedFiles;
  if (metaDiff) satisfiedKinds.add("diff");
  const metaArtifact = metadata?.artifact || metadata?.artifactPath || metadata?.evidenceRef;
  if (metaArtifact) satisfiedKinds.add("artifact");

  if (!required) {
    return { required: false, satisfied: true, gates: [...satisfiedKinds], missing: [], reason: "evidence not required" };
  }

  if (satisfiedKinds.size > 0) {
    return {
      required: true,
      satisfied: true,
      gates: [...satisfiedKinds],
      missing: [],
      reason: `evidence satisfied by ${[...satisfiedKinds].join(", ")}`,
    };
  }

  return {
    required: true,
    satisfied: false,
    gates: [],
    missing: gateKinds,
    reason: "required evidence gate missing: no command-pass, test-pass, review-pass, file-exists, summary, artifact, or diff output",
  };
}

// ── Release Gate Result ─────────────────────────────────────────

/** Per-gate check result. */
export interface GateCheck {
  readonly gate: string;
  readonly passed: boolean;
  readonly message: string;
  readonly evidenceIds: readonly string[];
}

/** Result of a full release gate evaluation. */
export interface ReleaseGateResult {
  readonly runId: string;
  readonly timestamp: string;
  readonly overallPass: boolean;
  readonly checks: readonly GateCheck[];
  readonly requiredGates: readonly string[];
  readonly optionalGates: readonly string[];
  readonly summary: string;
}
