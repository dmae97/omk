import type { OmkRuntimeScope } from "../../util/resource-profile.js";
import type { UserIntent } from "../../contracts/orchestration.js";
import type { IntentFrame } from "../../contracts/goal.js";
import type { ExecutionStrategy } from "../../contracts/orchestration.js";
import { renderActionDigest, buildIntentFrame } from "../../goal/intent-frame.js";
import { renderPromptDigest } from "../../goal/prompt-digest.js";


export function normalizeApprovalPolicy(
  value: string | undefined,
  _profile: string
): "interactive" | "auto" | "yolo" | "block" {
  const v = value?.trim().toLowerCase();
  if (v === "interactive" || v === "auto" || v === "yolo" || v === "block") return v;
  // Default: interactive for safety in parallel mode
  return "interactive";
}

export function buildPromptText(
  goal: string,
  runId: string,
  profile: string,
  workerCount: number,
  mcpScope: OmkRuntimeScope,
  intent?: UserIntent,
  intentFrame: IntentFrame = buildIntentFrame(goal),
  memorySummary?: string,
  executionStrategy: ExecutionStrategy = "parallel"
): string {
  const taskType = intent?.taskType ?? "general";
  const lines: string[] = [
    `# Primary provider DAG Execution Envelope`,
    ``,
    `Primary provider must transform the orchestration context into node-level action. Do not echo the prompt, restart completed work, or ask for generic continuation.`,
    ``,
    `## Strict Intent / Action Digest`,
    renderActionDigest(intentFrame),
    ``,
    `## Non-verbatim Source Digest`,
    renderPromptDigest("Execution envelope digest", goal, { maxKeywords: 18, maxPhrases: 3 }),
    `- raw prompt text: audit-only in run artifacts; not available for worker prompts.`,
    ``,
    `## Run Metadata`,
    `Run ID: ${runId}`,
    `Resource profile: ${profile}`,
    `Worker budget: ${workerCount}`,
    `MCP scope: ${mcpScope}`,
    `Execution strategy: ${executionStrategy}`,
    `Task type: ${taskType}`,
  ];

  if (memorySummary?.trim()) {
    lines.push(
      ``,
      `## Initial Memory Recall Summary`,
      memorySummary.trim().slice(0, 2_000),
    );
  }

  if (intent) {
    lines.push(
      `Complexity: ${intent.complexity}`,
      `Parallelizable: ${intent.parallelizable}`,
      `Required roles: ${intent.requiredRoles.join(", ")}`,
      `Read-only: ${intent.isReadOnly}`,
      ``
    );
  }

  if (executionStrategy === "sequential") {
    lines.push(
      `Execute the goal one by one with a single primary provider worker lane.`,
      `- The coordinator plans the next scoped action before execution.`,
      `- Do not spawn parallel subagent, DeepSeek, or capability fanout lanes.`,
      `- The reviewer verifies the sequential output before final reporting.`,
      `- Produce concrete evidence, changed files, and verification results.`
    );
  } else {
    lines.push(
      `Execute the goal using parallel agents.`,
      `- The coordinator plans and delegates.`,
      `- Workers execute scoped sub-tasks in parallel.`,
      `- The reviewer verifies and merges outputs.`,
      `- Produce concrete evidence, changed files, and verification results.`
    );
  }

  // Task-type specific guidance
  if (taskType === "explore" || taskType === "research") {
    lines.push(
      `- Each worker focuses on a distinct subsystem, module, or question.`,
      `- Synthesize findings across workers rather than editing code.`,
      `- Prefer read-only tools (Glob, Grep, ReadFile, SearchWeb).`
    );
  } else if (taskType === "bugfix") {
    lines.push(
      `- First worker reproduces the bug; others explore root causes in parallel.`,
      `- Fix must be minimal and include a regression test.`,
      `- Run quality gates after the fix to verify no new failures.`
    );
  } else if (taskType === "refactor") {
    lines.push(
      `- Preserve external behavior; run tests before and after.`,
      `- Each worker handles a distinct file group or abstraction layer.`,
      `- Coordinate interfaces between refactored boundaries.`
    );
  } else if (taskType === "review") {
    lines.push(
      `- Each worker audits a different dimension: correctness, security, maintainability.`,
      `- Cite specific lines and file paths for every finding.`,
      `- Rank issues by severity (critical / warning / suggestion).`
    );
  } else if (taskType === "test") {
    lines.push(
      `- Cover edge cases, failure paths, and happy paths in parallel.`,
      `- Verify test isolation and deterministic behavior.`,
      `- Report coverage delta explicitly.`
    );
  } else if (taskType === "security") {
    lines.push(
      `- Audit trust boundaries, secret handling, and input validation.`,
      `- Do NOT commit or expose any discovered secrets.`,
      `- Provide concrete remediation steps with file references.`
    );
  } else if (taskType === "implement") {
    lines.push(
      `- Follow existing code style and design conventions.`,
      `- Split work by component or file boundary when possible.`,
      `- Include tests and documentation for new surfaces.`
    );
  }

  lines.push(
    ``,
    `MEMORY RECALL (MANDATORY):`,
    `- Before planning, the coordinator MUST read memory-recall-summary.md and call omk_memory_mindmap or omk_search_memory when more detail is needed.`,
    `- Workers MUST only use skills and MCP servers relevant to their assigned role.`,
    ``,
    `SKILLS & MCP USAGE (MANDATORY):`,
    `- Activate relevant skills from the routing hints for each node.`,
    mcpScope === "none"
      ? `- MCP scope is none for this run: do not launch MCP servers; rely on local tools and skills/hooks.`
      : mcpScope === "project"
        ? `- MCP scope is project for this run: use only project-local/builtin MCP servers such as omk-project.`
        : `- MCP scope is all for this run: global and project MCP servers may be available; never expose secrets or raw config.`,
    `- Prefer omk-project MCP tools for checkpoint, memory, and run-state operations when MCP is enabled.`,
    `- Use SearchWeb / FetchURL for external docs, official APIs, or citations.`
  );

  return lines.join("\n");
}

