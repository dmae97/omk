import { join } from "path";
import type { RunState, NextAction } from "../contracts/orchestration.js";
import type { GoalSpec, GoalEvidence, MissingCriterion, NextActionSuggestion } from "../contracts/goal.js";
import { scoreGoal } from "./scoring.js";
import { checkGoalEvidence } from "./evidence.js";
import { getProjectRoot } from "../util/fs.js";
import { MemoryStore } from "../memory/memory-store.js";
import {
  evaluateEnsembleDecision,
  type EnsembleDecisionCandidateVote,
} from "../orchestration/ensemble-decision.js";
import { evaluateMissingCriteria, suggestNextAction } from "./eval-criteria.js";
import { saveEnsembleDecision } from "./ensemble-memory.js";
import { renderPromptDigest } from "./prompt-digest.js";
import {
  checkDeepSeekBalance,
  DeepSeekClient,
  DEEPSEEK_V4_PRO_MODEL,
  getDeepSeekProviderStatus,
  resolveDeepSeekApiKey,
} from "../providers/index.js";



export interface GoalProgress {
  status: GoalSpec["status"];
  score: import("../contracts/goal.js").GoalScore;
  nextAction: NextAction;
}

export async function evaluateGoalProgress(
  goal: GoalSpec,
  runState: RunState
): Promise<GoalProgress> {
  const root = getProjectRoot();
  const evidence = await checkGoalEvidence(goal, { root, runState });
  const score = scoreGoal(goal, evidence);

  let nextAction: NextAction;
  if (score.overall === "pass") {
    nextAction = "close";
  } else if (score.overall === "fail") {
    nextAction = "block";
  } else if (runState.completedAt) {
    nextAction = "handoff";
  } else {
    nextAction = "continue";
  }

  return {
    status: goal.status,
    score,
    nextAction,
  };
}

export interface EnsembleGoalProgress extends GoalProgress {
  ensemble: ReturnType<typeof evaluateEnsembleDecision>;
}

export interface DeepSeekGoalDecisionContext {
  goal: GoalSpec;
  runState: RunState;
  evidence: GoalEvidence[];
  score: import("../contracts/goal.js").GoalScore;
}

export type DeepSeekGoalDecisionAdvisor = (
  context: DeepSeekGoalDecisionContext
) => Promise<EnsembleDecisionCandidateVote | undefined>;

export interface DeepSeekGoalDecisionOptions {
  enabled?: boolean;
  weight?: number;
  timeoutMs?: number;
  maxTokens?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  advisor?: DeepSeekGoalDecisionAdvisor;
}

export interface GoalProgressEnsembleOptions {
  deepseek?: false | DeepSeekGoalDecisionOptions;
}

export function evaluateLoopGuard(runState: RunState): { shouldStop: boolean; reason?: string } {
  const { iterationCount, maxIterations } = runState;
  if (
    typeof iterationCount === "number" &&
    typeof maxIterations === "number" &&
    maxIterations > 0 &&
    iterationCount > 0 &&
    iterationCount >= maxIterations
  ) {
    return { shouldStop: true, reason: "max-iterations-reached" };
  }
  return { shouldStop: false };
}

/**
 * Evaluate goal progress using an ensemble of decision candidates.
 * Returns the consensus next action without requiring human STOP/CONTINUE input.
 */
