interface OmkRuntimePresetBase {
  name: string;
  description: string;
  skills: string[];
  hooks: string[];
  mcpServers: string[];
  purpose: string;
}

export interface OmkCoreVerifiedPreset extends OmkRuntimePresetBase {
  id: "omk-core-verified";
}

export interface OmkTsProductPreset extends OmkRuntimePresetBase {
  id: "omk-ts-product";
}

export interface OmkWorktreeTeamPreset extends OmkRuntimePresetBase {
  id: "omk-worktree-team";
}

export interface OmkReleaseGuardPreset extends OmkRuntimePresetBase {
  id: "omk-release-guard";
}

export interface OmkParallelOrchestratorPreset extends OmkRuntimePresetBase {
  id: "omk-parallel-orchestrator";
}

export type OmkRuntimePreset =
  | OmkCoreVerifiedPreset
  | OmkTsProductPreset
  | OmkWorktreeTeamPreset
  | OmkReleaseGuardPreset
  | OmkParallelOrchestratorPreset;

export const OMK_TOP_PRIORITY_SKILLS = [
  "omk-context-broker",
  "omk-repo-explorer",
  "omk-industrial-control-loop",
  "omk-plan-first",
  "omk-quality-gate",
  "omk-test-debug-loop",
  "omk-code-review",
  "omk-security-review",
  "omk-secret-guard",
  "omk-typescript-strict",
  "omk-python-typing",
  "omk-worktree-team",
] as const;

export const OMK_CORE_VERIFIED_PRESET: OmkCoreVerifiedPreset = {
  id: "omk-core-verified",
  name: "OMK Core Verified",
  description: "Default safe execution loop for general coding, refactor, and debugging work.",
  skills: [
    "omk-repo-explorer",
    "omk-context-broker",
    "omk-industrial-control-loop",
    "omk-plan-first",
    "omk-quality-gate",
    "omk-test-debug-loop",
    "omk-code-review",
    "omk-secret-guard",
    "omk-python-typing",
  ],
  hooks: [
    "pre-shell-guard.sh",
    "protect-secrets.sh",
    "stop-verify.sh",
  ],
  mcpServers: [
    "omk-project",
  ],
  purpose: "Baseline conservative orchestration loop with project-local MCP, minimal hooks, and only the core skills needed for bounded planning, repo context, verification, and secret protection.",
};

export const OMK_TS_PRODUCT_PRESET: OmkTsProductPreset = {
  id: "omk-ts-product",
  name: "OMK TS Product",
  description: "High-efficiency preset for TypeScript, Next.js, NestJS, React, and product UI/API work.",
  skills: [
    "omk-typescript-strict",
    "matt-pocock-skills",
    "omk-backend-api-review",
    "omk-frontend-implementation",
    "omk-frontend-ui-review",
    "react-doctor",
    "omk-design-system",
  ],
  hooks: ["post-format.sh", "typecheck-after-edit.sh", "eslint-after-edit.sh", "stop-verify.sh"],
  mcpServers: ["context7", "playwright", "github", "omk-project"],
  purpose:
    "Strict TypeScript product loop for React/Next UI, Nest/API boundaries, DTO/domain/persistence separation, and UI verification.",
};

export const OMK_WORKTREE_TEAM_PRESET: OmkWorktreeTeamPreset = {
  id: "omk-worktree-team",
  name: "OMK Worktree Team",
  description: "Parallel worker-lane preset for isolated Git worktrees and merge-before-verify workflows.",
  skills: [
    "omk-worktree-team",
    "omk-task-router",
    "omk-context-broker",
    "omk-quality-gate",
    "omk-git-commit-pr",
  ],
  hooks: ["worktree-create-guard.sh", "subagent-stop-audit.sh", "branch-diff-snapshot.sh", "stop-verify.sh"],
  mcpServers: ["omk-project", "github", "memory", "filesystem-readonly"],
  purpose:
    "Coordinate isolated parallel worker lanes with branch snapshots, subagent audit, and merge-ready quality evidence.",
};

export const OMK_RELEASE_GUARD_PRESET: OmkReleaseGuardPreset = {
  id: "omk-release-guard",
  name: "OMK Release Guard",
  description: "Release and security preset for secret checks, destructive-shell guardrails, and publish evidence.",
  skills: [
    "omk-secret-guard",
    "omk-security-review",
    "omk-quality-gate",
    "omk-docs-release",
    "omk-git-commit-pr",
    "omk-research-verify",
  ],
  hooks: [
    "protect-secrets.sh",
    "pre-shell-guard.sh",
    "release-check-before-stop.sh",
    "npm-audit-summary.sh",
    "stop-verify.sh",
  ],
  mcpServers: ["github", "omk-project", "fetch", "context7"],
  purpose:
    "Guard release and security work with secret scanning, destructive-shell blocks, audit summaries, checklist evidence, and narrow MCP authority because reference MCP servers are advisory examples, not production-ready trust boundaries.",
};

