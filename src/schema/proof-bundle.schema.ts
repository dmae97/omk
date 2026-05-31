import { z } from "zod";
import { OMK_PROOF_BUNDLE_SCHEMA_VERSION, OMK_RUNTIME_VERSION } from "../version.js";

export const ProofBundleScenarioSchema = z.enum([
  "no-kimi-smoke",
  "evidence-block",
  "fallback-route",
  "dag-dependent-block",
  "replay-inspect",
  "example-generation",
  "doctor-provider",
  "native-safety",
  "contract-version-smoke",
]);

export const ProofBundleFilesSchema = z.object({
  rawPrompt: z.string().min(1),
  commands: z.string().min(1),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  verifyJson: z.string().min(1),
  decisionsJsonl: z.string().min(1),
  runManifest: z.string().min(1),
  evidenceJsonl: z.string().min(1),
  diffPatch: z.string().optional(),
  replay: z.string().optional(),
  inspectJson: z.string().optional(),
  limitations: z.string().min(1),
});

export const ProofBundleSchema = z.object({
  schemaVersion: z.literal(OMK_PROOF_BUNDLE_SCHEMA_VERSION),
  proofId: z.string().min(1),
  title: z.string().min(1),
  omkVersion: z.string().min(1),
  runtimeVersion: z.literal(OMK_RUNTIME_VERSION),
  commit: z.string().min(1),
  runId: z.string().min(1),
  providerPolicy: z.string().min(1),
  scenario: ProofBundleScenarioSchema,
  files: ProofBundleFilesSchema,
  verdict: z.enum(["passed", "failed", "partial"]),
  knownLimitations: z.array(z.string().min(1)),
  checksums: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
});
