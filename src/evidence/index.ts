export type {
  AttemptStatus,
  RuntimeId,
  EvidenceResult,
  AttemptRecord,
  DiagnosisResult,
  RetryStrategy,
  ContextAdjustment,
} from "./attempt-record.js";

export { createAttemptId, hashContent } from "./attempt-record.js";

export type { EvidenceRecorderOptions, EvidenceRecorder } from "./evidence-recorder.js";

export { createEvidenceRecorder } from "./evidence-recorder.js";

export type {
  ContextSnapshotMeta,
  ContextSnapshotStore,
} from "./context-snapshot.js";

export { createContextSnapshotStore } from "./context-snapshot.js";

export type { DiagnosisEngine } from "./diagnosis.js";

export { createDiagnosisEngine } from "./diagnosis.js";

export type {
  NodeTraceSummary,
  RunTrace,
  RunTraceStore,
  RunMeta,
  NodeReport,
  RunReport,
} from "./run-trace.js";

export { createRunTraceStore } from "./run-trace.js";

export type { RepairAction, RepairDecision } from "./attempt-record.js";

export { decideRepair } from "../orchestration/repair-policy.js";
export type { RepairContext } from "../orchestration/repair-policy.js";

export type { DecisionTraceStore } from "./decision-trace.js";
export { createDecisionTraceStore } from "./decision-trace.js";

export type { ProofTrustMvpEngine, ProofTrustResult } from "./proof-trust.js";
export { createProofTrustMvpEngine } from "./proof-trust.js";

export type {
  EtsClaim,
  EtsClaimCategory,
  EtsTaskType,
  EtsRiskTier,
  RequiredEvidenceItem,
  RunArtifactMeta,
  CollectedEvidence,
  EvidenceVerificationResult,
  EtsV2Result,
  EtsV2Engine,
  EtsV2Params,
  EtsV2EngineOptions,
} from "./evidence-trust-score.js";

export {
  extractClaims,
  requiredEvidenceForClaim,
  collectEvidenceFromRunDir,
  verifyEvidence,
  createEvidenceTrustScoreV2Engine,
  createEvidenceTrustScore,
} from "./evidence-trust-score.js";

export type {
  AlgorithmSpec,
  ReleaseCandidate,
  RegressionProofMatrixResult,
  RegressionProofMatrixEngine,
  RegressionProofMatrixOptions,
} from "./regression-proof-matrix.js";
export { createRegressionProofMatrixEngine } from "./regression-proof-matrix.js";
