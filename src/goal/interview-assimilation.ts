// Module: src/goal/interview-assimilation.ts
// Owner: Deep Interview phase 2 (answer assimilation + conflict resolution + spec-delta apply)
//
// Deterministic, offline, NO LLM, NO network. Pure logic over the interview /
// goal contracts. The only side-effecting call is `new Date().toISOString()`
// inside `applyInterviewDelta` (the contract's single allowed timestamp site).
//
// Conflict resolver priority (highest wins):
//   1. explicit answer            (a non-skipped, non-empty interview answer)
//   2. existing explicit value    (e.g. SuccessCriterion.inferred === false,
//                                   or a non-empty objective NOT derived from
//                                   the inferred IntentFrame)
//   3. inferred field             (values produced by intent inference)
//   4. heuristic default          (scaffolding defaults)
//
// `add` ops always append and therefore never contradict. `replace` ops on
// `objective` / `riskLevel` are the only ones that can collide: when the goal
// already holds an explicit value and the new answer differs materially, we
// record a human-readable contradiction (and lower confidence to 0.5) instead
// of silently overwriting. The downstream `applyInterviewDelta` re-checks the
// goal state so it stays self-consistent even with externally-built deltas.

import type {
  CriterionRequirement,
  ExpectedArtifact,
  GoalConstraint,
  GoalRisk,
  GoalSpec,
  RiskLevel,
  SuccessCriterion,
} from "../contracts/goal.js";
import type {
  InterviewAnswer,
  InterviewApplyResult,
  InterviewDeltaField,
  InterviewFinding,
  InterviewQuestion,
  InterviewSeed,
  InterviewSpecChange,
  InterviewSpecDelta,
} from "../contracts/interview.js";
import { INTERVIEW_DELTA_SCHEMA_VERSION } from "../contracts/interview.js";

const EXPLICIT_CONFIDENCE = 0.9;
const CONFLICTED_CONFIDENCE = 0.5;

const HIGH_RISK_RE = /production|prod\b|migrat|database|deploy|보안|배포|권한|마이그/i;
const LOW_RISK_RE = /docs only|문서만|read[- ]?only|읽기 전용/i;
const COMMAND_RE =
  /\b(test|tests|spec|specs|command|cmd|run|build|lint|typecheck|pytest|jest|vitest|npm|yarn|pnpm|make|check|ci)\b/i;
const PATH_RE = /[\w./-]+\.[a-zA-Z0-9]+/;

// ---------------------------------------------------------------------------
// assimilateAnswers
// ---------------------------------------------------------------------------

export function assimilateAnswers(input: {
  seed: InterviewSeed;
  questions: InterviewQuestion[];
  answers: InterviewAnswer[];
  goal?: GoalSpec;
}): { findings: InterviewFinding[]; specDelta: InterviewSpecDelta; contradictions: string[] } {
  const { questions, answers, goal } = input;
  const questionById = new Map<string, InterviewQuestion>(questions.map((q) => [q.id, q]));

  const findings: InterviewFinding[] = [];
  const changes: InterviewSpecChange[] = [];
  const contradictions: string[] = [];

  const record = (
    question: InterviewQuestion,
    field: InterviewDeltaField,
    op: InterviewSpecChange["op"],
    value: unknown,
    confidence: number,
    conflict: boolean,
  ): void => {
    changes.push({ field, op, value, sourceQuestionId: question.id, confidence });
    findings.push({ field: question.targetField, value, sourceQuestionId: question.id, confidence, conflict });
  };

  for (const answer of answers) {
    if (answer.skipped) continue;
    const text = answer.answer.trim();
    if (text.length === 0) continue;

    const question = questionById.get(answer.questionId);
    if (!question) continue;

    switch (question.targetField) {
      case "objective": {
        let confidence = EXPLICIT_CONFIDENCE;
        let conflict = false;
        if (isObjectiveExplicit(goal) && differsMaterially(goal?.objective ?? "", text)) {
          conflict = true;
          confidence = CONFLICTED_CONFIDENCE;
          contradictions.push(
            `objective: answer ${question.id} conflicts with existing explicit objective ` +
              `("${truncate(goal?.objective ?? "")}" vs "${truncate(text)}")`,
          );
        }
        record(question, "objective", "replace", text, confidence, conflict);
        break;
      }

      case "successCriteria": {
        for (const item of splitIntoItems(text, 3)) {
          record(question, "successCriteria", "add", item, EXPLICIT_CONFIDENCE, false);
        }
        break;
      }

      case "expectedArtifacts": {
        const path = extractPath(text);
        const gate: ExpectedArtifact["gate"] = COMMAND_RE.test(text) ? "command-pass" : "file-exists";
        const name = path ? basename(path) : truncate(firstNonEmptyLine(text), 80);
        const value: { name: string; path?: string; gate: ExpectedArtifact["gate"] } =
          path !== undefined ? { name, path, gate } : { name, gate };
        record(question, "expectedArtifacts", "add", value, EXPLICIT_CONFIDENCE, false);
        break;
      }

      case "constraints": {
        record(question, "constraints", "add", text, EXPLICIT_CONFIDENCE, false);
        break;
      }

      case "nonGoals": {
        record(question, "nonGoals", "add", text, EXPLICIT_CONFIDENCE, false);
        break;
      }

      case "risks": {
        const level = computeRiskLevel(text);
        record(question, "risks", "add", { description: text, level }, EXPLICIT_CONFIDENCE, false);
        // Escalate the goal-level riskLevel when a risk answer is high.
        // Never downgrade here (applyInterviewDelta enforces escalate-only).
        if (level === "high") {
          record(question, "riskLevel", "replace", "high", EXPLICIT_CONFIDENCE, false);
        }
        break;
      }

      case "riskLevel": {
        const newLevel = computeRiskLevel(text);
        let confidence = EXPLICIT_CONFIDENCE;
        let conflict = false;
        if (goal && goal.riskLevel === "high" && riskRank(newLevel) < riskRank("high")) {
          conflict = true;
          confidence = CONFLICTED_CONFIDENCE;
          contradictions.push(
            `riskLevel: answer ${question.id} would downgrade explicit "high" risk to "${newLevel}"`,
          );
        }
        record(question, "riskLevel", "replace", newLevel, confidence, conflict);
        break;
      }

      // intentFrame / actionAtoms are not assimilated by this module.
      default:
        break;
    }
  }

  const specDelta: InterviewSpecDelta = {
    schemaVersion: INTERVIEW_DELTA_SCHEMA_VERSION,
    goalId: goal?.goalId,
    changes,
  };

  return { findings, specDelta, contradictions };
}

