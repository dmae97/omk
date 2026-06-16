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

/** A declared gate requirement. Declarations are not evidence. */
export interface EvidenceRequirement {
  readonly gate: EvidenceGateKind;
  readonly ref?: string;
  readonly required: boolean;
}

/** A produced, replayable evidence observation. */
export interface EvidenceObservation {
  readonly kind: EvidenceGateKind;
  readonly source: "stdout" | "metadata" | "artifact" | "file";
  readonly ref?: string;
  readonly artifactPath?: string;
  readonly timestamp: string;
  readonly replayable: boolean;
  readonly redacted: boolean;
  /** Confidence that this observation is replayable, command-backed evidence. */
  readonly confidence: number;
}

/** Result of checking whether a node/task produced required evidence. */
export interface EvidenceGateCheck {
  readonly required: boolean;
  readonly satisfied: boolean;
  readonly gates: readonly EvidenceGateKind[];
  readonly missing: readonly EvidenceGateKind[];
  readonly reason: string;
  readonly requirements?: readonly EvidenceRequirement[];
  readonly observations?: readonly EvidenceObservation[];
}

const EVIDENCE_GATE_KINDS: readonly EvidenceGateKind[] = [
  "file-exists",
  "test-pass",
  "review-pass",
  "command-pass",
  "summary",
  "artifact",
  "diff",
];

export function isEvidenceGateKind(value: string | undefined): value is EvidenceGateKind {
  return Boolean(value && EVIDENCE_GATE_KINDS.includes(value.toLowerCase() as EvidenceGateKind));
}

export function evidenceRequirementsFromOutputs(
  outputs: readonly { gate?: string; ref?: string; required?: boolean }[] | undefined,
): EvidenceRequirement[] {
  const requirements: EvidenceRequirement[] = [];
  for (const output of outputs ?? []) {
    const kind = output.gate?.toLowerCase();
    if (!isEvidenceGateKind(kind)) continue;
    if (output.required === false) continue;
    requirements.push({ gate: kind, ref: output.ref, required: true });
  }
  return requirements;
}

export function hasDeclaredEvidenceRequirement(
  outputs: readonly { gate?: string; ref?: string; required?: boolean }[] | undefined,
): boolean {
  return evidenceRequirementsFromOutputs(outputs).length > 0;
}

export function evidenceObservationsFromResult(input: {
  readonly metadata?: Record<string, unknown> | null;
  readonly stdout?: string;
  readonly artifactPaths?: readonly string[];
  readonly timestamp?: string;
}): EvidenceObservation[] {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const observations: EvidenceObservation[] = [];
  const metadata = input.metadata ?? undefined;

  const metaGates = metadata?.evidenceGates;
  if (Array.isArray(metaGates)) {
    for (const raw of metaGates) {
      const gate = typeof raw === "string" ? raw.toLowerCase() : undefined;
      if (isEvidenceGateKind(gate)) {
        observations.push({ kind: gate, source: "metadata", timestamp, replayable: true, redacted: true, confidence: 0.9 });
      }
    }
  }
  if (metadata?.commandPass === true || metadata?.testPass === true || metadata?.buildPass === true) {
    observations.push({ kind: "command-pass", source: "metadata", timestamp, replayable: true, redacted: true, confidence: 0.9 });
  }
  if (metadata?.diff || metadata?.patch || metadata?.changedFiles) {
    observations.push({ kind: "diff", source: "metadata", timestamp, replayable: true, redacted: true, confidence: 0.9 });
  }
  const artifactRef = metadata?.artifact ?? metadata?.artifactPath ?? metadata?.evidenceRef;
  if (typeof artifactRef === "string" && artifactRef.trim().length > 0) {
    observations.push({ kind: "artifact", source: "metadata", ref: artifactRef, artifactPath: artifactRef, timestamp, replayable: true, redacted: true, confidence: 0.95 });
  }
  for (const artifactPath of input.artifactPaths ?? []) {
    observations.push({ kind: "artifact", source: "artifact", artifactPath, ref: artifactPath, timestamp, replayable: true, redacted: true, confidence: 0.95 });
  }

  const stdout = input.stdout ?? "";
  if (stdout.trim().length > 0) {
    observations.push({ kind: "summary", source: "stdout", timestamp, replayable: true, redacted: true, confidence: 0.4 });
  }
  if (/\b(pass(ed)?|success|ok)\b/i.test(stdout) && /\b(test|check|build|lint|command)\b/i.test(stdout)) {
    observations.push({ kind: "command-pass", source: "stdout", timestamp, replayable: true, redacted: true, confidence: 0.4 });
  }

  return observations;
}

function minimumConfidenceFor(requirement: EvidenceRequirement): number {
  if (requirement.gate === "command-pass" || requirement.gate === "test-pass") return 0.8;
  return 0;
}

function observationSatisfies(requirement: EvidenceRequirement, observation: EvidenceObservation): boolean {
  if (!observation.replayable || !observation.redacted) return false;
  if (observation.confidence < minimumConfidenceFor(requirement)) return false;
  if (observation.kind === requirement.gate) return true;
  if (requirement.gate === "test-pass" && observation.kind === "command-pass") return true;
  if (requirement.gate === "file-exists" && observation.kind === "artifact") return true;
  return false;
}

export function checkEvidenceGate(
  required: boolean | undefined,
  outputs: readonly { gate?: string; ref?: string; required?: boolean }[] | undefined,
  metadata?: Record<string, unknown> | null,
  stdout?: string,
  artifactPaths?: readonly string[],
): EvidenceGateCheck {
  const requirements = evidenceRequirementsFromOutputs(outputs);
  const observations = evidenceObservationsFromResult({ metadata, stdout, artifactPaths });
  const observedKinds = new Set(observations.map((o) => o.kind));

  if (!required) {
    return { required: false, satisfied: true, gates: [...observedKinds], missing: [], reason: "evidence not required", requirements, observations };
  }

  if (requirements.length === 0 && observations.length > 0) {
    const strongObservations = observations.filter((observation) => observation.confidence >= 0.8 && observation.replayable && observation.redacted);
    if (strongObservations.length > 0) {
      return {
        required: true,
        satisfied: true,
        gates: [...new Set(strongObservations.map((observation) => observation.kind))],
        missing: [],
        reason: `evidence satisfied by high-confidence observations without explicit gate: ${[...new Set(strongObservations.map((observation) => observation.kind))].join(", ")}`,
        requirements,
        observations,
      };
    }
  }

  const effectiveRequirements = requirements.length > 0
    ? requirements
    : EVIDENCE_GATE_KINDS.map((gate) => ({ gate, required: true }));
  const missing = effectiveRequirements
    .filter((requirement) => !observations.some((observation) => observationSatisfies(requirement, observation)))
    .map((requirement) => requirement.gate);

  if (missing.length === 0) {
    return {
      required: true,
      satisfied: true,
      gates: [...observedKinds],
      missing: [],
      reason: `evidence satisfied by observations: ${[...observedKinds].join(", ") || "none"}`,
      requirements: effectiveRequirements,
      observations,
    };
  }

  return {
    required: true,
    satisfied: false,
    gates: [...observedKinds],
    missing,
    reason: `required evidence observations missing: ${[...new Set(missing)].join(", ")}`,
    requirements: effectiveRequirements,
    observations,
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
