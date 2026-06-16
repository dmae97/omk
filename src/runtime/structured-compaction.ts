import type { ContextCapsule } from "./context-capsule.js";

export interface StructuredCompactionContract {
  readonly schemaVersion: "omk.structured-compaction.v1";
  readonly requiredSections: readonly string[];
  readonly minTaskPrefixChars: number;
  readonly safetyMarkers: readonly string[];
}

export interface StructuredCompactionValidationResult {
  readonly ok: boolean;
  readonly missing: readonly string[];
  readonly contract: StructuredCompactionContract;
}

export const DEFAULT_STRUCTURED_COMPACTION_CONTRACT: StructuredCompactionContract = {
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

export function validateStructuredCompaction(
  compactedText: string,
  capsule: ContextCapsule,
  contract: StructuredCompactionContract = DEFAULT_STRUCTURED_COMPACTION_CONTRACT,
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

export function structuredCompactionGuardNote(result: StructuredCompactionValidationResult): string {
  return `Headroom compaction removed required sections: ${result.missing.join(", ")}; using original capsule.`;
}

export function structuredCompactionInstruction(contract: StructuredCompactionContract = DEFAULT_STRUCTURED_COMPACTION_CONTRACT): string {
  return [
    `${contract.schemaVersion}: the original context capsule was compacted before runtime dispatch.`,
    `Required sections: ${contract.requiredSections.join(", ")}.`,
    "Preserve task, node routing, evidence requirements, safety constraints, and capability grants below.",
  ].join(" ");
}