export async function evaluateGoalProgressEnsemble(
  goal: GoalSpec,
  runState: RunState,
  iterationContext?: { iterationCount: number; maxIterations: number },
  options: GoalProgressEnsembleOptions = {}
): Promise<EnsembleGoalProgress> {
  const root = getProjectRoot();
  const evidence = await checkGoalEvidence(goal, { root, runState });
  const score = scoreGoal(goal, evidence);
  const deepseekVote = await resolveDeepSeekGoalDecisionVote(goal, runState, evidence, score, options.deepseek);

  // Loop guard check
  const effectiveState: RunState = iterationContext
    ? { ...runState, iterationCount: iterationContext.iterationCount, maxIterations: iterationContext.maxIterations }
    : runState;
  const guard = evaluateLoopGuard(effectiveState);
  if (guard.shouldStop) {
    const forcedNextAction: NextAction = score.overall === "fail" ? "block" : "handoff";
    console.warn(`[goal-control-loop] Loop guard triggered: ${guard.reason}. Forcing nextAction="${forcedNextAction}".`);
    const ensemble = evaluateEnsembleDecision(goal, runState, evidence, {
      enabled: true,
      quorumRatio: 0.5,
      extraVotes: deepseekVote ? [deepseekVote] : undefined,
    });
    return {
      status: goal.status,
      score,
      nextAction: forcedNextAction,
      ensemble,
    };
  }

  // Run ensemble decision engine
  const ensemble = evaluateEnsembleDecision(goal, runState, evidence, {
    enabled: true,
    quorumRatio: 0.5,
    extraVotes: deepseekVote ? [deepseekVote] : undefined,
  });

  // If ensemble has high confidence (>0.7), trust it; otherwise fall back to basic logic
  let nextAction: NextAction;
  if (ensemble.confidence >= 0.7) {
    nextAction = ensemble.action;
  } else if (score.overall === "pass") {
    nextAction = "close";
  } else if (score.overall === "fail") {
    nextAction = "block";
  } else if (runState.completedAt) {
    nextAction = "handoff";
  } else {
    nextAction = "continue";
  }

  // Persist important ensemble decisions to the configured graph memory backend.
  if (ensemble.confidence >= 0.5) {
    await saveEnsembleDecision(goal, runState, ensemble, root).catch(() => {
      // ignore persistence failures
    });
  }

  return {
    status: goal.status,
    score,
    nextAction,
    ensemble,
  };
}

async function resolveDeepSeekGoalDecisionVote(
  goal: GoalSpec,
  runState: RunState,
  evidence: GoalEvidence[],
  score: import("../contracts/goal.js").GoalScore,
  options: GoalProgressEnsembleOptions["deepseek"]
): Promise<EnsembleDecisionCandidateVote | undefined> {
  if (options === false) return undefined;
  const env = options?.env ?? process.env;
  if (options?.enabled === false || parseOptionalBoolean(env.OMK_DEEPSEEK_GOAL_ENSEMBLE) === false) {
    return undefined;
  }

  const context: DeepSeekGoalDecisionContext = { goal, runState, evidence, score };
  if (options?.advisor) {
    const vote = await options.advisor(context).catch((err: unknown) =>
      deepseekUnavailableVote(`advisor failed: ${sanitizeDeepSeekMessage(err)}`, options.weight)
    );
    return vote ? normalizeDeepSeekDecisionVote(vote, options.weight) : undefined;
  }

  const status = await getDeepSeekProviderStatus({ env }).catch(() => undefined);
  if (!status?.enabled || !status.apiKeySet) return undefined;

  const resolved = await resolveDeepSeekApiKey({ env }).catch(() => undefined);
  if (!resolved?.apiKey) return undefined;

  const health = await checkDeepSeekBalance({
    apiKey: resolved.apiKey,
    env,
    fetchImpl: options?.fetchImpl,
    timeoutMs: Math.min(options?.timeoutMs ?? 10_000, 20_000),
  });
  if (!health.available) {
    return deepseekUnavailableVote(health.reason ?? "preflight unavailable", options?.weight);
  }

  const client = new DeepSeekClient({
    apiKey: resolved.apiKey,
    env,
    fetchImpl: options?.fetchImpl,
    model: DEEPSEEK_V4_PRO_MODEL,
    reasoningEffort: "max",
    timeoutMs: options?.timeoutMs ?? 45_000,
  });

  try {
    const content = await client.complete({
      messages: [
        {
          role: "system",
          content: [
            "You are DeepSeek inside the OMK goal-progress ensemble.",
            "Kimi remains the orchestrator and final authority.",
            "You have no file, shell, MCP, secret, or merge authority.",
            "Return JSON only with action, confidence, and reason.",
            "Allowed action values: continue, replan, block, handoff, close.",
          ].join(" ") || "You are DeepSeek inside OMK. Return JSON with action, confidence, and reason.",
        },
        { role: "user", content: buildDeepSeekGoalDecisionPrompt(goal, runState, evidence, score) },
      ],
      maxTokens: options?.maxTokens ?? 512,
      thinking: "disabled",
    });

    return normalizeDeepSeekDecisionVote(parseDeepSeekDecisionVote(content, options?.weight), options?.weight);
  } catch (err) {
    return deepseekUnavailableVote(`chat failed: ${sanitizeDeepSeekMessage(err)}`, options?.weight);
  }
}