export const OMK_PARALLEL_ORCHESTRATOR_PRESET: OmkParallelOrchestratorPreset = {
  id: "omk-parallel-orchestrator",
  name: "OMK Parallel Orchestrator",
  description: "Maximum parallelism preset for orchestrating multiple subagents with full MCP, skills, and hooks access.",
  skills: [
    "omk-repo-explorer",
    "omk-context-broker",
    "omk-industrial-control-loop",
    "omk-plan-first",
    "omk-quality-gate",
    "omk-code-review",
    "omk-test-debug-loop",
    "omk-python-typing",
    "omk-task-router",
    "multica",
    "agentmemory",
  ],
  hooks: [
    "pre-shell-guard.sh",
    "protect-secrets.sh",
    "stop-verify.sh",
    "subagent-stop-audit.sh",
    "post-format.sh",
  ],
  mcpServers: [
    "omk-project",
    "context7",
    "github",
    "fetch",
    "railway-unofficial",
    "supabase",
    "firecrawl",
    "puppeteer",
    "playwright",
    "pdf",
    "memory",
    "sequential-thinking",
    "filesystem-readonly",
    "git",
  ],
  purpose: "Maximum parallelism orchestration with all available MCP servers, skills, and hooks enabled for multi-agent coordination.",
};

export const OMK_RUNTIME_PRESETS: readonly OmkRuntimePreset[] = [
  OMK_CORE_VERIFIED_PRESET,
  OMK_PARALLEL_ORCHESTRATOR_PRESET,
  OMK_TS_PRODUCT_PRESET,
  OMK_WORKTREE_TEAM_PRESET,
  OMK_RELEASE_GUARD_PRESET,
];

const CORE_VERIFIED_INTENTS = new Set([
  "coding",
  "debugging",
  "refactor",
  "review",
  "test-generation",
]);

const TS_PRODUCT_INTENTS = new Set([
  "coding",
  "debugging",
  "refactor",
  "review",
  "test-generation",
  "planning",
]);

const WORKTREE_TEAM_INTENTS = new Set([
  "coding",
  "debugging",
  "refactor",
  "review",
  "test-generation",
  "planning",
]);

const RELEASE_GUARD_INTENTS = new Set([
  "coding",
  "documentation",
  "planning",
  "review",
  "shell-operation",
]);

const PARALLEL_ORCHESTRATOR_INTENTS = new Set([
  "coding",
  "debugging",
  "refactor",
  "review",
  "test-generation",
  "planning",
  "orchestration",
  "general",
]);

export function isParallelOrchestratorIntent(intent: string, text: string): boolean {
  if (!PARALLEL_ORCHESTRATOR_INTENTS.has(intent)) return false;
  return /parallel|worker(?:s)?|lane(?:s)?|multi[- ]?agent|subagent|orchestrat(?:e|ion)|team|coordinate|并发|병렬|并行|エージェント|協調/i.test(
    text
  );
}

export function isCoreVerifiedIntent(intent: string): boolean {
  return CORE_VERIFIED_INTENTS.has(intent);
}

export function isTsProductIntent(intent: string, text: string): boolean {
  if (!TS_PRODUCT_INTENTS.has(intent)) return false;
  return /typescript|\bts\b|tsx|next(?:\.js)?|nestjs?|\bnest\b|react|frontend|front-end|ui|component|accessibility|responsive|api|dto|domain|persistence|controller|service/i.test(
    text
  );
}

export function isWorktreeTeamIntent(intent: string, text: string): boolean {
  if (!WORKTREE_TEAM_INTENTS.has(intent)) return false;
  return /parallel|worker(?:s)?|lane(?:s)?|worktree|multi[- ]?agent|subagent|team|branch|merge|integrat(?:e|ion)|review[- ]?merge|isolated/i.test(
    text
  );
}

export function isReleaseGuardIntent(intent: string, text: string): boolean {
  if (!RELEASE_GUARD_INTENTS.has(intent)) return false;
  return /release|deploy|publish|version|changelog|tag|npm(?:\s+(?:publish|pack|audit|version))?|provenance|tarball|release[- ]?checklist|secret[- ]?leak|destructive[- ]?shell|security.*release|release.*security/i.test(
    text
  );
}
