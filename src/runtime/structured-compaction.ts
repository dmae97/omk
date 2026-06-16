import type { ContextCapsule } from "./context-capsule.js";
import { maskSensitiveText } from "../util/secret-mask.js";

export interface StructuredCompactionContractV1 {
  readonly schemaVersion: "omk.structured-compaction.v1";
  readonly requiredSections: readonly string[];
  readonly minTaskPrefixChars: number;
  readonly safetyMarkers: readonly string[];
}

export interface StructuredCompactionContractV2 {
  readonly schemaVersion: "omk.structured-compaction.v2";
  readonly node: {
    readonly id: string;
    readonly role: string;
  };
  readonly routing: {
    readonly provider: string;
    readonly risk: string;
    readonly sandboxMode: string;
    readonly readOnly: boolean;
    readonly approvalPolicy: string;
  };
  readonly evidence: {
    readonly required: readonly { readonly gate: string; readonly ref?: string }[];
  };
  readonly capabilities: readonly string[];
  readonly safety: {
    readonly evidenceRequired: boolean;
    readonly preserve: readonly string[];
  };
}

export type StructuredCompactionContract = StructuredCompactionContractV1 | StructuredCompactionContractV2;

export interface StructuredCompactionValidationResult {
  readonly ok: boolean;
  readonly missing: readonly string[];
  readonly contract: StructuredCompactionContract;
}

export interface StructuredCompactionBuildOptions {
  /** Approximate target budget for the generated fallback text. */
  readonly maxTokens?: number;
  /** Apply secret redaction to all non-contract free text. Default true. */
  readonly redact?: boolean;
  readonly maxMemoryFacts?: number;
  readonly maxDependencySummaries?: number;
}

export const DEFAULT_STRUCTURED_COMPACTION_CONTRACT: StructuredCompactionContractV1 = {
  schemaVersion: "omk.structured-compaction.v1",
  requiredSections: [
    "task",
    "node routing",
    "evidence requirements",
    "safety constraints",
    "capabilities",
  ],
  minTaskPrefixChars: 40,
  safetyMarkers: ["preserve", "safety", "constraints", "evidence required", "capabilities"],
};

export const STRUCTURED_COMPACTION_V2_SCHEMA_VERSION = "omk.structured-compaction.v2" as const;

export function validateStructuredCompaction(
  compactedText: string,
  capsule: ContextCapsule,
  contract: StructuredCompactionContractV1 = DEFAULT_STRUCTURED_COMPACTION_CONTRACT,
): StructuredCompactionValidationResult {
  const typed = parseTypedStructuredCompactionContract(compactedText);
  if (typed) return validateTypedStructuredCompaction(compactedText, capsule, typed);
  return validateLegacyStructuredCompaction(compactedText, capsule, contract);
}

function validateLegacyStructuredCompaction(
  compactedText: string,
  capsule: ContextCapsule,
  contract: StructuredCompactionContractV1,
): StructuredCompactionValidationResult {
  const lower = compactedText.toLowerCase();
  const missing: string[] = [];

  if (contract.requiredSections.includes("task")) {
    const taskLower = capsule.task.toLowerCase().trim();
    const prefixLength = Math.min(contract.minTaskPrefixChars, taskLower.length);
    if (taskLower.length > 0 && !lower.includes(taskLower.slice(0, prefixLength))) {
      missing.push("task");
    }
  }

  const routing = capsule.node.routing;
  if (routing && contract.requiredSections.includes("node routing")) {
    if (routing.provider && !lower.includes(routing.provider.toLowerCase())) missing.push("node routing provider");
    if (routing.risk && !lower.includes(routing.risk.toLowerCase())) missing.push("node routing risk");
    if (routing.sandboxMode && !lower.includes(routing.sandboxMode.toLowerCase())) missing.push("node routing sandboxMode");
    if (routing.readOnly === true && !lower.includes("read-only") && !lower.includes("readonly")) {
      missing.push("node routing readOnly");
    }
  }

  if (contract.requiredSections.includes("evidence requirements")) {
    const requiredGates = capsule.evidenceRequirements
      .filter((e) => e.required)
      .map((e) => e.gate.toLowerCase());
    if (requiredGates.length > 0 && !requiredGates.some((gate) => lower.includes(gate))) {
      missing.push("evidence requirements");
    }
  }

  if (contract.requiredSections.includes("safety constraints")) {
    const systemLower = capsule.system.toLowerCase();
    const hasSafetyMarker = contract.safetyMarkers.some((marker) => lower.includes(marker));
    const hasSystemOverlap = systemLower.length > 0 && lower.includes(systemLower.slice(0, Math.min(60, systemLower.length)));
    if (!hasSafetyMarker && !hasSystemOverlap) missing.push("safety constraints");
  }

  if (contract.requiredSections.includes("capabilities")) {
    const assignedCaps = new Set(routing?.assignedProviderCapabilities?.map((c) => c.toLowerCase()) ?? []);
    if (assignedCaps.size > 0 && !Array.from(assignedCaps).some((cap) => lower.includes(cap))) {
      missing.push("capabilities");
    }
  }

  return { ok: missing.length === 0, missing, contract };
}