// ---------------------------------------------------------------------------
// applyInterviewDelta
// ---------------------------------------------------------------------------

export function applyInterviewDelta(goal: GoalSpec, delta: InterviewSpecDelta): InterviewApplyResult {
  // Clone: new top-level object + fresh copies of every collection we mutate so
  // the caller's GoalSpec is never touched. Existing nested entries are reused
  // by reference but never mutated (we only push new entries / reassign scalars).
  const next: GoalSpec = {
    ...goal,
    successCriteria: [...goal.successCriteria],
    constraints: [...goal.constraints],
    nonGoals: [...goal.nonGoals],
    risks: [...goal.risks],
    expectedArtifacts: [...goal.expectedArtifacts],
    runIds: [...goal.runIds],
  };

  const appliedChanges: InterviewSpecChange[] = [];
  const skippedChanges: InterviewSpecChange[] = [];
  const contradictions: string[] = [];

  for (const change of delta.changes) {
    if (change.op === "add") {
      switch (change.field) {
        case "successCriteria": {
          const description = asString(change.value);
          if (!description) {
            skippedChanges.push(change);
            break;
          }
          const requirement: CriterionRequirement = next.successCriteria.length === 0 ? "required" : "optional";
          const criterion: SuccessCriterion = {
            id: `criterion-${next.successCriteria.length + 1}`,
            description,
            requirement,
            weight: requirement === "required" ? 1.0 : 0.5,
            inferred: false,
          };
          next.successCriteria.push(criterion);
          appliedChanges.push(change);
          break;
        }

        case "expectedArtifacts": {
          const artifact = asArtifactValue(change.value);
          if (!artifact) {
            skippedChanges.push(change);
            break;
          }
          const entry: ExpectedArtifact = { name: artifact.name };
          if (artifact.path !== undefined) entry.path = artifact.path;
          if (artifact.gate !== undefined) entry.gate = artifact.gate;
          next.expectedArtifacts.push(entry);
          appliedChanges.push(change);
          break;
        }

        case "constraints": {
          const description = asString(change.value);
          if (!description) {
            skippedChanges.push(change);
            break;
          }
          const constraint: GoalConstraint = { id: `constraint-${next.constraints.length + 1}`, description };
          next.constraints.push(constraint);
          appliedChanges.push(change);
          break;
        }

        case "nonGoals": {
          const value = asString(change.value);
          if (!value) {
            skippedChanges.push(change);
            break;
          }
          next.nonGoals.push(value);
          appliedChanges.push(change);
          break;
        }

        case "risks": {
          const risk = asRiskValue(change.value);
          if (!risk) {
            skippedChanges.push(change);
            break;
          }
          const entry: GoalRisk = { id: `risk-${next.risks.length + 1}`, description: risk.description, level: risk.level };
          next.risks.push(entry);
          appliedChanges.push(change);
          break;
        }

        default:
          skippedChanges.push(change);
          break;
      }
      continue;
    }

    if (change.op === "replace") {
      switch (change.field) {
        case "riskLevel": {
          const newLevel = asRiskLevel(change.value);
          if (newLevel === null || change.confidence < CONFLICTED_CONFIDENCE) {
            skippedChanges.push(change);
            break;
          }
          const current = next.riskLevel;
          const downgradeFromHigh = current === "high" && riskRank(newLevel) < riskRank(current);
          if (downgradeFromHigh) {
            contradictions.push(
              `riskLevel: skipped downgrade of explicit "high" risk to "${newLevel}" (from ${change.sourceQuestionId})`,
            );
            skippedChanges.push(change);
          } else if (newLevel !== current) {
            // higher-or-different
            next.riskLevel = newLevel;
            appliedChanges.push(change);
          } else {
            skippedChanges.push(change);
          }
          break;
        }

        case "objective": {
          const newObjective = asString(change.value);
          if (!newObjective) {
            skippedChanges.push(change);
            break;
          }
          if (
            isObjectiveExplicit(next) &&
            change.confidence < EXPLICIT_CONFIDENCE &&
            differsMaterially(next.objective, newObjective)
          ) {
            contradictions.push(
              `objective: skipped overwrite of explicit objective with low-confidence answer (from ${change.sourceQuestionId})`,
            );
            skippedChanges.push(change);
          } else {
            next.objective = newObjective;
            appliedChanges.push(change);
          }
          break;
        }

        default:
          skippedChanges.push(change);
          break;
      }
      continue;
    }

    // "remove" and any unknown op are not supported by this module.
    skippedChanges.push(change);
  }

  // The single allowed timestamp site for this module.
  next.updatedAt = new Date().toISOString();

  return { goal: next, appliedChanges, skippedChanges, contradictions };
}

