import type { OMK_EVIDENCE_SCHEMA_VERSION } from "../version.js";

export type EvidenceStatus = "passed" | "failed" | "missing" | "skipped" | "blocked";

export type EvidenceKind =
  | "file-exists"
  | "command-passes"
  | "git-diff-non-empty"
  | "summary-present"
  | "marker-present"
  | "screenshot-present"
  | "custom";

export type EvidenceRecord = {
  schemaVersion: typeof OMK_EVIDENCE_SCHEMA_VERSION;
  runId: string;
  nodeId?: string;
  evidenceId: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
  required: boolean;
  path?: string;
  command?: string;
  exitCode?: number;
  observedAt: string;
  message?: string;
};

export type EvidenceRef = {
  schemaVersion?: typeof OMK_EVIDENCE_SCHEMA_VERSION;
  evidenceId: string;
  runId?: string;
  path?: string;
};