export function buildTypedStructuredCompactionContract(capsule: ContextCapsule): StructuredCompactionContractV2 {
  const routing = capsule.node.routing;
  const requiredEvidence = capsule.evidenceRequirements
    .filter((e) => e.required)
    .map((e) => (e.ref ? { gate: e.gate, ref: e.ref } : { gate: e.gate }));
  return {
    schemaVersion: STRUCTURED_COMPACTION_V2_SCHEMA_VERSION,
    node: {
      id: capsule.nodeId,
      role: String(capsule.node.role ?? "worker"),
    },
    routing: {
      provider: routing?.provider ?? "auto",
      risk: routing?.risk ?? "read",
      sandboxMode: routing?.sandboxMode ?? "unknown",
      readOnly: routing?.readOnly === true,
      approvalPolicy: routing?.approvalPolicy ?? "unknown",
    },
    evidence: {
      required: requiredEvidence,
    },
    capabilities: routing?.assignedProviderCapabilities ?? [],
    safety: {
      evidenceRequired: routing?.evidenceRequired === true || requiredEvidence.length > 0,
      preserve: DEFAULT_STRUCTURED_COMPACTION_CONTRACT.requiredSections,
    },
  };
}

export function renderTypedStructuredCompactionContract(contract: StructuredCompactionContractV2): string {
  return [
    "```json omk.structured-compaction.v2",
    JSON.stringify(contract, null, 2),
    "```",
  ].join("\n");
}

export function parseTypedStructuredCompactionContract(compactedText: string): StructuredCompactionContractV2 | null {
  const match = compactedText.match(/```json omk\.structured-compaction\.v2\s*\n([\s\S]*?)\n```/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== STRUCTURED_COMPACTION_V2_SCHEMA_VERSION) return null;
    if (!isRecord(parsed.node) || typeof parsed.node.id !== "string" || typeof parsed.node.role !== "string") return null;
    if (!isRecord(parsed.routing)) return null;
    if (!isRecord(parsed.evidence) || !Array.isArray(parsed.evidence.required)) return null;
    if (!Array.isArray(parsed.capabilities)) return null;
    if (!isRecord(parsed.safety) || !Array.isArray(parsed.safety.preserve)) return null;
    return parsed as unknown as StructuredCompactionContractV2;
  } catch {
    return null;
  }
}

