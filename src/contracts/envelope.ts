import type { OMK_CONTRACT_VERSION, OMK_RUNTIME_VERSION } from "../version.js";
import type { DecisionRef } from "./decision.js";
import type { OmkError, OmkWarning } from "./errors.js";
import type { EvidenceRef } from "./evidence.js";

export type OmkCommandStatus =
  | "passed"
  | "failed"
  | "blocked"
  | "skipped"
  | "partial"
  | "dry-run"
  | "not-applicable";

export type OmkJsonEnvelope<TData = unknown> = {
  ok: boolean;
  schemaVersion: typeof OMK_CONTRACT_VERSION;
  command: string;
  omkVersion: string;
  runtimeVersion: typeof OMK_RUNTIME_VERSION;
  commit?: string;
  runId?: string;
  traceId: string;
  status: OmkCommandStatus;
  data: TData;
  warnings: OmkWarning[];
  errors: OmkError[];
  evidenceRefs?: EvidenceRef[];
  decisionRefs?: DecisionRef[];
  metadata: {
    cwd: string;
    platform: NodeJS.Platform;
    nodeVersion: string;
    provider?: string;
    durationMs: number;
    timestamp: string;
  };
};
