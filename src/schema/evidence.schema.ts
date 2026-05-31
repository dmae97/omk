import { z } from "zod";
import { OMK_EVIDENCE_SCHEMA_VERSION } from "../version.js";

export const EvidenceStatusSchema = z.enum(["passed", "failed", "missing", "skipped", "blocked"]);

export const EvidenceRecordSchema = z.object({
  schemaVersion: z.literal(OMK_EVIDENCE_SCHEMA_VERSION),
  runId: z.string().min(1),
  nodeId: z.string().min(1).optional(),
  evidenceId: z.string().min(1),
  kind: z.enum([
    "file-exists",
    "command-passes",
    "git-diff-non-empty",
    "summary-present",
    "marker-present",
    "screenshot-present",
    "custom",
  ]),
  status: EvidenceStatusSchema,
  required: z.boolean(),
  path: z.string().optional(),
  command: z.string().optional(),
  exitCode: z.number().int().optional(),
  observedAt: z.string().min(1),
  message: z.string().optional(),
});

export const EvidenceRefSchema = z.object({
  schemaVersion: z.literal(OMK_EVIDENCE_SCHEMA_VERSION).optional(),
  evidenceId: z.string().min(1),
  runId: z.string().min(1).optional(),
  path: z.string().optional(),
});
