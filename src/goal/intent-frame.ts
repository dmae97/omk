import type {
  ActionAtom,
  ActionAtomVerb,
  GoalEvidence,
  GoalSpec,
  IntentCapabilityHints,
  IntentConfidence,
  IntentDiagnostic,
  IntentDirective,
  IntentFrame,
  NextActionContract,
  PromptNoveltyReport,
} from "../contracts/goal.js";
import type { DagNodeRouting } from "../orchestration/dag.js";
import type { NextAction, RunState } from "../contracts/orchestration.js";
import { extractPromptKeywords, promptDigestFingerprint } from "./prompt-digest.js";
import type { OuroborosDecision } from "../runtime/ouroboros-policy.js";
import { resolveOuroborosDecision } from "../runtime/ouroboros-policy.js";

const TOKEN_PATTERN = /[\p{L}\p{N}_-]+/gu;
const REPLAY_PATTERN = /repeat|replay|verbatim|same prompt|original objective|original goal|raw input|원문|반복|재사용|그대로/u;
const REPLAY_THRESHOLD = 0.72;
const OSCILLATION_REPEAT_COUNT = 3;
const LOW_EVIDENCE_DELTA = 0.10;

interface SanitizedPrompt {
  normalized: string;
  redacted: string;
  redactionCount: number;
  diagnostics: IntentDiagnostic[];
}

interface PrimaryAction {
  verb: ActionAtomVerb;
  confidence: number;
  matchedKeywords: string[];
}

export function buildIntentFrame(rawPrompt: string, input: {
  constraints?: string[];
  successCriteria?: string[];
  expectedArtifacts?: Array<{ name: string; path?: string }>;
} = {}): IntentFrame {
  const sanitized = sanitizePrompt(rawPrompt);
  const normalized = sanitized.redacted;
  const keywords = extractPromptKeywords(normalized, 10);
  const directives = extractDirectives(normalized, input.constraints ?? []);
  const entities = extractEntities(normalized, keywords);
  const constraints = uniqueStrings([
    ...(input.constraints ?? []),
    ...directives.filter((directive) => directive.kind === "constraint" || directive.kind === "scope").map((directive) => directive.value),
  ]);
  const successCriteria = uniqueStrings(input.successCriteria ?? []);
  const primary = classifyPrimaryAction(normalized, directives);
  const subject = summarizeSubject(keywords, entities, directives);
  const capabilityHints = buildCapabilityHints(normalized, directives, primary.verb);
  const actionAtoms = buildActionAtoms({
    primary: primary.verb,
    subject,
    constraints,
    successCriteria,
    expectedArtifacts: input.expectedArtifacts ?? [],
    directives,
  });
  const confidence = buildConfidence(primary, directives, sanitized.redactionCount, keywords.length);
  const diagnostics = [...sanitized.diagnostics, ...buildIntentDiagnostics(directives, confidence)];

  return {
    schemaVersion: 2,
    rawPromptDigest: promptDigestFingerprint(normalized),
    problem: `Resolve ${subject}`,
    desiredOutcome: `Deliver verified ${primary.verb} work for ${subject}`,
    constraints,
    entities,
    successCriteria,
    actionAtoms,
    strict: true,
    directives,
    confidence,
    capabilityHints,
    diagnostics,
  };
}

export function buildIntentFrameFromGoal(goal: GoalSpec): IntentFrame {
  return goal.intentFrame ?? buildIntentFrame(goal.rawPrompt || goal.objective || goal.title, {
    constraints: goal.constraints.map((constraint) => constraint.description),
    successCriteria: goal.successCriteria.map((criterion) => criterion.description),
    expectedArtifacts: goal.expectedArtifacts,
  });
}

/**
 * IntentFrame enriched with an advisory Ouroboros routing decision.
 * The existing IntentFrame shape is unchanged; the optional ouroboros
 * field is additive and consumed only by callers that understand it.
 */
export type IntentFrameWithOuroboros = IntentFrame & {
  ouroboros?: OuroborosDecision;
};

/**
 * Build an IntentFrame and, for goal/spec/orchestration intents,
 * attach a non-fatal Ouroboros routing decision.
 *
 * The base IntentFrame fields are never modified; the ouroboros hint
 * is purely advisory.
 */
