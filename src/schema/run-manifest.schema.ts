import { z } from "zod";
import { OMK_RUN_MANIFEST_SCHEMA_VERSION } from "../version.js";
import { ProviderPolicySchema } from "./provider.schema.js";

const RunStatusSchema = z.enum(["running", "passed", "failed", "blocked", "partial"]);

export const RunNodeSummarySchema = z.object({
  nodeId: z.string().min(1),
  label: z.string().optional(),
  status: RunStatusSchema,
  provider: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export const RunArtifactRefSchema = z.object({
  kind: z.string().min(1),
  path: z.string().min(1),
  sha256: z.string().optional(),
});

export const RunManifestSchema = z.object({
  schemaVersion: z.literal(OMK_RUN_MANIFEST_SCHEMA_VERSION),
  runId: z.string().min(1),
  createdAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
  status: RunStatusSchema,
  promptHash: z.string().optional(),
  providerPolicy: ProviderPolicySchema,
  nodes: z.array(RunNodeSummarySchema),
  artifacts: z.array(RunArtifactRefSchema),
  evidenceSummary: z.object({
    required: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
  }),
  decisionTracePath: z.string().optional(),
});
