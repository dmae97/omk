// Module: src/goal/interview-question-bank.ts
// Owner: Interview Question Bank Worker (Deep Interview phase)
//
// Deterministic, offline candidate-question bank for the OMK Deep Interview.
// NO LLM calls, NO network, NO Date, NO randomness: the same `InterviewSeed`
// always yields the same candidate set. The caller is responsible for scoring
// (the returned candidates intentionally omit `score`).

import type { GoalSpec } from "../contracts/goal.js";
import type {
  InterviewQuestion,
  InterviewQuestionKind,
  InterviewSeed,
  InterviewTargetField,
} from "../contracts/interview.js";

/** A candidate question before the caller assigns a ranking `score`. */
type InterviewCandidate = Omit<InterviewQuestion, "score">;

/** Static definition of one axis before deterministic signal adjustments. */
interface QuestionSpec {
  id: string;
  kind: InterviewQuestionKind;
  targetField: InterviewTargetField;
  required: boolean;
  prompt: string;
  informationGain: number;
  riskReduction: number;
  dagImpact: number;
  evidenceImpact: number;
  userCost: number;
}

/**
 * Seeds matching this pattern (or a `high` riskLevel) boost the risk/authority/
 * rollback axes so the ranker surfaces safety questions earlier.
 */
const HIGH_RISK_PATTERN = /production|deploy|migrat|database|보안|배포|마이그/i;

/** Axes that defend against execution risk and benefit from high-risk boosts. */
const RISK_AXIS_IDS: ReadonlySet<string> = new Set(["q-risk", "q-authority", "q-rollback"]);

/** Multiplier applied to informationGain when the goal already fills the axis. */
const POPULATED_DOWNRANK = 0.4;

/**
 * The 10 deep-interview axes. Base signals follow the deterministic guidance:
 *  - required-true axes start with informationGain >= 0.8;
 *  - artifact/verification/success-criteria carry evidenceImpact >= 0.7 and
 *    dagImpact >= 0.6;
 *  - scope/non-goal carry moderate dagImpact (~0.5);
 *  - risk/authority/rollback carry riskReduction >= 0.7;
 *  - userCost stays in the ~0.2-0.4 band.
 */
const QUESTION_SPECS: readonly QuestionSpec[] = [
  {
    id: "q-objective",
    kind: "objective",
    targetField: "objective",
    required: true,
    prompt: "이 작업이 최종적으로 무엇이 되면 성공인지 한 문장으로 정의해줘.",
    informationGain: 0.9,
    riskReduction: 0.3,
    dagImpact: 0.7,
    evidenceImpact: 0.5,
    userCost: 0.2,
  },
  {
    id: "q-success-criteria",
    kind: "success-criteria",
    targetField: "successCriteria",
    required: true,
    prompt: "완료를 판단할 필수 성공 기준을 1-3개로 써줘.",
    informationGain: 0.86,
    riskReduction: 0.4,
    dagImpact: 0.65,
    evidenceImpact: 0.8,
    userCost: 0.3,
  },
  {
    id: "q-artifact",
    kind: "artifact",
    targetField: "expectedArtifacts",
    required: true,
    prompt:
      "반드시 생성/수정되어야 하는 산출물을 경로까지 적어줘. 예: src/commands/goal-interview.ts",
    informationGain: 0.83,
    riskReduction: 0.35,
    dagImpact: 0.7,
    evidenceImpact: 0.85,
    userCost: 0.3,
  },
  {
    id: "q-scope",
    kind: "constraint",
    targetField: "constraints",
    required: false,
    prompt: "수정 가능한 범위를 구체적으로 지정해줘. 예: src/ 만, docs 만, 전체 repo.",
    informationGain: 0.6,
    riskReduction: 0.5,
    dagImpact: 0.5,
    evidenceImpact: 0.4,
    userCost: 0.3,
  },
  {
    id: "q-non-goal",
    kind: "non-goal",
    targetField: "nonGoals",
    required: false,
    prompt:
      "절대 하지 말아야 할 행동이 있어? 예: npm publish 금지, git push 금지, production config 수정 금지.",
    informationGain: 0.55,
    riskReduction: 0.5,
    dagImpact: 0.5,
    evidenceImpact: 0.35,
    userCost: 0.3,
  },
  {
    id: "q-verification",
    kind: "evidence",
    targetField: "successCriteria",
    required: true,
    prompt: "검증 명령/테스트가 있으면 적어줘. 없으면 OMK가 추론해도 되는지 답해줘.",
    informationGain: 0.8,
    riskReduction: 0.5,
    dagImpact: 0.6,
    evidenceImpact: 0.85,
    userCost: 0.35,
  },
  {
    id: "q-risk",
    kind: "risk",
    targetField: "risks",
    required: false,
    prompt: "데이터/보안/배포/권한 측면의 위험이 있어?",
    informationGain: 0.6,
    riskReduction: 0.75,
    dagImpact: 0.55,
    evidenceImpact: 0.5,
    userCost: 0.35,
  },
  {
    id: "q-authority",
    kind: "authority",
    targetField: "riskLevel",
    required: false,
    prompt: "허용 권한 수준을 알려줘. write/shell/merge 중 어디까지 허용해?",
    informationGain: 0.55,
    riskReduction: 0.7,
    dagImpact: 0.55,
    evidenceImpact: 0.45,
    userCost: 0.25,
  },
  {
    id: "q-dependency",
    kind: "dependency",
    targetField: "intentFrame",
    required: false,
    prompt: "참고해야 할 파일/문서/외부 시스템이 있어?",
    informationGain: 0.55,
    riskReduction: 0.4,
    dagImpact: 0.5,
    evidenceImpact: 0.45,
    userCost: 0.35,
  },
  {
    id: "q-rollback",
    kind: "rollback",
    targetField: "riskLevel",
    required: false,
    prompt: "실패 시 rollback 또는 중단 조건이 있어?",
    informationGain: 0.5,
    riskReduction: 0.7,
    dagImpact: 0.55,
    evidenceImpact: 0.5,
    userCost: 0.3,
  },
];