export async function buildIntentFrameWithOuroboros(
  rawPrompt: string,
  input: {
    constraints?: string[];
    successCriteria?: string[];
    expectedArtifacts?: Array<{ name: string; path?: string }>;
  } = {},
): Promise<IntentFrameWithOuroboros> {
  const frame = buildIntentFrame(rawPrompt, input);
  try {
    const decision = await resolveOuroborosDecision({ intent: rawPrompt });
    return { ...frame, ouroboros: decision };
  } catch {
    return frame;
  }
}

export function actionAtomRouting(atom: ActionAtom): NonNullable<DagNodeRouting["actionAtom"]> {
  return {
    id: atom.id,
    label: atom.label,
    verb: atom.verb,
    object: atom.object,
    evidenceTarget: atom.evidenceTarget,
    doneCondition: atom.doneCondition,
  };
}

export function renderActionDigest(frame: IntentFrame, options: { maxAtoms?: number } = {}): string {
  const maxAtoms = options.maxAtoms ?? 8;
  const directiveText = frame.directives.length > 0
    ? frame.directives.map((directive) => `${directive.kind}:${directive.value}`).slice(0, 6).join("; ")
    : "none";
  const hints = frame.capabilityHints;
  return [
    `Intent digest: ${frame.rawPromptDigest}`,
    `Intent schema: v${frame.schemaVersion}; strict=${frame.strict}; confidence=${frame.confidence.overall}`,
    `Problem: ${frame.problem}`,
    `Desired outcome: ${frame.desiredOutcome}`,
    `Directives: ${directiveText}`,
    `Capability hints: skills=${hints.skills.length}; mcp=${hints.mcpServers.length}; tools=${hints.tools.length}; hooks=${hints.hooks.length}; readOnly=${hints.readOnly}; voters=${hints.ensembleVoters.length}`,
    `Entities: ${frame.entities.length > 0 ? frame.entities.join(", ") : "none"}`,
    "ActionAtoms:",
    ...frame.actionAtoms.slice(0, maxAtoms).map((atom) =>
      `- ${atom.label}: ${atom.verb} ${atom.object}; role=${atom.roleHint ?? "auto"}; evidence=${atom.evidenceTarget}; done=${atom.doneCondition}`
    ),
  ].join("\n");
}

export function makeActionAtom(input: {
  id: string;
  label: string;
  verb: ActionAtomVerb;
  object: string;
  evidenceTarget: string;
  doneCondition: string;
  source?: ActionAtom["source"];
  roleHint?: string;
}): ActionAtom {
  return {
    id: input.id,
    label: normalizeAtomLabel(input.label),
    verb: input.verb,
    object: normalizeActionObject(input.object),
    evidenceTarget: normalizeActionObject(input.evidenceTarget),
    doneCondition: normalizeActionObject(input.doneCondition),
    source: input.source ?? "heuristic",
    roleHint: input.roleHint,
  };
}

export function buildNextActionContract(
  action: NextAction,
  targetId: string,
  description: string,
  frame: IntentFrame
): NextActionContract {
  const actionAtom = frame.actionAtoms.find((atom) => atom.id === targetId) ?? frame.actionAtoms[0];
  return {
    action,
    targetId,
    description: normalizeActionObject(description),
    evidenceTarget: actionAtom?.evidenceTarget ?? "state.json",
    doneCondition: actionAtom?.doneCondition ?? "Evidence demonstrates the next action completed",
    actionAtom,
  };
}

