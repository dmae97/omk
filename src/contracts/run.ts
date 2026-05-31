import type { OMK_RUN_MANIFEST_SCHEMA_VERSION } from "../version.js";
import type { ProviderPolicy } from "./provider.js";

export type RunStatus = "running" | "passed" | "failed" | "blocked" | "partial";

export type RunNodeSummary = {
  nodeId: string;
  label?: string;
  status: RunStatus;
  provider?: string;
  startedAt?: string;
  completedAt?: string;
};

export type RunArtifactRef = {
  kind: string;
  path: string;
  sha256?: string;
};

export type RunManifest = {
  schemaVersion: typeof OMK_RUN_MANIFEST_SCHEMA_VERSION;
  runId: string;
  createdAt: string;
  completedAt?: string;
  status: RunStatus;
  promptHash?: string;
  providerPolicy: ProviderPolicy;
  nodes: RunNodeSummary[];
  artifacts: RunArtifactRef[];
  evidenceSummary: {
    required: number;
    passed: number;
    failed: number;
    missing: number;
  };
  decisionTracePath?: string;
};