function validateTypedStructuredCompaction(
  compactedText: string,
  capsule: ContextCapsule,
  contract: StructuredCompactionContractV2,
): StructuredCompactionValidationResult {
  const missing: string[] = [];
  const expected = buildTypedStructuredCompactionContract(capsule);
  const lower = compactedText.toLowerCase();

  for (const section of DEFAULT_STRUCTURED_COMPACTION_CONTRACT.requiredSections) {
    if (!lower.includes(`## ${section}`)) missing.push(section);
  }

  if (contract.node.id !== expected.node.id) missing.push("typed node id");
  if (contract.node.role !== expected.node.role) missing.push("typed node role");
  if (contract.routing.provider !== expected.routing.provider) missing.push("typed routing provider");
  if (contract.routing.risk !== expected.routing.risk) missing.push("typed routing risk");
  if (contract.routing.sandboxMode !== expected.routing.sandboxMode) missing.push("typed routing sandboxMode");
  if (contract.routing.readOnly !== expected.routing.readOnly) missing.push("typed routing readOnly");
  if (contract.routing.approvalPolicy !== expected.routing.approvalPolicy) missing.push("typed routing approvalPolicy");
  if (!sameStringSet(contract.capabilities, expected.capabilities)) missing.push("typed capabilities");
  if (!sameEvidence(contract.evidence.required, expected.evidence.required)) missing.push("typed evidence requirements");
  if (contract.safety.evidenceRequired !== expected.safety.evidenceRequired) missing.push("typed safety evidenceRequired");
  if (!DEFAULT_STRUCTURED_COMPACTION_CONTRACT.requiredSections.every((section) => contract.safety.preserve.includes(section))) {
    missing.push("typed safety preserve");
  }

  return { ok: missing.length === 0, missing, contract };
}

export function structuredCompactionGuardNote(result: StructuredCompactionValidationResult): string {
  return `Headroom compaction removed required sections: ${result.missing.join(", ")}; using original capsule.`;
}

export function structuredCompactionInstruction(contract: StructuredCompactionContract = DEFAULT_STRUCTURED_COMPACTION_CONTRACT): string {
  if (contract.schemaVersion === STRUCTURED_COMPACTION_V2_SCHEMA_VERSION) {
    return [
      `${contract.schemaVersion}: the original context capsule was compacted before runtime dispatch.`,
      "The typed JSON contract below is authoritative for routing, evidence, safety, and capabilities.",
      "Preserve task, node routing, evidence requirements, safety constraints, and capability grants below.",
    ].join(" ");
  }
  return [
    `${contract.schemaVersion}: the original context capsule was compacted before runtime dispatch.`,
    `Required sections: ${contract.requiredSections.join(", ")}.`,
    "Preserve task, node routing, evidence requirements, safety constraints, and capability grants below.",
  ].join(" ");
}

export function buildStructuredCompactionText(
  capsule: ContextCapsule,
  contract: StructuredCompactionContractV1 = DEFAULT_STRUCTURED_COMPACTION_CONTRACT,
  options: StructuredCompactionBuildOptions = {},
): string {
  const typedContract = buildTypedStructuredCompactionContract(capsule);
  const routing = capsule.node.routing;
  const redact = options.redact !== false;
  const safe = (value: unknown, maxChars = 1_200): string => truncateChars(redactText(String(value ?? ""), redact), maxChars);
  const requiredEvidence = capsule.evidenceRequirements
    .filter((e) => e.required)
    .map((e) => `${safe(e.gate, 120)}${e.ref ? `:${safe(e.ref, 240)}` : ""}`)
    .join(", ") || "none";
  const capabilities = routing?.assignedProviderCapabilities?.map((cap) => safe(cap, 120)).join(", ") || "none";

  const hardSections = [
    structuredCompactionInstruction(typedContract),
    renderTypedStructuredCompactionContract(typedContract),
    "",
    "## task",
    safe(capsule.task, 1_600),
    "",
    "## node routing",
    [
      `node=${safe(capsule.nodeId, 160)}`,
      `role=${safe(capsule.node.role, 120)}`,
      `provider=${safe(routing?.provider ?? "auto", 120)}`,
      `risk=${safe(routing?.risk ?? "read", 120)}`,
      `sandboxMode=${safe(routing?.sandboxMode ?? "unknown", 120)}`,
      `readOnly=${routing?.readOnly === true ? "read-only" : "write-capable"}`,
      `approvalPolicy=${safe(routing?.approvalPolicy ?? "unknown", 120)}`,
    ].join("; "),
    "",
    "## evidence requirements",
    requiredEvidence,
    "",
    "## safety constraints",
    [
      "preserve safety constraints",
      routing?.evidenceRequired ? "evidence required" : "evidence optional",
      `goal=${safe(capsule.goal, 400)}`,
      safe(capsule.system, 700),
    ].filter(Boolean).join("; "),
    "",
    "## capabilities",
    capabilities,
  ].join("\n");

  const targetTokens = Math.max(256, Math.floor(options.maxTokens ?? (capsule.budget.maxInputTokens - capsule.budget.reservedOutputTokens)));
  let remainingTokens = Math.max(0, targetTokens - estimateTextTokens(hardSections));
  const selected = selectCandidateSections(capsule, remainingTokens, options, redact);

  return [hardSections, ...selected].join("\n");
}

