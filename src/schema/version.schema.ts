import { z } from "zod";
import { OMK_RUNTIME_VERSION, OMK_VERSION_SCHEMA_VERSION } from "../version.js";

export const VersionReportSchema = z.object({
  schemaVersion: z.literal(OMK_VERSION_SCHEMA_VERSION),
  packageName: z.string().min(1),
  packageVersion: z.string().min(1),
  runtimeVersion: z.literal(OMK_RUNTIME_VERSION),
  schemaVersions: z.array(z.string().min(1)),
  gitCommit: z.string().optional(),
  gitBranch: z.string().optional(),
  npmPublishedVersion: z.string().optional(),
  sourceTarget: z.string().optional(),
  releaseCandidate: z.string().optional(),
  dirty: z.boolean(),
  consistent: z.boolean(),
  mismatches: z.array(z.object({
    file: z.string().min(1),
    expected: z.string(),
    actual: z.string(),
  })),
});