// ---------------------------------------------------------------------------
// Internal helpers (pure)
// ---------------------------------------------------------------------------

/**
 * A goal's objective is "explicit" when it is non-empty and was not merely
 * lifted from the inferred IntentFrame (problem / desiredOutcome). Without a
 * dedicated flag on GoalSpec.objective this is the most reliable deterministic
 * signal that the value came from a user/prompt source rather than inference.
 */
function isObjectiveExplicit(goal: GoalSpec | undefined): boolean {
  if (!goal) return false;
  const objective = goal.objective?.trim() ?? "";
  if (objective.length === 0) return false;
  const frame = goal.intentFrame;
  if (frame) {
    const desired = frame.desiredOutcome?.trim() ?? "";
    const problem = frame.problem?.trim() ?? "";
    if (objective === desired || objective === problem) return false;
  }
  return true;
}

function computeRiskLevel(text: string): RiskLevel {
  if (HIGH_RISK_RE.test(text)) return "high";
  if (LOW_RISK_RE.test(text)) return "low";
  return "medium";
}

function riskRank(level: RiskLevel): number {
  return level === "high" ? 2 : level === "medium" ? 1 : 0;
}

function differsMaterially(a: string, b: string): boolean {
  return normalize(a) !== normalize(b);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Split answer text into list items on newlines or inline numbered markers. */
function splitIntoItems(text: string, max: number): string[] {
  const byLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let parts: string[];
  if (byLine.length > 1) {
    parts = byLine;
  } else {
    const single = byLine[0] ?? text.trim();
    const inline = single
      .split(/(?=\b\d+[.)]\s)/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    parts = inline.length > 1 ? inline : [single];
  }

  return parts
    .map(stripListMarker)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, max);
}

function stripListMarker(value: string): string {
  return value.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "").trim();
}

function extractPath(text: string): string | undefined {
  const match = text.match(PATH_RE);
  return match ? match[0] : undefined;
}

function basename(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] || path;
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return text.trim();
}

function truncate(value: string, max = 60): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRiskLevel(value: unknown): RiskLevel | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function asArtifactValue(
  value: unknown,
): { name: string; path?: string; gate?: ExpectedArtifact["gate"] } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (name.length === 0) return null;
  const path = typeof record.path === "string" && record.path.length > 0 ? record.path : undefined;
  const gate =
    record.gate === "file-exists" || record.gate === "command-pass" || record.gate === "summary"
      ? record.gate
      : undefined;
  return { name, path, gate };
}

function asRiskValue(value: unknown): { description: string; level: RiskLevel } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const level = asRiskLevel(record.level);
  if (description.length === 0 || level === null) return null;
  return { description, level };
}