function buildDeepSeekGoalDecisionPrompt(
  goal: GoalSpec,
  runState: RunState,
  evidence: GoalEvidence[],
  score: import("../contracts/goal.js").GoalScore
): string {
  const missing = evaluateMissingCriteria(goal, evidence);
  const nodes = describeNodes(runState.nodes, 10);
  const nodeEvidence = describeNodeEvidence(runState, 10);
  const providerAttempts = describeProviderAttempts(runState, 10);
  const goalEvidence = evidence.slice(-10).map((item) => {
    const message = item.message ? ` — ${truncateLine(item.message, 160)}` : "";
    const ref = item.ref ? ` (${item.ref})` : "";
    return `- ${item.criterionId}: ${item.passed ? "passed" : "failed"}${ref}${message}`;
  });

  return [
    "# OMK Goal Progress Snapshot",
    `Goal: ${goal.title}`,
    renderPromptDigest("Objective digest", goal.objective, { maxKeywords: 18, maxPhrases: 3 }),
    `Risk level: ${goal.riskLevel}`,
    `Score: ${score.overall} required=${score.requiredPassed}/${score.requiredTotal} optional=${score.optionalScore.toFixed(2)} qualityGate=${score.qualityGatePassed}`,
    "",
    "Missing criteria:",
    ...(missing.length > 0 ? missing.slice(0, 10).map((item) => `- ${item.criterionId}: ${item.description} (${item.requirement})`) : ["- none"]),
    "",
    "Run nodes:",
    ...(nodes.length > 0 ? nodes : ["- none"]),
    "",
    "Node evidence:",
    ...(nodeEvidence.length > 0 ? nodeEvidence : ["- none"]),
    "",
    "Goal evidence:",
    ...(goalEvidence.length > 0 ? goalEvidence : ["- none"]),
    "",
    "Provider attempts:",
    ...(providerAttempts.length > 0 ? providerAttempts : ["- none"]),
    "",
    "Choose the next action for the Kimi control loop.",
    "Return compact JSON only, e.g. {\"action\":\"continue\",\"confidence\":0.82,\"reason\":\"...\"}.",
  ].join("\n");
}

function parseDeepSeekDecisionVote(content: string, fallbackWeight: number | undefined): EnsembleDecisionCandidateVote {
  const parsed = parseJsonObject(content);
  const action = isNextAction(parsed?.action) ? parsed.action : "continue";
  const confidence = clampConfidence(Number(parsed?.confidence));
  const reason = typeof parsed?.reason === "string" && parsed.reason.trim()
    ? parsed.reason
    : content;
  return {
    id: "deepseek-v4-pro",
    action,
    weight: Math.max(0.1, (fallbackWeight ?? 0.9) * confidence),
    reason: `DeepSeek advisory: ${truncateLine(reason, 180)}`,
  };
}

