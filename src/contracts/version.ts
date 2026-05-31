import type {
  OMK_RUNTIME_VERSION,
  OMK_VERSION_SCHEMA_VERSION,
} from "../version.js";

export type VersionMismatch = {
  file: string;
  expected: string;
  actual: string;
};

export type VersionReport = {
  schemaVersion: typeof OMK_VERSION_SCHEMA_VERSION;
  packageName: string;
  packageVersion: string;
  runtimeVersion: typeof OMK_RUNTIME_VERSION;
  schemaVersions: string[];
  gitCommit?: string;
  gitBranch?: string;
  npmPublishedVersion?: string;
  sourceTarget?: string;
  releaseCandidate?: string;
  dirty: boolean;
  consistent: boolean;
  mismatches: VersionMismatch[];
};
