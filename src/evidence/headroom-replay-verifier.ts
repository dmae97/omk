import { readFileSync, existsSync } from "node:fs";
import type { GraphState } from "../memory/local-graph-memory-store.js";

export interface HeadroomReplayVerificationIssue {
  readonly kind: string;
  readonly message: string;
  readonly runId?: string;
  readonly nodeId?: string;
  readonly artifactRef?: string;
}

export interface HeadroomReplayVerificationResult {
  readonly pass: boolean;
  readonly issues: readonly HeadroomReplayVerificationIssue[];
}

export interface VerifyHeadroomReplayInput {
  readonly runId: string;
  readonly runDir: string;
  readonly state: GraphState;
  readonly qualityThreshold?: number;
}

export async function verifyHeadroomReplay(input: VerifyHeadroomReplayInput): Promise<HeadroomReplayVerificationResult> {
  const issues: HeadroomReplayVerificationIssue[] = [];
  const decisionPath = `${input.runDir}/headroom-decisions.jsonl`;

  if (!existsSync(decisionPath)) {
    issues.push({ kind: "missing-decisions", message: `headroom decisions file not found: ${decisionPath}`, runId: input.runId });
    return { pass: false, issues };
  }

  const lines = readFileSync(decisionPath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  const decisions: Array<Record<string, unknown>> = [];
  for (const [index, line] of lines.entries()) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.schemaVersion !== "omk.headroom-decision.v1") {
        issues.push({ kind: "schema-version", message: `unexpected schemaVersion at line ${index + 1}`, runId: input.runId });
      }
      if (typeof parsed.nodeId !== "string") {
        issues.push({ kind: "missing-node-id", message: `missing nodeId at line ${index + 1}`, runId: input.runId });
      }
      if (typeof parsed.attempted !== "boolean") {
        issues.push({ kind: "missing-attempted", message: `missing attempted boolean at line ${index + 1}`, runId: input.runId });
      }
      decisions.push(parsed);
    } catch {
      issues.push({ kind: "parse-error", message: `invalid JSON at line ${index + 1}`, runId: input.runId });
    }
  }

  const state = input.state;
  const graphDecisions = state.nodes.filter((node) => node.type === "HeadroomDecision" && node.properties.runId === input.runId);

  if (graphDecisions.length < decisions.length) {
    issues.push({
      kind: "graph-count",
      message: `graph HeadroomDecision count (${graphDecisions.length}) is lower than decision file lines (${decisions.length})`,
      runId: input.runId,
    });
  }

  for (const decision of decisions) {
    const nodeId = String(decision.nodeId);
    const graphDecision = graphDecisions.find((node) => node.properties.nodeId === nodeId);
    if (!graphDecision) {
      issues.push({ kind: "missing-graph-decision", message: `HeadroomDecision missing in graph for node ${nodeId}`, runId: input.runId, nodeId });
      continue;
    }

    const artifactRef = typeof decision.artifactRef === "string" ? decision.artifactRef : undefined;
    let artifactNode: typeof state.nodes[number] | undefined;
    if (artifactRef) {
      artifactNode = state.nodes.find((node) =>
        node.type === "Artifact" && node.properties.runId === input.runId && node.properties.path === artifactRef
      );
      if (!artifactNode) {
        issues.push({ kind: "missing-artifact-node", message: `Artifact node missing for ${artifactRef}`, runId: input.runId, nodeId, artifactRef });
      } else if (artifactNode.properties.exists !== true) {
        issues.push({ kind: "artifact-missing-on-disk", message: `Artifact declared but file does not exist: ${artifactRef}`, runId: input.runId, nodeId, artifactRef });
      } else {
        const absolutePath = `${input.runDir}/${artifactRef.split("/").pop() ?? ""}`;
        if (!existsSync(absolutePath)) {
          issues.push({ kind: "artifact-file-missing", message: `artifact file not found: ${absolutePath}`, runId: input.runId, nodeId, artifactRef });
        }
      }

      const hasStoredAt = state.edges.some((edge) =>
        edge.type === "STORED_AT" && edge.from === graphDecision.id && edge.to === artifactNode?.id
      );
      if (!hasStoredAt && artifactNode) {
        issues.push({ kind: "missing-stored-at", message: `STORED_AT edge missing for artifact ${artifactRef}`, runId: input.runId, nodeId, artifactRef });
      }
    }

    const attempted = decision.attempted === true;
    const applied = decision.applied === true;
    if (attempted && !applied) {
      const riskNode = state.nodes.find((node) =>
        node.type === "Risk" && node.properties.runId === input.runId && node.properties.nodeId === nodeId && node.properties.kind === "headroom-compaction-not-applied"
      );
      if (!riskNode) {
        issues.push({ kind: "missing-risk", message: `Risk node missing for attempted-but-not-applied compaction on node ${nodeId}`, runId: input.runId, nodeId });
      }
    }

    const qualityScore = typeof decision.qualityScore === "number" ? decision.qualityScore : undefined;
    const threshold = input.qualityThreshold ?? 0.75;
    if (qualityScore != null && qualityScore < threshold) {
      const riskNode = state.nodes.find((node) =>
        node.type === "Risk" && node.properties.runId === input.runId && node.properties.nodeId === nodeId
      );
      if (!riskNode) {
        issues.push({ kind: "missing-quality-risk", message: `quality score ${qualityScore.toFixed(2)} below threshold but no Risk node`, runId: input.runId, nodeId });
      }
    }
  }

  return { pass: issues.length === 0, issues };
}
