import { z } from "zod";
import { OMK_CONTRACT_VERSION, OMK_RUNTIME_VERSION } from "../version.js";
import { DecisionRefSchema } from "./decision.schema.js";
import { OmkErrorSchema, OmkWarningSchema } from "./error.schema.js";
import { EvidenceRefSchema } from "./evidence.schema.js";

export const OmkEnvelopeStatusSchema = z.enum([
  "passed",
  "failed",
  "blocked",
  "skipped",
  "partial",
  "dry-run",
  "not-applicable",
]);

export const OmkEnvelopeSchema = z.object({
  ok: z.boolean(),
  schemaVersion: z.literal(OMK_CONTRACT_VERSION),
  command: z.string().min(1),
  omkVersion: z.string().min(1),
  runtimeVersion: z.literal(OMK_RUNTIME_VERSION),
  commit: z.string().optional(),
  runId: z.string().optional(),
  traceId: z.string().min(1),
  status: OmkEnvelopeStatusSchema,
  data: z.unknown(),
  warnings: z.array(OmkWarningSchema),
  errors: z.array(OmkErrorSchema),
  evidenceRefs: z.array(EvidenceRefSchema).optional(),
  decisionRefs: z.array(DecisionRefSchema).optional(),
  metadata: z.object({
    cwd: z.string(),
    platform: z.string(),
    nodeVersion: z.string(),
    provider: z.string().optional(),
    durationMs: z.number().nonnegative(),
    timestamp: z.string().min(1),
  }),
});
