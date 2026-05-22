// Contract: src/contracts/goal.ts
// Owner: Contract Worker (Phase 0)
// Read-only for all other workers. Version-bump only via Integration Worker.

export type GoalStatus =
  | "draft"
  | "planned"
  | "running"
  | "blocked"
  | "verifying"
  | "done"
  | "failed"
  | "cancelled"
  | "closed";

export type RiskLevel = "low" | "medium" | "high";
export type CriterionRequirement = "required" | "optional";
export type EvidenceType = "criterion" | "artifact" | "constraint";

export interface SuccessCriterion {
  id: string;
  description: string;
  requirement: CriterionRequirement;
  weight: number;
  inferred: boolean;
}

export interface GoalConstraint {
  id: string;
  description: string;
}

export interface GoalRisk {
  id: string;
  description: string;
  level: RiskLevel;
}

export interface ExpectedArtifact {
  name: string;
  path?: string;
  gate?: "file-exists" | "command-pass" | "summary";
}

export type ActionAtomVerb =
  | "bootstrap"
  | "inspect"
  | "plan"
  | "modify"
  | "verify"
  | "integrate"
  | "document"
  | "research"
  | "review"
  | "test"
  | "coordinate"
  | "route";

export interface ActionAtom {
  id: string;
  label: string;
  verb: ActionAtomVerb;
  object: string;
  evidenceTarget: string;
  doneCondition: string;
  roleHint?: string;
  source: "heuristic" | "criterion" | "artifact" | "runtime" | "directive";
}

export type IntentDirectiveKind =
  | "read-only"
  | "no-edits"
  | "scope"
  | "expected-output"
  | "constraint";

export interface IntentDirective {
  kind: IntentDirectiveKind;
  value: string;
  source: "explicit" | "heuristic";
}

export interface IntentCapabilityHints {
  skills: string[];
  mcpServers: string[];
  tools: string[];
  hooks: string[];
  readOnly: boolean;
  needsMcp: boolean;
  needsSkills: boolean;
  needsHooks: boolean;
  ensembleVoters: string[];
}

export interface IntentConfidence {
  overall: number;
  primaryAction: number;
  directives: number;
  notes: string[];
}

export interface IntentDiagnostic {
  kind: "redaction" | "directive" | "normalization" | "low-confidence" | "rewrite";
  message: string;
  count?: number;
}

export interface IntentRewrite {
  summary: string;
  accepted: boolean;
  reason: string;
}

export interface IntentFrame {
  schemaVersion: 2;
  rawPromptDigest: string;
  problem: string;
  desiredOutcome: string;
  constraints: string[];
  entities: string[];
  successCriteria: string[];
  actionAtoms: ActionAtom[];
  strict: true;
  directives: IntentDirective[];
  confidence: IntentConfidence;
  capabilityHints: IntentCapabilityHints;
  diagnostics: IntentDiagnostic[];
  rewrite?: IntentRewrite;
}

export interface PromptNoveltyReport {
  schemaVersion: 2;
  action: "continue" | "replan" | "block" | "handoff" | "close";
  recommendation: "continue" | "replan" | "block" | "handoff" | "close";
  reason: string;
  similarityToOriginal: number;
  similarityToPrevious: number;
  repeatedNodeNames: string[];
  hasNewEvidence: boolean;
  evidenceDelta: number;
  progressDelta: number;
  replayRisk: boolean;
  oscillation: boolean;
  targetAtomId?: string;
}

export interface NextActionContract {
  action: "continue" | "replan" | "block" | "handoff" | "close";
  targetId: string;
  description: string;
  evidenceTarget: string;
  doneCondition: string;
  actionAtom?: ActionAtom;
}

export interface GoalSpec {
  schemaVersion: 1;
  goalId: string;
  title: string;
  rawPrompt: string;
  objective: string;
  successCriteria: SuccessCriterion[];
  constraints: GoalConstraint[];
  nonGoals: string[];
  risks: GoalRisk[];
  expectedArtifacts: ExpectedArtifact[];
  status: GoalStatus;
  riskLevel: RiskLevel;
  planRevision: number;
  createdAt: string;
  updatedAt: string;
  runIds: string[];
  intentFrame?: IntentFrame;
  actionAtoms?: ActionAtom[];
}

export interface GoalEvidence {
  criterionId: string;
  passed: boolean;
  message?: string;
  ref?: string;
  checkedAt: string;
  evidenceType?: EvidenceType;
}

export interface ArtifactEvidence {
  artifactName: string;
  passed: boolean;
  message: string;
  filePath?: string;
  commandOutput?: string;
  url?: string;
  checkedAt: string;
}

export interface MissingCriterion {
  criterionId: string;
  description: string;
  requirement: CriterionRequirement;
  priority: number;
}

export interface NextActionSuggestion {
  type: "criterion" | "artifact" | "constraint" | "close";
  targetId: string;
  description: string;
  reason: string;
}

export interface GoalScore {
  requiredTotal: number;
  requiredPassed: number;
  optionalScore: number;
  qualityGatePassed: boolean;
  overall: "pass" | "fail" | "incomplete";
}

export interface GoalHistoryEntry {
  at: string;
  action: string;
  detail?: Record<string, unknown>;
}