export function buildDeepSeekPromptPrefix(
  goalContext: string,
  runId: string,
  workerCount: number,
  intent?: UserIntent,
  intentFrame: IntentFrame = buildIntentFrame(goalContext)
): string {
  const taskType = intent?.taskType ?? "general";
  const lines = [
    `OMK DeepSeek model-agent worker.`,
    `Initial primary provider orchestration may spawn dedicated DeepSeek Flash/Pro read-only agents; opportunistic routing may also offload low-risk workers.`,
    `Direct mode is read-only. For file-affecting advisory mode, propose patch strategy only; Authority provider owns actual edits, merge authority, and final synthesis.`,
    `Do not repeat or restart the user's original goal. Read the current primary provider / goal context below and answer only for the assigned DAG node.`,
    ``,
    `## Current Run Context`,
    `- Run ID: ${runId}`,
    `- Worker budget: ${workerCount}`,
    `- Task type: ${taskType}`,
  ];

  if (intent) {
    lines.push(
      `- Complexity: ${intent.complexity}`,
      `- Parallelizable: ${intent.parallelizable}`,
      `- Required roles: ${intent.requiredRoles.join(", ")}`,
      `- Read-only intent: ${intent.isReadOnly}`,
      `- Rationale: ${intent.rationale}`
    );
  }

  lines.push(
    ``,
    `## Current Primary Provider Goal Action Digest`,
    renderActionDigest(intentFrame, { maxAtoms: 6 }),
    ``,
    `## Non-verbatim Context Digest`,
    renderPromptDigest("DeepSeek context digest", goalContext, { maxKeywords: 12, maxPhrases: 2 }),
    `- raw prompt text: unavailable to DeepSeek/model-advisory lanes.`
  );

  return lines.join("\n");
}