interface CandidateSection {
  readonly heading: string;
  readonly text: string;
  readonly priority: number;
}

function selectCandidateSections(
  capsule: ContextCapsule,
  budgetTokens: number,
  options: StructuredCompactionBuildOptions,
  redact: boolean,
): string[] {
  const candidates: CandidateSection[] = [];
  const maxDeps = Math.max(0, options.maxDependencySummaries ?? 5);
  for (const [index, summary] of capsule.dependencySummaries.slice(0, maxDeps).entries()) {
    candidates.push({
      heading: "dependency summaries",
      text: redactText(summary, redact),
      priority: 0.78 - index * 0.02,
    });
  }

  const maxMemoryFacts = Math.max(0, options.maxMemoryFacts ?? capsule.budget.maxMemoryFacts);
  for (const [index, fact] of capsule.graphMemory.slice(0, maxMemoryFacts).entries()) {
    const text = redactText(`${fact.key}=${fact.value}`, redact);
    candidates.push({
      heading: "graph memory",
      text,
      priority: memoryPriority(fact.kind) - index * 0.01,
    });
  }

  for (const [index, file] of capsule.relevantFiles.slice(0, 5).entries()) {
    candidates.push({
      heading: "file summaries",
      text: redactText(`${file.path}:${file.startLine}-${file.endLine}\n${truncateChars(file.content, 1_000)}`, redact),
      priority: 0.62 - index * 0.02,
    });
  }

  for (const [index, attempt] of capsule.priorAttempts.slice(0, 5).entries()) {
    candidates.push({
      heading: "prior attempts",
      text: redactText(`attempt=${attempt.attempt} provider=${attempt.provider} status=${attempt.status} durationMs=${attempt.durationMs ?? "?"} failure=${attempt.failureSummary ?? "none"}`, redact),
      priority: 0.58 - index * 0.02,
    });
  }

  const selected: Record<string, string[]> = {};
  const sorted = candidates
    .map((candidate) => ({ ...candidate, cost: Math.max(1, estimateTextTokens(candidate.text)) }))
    .sort((a, b) => (b.priority / b.cost) - (a.priority / a.cost));

  let remaining = budgetTokens;
  for (const candidate of sorted) {
    if (remaining <= 0) break;
    const cost = Math.max(1, estimateTextTokens(candidate.text));
    const text = cost <= remaining
      ? candidate.text
      : truncateToTokenBudget(candidate.text, remaining);
    if (!text.trim()) continue;
    selected[candidate.heading] ??= [];
    selected[candidate.heading].push(text);
    remaining -= estimateTextTokens(text);
  }

  const headings = ["dependency summaries", "graph memory", "file summaries", "prior attempts"];
  return headings.map((heading) => {
    const lines = selected[heading];
    return ["", `## ${heading}`, lines?.length ? lines.join(" | ") : "none"].join("\n");
  });
}

function memoryPriority(kind: string): number {
  switch (kind) {
    case "failure_pattern":
    case "provider_behavior":
      return 0.72;
    case "architecture_decision":
    case "api_contract":
      return 0.66;
    default:
      return 0.54;
  }
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokenBudget(text: string, budgetTokens: number): string {
  const maxChars = Math.max(0, budgetTokens * 4);
  return truncateChars(text, maxChars);
}

function truncateChars(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars <= 16) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 16)}…[truncated]`;
}

function redactText(text: string, redact: boolean): string {
  return redact ? maskSensitiveText(text) : text;
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function sameEvidence(
  a: readonly { readonly gate: string; readonly ref?: string }[],
  b: readonly { readonly gate: string; readonly ref?: string }[],
): boolean {
  const key = (item: { readonly gate: string; readonly ref?: string }) => `${item.gate}\u0000${item.ref ?? ""}`;
  return sameStringSet(a.map(key), b.map(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
