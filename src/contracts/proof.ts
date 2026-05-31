import type { OMK_PROOF_BUNDLE_SCHEMA_VERSION, OMK_RUNTIME_VERSION } from "../version.js";

export type ProofBundleScenario =
  | "no-kimi-smoke"
  | "evidence-block"
  | "fallback-route"
  | "dag-dependent-block"
  | "replay-inspect"
  | "graph-audit"
  | "example-generation"
  | "doctor-provider"
  | "native-safety"
  | "contract-version-smoke";

export type ProofBundleVerdict = "passed" | "failed" | "partial";

export type ProofBundleFiles = {
  rawPrompt: string;
  commands: string;
  stdout?: string;
  stderr?: string;
  verifyJson: string;
  decisionsJsonl: string;
  runManifest: string;
  evidenceJsonl: string;
  diffPatch?: string;
  replay?: string;
  inspectJson?: string;
  limitations: string;
};

export type ProofBundle = {
  schemaVersion: typeof OMK_PROOF_BUNDLE_SCHEMA_VERSION;
  proofId: string;
  title: string;
  omkVersion: string;
  runtimeVersion: typeof OMK_RUNTIME_VERSION;
  commit: string;
  runId: string;
  providerPolicy: string;
  scenario: ProofBundleScenario;
  files: ProofBundleFiles;
  verdict: ProofBundleVerdict;
  knownLimitations: string[];
  checksums: Record<string, string>;
};
