import type { GoalEvidence, GoalScore, GoalSpec } from "../contracts/goal.js";

export function scoreGoal(goal: GoalSpec, evidence: GoalEvidence[]): GoalScore {
  const evidenceByCriterion = latestEvidenceByCriterion(evidence);
  const requiredCriteria = goal.successCriteria.filter((c) => c.requirement === "required");
  const optionalCriteria = goal.successCriteria.filter((c) => c.requirement === "optional");

  let requiredPassed = 0;
  let requiredFailed = 0;
  for (const criterion of requiredCriteria) {
    const ev = evidenceByCriterion.get(criterion.id);
    if (ev?.passed) {
      requiredPassed++;
    } else if (ev && !ev.passed) {
      requiredFailed++;
    }
  }

  let optionalWeightedSum = 0;
  let optionalWeightTotal = 0;
  for (const criterion of optionalCriteria) {
    const ev = evidenceByCriterion.get(criterion.id);
    optionalWeightTotal += criterion.weight;
    if (ev?.passed) {
      optionalWeightedSum += criterion.weight;
    }
  }

  const optionalScore = optionalWeightTotal > 0 ? optionalWeightedSum / optionalWeightTotal : 0;

  // Quality gate: all artifact gates must pass
  const artifactEvidence = [...evidenceByCriterion.values()].filter((e) => e.criterionId.startsWith("artifact:"));
  const qualityGatePassed = artifactEvidence.length === 0 || artifactEvidence.every((e) => e.passed);

  let overall: GoalScore["overall"];
  if (requiredFailed > 0) {
    overall = "fail";
  } else if (requiredPassed < requiredCriteria.length) {
    overall = "incomplete";
  } else if (!qualityGatePassed) {
    overall = "fail";
  } else if (requiredPassed === requiredCriteria.length && optionalScore >= 0.5) {
    overall = "pass";
  } else if (requiredPassed === requiredCriteria.length) {
    overall = "pass";
  } else {
    overall = "incomplete";
  }

  return {
    requiredTotal: requiredCriteria.length,
    requiredPassed,
    optionalScore: Math.round(optionalScore * 100) / 100,
    qualityGatePassed,
    overall,
  };
}

function latestEvidenceByCriterion(evidence: GoalEvidence[]): Map<string, GoalEvidence> {
  const latest = new Map<string, GoalEvidence>();
  for (const ev of evidence) {
    const previous = latest.get(ev.criterionId);
    if (!previous || evidenceCheckedAt(ev) >= evidenceCheckedAt(previous)) {
      latest.set(ev.criterionId, ev);
    }
  }
  return latest;
}

function evidenceCheckedAt(evidence: GoalEvidence): number {
  const timestamp = Date.parse(evidence.checkedAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}