/** Clamp a signal into [0,1] and round to 2 decimals for stable output. */
function clamp01(value: number): number {
  const bounded = value < 0 ? 0 : value > 1 ? 1 : value;
  return Math.round(bounded * 100) / 100;
}

/** True when the seed describes risk-sensitive work (prompt match or high risk). */
function isHighRiskSeed(seed: InterviewSeed): boolean {
  if (seed.riskLevel === "high") {
    return true;
  }
  return HIGH_RISK_PATTERN.test(seed.rawPrompt);
}

/**
 * True when the goal already carries a usable value for the axis, so the axis
 * question can be downranked. `riskLevel` always has a default and does not
 * capture authority/rollback intent, so those axes are never auto-populated.
 */
function isAxisPopulated(goal: GoalSpec | undefined, id: string): boolean {
  if (!goal) {
    return false;
  }
  switch (id) {
    case "q-objective":
      return goal.objective.trim().length > 0;
    case "q-success-criteria":
    case "q-verification":
      return goal.successCriteria.length > 0;
    case "q-artifact":
      return goal.expectedArtifacts.length > 0;
    case "q-scope":
      return goal.constraints.length > 0;
    case "q-non-goal":
      return goal.nonGoals.length > 0;
    case "q-risk":
      return goal.risks.length > 0;
    case "q-dependency":
      return (goal.intentFrame?.entities.length ?? 0) > 0;
    default:
      return false;
  }
}

/**
 * Build the deterministic candidate-question bank for a seed.
 *
 * The result always contains the 10 axes in a stable order. Signals are
 * adjusted deterministically: risk/authority/rollback axes are boosted on
 * high-risk seeds, and any axis already satisfied by `seed.goal` has its
 * informationGain reduced so the caller's ranker downranks it. `score` is
 * intentionally omitted — the caller assigns it.
 */
export function buildInterviewQuestionBank(seed: InterviewSeed): Array<Omit<InterviewQuestion, "score">> {
  const highRisk = isHighRiskSeed(seed);

  return QUESTION_SPECS.map((spec): InterviewCandidate => {
    let informationGain = spec.informationGain;
    let riskReduction = spec.riskReduction;
    let dagImpact = spec.dagImpact;

    if (highRisk && RISK_AXIS_IDS.has(spec.id)) {
      informationGain += 0.1;
      riskReduction = Math.max(riskReduction + 0.15, 0.85);
      dagImpact = Math.max(dagImpact + 0.2, 0.7);
    }

    if (isAxisPopulated(seed.goal, spec.id)) {
      informationGain *= POPULATED_DOWNRANK;
    }

    return {
      id: spec.id,
      kind: spec.kind,
      prompt: spec.prompt,
      required: spec.required,
      targetField: spec.targetField,
      informationGain: clamp01(informationGain),
      riskReduction: clamp01(riskReduction),
      dagImpact: clamp01(dagImpact),
      evidenceImpact: clamp01(spec.evidenceImpact),
      userCost: clamp01(spec.userCost),
    };
  });
}
