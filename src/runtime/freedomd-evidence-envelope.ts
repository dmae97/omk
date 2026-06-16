/**
 * Local-first evidence envelope for Freedomd.
 *
 * Provider responses and evidence observations are persisted outside the
 * provider runtime so that runs remain replayable and auditable even when a
 * provider becomes unavailable or changes policy.
 */

import { mkdir, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import type { AgentRuntime, AgentRunResult, AgentTask, AgentTaskSovereignty } from "./agent-runtime.js";
import type { EvidenceObservation, EvidenceRequirement } from "./contracts/evidence.js";
import type { LocalGraphMemoryStore } from "../memory/local-graph-memory-store.js";
import { sha256Hex } from "../util/hash.js";

export interface EvidenceEnvelopeArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly redacted: boolean;
  readonly replayable: boolean;
}

export interface EvidenceEnvelopeObservation {
  readonly kind: string;
  readonly verdict: "pass" | "fail" | "partial" | "pending";
  readonly artifactRef?: string;
  readonly sha256?: string;
  readonly replayable: boolean;
  readonly redacted: boolean;
  readonly confidence: number;
  readonly timestamp: string;
}

export interface FreedomdEvidenceEnvelope {
  schemaVersion: "omk.freedomd.evidence-envelope.v1";
  runId: string;
  nodeId: string;
  taskHash: string;
  selectedRuntime: string;
  providerId: string;
  runtimeMode: string;
  sovereignty: AgentTaskSovereignty;
  evidenceRequirements: readonly EvidenceRequirement[];
  evidenceObservations: readonly EvidenceEnvelopeObservation[];
  providerResponseRef?: string;
  localArtifacts: readonly EvidenceEnvelopeArtifact[];
  createdAt: string;
}

export interface BuildEvidenceEnvelopeOptions {
  readonly task: AgentTask;
  readonly selectedRuntime: AgentRuntime;
  readonly runContext: {
    readonly runId: string;
    readonly nodeId: string;
    readonly projectRoot?: string;
  };
  readonly evidenceObservations?: readonly EvidenceObservation[];
  readonly providerResponse?: AgentRunResult;
  readonly sovereignty: AgentTaskSovereignty;
}

function envelopeDir(root: string, runId: string): string {
  return join(resolve(root), ".omk", "runs", runId, "freedomd");
}

function artifactPath(root: string, runId: string, nodeId: string, kind: string): string {
  const safeNodeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(envelopeDir(root, runId), `${safeNodeId}-${kind}.json`);
}

export function hashTaskPrompt(prompt: string): string {
  return sha256Hex(prompt);
}

async function persistArtifact(
  root: string,
  runId: string,
  nodeId: string,
  kind: string,
  payload: unknown,
): Promise<EvidenceEnvelopeArtifact> {
  const path = artifactPath(root, runId, nodeId, kind);
  await mkdir(dirname(path), { recursive: true });
  const text = JSON.stringify(payload, null, 2);
  await writeFile(path, text, "utf-8");
  return {
    path,
    sha256: sha256Hex(text),
    sizeBytes: Buffer.byteLength(text, "utf-8"),
    redacted: false,
    replayable: true,
  };
}

export async function buildLocalFirstEvidenceEnvelope(
  options: BuildEvidenceEnvelopeOptions,
): Promise<FreedomdEvidenceEnvelope> {
  const { task, selectedRuntime, runContext, evidenceObservations, providerResponse, sovereignty } = options;
  const root = runContext.projectRoot ?? process.cwd();
  const now = new Date().toISOString();

  const localArtifacts: EvidenceEnvelopeArtifact[] = [];
  const evidenceObservationList: EvidenceEnvelopeObservation[] = [];

  for (const observation of evidenceObservations ?? []) {
    const artifact = await persistArtifact(root, runContext.runId, runContext.nodeId, `observation-${observation.kind}`, observation);
    localArtifacts.push(artifact);
    evidenceObservationList.push({
      kind: observation.kind,
      verdict: observation.confidence >= 0.8 ? "pass" : observation.confidence >= 0.4 ? "partial" : "fail",
      artifactRef: artifact.path,
      sha256: artifact.sha256,
      replayable: observation.replayable,
      redacted: observation.redacted,
      confidence: observation.confidence,
      timestamp: observation.timestamp,
    });
  }

  if (providerResponse) {
    const safeResponse = {
      success: providerResponse.success,
      exitCode: providerResponse.exitCode,
      stdout: providerResponse.stdout,
      stderr: providerResponse.stderr,
      tokenUsage: providerResponse.tokenUsage,
      metadata: providerResponse.metadata,
    };
    const artifact = await persistArtifact(root, runContext.runId, runContext.nodeId, "provider-response", safeResponse);
    localArtifacts.push(artifact);

    const envelope: FreedomdEvidenceEnvelope = {
      schemaVersion: "omk.freedomd.evidence-envelope.v1",
      runId: runContext.runId,
      nodeId: runContext.nodeId,
      taskHash: hashTaskPrompt(task.prompt),
      selectedRuntime: selectedRuntime.id,
      providerId: selectedRuntime.providerId ?? selectedRuntime.id.split("-")[0] ?? selectedRuntime.id,
      runtimeMode: selectedRuntime.runtimeMode,
      sovereignty,
      evidenceRequirements: [],
      evidenceObservations: evidenceObservationList,
      providerResponseRef: artifact.path,
      localArtifacts,
      createdAt: now,
    };
    const envelopeArtifact = await persistArtifact(root, runContext.runId, runContext.nodeId, "evidence-envelope", envelope);
    return {
      ...envelope,
      localArtifacts: [...localArtifacts, envelopeArtifact],
    };
  }

  const envelope: FreedomdEvidenceEnvelope = {
    schemaVersion: "omk.freedomd.evidence-envelope.v1",
    runId: runContext.runId,
    nodeId: runContext.nodeId,
    taskHash: hashTaskPrompt(task.prompt),
    selectedRuntime: selectedRuntime.id,
    providerId: selectedRuntime.providerId ?? selectedRuntime.id.split("-")[0] ?? selectedRuntime.id,
    runtimeMode: selectedRuntime.runtimeMode,
    sovereignty,
    evidenceRequirements: [],
    evidenceObservations: evidenceObservationList,
    localArtifacts,
    createdAt: now,
  };
  const envelopeArtifact = await persistArtifact(root, runContext.runId, runContext.nodeId, "evidence-envelope", envelope);
  return {
    ...envelope,
    localArtifacts: [...localArtifacts, envelopeArtifact],
  };
}

export async function materializeEvidenceEnvelopeInGraph(
  store: LocalGraphMemoryStore,
  envelope: FreedomdEvidenceEnvelope,
): Promise<void> {
  const runId = envelope.runId;
  const nodeId = envelope.nodeId;
  await store.write(
    join(".omk", "runs", runId, "freedomd", `${nodeId}-evidence-envelope.json`),
    JSON.stringify(envelope, null, 2),
  );
}