export function evaluatePromptNovelty(input: {
  goal: GoalSpec;
  runState?: RunState;
  previousPrompt?: string;
  evidence?: GoalEvidence[];
  action: NextAction;
  targetAtomId?: string;
}): PromptNoveltyReport {
  const original = input.goal.rawPrompt || input.goal.objective || input.goal.title;
  const originalDigestText = sanitizePrompt(original).redacted;
  const previousPrompt = input.previousPrompt ?? "";
  const nodes = [...(input.runState?.nodes ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const nodeTexts = nodes.flatMap((node) => [
    node.name,
    node.blockedReason ?? "",
    ...(node.evidence ?? []).map((item) => item.message ?? ""),
  ]);
  const similarityToOriginal = Math.max(
    textSimilarity(originalDigestText, previousPrompt),
    ...nodeTexts.map((value) => textSimilarity(originalDigestText, value))
  );
  const similarityToPrevious = Math.max(
    textSimilarity(previousPrompt, input.goal.objective),
    ...nodeTexts.map((value) => textSimilarity(previousPrompt, value))
  );
  const repeatedNodeNames = nodes
    .filter((node) =>
      textSimilarity(originalDigestText, node.name) >= REPLAY_THRESHOLD ||
      textSimilarity(previousPrompt, node.name) >= REPLAY_THRESHOLD ||
      REPLAY_PATTERN.test(`${node.name} ${node.blockedReason ?? ""}`)
    )
    .map((node) => node.name)
    .slice(0, 8);
  const nodeEvidenceCount = nodes.reduce((count, node) => count + (node.evidence?.length ?? 0), 0);
  const passedEvidenceCount = nodes.reduce(
    (count, node) => count + (node.evidence?.filter((item) => item.passed).length ?? 0),
    0
  );
  const doneCount = nodes.filter((node) => node.status === "done").length;
  const totalEvidenceCount = (input.evidence?.length ?? 0) + nodeEvidenceCount;
  const evidenceDelta = nodes.length === 0
    ? totalEvidenceCount > 0 ? 1 : 0
    : Math.min(1, (passedEvidenceCount + (input.evidence?.filter((item) => item.passed).length ?? 0)) / Math.max(1, nodes.length));
  const progressDelta = nodes.length === 0 ? 0 : Math.min(1, doneCount / Math.max(1, nodes.length));
  const hasNewEvidence = totalEvidenceCount > 0 || doneCount > 0;
  const targetAtomId = input.targetAtomId ?? inferDominantActionAtomId(nodes);
  const oscillation = Boolean(targetAtomId) &&
    repeatedTargetCount(nodes, targetAtomId) >= OSCILLATION_REPEAT_COUNT &&
    evidenceDelta < LOW_EVIDENCE_DELTA;
  const replayRisk = similarityToOriginal >= REPLAY_THRESHOLD ||
    similarityToPrevious >= REPLAY_THRESHOLD ||
    repeatedNodeNames.length > 0;
  const shouldReplan = input.action === "continue" && (
    (replayRisk && evidenceDelta < LOW_EVIDENCE_DELTA && progressDelta < LOW_EVIDENCE_DELTA) || oscillation
  );
  const recommendation: NextAction = shouldReplan ? "replan" : input.action;
  return {
    schemaVersion: 2,
    action: input.action,
    recommendation,
    reason: shouldReplan
      ? oscillation
        ? "novelty guard detected action atom oscillation without evidence delta"
        : "novelty guard detected repeated prompt context without evidence delta"
      : "prompt context is sufficiently novel or backed by evidence/progress delta",
    similarityToOriginal: roundSimilarity(similarityToOriginal),
    similarityToPrevious: roundSimilarity(similarityToPrevious),
    repeatedNodeNames,
    hasNewEvidence,
    evidenceDelta: roundSimilarity(evidenceDelta),
    progressDelta: roundSimilarity(progressDelta),
    replayRisk,
    oscillation,
    targetAtomId,
  };
}

const SECRET_REDACTION_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: "bearer-token", pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, replacement: "Bearer [REDACTED_TOKEN]" },
  { name: "openai-key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: "[REDACTED_API_KEY]" },
  { name: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{16,}\b/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
  { name: "aws-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED_AWS_KEY]" },
  { name: "env-secret", pattern: /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)\s*=\s*[^\s`'"]{6,}/g, replacement: "[REDACTED_ENV_SECRET]" },
  { name: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" },
];

/**
 * Redact high-confidence secrets from free text while preserving layout
 * (no normalization). Use before persisting or echoing prompts/answers so
 * tokens never land in interview artifacts, GoalSpec fields, or --json output.
 */
export function redactSecretText(text: string): string {
  let redacted = text;
  for (const item of SECRET_REDACTION_PATTERNS) {
    redacted = redacted.replace(item.pattern, item.replacement);
  }
  return redacted;
}

function sanitizePrompt(rawPrompt: string): SanitizedPrompt {
  const normalized = normalizeText(rawPrompt);
  let redacted = normalized;
  let redactionCount = 0;
  const diagnostics: IntentDiagnostic[] = [];
  for (const item of SECRET_REDACTION_PATTERNS) {
    let count = 0;
    redacted = redacted.replace(item.pattern, () => {
      count += 1;
      return item.replacement;
    });
    if (count > 0) {
      redactionCount += count;
      diagnostics.push({ kind: "redaction", message: `${item.name} redacted before intent extraction`, count });
    }
  }
  if (redacted !== normalized) {
    diagnostics.push({ kind: "normalization", message: "intent extraction used redacted normalized input", count: redactionCount });
  }
  return { normalized, redacted, redactionCount, diagnostics };
}

function extractDirectives(text: string, constraints: string[]): IntentDirective[] {
  const directives: IntentDirective[] = [];
  const lowered = text.toLocaleLowerCase();
  if (/\b(read[-\s]?only|no edits?|do not edit|no write|no changes?)\b|읽기\s*전용|수정\s*금지|편집\s*금지/u.test(lowered)) {
    directives.push({ kind: "read-only", value: "read-only execution requested", source: "explicit" });
  }
  if (/\b(no edits?|do not edit|without edits?|no file changes?)\b|수정\s*없이|파일\s*변경\s*금지/u.test(lowered)) {
    directives.push({ kind: "no-edits", value: "do not modify files", source: "explicit" });
  }
  for (const match of text.matchAll(/(?:scope|범위)\s*[:：-]\s*([^\n.;]{2,160})/giu)) {
    directives.push({ kind: "scope", value: match[1].trim(), source: "explicit" });
  }
  for (const match of text.matchAll(/(?:expected output|output|산출물|결과물|출력)\s*[:：-]\s*([^\n.;]{2,160})/giu)) {
    directives.push({ kind: "expected-output", value: match[1].trim(), source: "explicit" });
  }
  for (const constraint of constraints) {
    directives.push({ kind: "constraint", value: constraint, source: "explicit" });
  }
  return dedupeDirectives(directives);
}

function buildCapabilityHints(text: string, directives: IntentDirective[], primary: ActionAtomVerb): IntentCapabilityHints {
  const lowered = text.toLocaleLowerCase();
  const readOnly = directives.some((directive) => directive.kind === "read-only" || directive.kind === "no-edits") ||
    primary === "inspect" || primary === "research" || primary === "review";
  const needsMcp = /\bmcp\b|tool|도구|memory|browser|playwright|github|supabase|filesystem/u.test(lowered);
  const needsSkills = /\bskill|skills\b|스킬|workflow|품질|quality|security|review/u.test(lowered);
  const needsHooks = /\bhook|hooks\b|가드|guard|stop-hook|userpromptsubmit/u.test(lowered);
  const ensembleVoters = inferEnsembleVoters(lowered, primary, { needsMcp, needsSkills, needsHooks });
  return {
    skills: needsSkills ? inferSkillHints(lowered) : [],
    mcpServers: needsMcp ? inferMcpHints(lowered) : [],
    tools: needsMcp ? inferToolHints(lowered) : [],
    hooks: needsHooks ? inferHookHints(lowered) : [],
    readOnly,
    needsMcp,
    needsSkills,
    needsHooks,
    ensembleVoters,
  };
}

function inferSkillHints(lowered: string): string[] {
  const skills: string[] = [];
  if (/test|검증|quality|품질/.test(lowered)) skills.push("omk-quality-gate", "omk-test-debug-loop");
  if (/security|secret|보안/.test(lowered)) skills.push("omk-security-review", "omk-secret-guard");
  if (/plan|설계|계획/.test(lowered)) skills.push("omk-plan-first");
  if (/mcp|orchestration|dag|오케스트/.test(lowered)) skills.push("omk-adaptorch-orchestration-review", "omk-control-loop-debugger");
  return uniqueStrings(skills).slice(0, 8);
}

function inferMcpHints(lowered: string): string[] {
  const hints: string[] = [];
  if (/memory|goal|run|state|omk/.test(lowered)) hints.push("omk-project");
  if (/file|filesystem|repo|코드|파일/.test(lowered)) hints.push("filesystem-readonly");
  if (/github|issue|pr/.test(lowered)) hints.push("github");
  if (/browser|playwright|ui/.test(lowered)) hints.push("playwright");
  return uniqueStrings(hints).slice(0, 8);
}

function inferToolHints(lowered: string): string[] {
  const hints: string[] = [];
  if (/search|find|탐색|검색/.test(lowered)) hints.push("Search", "Grep");
  if (/fetch|web|docs|문서|공식/.test(lowered)) hints.push("SearchWeb", "FetchURL");
  if (/test|검증/.test(lowered)) hints.push("shell:test");
  return uniqueStrings(hints).slice(0, 8);
}

function inferHookHints(lowered: string): string[] {
  const hints: string[] = [];
  if (/userprompt|routing|triage|라우팅/.test(lowered)) hints.push("UserPromptSubmit");
  if (/subagent|worker|서브에이전트/.test(lowered)) hints.push("SubagentStop");
  if (/secret|보안|guard/.test(lowered)) hints.push("secret-guard");
  return uniqueStrings(hints).slice(0, 8);
}

function inferEnsembleVoters(lowered: string, primary: ActionAtomVerb, hints: { needsMcp: boolean; needsSkills: boolean; needsHooks: boolean }): string[] {
  const voters: string[] = [];
  if (/security|secret|보안/.test(lowered)) voters.push("security-evaluator");
  if (/test|검증|quality|품질/.test(lowered) || primary === "test") voters.push("test-evaluator");
  if (hints.needsMcp || /\bmcp\b|tool|도구|memory|browser|playwright|github|supabase|filesystem/u.test(lowered)) voters.push("capability-mcp");
  if (hints.needsHooks || /\bhook|hooks\b|가드|guard|stop-hook|userpromptsubmit/u.test(lowered)) voters.push("capability-hook");
  if (/review|audit|검토|리뷰|점검/.test(lowered) || primary === "review") voters.push("quality-assessor");
  if (/plan|design|architecture|설계|계획/.test(lowered) || primary === "plan") voters.push("progress-analyst");
  if (/risk|위험|rollback/.test(lowered)) voters.push("risk-evaluator");
  if (/resource|worker|utilization|병렬|parallel/.test(lowered)) voters.push("resource-optimizer");
  return uniqueStrings(voters).slice(0, 8);
}

function buildConfidence(primary: PrimaryAction, directives: IntentDirective[], redactionCount: number, keywordCount: number): IntentConfidence {
  const directiveScore = directives.length > 0 ? 0.95 : 0.7;
  const keywordScore = keywordCount >= 4 ? 0.9 : keywordCount >= 2 ? 0.75 : 0.55;
  const redactionPenalty = redactionCount > 0 ? 0.05 : 0;
  const overall = roundSimilarity(Math.max(0.1, Math.min(1, (primary.confidence + directiveScore + keywordScore) / 3 - redactionPenalty)));
  const notes: string[] = [];
  if (directives.length === 0) notes.push("no explicit directives detected");
  if (keywordCount < 2) notes.push("low keyword density");
  if (redactionCount > 0) notes.push("secret-like values redacted before parsing");
  return {
    overall,
    primaryAction: roundSimilarity(primary.confidence),
    directives: roundSimilarity(directiveScore),
    notes,
  };
}

function buildIntentDiagnostics(directives: IntentDirective[], confidence: IntentConfidence): IntentDiagnostic[] {
  const diagnostics: IntentDiagnostic[] = [];
  if (directives.length > 0) {
    diagnostics.push({ kind: "directive", message: "explicit directives extracted", count: directives.length });
  }
  if (confidence.overall < 0.6) {
    diagnostics.push({ kind: "low-confidence", message: "deterministic intent confidence is low; keep execution conservative" });
  }
  return diagnostics;
}

function buildActionAtoms(input: {
  primary: ActionAtomVerb;
  subject: string;
  constraints: string[];
  successCriteria: string[];
  expectedArtifacts: Array<{ name: string; path?: string }>;
  directives: IntentDirective[];
}): ActionAtom[] {
  const readOnly = input.directives.some((directive) => directive.kind === "read-only" || directive.kind === "no-edits");
  const atoms: ActionAtom[] = [
    makeActionAtom({
      id: "atom-bootstrap",
      label: "bootstrap",
      verb: "bootstrap",
      object: "runtime context",
      evidenceTarget: "state.json",
      doneCondition: "Run state and resource scopes are initialized",
      roleHint: "omk",
    }),
    makeActionAtom({
      id: "atom-plan",
      label: input.subject.includes("dag") ? "plan-intent-dag" : "plan-execution",
      verb: "plan",
      object: input.subject,
      evidenceTarget: "plan.md",
      doneCondition: "A scoped execution plan exists before worker delegation",
      roleHint: "planner",
    }),
  ];

  if (readOnly) {
    atoms.push(makeActionAtom({
      id: "atom-inspect",
      label: "inspect-read-only-scope",
      verb: "inspect",
      object: input.subject,
      evidenceTarget: "read-only findings",
      doneCondition: "Findings answer the request without file edits",
      roleHint: "explorer",
      source: "directive",
    }));
  } else if (input.primary === "research" || input.primary === "inspect") {
    atoms.push(makeActionAtom({
      id: "atom-inspect",
      label: "inspect-context",
      verb: "inspect",
      object: input.subject,
      evidenceTarget: "state.json",
      doneCondition: "Relevant context and evidence are mapped",
      roleHint: "explorer",
    }));
  } else if (input.primary === "test") {
    atoms.push(makeActionAtom({
      id: "atom-test",
      label: "test-scenario",
      verb: "test",
      object: input.subject,
      evidenceTarget: "test output",
      doneCondition: "Targeted regression tests prove the behavior",
      roleHint: "tester",
    }));
  } else if (input.primary === "document") {
    atoms.push(makeActionAtom({
      id: "atom-document",
      label: "document-result",
      verb: "document",
      object: input.subject,
      evidenceTarget: "docs",
      doneCondition: "Documentation reflects the verified behavior",
      roleHint: "researcher",
    }));
  } else if (input.primary === "plan") {
    atoms.push(makeActionAtom({
      id: "atom-design",
      label: "design-plan",
      verb: "plan",
      object: input.subject,
      evidenceTarget: "plan.md",
      doneCondition: "Design or architecture plan is concrete and testable",
      roleHint: "architect",
    }));
  } else {
    atoms.push(makeActionAtom({
      id: "atom-modify",
      label: "implement-change",
      verb: "modify",
      object: input.subject,
      evidenceTarget: "diff",
      doneCondition: "A minimal, scoped change implements the requested behavior",
      roleHint: "coder",
    }));
  }

  input.expectedArtifacts.forEach((artifact, index) => {
    atoms.push(makeActionAtom({
      id: `atom-artifact-${index + 1}`,
      label: "produce-artifact",
      verb: readOnly ? "document" : "modify",
      object: artifact.name,
      evidenceTarget: artifact.path ?? artifact.name,
      doneCondition: `Artifact ${artifact.name} exists or is summarized with evidence`,
      source: "artifact",
      roleHint: readOnly ? "researcher" : "coder",
    }));
  });

  input.directives.filter((directive) => directive.kind === "expected-output").forEach((directive, index) => {
    atoms.push(makeActionAtom({
      id: `atom-directive-output-${index + 1}`,
      label: "satisfy-expected-output",
      verb: readOnly ? "document" : "modify",
      object: directive.value,
      evidenceTarget: directive.value,
      doneCondition: "Explicit expected output directive is satisfied",
      source: "directive",
      roleHint: readOnly ? "researcher" : "coder",
    }));
  });

  atoms.push(makeActionAtom({
    id: "atom-verify",
    label: "verify-evidence",
    verb: "verify",
    object: input.successCriteria[0] ?? input.subject,
    evidenceTarget: "verification report",
    doneCondition: "Success criteria and quality gates are verified",
    roleHint: "reviewer",
  }));

  return dedupeAtoms(atoms);
}

function classifyPrimaryAction(value: string, directives: IntentDirective[] = []): PrimaryAction {
  const normalized = value.toLocaleLowerCase();
  if (directives.some((directive) => directive.kind === "read-only" || directive.kind === "no-edits")) {
    return { verb: "inspect", confidence: 0.95, matchedKeywords: ["read-only"] };
  }
  const rules: Array<{ verb: ActionAtomVerb; confidence: number; pattern: RegExp; keywords: string[] }> = [
    { verb: "test", confidence: 0.88, pattern: /(test|verify|validate|coverage|regression|테스트|검증)/u, keywords: ["test", "verify"] },
    { verb: "research", confidence: 0.84, pattern: /(research|investigate|compare|analyze|조사|분석|비교)/u, keywords: ["research", "analyze"] },
    { verb: "review", confidence: 0.84, pattern: /(review|audit|검토|리뷰|점검)/u, keywords: ["review", "audit"] },
    { verb: "document", confidence: 0.82, pattern: /(doc|readme|guide|문서|가이드)/u, keywords: ["doc"] },
    { verb: "inspect", confidence: 0.78, pattern: /(find|search|inspect|map|trace|탐색|검색|찾)/u, keywords: ["inspect"] },
    { verb: "plan", confidence: 0.8, pattern: /(plan|design|architecture|설계|계획)/u, keywords: ["plan", "design"] },
  ];
  for (const rule of rules) {
    if (rule.pattern.test(normalized)) return { verb: rule.verb, confidence: rule.confidence, matchedKeywords: rule.keywords };
  }
  return { verb: "modify", confidence: 0.68, matchedKeywords: [] };
}

function extractEntities(value: string, keywords: string[]): string[] {
  const explicit = Array.from(value.matchAll(/`([^`]{2,80})`/g), (match) => match[1]);
  const paths = Array.from(value.matchAll(/\b[\w.-]+\/[\w./-]+\b/g), (match) => match[0]);
  const commands = Array.from(value.matchAll(/\b(?:npm|pnpm|yarn|node|omk|kimi)\s+[\w:.-]+\b/g), (match) => match[0]);
  return uniqueStrings([...explicit, ...paths, ...commands, ...keywords.slice(0, 6)]).slice(0, 12);
}

function summarizeSubject(keywords: string[], entities: string[], directives: IntentDirective[]): string {
  const scoped = directives.find((directive) => directive.kind === "scope")?.value;
  if (scoped) return normalizeActionObject(scoped);
  const tokens = uniqueStrings([...entities, ...keywords])
    .filter((token) => token.length <= 40)
    .slice(0, 5);
  return tokens.length > 0 ? tokens.join(" ") : "requested outcome";
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeActionObject(value: string): string {
  const normalized = normalizeText(value);
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function normalizeAtomLabel(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "action";
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function dedupeDirectives(values: IntentDirective[]): IntentDirective[] {
  const seen = new Set<string>();
  const result: IntentDirective[] = [];
  for (const value of values) {
    const normalized = normalizeText(value.value);
    const key = `${value.kind}:${normalized}`;
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push({ ...value, value: normalized });
  }
  return result;
}

function dedupeAtoms(atoms: ActionAtom[]): ActionAtom[] {
  const seen = new Set<string>();
  return atoms.filter((atom) => {
    const key = `${atom.label}:${atom.evidenceTarget}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function textSimilarity(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    (normalizeText(value).toLocaleLowerCase().match(TOKEN_PATTERN) ?? [])
      .filter((token) => token.length > 1)
  );
}

function roundSimilarity(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function inferDominantActionAtomId(nodes: RunState["nodes"]): string | undefined {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const id = node.routing?.actionAtom?.id;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

function repeatedTargetCount(nodes: RunState["nodes"], targetAtomId: string | undefined): number {
  if (!targetAtomId) return 0;
  return nodes.filter((node) => node.routing?.actionAtom?.id === targetAtomId).length;
}