function parseJsonObject(content: string): Record<string, unknown> | undefined {
  const trimmed = content.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    trimmed.match(/\{[\s\S]*\}/)?.[0],
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

function normalizeDeepSeekDecisionVote(
  vote: EnsembleDecisionCandidateVote,
  fallbackWeight: number | undefined
): EnsembleDecisionCandidateVote | undefined {
  if (!isNextAction(vote.action)) return undefined;
  const weight = Number.isFinite(vote.weight) && vote.weight > 0
    ? vote.weight
    : fallbackWeight ?? 0.9;
  return {
    id: vote.id || "deepseek-v4-pro",
    action: vote.action,
    weight,
    reason: truncateLine(vote.reason || "DeepSeek advisory", 220),
  };
}

function deepseekUnavailableVote(reason: string, fallbackWeight: number | undefined): EnsembleDecisionCandidateVote {
  return {
    id: "deepseek-v4-pro",
    action: "continue",
    weight: Math.min(0.2, fallbackWeight ?? 0.2),
    reason: `DeepSeek advisory unavailable: ${truncateLine(reason, 180)}`,
  };
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function isNextAction(value: unknown): value is NextAction {
  return value === "continue" || value === "replan" || value === "block" || value === "handoff" || value === "close";
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.6;
  return Math.max(0.1, Math.min(1, value));
}

function sanitizeDeepSeekMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export interface NextPromptResult {
  prompt: string;
  missingCriteria: MissingCriterion[];
  suggestion: NextActionSuggestion;
  memorySummary: string;
  recommendedCommands: string[];
  recommendedSkills: string[];
  verificationGates: string[];
}

export async function recallMemoryForGoal(goal: GoalSpec, root: string): Promise<string> {
  const memoryStore = new MemoryStore(join(root, ".omk", "memory"), {
    projectRoot: root,
    source: "goal-continue",
  });

  const parts: string[] = [];

  try {
    const mindmap = await memoryStore.mindmap(goal.title, 40);
    if (mindmap && mindmap.nodes.length > 0) {
      const relevant = mindmap.nodes
        .filter((n) => n.type === "Goal" || n.type === "Task" || n.type === "Decision" || n.type === "Evidence")
        .slice(0, 10)
        .map((n) => `- ${n.label} (${n.type})`)
        .join("\n");
      if (relevant) {
        parts.push("### Mindmap", relevant);
      }
    }
  } catch {
    // ignore mindmap failures
  }

  try {
    const searchResults = await memoryStore.search(goal.objective, 10);
    if (searchResults.length > 0) {
      const relevant = searchResults
        .slice(0, 5)
        .map((r) => `- ${r.path}: ${r.content.slice(0, 120)}`)
        .join("\n");
      parts.push("### Search Results", relevant);
    }
  } catch {
    // ignore search failures
  }

  return parts.join("\n");
}

export async function generateNextPrompt(
  goal: GoalSpec,
  evidence: GoalEvidence[],
  runState?: RunState,
  memorySummary?: string,
  root?: string,
): Promise<NextPromptResult> {
  let resolvedMemorySummary = memorySummary ?? "";
  if (!resolvedMemorySummary && root) {
    try {
      resolvedMemorySummary = await recallMemoryForGoal(goal, root);
    } catch {
      // ignore memory recall failures
    }
  }

  const missingCriteria = evaluateMissingCriteria(goal, evidence);
  const suggestion = suggestNextAction(goal, evidence);

  const completedCriteria = goal.successCriteria.filter((c) => {
    const ev = evidence.find((e) => e.criterionId === c.id);
    return ev?.passed ?? false;
  });

  const failedNodes = runState?.nodes.filter((n) => n.status === "failed") ?? [];
  const blockedNodes = runState?.nodes.filter((n) => n.status === "blocked") ?? [];
  const runningNodes = runState?.nodes.filter((n) => n.status === "running") ?? [];
  const pendingNodes = runState?.nodes.filter((n) => n.status === "pending") ?? [];
  const successNodes = runState?.nodes.filter((n) => n.status === "done") ?? [];

  const lines: string[] = [
    `# Context-Aware Goal Follow-up: ${goal.title}`,
    ``,
    `## Kimi Context Synthesis`,
    `Treat this document as context for the next action, not as text to repeat verbatim.`,
    `Kimi should infer the next concrete prompt from the latest evidence, failed/blocked nodes, missing criteria, and related memory.`,
    `Do not repeat the original goal verbatim. Do not restart completed work unless its evidence is invalid or stale.`,
    ``,
    `## Goal Reference (non-verbatim)`,
    renderPromptDigest("Original objective digest", goal.objective),
    ``,
    `## Immediate Focus`,
    `- Type: ${suggestion.type}`,
    `- Target: ${suggestion.targetId}`,
    `- Description: ${suggestion.description}`,
    `- Reason: ${suggestion.reason}`,
    `- Priority: ${describeImmediatePriority(missingCriteria, failedNodes, blockedNodes)}`,
    ``,
    `## Success Criteria`,
    `### Completed (${completedCriteria.length}/${goal.successCriteria.length})`,
    ...completedCriteria.map((c) => `- [x] ${c.description}`),
    ``,
    `### Missing (${missingCriteria.length})`,
    ...missingCriteria.map((c) => `- [ ] ${c.description} (${c.requirement}, priority: ${c.priority})`),
    ``,
  ];

  if (runState) {
    lines.push(
      `## Previous Run Results`,
      `- Run ID: ${runState.runId}`,
      `- Successful nodes: ${successNodes.length}`,
      `- Failed nodes: ${failedNodes.length}`,
      `- Blocked nodes: ${blockedNodes.length}`,
      `- Running nodes: ${runningNodes.length}`,
      `- Pending nodes: ${pendingNodes.length}`,
    );
    if (successNodes.length > 0) {
      lines.push(`### Completed Nodes`, ...describeNodes(successNodes));
    }
    if (failedNodes.length > 0) {
      lines.push(`### Failed Nodes`, ...describeNodes(failedNodes));
    }
    if (blockedNodes.length > 0) {
      lines.push(`### Blocked Nodes`, ...describeNodes(blockedNodes));
    }
    const evidenceSummary = describeNodeEvidence(runState);
    if (evidenceSummary.length > 0) {
      lines.push(`### Recent Evidence`, ...evidenceSummary);
    }
    const attemptSummary = describeProviderAttempts(runState);
    if (attemptSummary.length > 0) {
      lines.push(`### Provider / Fallback Notes`, ...attemptSummary);
    }
    lines.push("");
  }

  if (resolvedMemorySummary) {
    lines.push(
      `## Related Memory`,
      resolvedMemorySummary,
      ``,
    );
  }

  const recommendedCommands: string[] = [];
  const recommendedSkills: string[] = [];
  const verificationGates: string[] = [];

  if (missingCriteria.length > 0) {
    recommendedCommands.push("npm run check", "npm run test");
    recommendedSkills.push("omk-quality-gate", "omk-test-debug-loop");
    verificationGates.push("Type-check passes", "Tests pass");
  }

  if (goal.expectedArtifacts.length > 0) {
    recommendedSkills.push("omk-code-review");
    verificationGates.push("Expected artifacts exist");
  }

  if (goal.constraints.length > 0) {
    recommendedSkills.push("omk-security-review");
    verificationGates.push("Constraints satisfied");
  }

  if (resolvedMemorySummary) {
    recommendedSkills.push("omk-context-broker", "omk-project-rules");
    recommendedCommands.push("omk_search_memory", "omk_memory_mindmap");
  }

  lines.push(
    `## Recommended Next Action`,
    `- Type: ${suggestion.type}`,
    `- Target: ${suggestion.targetId}`,
    `- Description: ${suggestion.description}`,
    `- Reason: ${suggestion.reason}`,
    ``,
    `## Recommended Commands`,
    ...recommendedCommands.map((c) => `- \`${c}\``),
    ``,
    `## Recommended Skills`,
    ...recommendedSkills.map((s) => `- ${s}`),
    ``,
    `## Verification Gates`,
    ...verificationGates.map((g) => `- [ ] ${g}`),
    ``,
    `## Instructions`,
    `Convert the context above into the next concrete Kimi action; do not send the same original goal prompt again.`,
    `Focus on the missing criteria and recommended next action while preserving completed nodes and valid evidence.`,
    `Run the recommended commands after making changes. Activate relevant skills for each sub-task.`,
  );

  const prompt = lines.join("\n");

  return {
    prompt,
    missingCriteria,
    suggestion,
    memorySummary: resolvedMemorySummary,
    recommendedCommands,
    recommendedSkills,
    verificationGates,
  };
}

function describeImmediatePriority(
  missingCriteria: MissingCriterion[],
  failedNodes: RunState["nodes"],
  blockedNodes: RunState["nodes"]
): string {
  if (blockedNodes.length > 0) return `unblock ${blockedNodes[0]?.id ?? "blocked-node"} before retrying dependent work`;
  if (failedNodes.length > 0) return `repair failed node ${failedNodes[0]?.id ?? "failed-node"} with a narrower retry plan`;
  if (missingCriteria.length > 0) return `satisfy missing criterion ${missingCriteria[0]?.criterionId ?? "criterion"}`;
  return "verify completion and close if all evidence remains valid";
}

function describeNodes(nodes: RunState["nodes"], limit = 8): string[] {
  const visible = nodes.slice(0, limit).map((node) => {
    const reason = node.blockedReason ? ` — ${truncateLine(node.blockedReason, 180)}` : "";
    const attempts = node.attempts?.length ? `, attempts=${node.attempts.length}` : "";
    return `- ${node.id}: ${node.name} (${node.role}${attempts})${reason}`;
  });
  if (nodes.length > limit) {
    visible.push(`- ... ${nodes.length - limit} more`);
  }
  return visible;
}

function describeNodeEvidence(runState: RunState, limit = 8): string[] {
  const entries = runState.nodes.flatMap((node) =>
    (node.evidence ?? []).map((evidence) => {
      const message = evidence.message ? ` — ${truncateLine(evidence.message, 180)}` : "";
      const ref = evidence.ref ? ` (${evidence.ref})` : "";
      return `- ${node.id}/${evidence.gate}: ${evidence.passed ? "passed" : "failed"}${ref}${message}`;
    })
  );
  return entries.slice(-limit);
}

function describeProviderAttempts(runState: RunState, limit = 8): string[] {
  const entries = runState.nodes.flatMap((node) =>
    (node.attempts ?? []).map((attempt) => {
      const details = [
        attempt.requestedProvider ? `requested=${attempt.requestedProvider}` : "",
        attempt.provider ? `provider=${attempt.provider}` : "",
        attempt.fallbackFrom ? `fallbackFrom=${attempt.fallbackFrom}` : "",
        attempt.fallbackReason ? `reason=${truncateLine(attempt.fallbackReason, 160)}` : "",
      ].filter(Boolean).join(" ");
      return `- ${node.id}#${attempt.attempt}: ${details}`;
    })
  ).filter((line) => line.includes("provider=") || line.includes("fallbackFrom="));
  return entries.slice(-limit);
}

function truncateLine(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}…`;
}

/**
 * Evaluate which success criteria still lack passing evidence.
 * Returns ordered list with required criteria first, then by weight desc.
 */


/**
 * Incremental evaluation: re-evaluate progress with current evidence.
 * Suitable for calling mid-run without recomputing the full run state.
 */
export function evaluateGoalProgressIncremental(
  goal: GoalSpec,
  evidence: GoalEvidence[]
): { score: import("../contracts/goal.js").GoalScore; suggestion: NextActionSuggestion } {
  const score = scoreGoal(goal, evidence);
  const suggestion = suggestNextAction(goal, evidence);
  return { score, suggestion };
}
