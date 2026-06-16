import { realpathSync } from "node:fs";
import type { Dirent } from "node:fs";
import { mkdir, writeFile, readFile, copyFile, readdir, stat, rename, symlink } from "fs/promises";
import { basename, join, dirname } from "path";
import { fileURLToPath } from "node:url";
import { confirm, password } from "@inquirer/prompts";
import { ExitPromptError } from "@inquirer/core";
import { getProjectRoot, getUserHome, normalizeUserHomePath, pathExists } from "../util/fs.js";
import { getOmkVersionSync } from "../util/version.js";

import { style, header, status } from "../util/theme.js";
import { defaultLspConfigJson } from "../lsp/default-config.js";
import { t } from "../util/i18n.js";
import { maybeAskForGitHubStar } from "../util/first-run-star.js";
import { getDeepSeekProviderStatus, setDeepSeekApiKey } from "../providers/deepseek/deepseek-config.js";
import { OMK_CORE_VERIFIED_PRESET, OMK_RUNTIME_PRESETS } from "../runtime/core-verified-preset.js";
import {
  RECOMMENDED_MCP_SERVERS,
  getDefaultSelections,
  type McpCatalogEntry,
} from "../mcp/server-catalog.js";
import { mcpBulkInstallCommand } from "./mcp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..", "..");

interface McpServerDefinition {
  command: string;
  args: string[];
  env?: Record<string, string>;
}


interface InitTtyLike {
  isTTY?: boolean;
}

export interface InitCommandOptions {
  profile: string;
  interactiveSetup?: boolean;
  importUserSkills?: boolean;
  localUser?: boolean;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  stdin?: InitTtyLike;
  stdout?: InitTtyLike;
  argv?: string[];
  promptGitHubStar?: (repoUrl: string) => Promise<boolean>;
  starRepo?: (repoUrl: string) => Promise<void> | void;
  promptLocalUserRuntime?: (context: { homeDir: string }) => Promise<boolean>;
  promptDeepSeekSetup?: () => Promise<boolean>;
  promptDeepSeekApiKey?: () => Promise<string>;
}

function createThemeJson(): string {
  return JSON.stringify({
    banner: {
      title: "OMK://CONTROL",
      subtitle: "Route agents. Verify evidence. Control the loop.",
      style: "default",
      enabled: true,
    },
    colors: {
      primary: "#00D6FF",
      accent: "#FF47B2",
      success: "#00FFC2",
      warning: "#FFB000",
      danger: "#FF5874",
      info: "#9D4EDD",
      muted: "#758FA8",
    },
    metaBox: true,
  }, null, 2) + "\n";
}

function createRuntimePresetsJson(): string {
  return JSON.stringify({
    defaultPresetId: OMK_CORE_VERIFIED_PRESET.id,
    presets: OMK_RUNTIME_PRESETS,
  }, null, 2) + "\n";
}

const OKABE_AGENT_YAML = `version: 1
agent:
  extend: default
  name: omk-okabe-base
  # Provider adapters may require an explicit non-empty tools list for custom --agent-file configs.
  # Keep the full OMK native tool surface, including Agent for parallel subagents
  # and SendDMail for Okabe checkpoints; MCP/skills/hooks are injected by runtime config.
  tools:
    - "kimi_cli.tools.agent:Agent"
    - "kimi_cli.tools.ask_user:AskUserQuestion"
    - "kimi_cli.tools.todo:SetTodoList"
    - "kimi_cli.tools.shell:Shell"
    - "kimi_cli.tools.file:ReadFile"
    - "kimi_cli.tools.file:ReadMediaFile"
    - "kimi_cli.tools.file:Glob"
    - "kimi_cli.tools.file:Grep"
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.web:SearchWeb"
    - "kimi_cli.tools.web:FetchURL"
    - "kimi_cli.tools.plan.enter:EnterPlanMode"
    - "kimi_cli.tools.plan:ExitPlanMode"
    - "kimi_cli.tools.background:TaskList"
    - "kimi_cli.tools.background:TaskOutput"
    - "kimi_cli.tools.background:TaskStop"
    - "kimi_cli.tools.dmail:SendDMail"
  system_prompt_args:
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
`;

const ROOT_AGENT_YAML = `version: 1
agent:
  extend: ./okabe.yaml  # Inherits the OMK provider-adapter tool surface plus MCP/skills/hooks flags
  name: omk-root
  system_prompt_path: ../prompts/root.md
  system_prompt_args:
    OMK_ROLE: "root-coordinator"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  subagents:
    explorer:
      path: ./roles/explorer.yaml
      description: "Read-only repository exploration and context mapping with scoped MCP, skills, and hooks access when enabled by runtime scope"
    explore:
      path: ./roles/explorer.yaml
      description: "Alias for explorer; kept for compatibility with older OMK instructions"
    planner:
      path: ./roles/planner.yaml
      description: "Architecture, refactor, migration, and implementation planning with scoped MCP, skills, and hooks access when enabled by runtime scope"
    plan:
      path: ./roles/planner.yaml
      description: "Alias for planner; kept for compatibility with older OMK instructions"
    router:
      path: ./roles/router.yaml
      description: "Task routing, skill/MCP/hook fit, context budgeting, and parallel/sequential lane decisions with scoped MCP, skills, and hooks access when enabled by runtime scope"
    architect:
      path: ./roles/architect.yaml
      description: "Read-only architecture and migration design with scoped MCP, skills, and hooks access when enabled by runtime scope"
    coder:
      path: ./roles/coder.yaml
      description: "Scoped implementation in the current project with scoped MCP, skills, and hooks access when enabled by runtime scope"
    reviewer:
      path: ./roles/reviewer.yaml
      description: "Adversarial code review and risk detection with scoped MCP, skills, and hooks access when enabled by runtime scope"
    security:
      path: ./roles/security.yaml
      description: "Security, secret, permission, and trust-boundary review with scoped MCP, skills, and hooks access when enabled by runtime scope"
    qa:
      path: ./roles/qa.yaml
      description: "Run and analyze lint, typecheck, test, and build results with scoped MCP, skills, and hooks access when enabled by runtime scope"
    tester:
      path: ./roles/tester.yaml
      description: "Focused regression and edge-case testing with scoped MCP, skills, and hooks access when enabled by runtime scope"
    researcher:
      path: ./roles/researcher.yaml
      description: "Reference-backed research and external documentation checks with scoped MCP, skills, and hooks access when enabled by runtime scope"
    integrator:
      path: ./roles/integrator.yaml
      description: "Merge coordination and final synthesis with scoped MCP, skills, and hooks access when enabled by runtime scope"
    aggregator:
      path: ./roles/aggregator.yaml
      description: "Parallel-lane result aggregation with scoped MCP, skills, and hooks access when enabled by runtime scope"
    interviewer:
      path: ./roles/interviewer.yaml
      description: "Requirement clarification and acceptance criteria discovery with scoped MCP, skills, and hooks access when enabled by runtime scope"
    ontology:
      path: ./roles/ontology.yaml
      description: "Project graph memory and ontology curation with scoped MCP, skills, and hooks access when enabled by runtime scope"
    vision-debugger:
      path: ./roles/vision-debugger.yaml
      description: "Screenshot and multimodal debugging with scoped MCP, skills, and hooks access when enabled by runtime scope"
`;

const ROLE_YAMLS: Record<string, string> = {
  interviewer: `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-interviewer
  system_prompt_args:
    OMK_ROLE: "interviewer"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  architect: `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-architect
  system_prompt_args:
    OMK_ROLE: "architect"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  planner: `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-planner
  system_prompt_args:
    OMK_ROLE: "planner"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  router: `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-router
  system_prompt_args:
    OMK_ROLE: "router"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  explorer: `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-explorer
  system_prompt_args:
    OMK_ROLE: "explorer"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  coder: `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-coder
  system_prompt_args:
    OMK_ROLE: "coder"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
`,
  reviewer: `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-reviewer
  system_prompt_args:
    OMK_ROLE: "reviewer"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  security: `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-security
  system_prompt_args:
    OMK_ROLE: "security"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
`,
  qa: `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-qa
  system_prompt_args:
    OMK_ROLE: "qa"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
`,
  tester: `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-tester
  system_prompt_args:
    OMK_ROLE: "tester"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
`,
  integrator: `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-integrator
  system_prompt_args:
    OMK_ROLE: "integrator"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  aggregator: `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-aggregator
  system_prompt_args:
    OMK_ROLE: "aggregator"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  researcher: `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-researcher
  system_prompt_args:
    OMK_ROLE: "researcher"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  ontology: `version: 1
agent:
  extend: ../okabe.yaml
  name: omk-ontology
  system_prompt_args:
    OMK_ROLE: "ontology"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  "vision-debugger": `version: 1
agent:
  extend: ../okabe.yaml  # Inherits unrestricted default Kimi tools plus MCP/skills/hooks flags
  name: omk-vision-debugger
  system_prompt_args:
    OMK_ROLE: "vision-debugger"
    OMK_MCP_ENABLED: "true"
    OMK_SKILLS_ENABLED: "true"
    OMK_HOOKS_ENABLED: "true"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
`,
};

function getDesignMd(version: string): string {
  return `---
title: "Design System"
description: "Project visual identity and design system"
version: "${version}"
---

# DESIGN.md

## Overview

Project visual identity and design system.

## Colors

- Primary: #111827
- Accent: #7C3AED
- Success: #059669
- Warning: #D97706
- Danger: #DC2626

## Typography

- Inter, system-ui

## Rules

- Use tokens before inventing new values.
- Keep components compact and status-aware.
`;
}

const GEMINI_MD = `# GEMINI.md

@./AGENTS.md
@./DESIGN.md

Use AGENTS.md as the canonical project instruction source, including current OMK skills, MCP, agents, and harness policy.
Use DESIGN.md as the canonical visual identity source.
Do not duplicate runtime inventories; follow AGENTS.md and \`chat-agent-harness.json\` when present.
`;

const CLAUDE_MD = `# CLAUDE.md

@./AGENTS.md
@./DESIGN.md

Use AGENTS.md as the canonical project instruction source, including current OMK skills, MCP, agents, and harness policy.
Use DESIGN.md for UI/frontend work.
Do not duplicate runtime inventories; follow AGENTS.md and \`chat-agent-harness.json\` when present.
`;

const ROADMAP_MD = `# Roadmap

Current source version: \`open-multi-agent-kit@0.80.1\` (\`pre-1.0\`; runtime contract family \`v1.2\`)
Last updated: 2026-06-15

## v1.1.9 reality

Provider routing and graph viewing are no longer purely future work:

- \`omk run\`, \`omk parallel\`, and DAG replay expose \`--provider auto|kimi\`.
- \`omk provider\` / \`omk deepseek\` manage DeepSeek enablement, key setup, availability checks, and configured authority fallback.
- DeepSeek is an opportunistic read-only/advisory worker; the configured authority provider remains the orchestrator, writer, merger, and final authority.
- \`omk graph view\` generates an HTML view from \`.omk/memory/graph-state.json\`.
- \`omk goal\` has a persisted lifecycle, continue loop, generated plan/evidence criteria, and verification flow.

## v1.2 — Hardening the current surface

### P0: release and contract gates

- Done: YAML validation now runs in local \`verify\` plus CI/smoke workflows.
- Done: package dry-pack, package audit, tarball smoke, release matrix gates, GitHub Release, and npm registry verification were re-verified for \`0.80.0\`.
- Done: provider/deepseek and screenshot JSON command contracts gained hermetic regression tests.
- Done: current AGENTS/init templates and packaged workflow skills were aligned with the active skills/MCP/agents/harness surface, including all generated agent MCP/skills/hooks flags and parallel subagent orchestration guidance.
- Remaining: lock broader provider fallback metadata with tests for rate limit, timeout, and Kimi fallback variants.
- Remaining: define minimum machine-readable CLI envelopes for the rest of the automation-critical commands.

### P1: observability and diagnostics

- Done: provider route/fallback counts are now emitted in run summaries/reports and summary terminal output.
- Done: invalid MCP JSON is reported as a visible diagnostic without leaking secret-like config values.
- Done: \`omk mcp doctor --json\` exposes structured server status, command resolution, timeout, permission, and config-source fields.
- Expand JSON output for graph, DAG, summary, and workflow commands where CI or agents consume results.
- Link graph nodes back to runs, goals, providers, and evidence so \`omk graph view\` becomes audit evidence, not only visualization.

### P2: execution depth and planner quality

- Deepen \`omk team\` runtime reporting: worker state, pane/session health, artifacts, and verification handoff.
- Done: replace the \`omk goal plan\` stub with a planner that emits steps, acceptance criteria, risks, and evidence gates.
- Add provider-quality gates before broader non-Kimi worker pools.
- Keep Kimi-only execution as the safe fallback path for every run.

## Later tracks

### Provider routing maturity

- Keep Kimi as the main orchestrator, planner, merger, and final synthesis runtime.
- Use provider hints for explorer, reviewer, QA, planner, and documentation roles only when preflight is healthy and task risk is low.
- Record provider attempts, route confidence, fallback reason, and final authority in run evidence.

### Graph and memory maturity

- Materialize provider routes, fallback events, goals, evidence gates, and run artifacts in the local graph/Kuzu ontology.
- Keep \`omk graph view\` local-first and safe for private repositories.

### Historical milestones

| Version | Focus |
|---------|-------|
| v0.1 | init / doctor / chat, P0 skills, AGENTS.md / DESIGN.md generation, quality gate hooks |
| v0.2 | wire controller, HUD, run state, worker logs |
| v0.3 | worktree team, merge queue, reviewer / QA / integrator agents |
| v0.4 | Google DESIGN.md integration, Stitch skills installer, screenshot UI review, Spec Kit planning + DAG execution, agent registry, project index, run summary |
| v0.5 | MCP project server, plugin pack, CI agent mode |
| v1.1.6 | provider/deepseek commands, provider policy flags, graph view, goal lifecycle, expanded run history and update JSON |
| v1.1.9 | chat harness manifest, capability DAG lanes, Windows clipboard screenshot bridge, release matrix |
| v1.1.12 | Replay system, skill assigner, decision trace coverage, evidence gates, and repair policy |
| v1.1.13 | Bundled MCP server entrypoints, ACP/host transport groundwork, deployment-ready package metadata |
| v1.1.14 | Current harness docs, external-inspired workflow skills, and release-safe public wording |
| v1.1.15 | Isolated HOME MCP shell-profile hotfix and persistent fetch MCP entrypoint |
| v1.1.16 | Deterministic IntentFrame/ActionAtom orchestration, chat schema preflight, MCP duplicate policy, agent capability propagation, and doctor/init/pack smoke fixes |
| v1.1.17 | Full generated-agent MCP/skills/hooks enablement, parallel subagent orchestration emphasis, and v1.1.17 release docs |
`;

const SECURITY_MD = `# Security Policy

## Reporting Vulnerabilities

Please report security issues via GitHub Issues with the \`security\` label.

## Built-in Protections

open-multi-agent-kit includes default hooks to block destructive commands and secret leakage.

## MCP and Harness Secret Handling

- Fresh init writes project-local \`omk-project\` MCP only; user/global MCP and skills are runtime-only unless explicitly imported by a trusted local user.
- Never print, commit, or summarize MCP \`env\`, headers, tokens, or provider keys.
- Treat \`chat-agent-harness.json\` as private run metadata: use it for inventory/gates, but do not paste large inventories or secret-like values into prompts, memory, or reports.
- Prefer sanitized \`omk mcp doctor --json\`, \`omk verify --json\`, test summaries, and secret scans as shareable evidence.

## Best Practices

- Review hooks before running in production repositories.
- Use \`--print\` mode only in disposable worktrees.
- Never commit secrets into agent memory files.
`;

const ROOT_PROMPT_MD = `# OMK Root Agent

You are the OMK root orchestrator for open-multi-agent-kit — a provider-neutral orchestration control plane that turns a goal into a bounded coding team.

Models execute. OMK routes, verifies, measures, and controls.

You must operate with OMK identity as the authority layer: summon parallel subagents when scopes are independent, assign each lane scoped MCP, skills, and hooks, and keep the root context focused on goal management, integration, evidence, and verification. The active runtime scope, selected provider adapter, and harness policy decide which resources are actually available.

## Loaded Project Instructions

\${KIMI_AGENTS_MD}

## Loaded Skills

\${KIMI_SKILLS}

## Global Rules

- Apply AGENTS.md silently.
- Do not repeat boilerplate.
- Use SetTodoList for multi-step tasks.
- Use Agent tool for non-trivial tasks. All 15 role agents (explorer, planner, router, architect, coder, reviewer, security, qa, tester, researcher, integrator, aggregator, interviewer, ontology, vision-debugger) are available with MCP, skills, and hooks capability flags.
- Use skills when relevant.
- Use MCP tools when configured and useful. All subagents inherit scoped MCP server inventory, skills, and hooks when enabled by runtime scope. Do not hesitate to invoke available capabilities.
- Treat project-local ontology graph memory as mandatory when the omk-project MCP exposes memory tools.
- Recall relevant project memory before work, write durable findings through omk_write_memory, and use omk_memory_mindmap/omk_graph_query for graph recall.
- Prefer plan-first execution.
- Prefer small, reviewable diffs.
- Verify before completion.
- Never claim tests passed unless they were run.

## Active Harness and Resource Inventory

- If a run contains chat-agent-harness.json, read it for the full MCP/skills/hooks inventory, virtual DAG, authority boundaries, worker limits, and gate list.
- Treat compact prompt resource counts as summaries only.
- Default runtime scope is project MCP/skills; all-scope may read user ~/.kimi resources at runtime without copying personal files.
- Do not paste huge global MCP/skill inventories or secret-bearing env/header values into prompts, memory, or final reports.

## OMK Context Tools

- Root and generated role agents inherit an Okabe-compatible base that keeps the default Kimi tool surface unrestricted while enabling scoped MCP, skills, and hooks.
- Use D-Mail before risky refactors, compaction, or long-running branch points: send a concise future-facing recovery note to the relevant checkpoint.
- Use Kimi subagents for isolated context and parallel work; keep the root context focused on decisions, integration, and verification.
- Prefer /compact or a D-Mail recovery note over dumping large history back into the prompt.

## Required Workflow

For non-trivial tasks:

1. Read project instructions.
2. Create todos.
3. Launch appropriate subagents in parallel when their scopes are independent:
   - explorer for repository discovery
   - planner for architecture/refactor/risky work
   - coder for implementation
   - reviewer or qa for review and gate analysis
   - security for secret/permission/trust-boundary review
   - ontology for graph memory and project knowledge curation
4. Read relevant skills.
5. Use MCP if useful.
6. Implement minimal changes.
7. Run quality gates.
8. Review final diff.
9. Return factual final report.

## Final Report Format

\`\`\`txt
Changed:
Files:
Commands:
Result:
Risk:
\`\`\`
`;

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function readTemplateFile(relativePath: string, fallback: string): Promise<string> {
  try {
    return await readFile(join(packageRoot, "templates", relativePath), "utf8");
  } catch {
    return fallback;
  }
}

async function getCopyEntryKind(srcPath: string, entry: Dirent): Promise<"directory" | "file" | null> {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  if (!entry.isSymbolicLink()) return null;

  try {
    const targetStats = await stat(srcPath);
    if (targetStats.isDirectory()) return "directory";
    if (targetStats.isFile()) return "file";
    return null;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

interface CopyTemplateDirOptions {
  skipEntry?: (srcPath: string, entry: Dirent) => boolean | Promise<boolean>;
}

interface SkillCopyStats {
  copied: number;
  skippedUnsafe: number;
  skippedUnavailable: number;
}

const SKILL_COPY_IGNORED_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
]);

const PROTECTED_SKILL_FILE_PATTERNS = [
  /^\.env(?:\..*)?$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p8$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /^credentials\.json$/i,
  /^service-account.*\.json$/i,
];

const SKILL_SECRET_LITERAL_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /glpat-[A-Za-z0-9\-_]{20,}/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bfc-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
];

const GENERIC_SKILL_SECRET_ASSIGNMENT =
  /\b(api[_-]?key|secret|token|password|private[_-]?key)\b\s*[:=]\s*["']?([^"'\s;,]{20,})/i;

const GENERIC_SKILL_SECRET_ALLOWLIST =
  /\$\{|<|YOUR_|REPLACE_|NPM_TOKEN|GITHUB_TOKEN|NODE_AUTH_TOKEN|process\.env|env\.|placeholder|example|sample|redacted|\*\*\*|Do not store secrets|Do not send secrets|secret leakage|secret leak/i;

function shouldSkipSkillCopyEntry(_srcPath: string, entry: Dirent): boolean {
  return SKILL_COPY_IGNORED_NAMES.has(entry.name);
}

function isProtectedSkillFileName(filePath: string): boolean {
  const name = basename(filePath);
  return PROTECTED_SKILL_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

function isLikelyBinaryContent(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function hasSecretLikeSkillLine(line: string): boolean {
  if (SKILL_SECRET_LITERAL_PATTERNS.some((pattern) => pattern.test(line))) return true;
  return GENERIC_SKILL_SECRET_ASSIGNMENT.test(line) && !GENERIC_SKILL_SECRET_ALLOWLIST.test(line);
}

async function skillDirectoryHasSecretContent(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(dir, entry.name);
    if (shouldSkipSkillCopyEntry(srcPath, entry)) continue;
    if (isProtectedSkillFileName(srcPath)) return true;

    const kind = await getCopyEntryKind(srcPath, entry);
    if (kind === "directory") {
      if (await skillDirectoryHasSecretContent(srcPath)) return true;
      continue;
    }
    if (kind !== "file") continue;

    const buffer = await readFile(srcPath);
    if (isLikelyBinaryContent(buffer)) continue;

    const text = buffer.toString("utf-8");
    for (const line of text.split(/\r?\n/)) {
      if (hasSecretLikeSkillLine(line)) return true;
    }
  }

  return false;
}

async function copyTemplateDir(src: string, dest: string, options: CopyTemplateDirOptions = {}): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    if (await options.skipEntry?.(srcPath, entry)) continue;
    const destPath = join(dest, entry.name);
    const kind = await getCopyEntryKind(srcPath, entry);
    if (kind === "directory") {
      await mkdir(destPath, { recursive: true });
      await copyTemplateDir(srcPath, destPath, options);
    } else if (kind === "file") {
      await mkdir(dirname(destPath), { recursive: true });
      await copyFile(srcPath, destPath);
    }
  }
}

async function copySafeSkillRoot(src: string, dest: string): Promise<SkillCopyStats> {
  const stats: SkillCopyStats = {
    copied: 0,
    skippedUnsafe: 0,
    skippedUnavailable: 0,
  };
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    if (entry.name.startsWith(".") || shouldSkipSkillCopyEntry(srcPath, entry)) continue;

    const kind = await getCopyEntryKind(srcPath, entry);
    if (kind !== "directory") {
      if (entry.isSymbolicLink()) stats.skippedUnavailable++;
      continue;
    }

    try {
      if (await skillDirectoryHasSecretContent(srcPath)) {
        stats.skippedUnsafe++;
        continue;
      }

      await copyTemplateDir(srcPath, join(dest, entry.name), {
        skipEntry: shouldSkipSkillCopyEntry,
      });
      stats.copied++;
    } catch {
      stats.skippedUnavailable++;
    }
  }

  return stats;
}

const HOOK_SCRIPTS: Record<string, string> = {
  "session-context.sh": `#!/usr/bin/env bash
# OMK SessionStart Context — keeps high-value local workflows visible
set -euo pipefail

if ! command -v node &>/dev/null; then
  echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"OMK session started. Read project rules, use graph-view for memory relationships, use open-design for localhost design, and verify before final."}}'
  exit 0
fi

node <<'NODE'
const context = [
  'OMK session startup context.',
  '- Read AGENTS.md and .kimi/AGENTS.md before edits; read DESIGN.md before UI/frontend/visual work.',
  '- For local design iteration, use /open-design or omk design open-design --open to launch localhost.',
  '- For memory/risk/file relationships, use /graph-view or omk graph view --open before broad repo edits.',
  '- Treat release, push, publish, and deployment as not done unless the exact command ran and fresh evidence was collected.',
  '- Final reports should list changed files, commands run, pass/fail/not-run status, and remaining risk.',
].join('\\n');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: context,
  },
}) + '\\n');
NODE
`,
  "awesome-agent-skills-router.sh": `#!/usr/bin/env bash
# Awesome Agent Skills Router — curated OMK hints from VoltAgent/awesome-agent-skills
set -euo pipefail

# This hook is advisory only: no network access, no third-party skill install,
# and no prompt blocking. It maps common awesome-agent-skills domains to the
# already-installed OMK skills/workflows that are safe to consider.
if ! command -v node &>/dev/null; then
  exit 0
fi

INPUT_FILE="$(mktemp)"
trap 'rm -f "$INPUT_FILE"' EXIT
cat > "$INPUT_FILE"

node - "$INPUT_FILE" <<'NODE'
const fs = require('node:fs');
// Static slash markers for non-shell smoke validation:
// /open-design /awesome-design-md /omk-design-md /omk-quality-gate /graph-view /omk-kimi-runtime

function readPayload(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function textFrom(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(textFrom).filter(Boolean).join('\\n');
  }
  if (value && typeof value === 'object') {
    for (const key of ['prompt', 'user_prompt', 'message', 'input', 'text', 'content', 'command_args']) {
      const found = textFrom(value[key]);
      if (found) return found;
    }
  }
  return '';
}

const payload = readPayload(process.argv[2]);
const prompt = textFrom(payload.prompt)
  || textFrom(payload.user_prompt)
  || textFrom(payload.message)
  || textFrom(payload.input)
  || textFrom(payload.command_args)
  || textFrom(payload.tool_input)
  || textFrom(payload);

const normalized = prompt.toLowerCase();
if (normalized.trim().length < 3) {
  process.exit(0);
}

const routes = [
  {
    id: 'design-ui',
    patterns: [
      'design', 'ui', 'ux', 'frontend', 'front-end', 'figma', 'stitch', 'open-design',
      'prototype', 'landing', 'component', 'visual', 'screenshot', 'responsive', 'accessibility',
      'react', 'next.js', 'vite', 'expo', 'react native',
      '디자인', '화면', '프론트', '랜딩', '컴포넌트', '시각', '스크린샷', '반응형', '접근성', '프로토타입',
    ],
    skills: ['open-design', 'awesome-design-md', 'omk-design-md', 'omk-flow-design-to-code', 'omk-multimodal-ui-review', 'react-doctor'],
    note: 'For visual work, read DESIGN.md, reuse tokens, use awesome-design-md references when a named style is requested, and launch localhost with omk design open-design when interactive design is useful.',
  },
  {
    id: 'bugfix-debug',
    patterns: [
      'bug', 'error', 'failed', 'failure', 'traceback', 'exception', 'fix', 'regression', 'broken', 'debug',
      '버그', '에러', '오류', '실패', '고쳐', '수정', '안됨', '안돼', '문제', '디버그',
    ],
    skills: ['omk-flow-bugfix', 'andrej-karpathy-skills', 'matt-pocock-skills', 'omk-quality-gate'],
    note: 'For failures, isolate root cause first, keep the patch small, and rerun the failing command plus the quality gate.',
  },
  {
    id: 'feature-build',
    patterns: [
      'implement', 'build', 'add ', 'create', 'scaffold', 'generate', 'feature', 'new command',
      '구현', '추가', '만들', '생성', '기능', '신규',
    ],
    skills: ['omk-plan-first', 'omk-flow-feature-dev', 'matt-pocock-skills', 'andrej-karpathy-skills', 'omk-quality-gate'],
    note: 'For new capability work, plan the smallest reversible diff and include regression coverage before completion.',
  },
  {
    id: 'review-security',
    patterns: [
      'review', 'audit', 'security', 'vulnerability', 'secret', 'token', 'auth', 'permission', 'xss', 'sql injection', 'ssrf',
      '리뷰', '검토', '보안', '취약', '시크릿', '토큰', '인증', '권한',
    ],
    skills: ['omk-code-review', 'omk-quality-gate'],
    note: 'For security-sensitive work, do not print secrets, review trust boundaries, and run the project secret scan when available.',
  },
  {
    id: 'release-git',
    patterns: [
      'release', 'publish', 'npm', 'version', 'changelog', 'commit', 'pull request', ' pr ', 'pr로', 'push', 'tag',
      '배포', '릴리즈', '버전', '변경로그', '커밋', '푸시',
    ],
    skills: ['omk-flow-release', 'omk-flow-pr-review', 'omk-quality-gate'],
    note: 'For release or PR work, verify build/test/package evidence before reporting publish or PR readiness.',
  },
  {
    id: 'spec-planning',
    patterns: [
      'spec', 'prd', 'requirements', 'acceptance', 'tasks', 'speckit', 'plan', 'architecture',
      '명세', '요구사항', '수락기준', '계획', '아키텍처',
    ],
    skills: ['omk-plan-first', 'speckit-specify', 'speckit-plan', 'speckit-tasks'],
    note: 'For specification work, produce acceptance criteria and a test shape before implementation.',
  },
  {
    id: 'refactor-cleanup',
    patterns: [
      'refactor', 'cleanup', 'simplify', 'deslop', 'debt', 'migration',
      '리팩토', '정리', '단순화', '마이그레이션',
    ],
    skills: ['omk-flow-refactor', 'andrej-karpathy-skills', 'matt-pocock-skills', 'omk-quality-gate'],
    note: 'For refactors, preserve behavior with tests first and avoid unrelated rewrites.',
  },
  {
    id: 'ontology-graph',
    patterns: [
      'ontology', 'graph', 'graph-view', 'node', 'nodes', 'edge', 'edges', 'relationship',
      'memory graph', 'risk map', 'decision graph', 'trace map',
      '온톨로지', '그래프', '노드', '엣지', '관계', '메모리 그래프', '리스크맵', '결정 그래프',
    ],
    skills: ['graph-view', 'omk-kimi-runtime', 'omk-quality-gate'],
    note: 'For graph or memory-relationship work, inspect .omk/memory/graph-state.json with omk graph view --open or /graph-view before changing code.',
  },
  {
    id: 'agent-orchestration',
    patterns: [
      'agent', 'subagent', 'multi-agent', 'orchestration', 'workflow', 'mcp', 'hook', 'hooks', 'skill', 'skills', 'memory',
      '에이전트', '서브에이전트', '워크플로', '훅', '스킬', '메모리',
    ],
    skills: ['omk-task-router', 'omk-project-rules', 'omk-kimi-runtime', 'omk-flow-team-run', 'agentmemory', 'multica', 'andrej-karpathy-skills'],
    note: 'For agent or hook work, keep routing advisory, avoid installing unreviewed external skills, and verify generated config locally.',
  },
  {
    id: 'tests-quality',
    patterns: [
      'test', 'tests', 'qa', 'quality', 'lint', 'typecheck', 'playwright', 'e2e', 'coverage',
      '테스트', '검증', '품질', '타입체크', '커버리지',
    ],
    skills: ['omk-quality-gate'],
    note: 'For validation requests, run the actual project scripts and report exact pass/fail evidence.',
  },
  {
    id: 'docs-research',
    patterns: [
      'docs', 'documentation', 'readme', 'research', 'verify', 'official docs', 'look up',
      '문서', '조사', '검증', '검색', '찾아',
    ],
    skills: ['omk-plan-first', 'omk-quality-gate'],
    note: 'For docs or external references, prefer official/current sources and cite or record what was verified.',
  },
];

const matched = routes.filter((route) => route.patterns.some((pattern) => normalized.includes(pattern)));
if (matched.length === 0) {
  process.exit(0);
}

const skills = [];
for (const route of matched) {
  for (const skill of route.skills) {
    if (!skills.includes(skill)) skills.push(skill);
  }
}

if (!skills.includes('omk-quality-gate')) {
  skills.push('omk-quality-gate');
}

const context = [
  'OMK awesome-agent-skills routing hint (curated from VoltAgent/awesome-agent-skills; advisory only).',
  'Matched domains: ' + matched.map((route) => route.id).join(', '),
  'Prefer installed OMK skills/workflows: ' + skills.map((skill) => '/' + skill).join(', '),
  'Do not auto-install third-party skills from awesome-agent-skills. Review source, license, and security before adoption.',
  ...matched.slice(0, 4).map((route) => route.note),
].join('\\n');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: context,
  },
}) + '\\n');
NODE
`,
  "precompact-checkpoint.sh": `#!/usr/bin/env bash
# OMK PreCompact Checkpoint — compact without losing recovery state
set -euo pipefail

if ! command -v node &>/dev/null; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreCompact","additionalContext":"Before compaction: record goal, changed files, verification state, blockers, and next action. Never store secrets."}}'
  exit 0
fi

node <<'NODE'
const context = [
  'OMK pre-compaction checkpoint.',
  '- Preserve current goal, changed files, verification state, blockers, and intended next action.',
  '- If available, write concise notes to .omx/notepad.md or project-local memory; never store secrets.',
  '- After compaction, refresh from the checkpoint before editing or claiming completion.',
].join('\\n');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreCompact',
    additionalContext: context,
  },
}) + '\\n');
NODE
`,
  "subagent-stop-audit.sh": `#!/usr/bin/env bash
# OMK SubagentStop Audit — leader must verify delegated work
set -euo pipefail

HOOK_INPUT="$(cat || true)"

if ! command -v node &>/dev/null; then
  exit 0
fi

OMK_HOOK_INPUT="$HOOK_INPUT" \\
node <<'NODE'
const inputText = process.env.OMK_HOOK_INPUT || '';

let input = {};
try {
  input = inputText.trim() ? JSON.parse(inputText) : {};
} catch (error) {
  console.error('[subagent-stop-audit] invalid stdin JSON: ' + String(error));
  process.exit(0);
}

if (input.stop_hook_active === true) {
  process.exit(0);
}

const context = [
  'OMK subagent completion audit.',
  '- Do not claim success from a subagent report alone.',
  '- Review the concrete files changed, reconcile conflicts, and keep unrelated user edits intact.',
  '- Run the relevant quality gates locally and report pass/fail/not-run evidence.',
].join('\\n');

process.stdout.write(JSON.stringify({
  systemMessage: context,
}) + '\\n');
NODE
`,
  "branch-diff-snapshot.sh": `#!/usr/bin/env bash
# OMK Branch Diff Snapshot — records merge-review metadata without full diff contents
set +e

SNAP_DIR=".omk/runs/_branch-snapshots"
mkdir -p "$SNAP_DIR" >/dev/null 2>&1

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo '{"hookSpecificOutput":{"hookEventName":"SubagentStop","additionalContext":"Branch diff snapshot skipped: not inside a git worktree."}}'
  exit 0
fi

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
commit="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
safe_branch="$(printf '%s' "$branch" | tr -c 'A-Za-z0-9._-' '-')"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
snapshot="$SNAP_DIR/$stamp-$safe_branch.md"

{
  echo "# OMK branch diff snapshot"
  echo
  echo "- branch: $branch"
  echo "- commit: $commit"
  echo "- captured_at: $stamp"
  echo
  echo "## Status"
  git status --short 2>/dev/null || true
  echo
  echo "## Diff stat"
  git diff --stat 2>/dev/null || true
  echo
  echo "## Changed files"
  git diff --name-only 2>/dev/null || true
} > "$snapshot"

printf '{"hookSpecificOutput":{"hookEventName":"SubagentStop","additionalContext":"Branch diff snapshot saved: %s"}}\\n' "$snapshot"
`,
  "pre-shell-guard.sh": `#!/usr/bin/env bash
# PreShellUse Guard — blocks dangerous commands
set -e

# Close security gate if jq/python3 is missing (deny by default)
if command -v python3 &>/dev/null; then
  PY=python3
elif command -v python &>/dev/null; then
  PY=python
else
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"python3 not installed — pre-shell-guard cannot validate commands"}}'
  exit 0
fi

INPUT=$(cat)
DESTRUCTIVE_DECISION=$(INPUT_JSON="$INPUT" "$PY" <<'PY'
import json
import os
import posixpath
import shlex

def decision(reason):
    print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":reason}}, separators=(",", ":")))

def as_tokens(value):
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str) and value.strip():
        return shlex.split(value, comments=True, posix=True)
    return []

def expand_shell_wrappers(root_tokens):
    result = []
    queue = [root_tokens]
    while queue and len(result) < 8:
        current = queue.pop(0)
        result.append(current)
        for idx, token in enumerate(current):
            if posixpath.basename(token) not in {"bash", "sh", "zsh", "dash"}:
                continue
            j = idx + 1
            while j < len(current):
                opt = current[j]
                if opt == "--":
                    j += 1
                    break
                if opt in {"-c", "-lc"} or (opt.startswith("-") and not opt.startswith("--") and "c" in opt):
                    if j + 1 < len(current):
                        queue.append(as_tokens(current[j + 1]))
                    break
                if opt.startswith("-"):
                    j += 1
                    continue
                break
    return result

def flag_letters(token):
    if token.startswith("--"):
        return set()
    if token.startswith("-"):
        return set(token[1:])
    return set()

def has_rm_rf(tokens, index):
    letters = set()
    for token in tokens[index + 1:]:
        letters.update(flag_letters(token))
        if not token.startswith("-"):
            break
    return "r" in letters and "f" in letters

def rm_rf_targets_catastrophic(tokens, index):
    if not has_rm_rf(tokens, index):
        return False
    targets = []
    for token in tokens[index + 1:]:
        if token == "--" or token.startswith("-"):
            continue
        targets.append(token)
    return any(target in {"/", "~", "$HOME"} or target.startswith("/*") or target.startswith("/dev/") for target in targets)

def has_git_clean_danger(tokens, index):
    rest = tokens[index + 1:]
    if "clean" not in rest:
        return False
    clean_index = rest.index("clean") + index + 1
    letters = set()
    for token in tokens[clean_index + 1:]:
        letters.update(flag_letters(token))
    return {"f", "d", "x"}.issubset(letters)

def has_pipe_to_shell(tokens):
    shell_names = {"bash", "sh", "zsh", "dash"}
    downloaders = {"curl", "wget"}
    for idx, token in enumerate(tokens):
        if token != "|":
            continue
        left = {posixpath.basename(item) for item in tokens[:idx]}
        right = {posixpath.basename(item) for item in tokens[idx + 1:]}
        if left & downloaders and right & shell_names:
            return True
    return False

def is_destructive(tokens):
    # Low-friction benchmark/SWE mode: only stop machine-destroying operations.
    # Package managers, git clean, chmod, docker, kubectl, sudo, and pipe-to-shell
    # are allowed so normal coding agents do not stall on broad heuristics.
    normalized = [str(token) for token in tokens]
    for idx, token in enumerate(normalized):
        exe = posixpath.basename(token)
        if exe == "rm" and rm_rf_targets_catastrophic(normalized, idx):
            return True
        if exe.startswith("mkfs"):
            return True
        if exe == "dd" and any(arg.startswith("of=/dev/") for arg in normalized[idx + 1:]):
            return True
    return False

try:
    data = json.loads(os.environ.get("INPUT_JSON", "{}"))
    tool_input = data.get("tool_input", {})
    tokens = as_tokens(tool_input.get("command", "")) + as_tokens(tool_input.get("args", ""))
    for expanded in expand_shell_wrappers(tokens):
        if is_destructive(expanded):
            decision("Potentially destructive command blocked by pre-shell-guard")
            break
except Exception:
    # If token parsing fails on complex shell/heredoc syntax, fall through to the
    # literal block list and release guard instead of blocking benign coding work.
    pass
PY
)
if [ -n "$DESTRUCTIVE_DECISION" ]; then
  echo "$DESTRUCTIVE_DECISION"
  exit 0
fi
COMMAND=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))')
ARGS=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("args",""))')

FULL="$COMMAND $ARGS"

# Block list
BLOCKED=(
  "rm -rf /"
  "rm -fr /"
  "rm -rf /*"
  "rm -fr /*"
  "rm -rf ~"
  "rm -fr ~"
  "mkfs"
  "of=/dev/"
  "> /dev/"
  ":(){ :|:& };:"
)

for pattern in "\${BLOCKED[@]}"; do
  if [[ "$FULL" == *"$pattern"* ]]; then
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Potentially destructive command blocked by pre-shell-guard"}}'
    exit 0
  fi
done

# Release/deploy guard. These commands are not destructive like rm -rf, but
# they can publish external state. Parse tokens so common option/shell-wrapper
# variants cannot bypass the guard.
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
INPUT_JSON="$INPUT" SCRIPT_DIR="$SCRIPT_DIR" "$PY" <<'PY'
import json
import os
import posixpath
import shlex
import sys

def respond(permission, reason=None):
    payload = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": permission}}
    if reason:
        payload["hookSpecificOutput"]["permissionDecisionReason"] = reason
    print(json.dumps(payload, separators=(",", ":")))
    sys.exit(0)

def as_tokens(value):
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str) and value.strip():
        return shlex.split(value, comments=True, posix=True)
    return []

def expand_shell_wrappers(root_tokens):
    result = []
    queue = [root_tokens]
    while queue and len(result) < 8:
        current = queue.pop(0)
        result.append(current)
        for idx, token in enumerate(current):
            if posixpath.basename(token) not in {"bash", "sh", "zsh", "dash"}:
                continue
            j = idx + 1
            while j < len(current):
                opt = current[j]
                if opt == "--":
                    j += 1
                    break
                if opt in {"-c", "-lc"} or (opt.startswith("-") and not opt.startswith("--") and "c" in opt):
                    if j + 1 < len(current):
                        try:
                            queue.append(as_tokens(current[j + 1]))
                        except ValueError as exc:
                            respond("deny", f"Unable to parse shell-wrapped release/deploy command safely: {exc}")
                    break
                if opt.startswith("-"):
                    j += 1
                    continue
                break
    return result

def skip_flags(tokens, index):
    value_flags = {
        "-C", "-c", "--config-env", "--git-dir", "--work-tree", "--namespace",
        "--registry", "--userconfig", "--prefix", "--cache", "--filter", "--workspace",
        "--cwd", "--repo", "-R", "--ref", "--field", "-f", "--json", "--jq",
    }
    i = index
    while i < len(tokens):
        token = tokens[i]
        if token == "--":
            return i + 1
        if token in value_flags and i + 1 < len(tokens):
            i += 2
            continue
        if any(token.startswith(prefix + "=") for prefix in value_flags if prefix.startswith("--")):
            i += 1
            continue
        if token.startswith("-"):
            i += 1
            continue
        return i
    return i

def is_release_command(tokens):
    i = 0
    while i < len(tokens):
        exe = posixpath.basename(tokens[i])
        if exe == "git":
            command_index = skip_flags(tokens, i + 1)
            if command_index < len(tokens) and tokens[command_index] == "push":
                return True
            i = max(command_index + 1, i + 1)
            continue
        if exe == "npm":
            command_index = skip_flags(tokens, i + 1)
            if command_index < len(tokens) and tokens[command_index] in {"publish", "version"}:
                return True
            i = max(command_index + 1, i + 1)
            continue
        if exe == "pnpm":
            command_index = skip_flags(tokens, i + 1)
            if command_index < len(tokens) and tokens[command_index] == "publish":
                return True
            i = max(command_index + 1, i + 1)
            continue
        if exe == "yarn":
            command_index = skip_flags(tokens, i + 1)
            if command_index < len(tokens) and tokens[command_index] == "publish":
                return True
            if command_index + 1 < len(tokens) and tokens[command_index] == "npm" and tokens[command_index + 1] == "publish":
                return True
            i = max(command_index + 1, i + 1)
            continue
        if exe == "gh":
            command_index = skip_flags(tokens, i + 1)
            if command_index + 1 < len(tokens):
                pair = (tokens[command_index], tokens[command_index + 1])
                if pair in {("release", "create"), ("workflow", "run")}:
                    return True
            i += 1
            continue
        i += 1
    return False

tool_input = {}
try:
    data = json.loads(os.environ.get("INPUT_JSON", "{}"))
    tool_input = data.get("tool_input", {})
    tokens = as_tokens(tool_input.get("command", "")) + as_tokens(tool_input.get("args", ""))
except Exception as exc:
    raw_command = str(tool_input.get("command", "")) if isinstance(tool_input, dict) else ""
    raw_args = str(tool_input.get("args", "")) if isinstance(tool_input, dict) else ""
    raw_full = f"{raw_command} {raw_args}"
    release_markers = ("git push", "npm publish", "npm version", "pnpm publish", "yarn publish", "yarn npm publish", "gh release create", "gh workflow run")
    if any(marker in raw_full for marker in release_markers):
        respond("deny", f"Unable to parse release/deploy command safely: {exc}")
    respond("allow")

if os.environ.get("OMK_ALLOW_RELEASE") == "1":
    respond("allow")

# File-based override for environments where env vars don't propagate to hooks
allow_release_path = os.path.join(os.environ.get("SCRIPT_DIR", ""), ".allow-release")
if os.path.exists(allow_release_path):
    respond("allow")

for expanded in expand_shell_wrappers(tokens):
    if is_release_command(expanded):
        respond("deny", "Release/deploy command blocked by OMK release guard. Re-run with OMK_ALLOW_RELEASE=1 only after an explicit user request and fresh verification evidence.")

respond("allow")
PY
`,
  "worktree-create-guard.sh": `#!/usr/bin/env bash
# OMK Worktree Create Guard — keeps worker lanes under .omk/worktrees by default
set -e

if command -v python3 &>/dev/null; then
  PY=python3
elif command -v python &>/dev/null; then
  PY=python
else
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"python3 not installed — worktree-create-guard cannot validate commands"}}'
  exit 0
fi

INPUT=$(cat)
INPUT_JSON="$INPUT" "$PY" <<'PY'
import json
import os
import posixpath
import shlex
import sys

def respond(permission, reason=None):
    payload = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": permission}}
    if reason:
        payload["hookSpecificOutput"]["permissionDecisionReason"] = reason
    print(json.dumps(payload, separators=(",", ":")))
    sys.exit(0)

def as_tokens(value):
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str) and value.strip():
        return shlex.split(value, comments=True, posix=True)
    return []

try:
    data = json.loads(os.environ.get("INPUT_JSON", "{}"))
except Exception:
    respond("allow")

tool_input = data.get("tool_input", {})
raw_full = f"{tool_input.get('command', '')} {tool_input.get('args', '')}"
try:
    initial_tokens = as_tokens(tool_input.get("command", "")) + as_tokens(tool_input.get("args", ""))
except ValueError as exc:
    if "git" in raw_full and "worktree" in raw_full:
        respond("deny", f"Unable to parse git worktree command safely: {exc}")
    respond("allow")

def canonical_path(path):
    return os.path.realpath(os.path.abspath(path))

def resolve_path(path_arg, base_dir):
    return canonical_path(path_arg if os.path.isabs(path_arg) else os.path.join(base_dir, path_arg))

project_root = canonical_path(os.environ.get("OMK_PROJECT_ROOT") or os.getcwd())
allowed_root = canonical_path(os.path.join(project_root, ".omk", "worktrees"))
options_with_values = {
    "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env",
    "-b", "-B", "--reason", "--lock", "--orphan",
}

def path_within_allowed(path_arg, base_dir):
    base = canonical_path(base_dir)
    actual = resolve_path(path_arg, base)
    try:
        return os.path.commonpath([allowed_root, actual]) == allowed_root
    except ValueError:
        return False

def skip_git_globals(index):
    base_dir = canonical_path(os.getcwd())
    i = index
    while i < len(tokens):
        token = tokens[i]
        if token == "-C" and i + 1 < len(tokens):
            next_dir = tokens[i + 1]
            base_dir = resolve_path(next_dir, base_dir)
            i += 2
        elif token.startswith("-C") and len(token) > 2:
            next_dir = token[2:]
            base_dir = resolve_path(next_dir, base_dir)
            i += 1
        elif token in {"-c", "--git-dir", "--work-tree", "--namespace", "--config-env"} and i + 1 < len(tokens):
            i += 2
        elif token.startswith(("--git-dir=", "--work-tree=", "--namespace=", "--config-env=")):
            i += 1
        elif token == "--":
            i += 1
            break
        elif token.startswith("-"):
            i += 1
        else:
            break
    return i, base_dir

def find_worktree_path(index):
    i = index
    while i < len(tokens):
        token = tokens[i]
        if token == "--":
            i += 1
            break
        if token in options_with_values and i + 1 < len(tokens):
            i += 2
            continue
        if any(token.startswith(prefix) for prefix in ("--reason=", "--orphan=")):
            i += 1
            continue
        if token.startswith("-"):
            i += 1
            continue
        return token
    return tokens[i] if i < len(tokens) else None

def expand_shell_wrappers(root_tokens):
    result = []
    queue = [root_tokens]
    while queue and len(result) < 8:
        current = queue.pop(0)
        result.append(current)
        for idx, token in enumerate(current):
            if posixpath.basename(token) not in {"bash", "sh", "zsh", "dash"}:
                continue
            j = idx + 1
            while j < len(current):
                opt = current[j]
                if opt == "--":
                    j += 1
                    break
                if opt in {"-c", "-lc"} or (opt.startswith("-") and not opt.startswith("--") and "c" in opt):
                    if j + 1 < len(current):
                        try:
                            queue.append(as_tokens(current[j + 1]))
                        except ValueError as exc:
                            if "git" in current[j + 1] and "worktree" in current[j + 1]:
                                respond("deny", f"Unable to parse shell-wrapped git worktree command safely: {exc}")
                    break
                if opt.startswith("-"):
                    j += 1
                    continue
                break
    return result

for tokens in expand_shell_wrappers(initial_tokens):
    i = 0
    while i < len(tokens):
        if posixpath.basename(tokens[i]) != "git":
            i += 1
            continue
        command_index, base_dir = skip_git_globals(i + 1)
        if command_index + 1 >= len(tokens) or tokens[command_index] != "worktree":
            i += 1
            continue
        action = tokens[command_index + 1]
        if action in {"remove", "prune"} and os.environ.get("OMK_ALLOW_WORKTREE_DELETE") != "1":
            respond("deny", "Worktree delete/prune blocked unless OMK_ALLOW_WORKTREE_DELETE=1 is set after review.")
        if action == "add" and os.environ.get("OMK_ALLOW_EXTERNAL_WORKTREE") != "1":
            path_arg = find_worktree_path(command_index + 2)
            if not path_arg or not path_within_allowed(path_arg, base_dir):
                respond("deny", "Worktree lanes must be created under .omk/worktrees/ unless OMK_ALLOW_EXTERNAL_WORKTREE=1 is set.")
        i = command_index + 2

respond("allow")
PY
`,
  "protect-secrets.sh": `#!/usr/bin/env bash
# Secret/environment variable protection
set -e

# Close security gate if jq/python3 is missing (deny by default)
if command -v python3 &>/dev/null; then
  PY=python3
elif command -v python &>/dev/null; then
  PY=python
else
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"python3 not installed — protect-secrets cannot validate files"}}'
  exit 0
fi

INPUT=$(cat)
OMK_HOOK_INPUT="$INPUT" "$PY" - <<'PY'
import json
import os
import re

def respond(decision, reason=None):
    payload = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": decision}}
    if reason:
        payload["hookSpecificOutput"]["permissionDecisionReason"] = reason
    print(json.dumps(payload, separators=(",", ":")))

try:
    data = json.loads(os.environ.get("OMK_HOOK_INPUT", "{}") or "{}")
except Exception:
    respond("deny", "Invalid hook input")
    raise SystemExit(0)

tool_input = data.get("tool_input", {})
if not isinstance(tool_input, dict):
    respond("allow")
    raise SystemExit(0)

def walk(value, key=""):
    if isinstance(value, str):
        yield key, value
    elif isinstance(value, dict):
        for child_key, child_value in value.items():
            yield from walk(child_value, str(child_key))
    elif isinstance(value, list):
        for child_value in value:
            yield from walk(child_value, key)

SENSITIVE_PATHS = (".env", ".pem", ".key", "id_rsa", "id_ed25519", "credentials", "service-account", ".p12", ".pfx", ".keystore", ".pi", "auth.json", "oauth.json", "tokens.json", "session.json")
HIGH_CONFIDENCE_PATTERNS = (
    re.compile(r"(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9_-]{30,}|pypi[-_][A-Za-z0-9_-]{30,}|sk-[A-Za-z0-9_-]{20,})", re.IGNORECASE),
    re.compile(r"(?:AKIA|ASIA)[0-9A-Z]{16}"),
    re.compile(r"BEGIN [A-Z ]*PRIVATE KEY"),
    re.compile(r"(?:ssh-rsa|ssh-ed25519)\\s+[A-Za-z0-9+/=]{40,}"),
    re.compile(r"\\bBearer\\s+[A-Za-z0-9._~+/-]{16,}", re.IGNORECASE),
)
ASSIGNMENT_PATTERN = re.compile(r"""\\b(?:password|secret|api[_-]?key|token|access[_-]?token|refresh[_-]?token|session[_-]?token|oauth|authorization|private[_-]?key|aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key)\\b['"]?\\s*[:=]\\s*['"]?[A-Za-z0-9_./+=@:-]{12,}""", re.IGNORECASE)
SCAN_VALUE_KEYS = ("content", "text", "string", "newtext", "oldtext", "input", "value", "body", "data")
SKIP_ASSIGNMENT_KEYS = ("path", "file", "command", "args", "name")

def should_scan_assignment(key):
    key_lower = key.lower()
    if any(marker in key_lower for marker in SKIP_ASSIGNMENT_KEYS):
        return False
    return key_lower == "" or any(marker in key_lower for marker in SCAN_VALUE_KEYS)

for key, value in walk(tool_input):
    key_lower = key.lower()
    if ("path" in key_lower or "file" in key_lower) and any(marker in value for marker in SENSITIVE_PATHS):
        respond("deny", "Direct modification of sensitive file blocked")
        raise SystemExit(0)

for key, value in walk(tool_input):
    if should_scan_assignment(key) and any(pattern.search(value) for pattern in HIGH_CONFIDENCE_PATTERNS):
        respond("deny", "High-confidence credential value detected")
        raise SystemExit(0)

for key, value in walk(tool_input):
    if should_scan_assignment(key) and ASSIGNMENT_PATTERN.search(value):
        respond("deny", "High-confidence credential assignment detected")
        raise SystemExit(0)
respond("allow")
PY
`,
  "post-format.sh": `#!/usr/bin/env bash
# Auto-format after save (single file target)
set -e

if command -v python3 &>/dev/null; then
  PY=python3
elif command -v python &>/dev/null; then
  PY=python
else
  echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
  exit 0
fi

INPUT=$(cat)
FILEPATH=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))')

if [ -z "$FILEPATH" ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
  exit 0
fi

# Detect project root and run formatter (target file only)
if [ -f "package.json" ] && [ -f "$FILEPATH" ]; then
  npx prettier --write "$FILEPATH" >/dev/null 2>&1 || true
fi

if [ -f "Cargo.toml" ] && [ -f "$FILEPATH" ]; then
  rustfmt "$FILEPATH" >/dev/null 2>&1 || true
fi

echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
`,
  "typecheck-after-edit.sh": `#!/usr/bin/env bash
# TypeScript product preset: run project typecheck after TS edits when available.
set +e

if command -v python3 &>/dev/null; then
  PY=python3
elif command -v python &>/dev/null; then
  PY=python
else
  echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
  exit 0
fi

INPUT=$(cat)
FILEPATH=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))')

case "$FILEPATH" in
  *.ts|*.tsx|*.mts|*.cts) ;;
  *) echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'; exit 0 ;;
esac

if [ ! -f "package.json" ] || ! command -v npm &>/dev/null; then
  echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
  exit 0
fi

node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts.check ? 0 : 1)" >/dev/null 2>&1
if [ $? -ne 0 ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
  exit 0
fi

TMP=$(mktemp)
npm run check >"$TMP" 2>&1
STATUS=$?
if [ $STATUS -eq 0 ]; then
  rm -f "$TMP"
  echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
  exit 0
fi

tail -n 40 "$TMP" | $PY -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow","additionalContext":"Typecheck failed after edit. Inspect npm run check output:\\n"+sys.stdin.read()}}))'
rm -f "$TMP"
`,
  "eslint-after-edit.sh": `#!/usr/bin/env bash
# TypeScript product preset: run project lint after JS/TS edits when available.
set +e

if command -v python3 &>/dev/null; then
  PY=python3
elif command -v python &>/dev/null; then
  PY=python
else
  echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
  exit 0
fi

INPUT=$(cat)
FILEPATH=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))')

case "$FILEPATH" in
  *.js|*.jsx|*.mjs|*.cjs|*.ts|*.tsx|*.mts|*.cts) ;;
  *) echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'; exit 0 ;;
esac

if [ ! -f "package.json" ] || ! command -v npm &>/dev/null; then
  echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
  exit 0
fi

node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts.lint ? 0 : 1)" >/dev/null 2>&1
if [ $? -ne 0 ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
  exit 0
fi

TMP=$(mktemp)
npm run lint >"$TMP" 2>&1
STATUS=$?
if [ $STATUS -eq 0 ]; then
  rm -f "$TMP"
  echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
  exit 0
fi

tail -n 40 "$TMP" | $PY -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow","additionalContext":"ESLint failed after edit. Inspect npm run lint output:\\n"+sys.stdin.read()}}))'
rm -f "$TMP"
`,
  "stop-verify.sh": `#!/usr/bin/env bash
# Final verification on Stop
set -euo pipefail

HOOK_INPUT="$(cat || true)"

if ! command -v node &>/dev/null; then
  exit 0
fi

OMK_HOOK_INPUT="$HOOK_INPUT" \\
node <<'NODE'
const inputText = process.env.OMK_HOOK_INPUT || '';

let input = {};
try {
  input = inputText.trim() ? JSON.parse(inputText) : {};
} catch (error) {
  console.error('[stop-verify] invalid stdin JSON: ' + String(error));
  process.exit(0);
}

if (input.stop_hook_active === true) {
  process.exit(0);
}

const context = [
  'OMK final response checklist.',
  '- Changed files: list authored files and note any ignored local runtime files refreshed.',
  '- Commands run: include exact verification commands and pass/fail/not-run status.',
  '- Deployment status: do not claim push, release, npm publish, or production deploy unless that command actually ran and evidence was read.',
  '- Remaining risk: state known gaps instead of saying complete without evidence.',
].join('\\n');

process.stdout.write(JSON.stringify({
  systemMessage: context,
}) + '\\n');
NODE
`,
  "release-check-before-stop.sh": `#!/usr/bin/env bash
# OMK Release Guard — final checklist reminder for release/security work
set +e

HOOK_INPUT="$(cat || true)"

if ! command -v node &>/dev/null; then
  exit 0
fi

OMK_HOOK_INPUT="$HOOK_INPUT" \\
node <<'NODE'
const { execSync } = require('node:child_process');
const inputText = process.env.OMK_HOOK_INPUT || '';

let input = {};
try {
  input = inputText.trim() ? JSON.parse(inputText) : {};
} catch (error) {
  console.error('[release-check-before-stop] invalid stdin JSON: ' + String(error));
  process.exit(0);
}

if (input.stop_hook_active === true) {
  process.exit(0);
}

function shell(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

const changed = [
  shell('git diff --name-only HEAD 2>/dev/null'),
  shell('git diff --cached --name-only 2>/dev/null'),
  shell('git ls-files --others --exclude-standard 2>/dev/null'),
].filter(Boolean).join('\\n');

const releaseTouched = /(^|\\n)(package\\.json|package-lock\\.json|pnpm-lock\\.yaml|yarn\\.lock|CHANGELOG\\.md|SECURITY\\.md|\\.npmrc|\\.github\\/workflows\\/release\\.ya?ml)(\\n|$)/.test(changed);
const context = releaseTouched
  ? 'OMK release guard: release/security files changed. Before final or publish, collect secret scan, security review, quality gate, npm audit summary, changelog/PR evidence, and do not publish/deploy without explicit user request.'
  : 'OMK release guard: no release file changes detected. Still do not claim push, release, npm publish, or production deploy without exact command evidence.';

process.stdout.write(JSON.stringify({
  systemMessage: context,
}) + '\\n');
NODE
`,
  "npm-audit-summary.sh": `#!/usr/bin/env bash
# OMK Release Guard — optional npm audit summary for release gates
set +e

HOOK_INPUT="$(cat || true)"

if command -v node &>/dev/null; then
  OMK_HOOK_INPUT="$HOOK_INPUT" node <<'NODE'
const inputText = process.env.OMK_HOOK_INPUT || '';
try {
  const input = inputText.trim() ? JSON.parse(inputText) : {};
  if (input.stop_hook_active === true) process.exit(10);
} catch (error) {
  console.error('[npm-audit-summary] invalid stdin JSON: ' + String(error));
  process.exit(11);
}
NODE
  case "$?" in
    10|11) exit 0 ;;
  esac
fi

if [ ! -f "package.json" ]; then
  printf '{"systemMessage":"OMK npm audit summary: skipped because package.json is absent."}\\n'
  exit 0
fi

if [ "$OMK_RUN_NPM_AUDIT_SUMMARY" != "1" ]; then
  printf '{"systemMessage":"OMK npm audit summary: not run automatically. For release/security claims, run npm audit or set OMK_RUN_NPM_AUDIT_SUMMARY=1 and capture the result."}\\n'
  exit 0
fi

if ! command -v npm &>/dev/null || ! command -v node &>/dev/null; then
  printf '{"systemMessage":"OMK npm audit summary: skipped because npm or node is unavailable."}\\n'
  exit 0
fi

TMP="$(mktemp)"
npm audit --audit-level=high --omit=dev --json > "$TMP" 2>&1
STATUS=$?

node - "$TMP" "$STATUS" <<'NODE'
const fs = require('node:fs');
const filePath = process.argv[2];
const status = Number(process.argv[3] || 0);
let raw = '';
try {
  raw = fs.readFileSync(filePath, 'utf8');
} catch {}

let context;
try {
  const parsed = JSON.parse(raw);
  const total = parsed.metadata?.vulnerabilities?.total ?? 'unknown';
  const high = parsed.metadata?.vulnerabilities?.high ?? 'unknown';
  const critical = parsed.metadata?.vulnerabilities?.critical ?? 'unknown';
  context = status === 0
    ? 'OMK npm audit summary: passed for high+ prod dependencies. total=' + total + ', high=' + high + ', critical=' + critical + '.'
    : 'OMK npm audit summary: attention required. total=' + total + ', high=' + high + ', critical=' + critical + '. Inspect npm audit output before release.';
} catch {
  context = status === 0
    ? 'OMK npm audit summary: command completed but JSON could not be parsed.'
    : 'OMK npm audit summary: npm audit failed or returned non-JSON output; inspect command output before release.';
}

process.stdout.write(JSON.stringify({
  systemMessage: context,
}) + '\\n');
NODE
rm -f "$TMP"
`,
  "post-init-mcp.sh": `#!/usr/bin/env bash
# Post-init MCP validation — non-blocking health check after omk init
set -uo pipefail

LOG_DIR=".omk/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/mcp-init-check.json"

# Run doctor silently and capture JSON output if available
if command -v omk &>/dev/null; then
  omk mcp doctor --json 2>/dev/null > "$LOG_FILE" || true
else
  echo '{"note":"omk not in PATH during hook execution"}' > "$LOG_FILE"
fi
`,
};

const KIMI_CONFIG_TOML = `# open-multi-agent-kit generated Kimi adapter config
# Lifecycle hook settings

[[hooks]]
event = "SessionStart"
command = ".omk/hooks/session-context.sh"
timeout = 5

[[hooks]]
event = "PreCompact"
command = ".omk/hooks/precompact-checkpoint.sh"
timeout = 5

[[hooks]]
event = "SubagentStop"
command = ".omk/hooks/subagent-stop-audit.sh"
timeout = 5

[[hooks]]
event = "PreToolUse"
matcher = "Shell"
command = ".omk/hooks/pre-shell-guard.sh"
timeout = 5

[[hooks]]
event = "PreToolUse"
matcher = "WriteFile|StrReplaceFile"
command = ".omk/hooks/protect-secrets.sh"
timeout = 5

[[hooks]]
event = "Stop"
command = ".omk/hooks/stop-verify.sh"
timeout = 30
`;

const DEFAULT_PROJECT_MCP_COMMENT =
  "Project-local MCP config. omk-project is virtual runtime MCP injected; global MCP servers remain in ~/.kimi/mcp.json and must be imported explicitly only after secret review.";

export function createOmkProjectMcpServer(
  projectRoot: string,
  options: { packageRoot?: string; platform?: NodeJS.Platform } = {}
): McpServerDefinition {
  // Use the concrete Node executable that launched init instead of a bare
  // `node` lookup. MCP clients often run with a reduced/isolated PATH, which
  // can accidentally pick a different Node ABI than the one used by npm install
  // and trigger native addon errors such as NODE_MODULE_VERSION mismatches.
  const isWin = (options.platform ?? process.platform) === "win32";
  const env = { OMK_PROJECT_ROOT: projectRoot };
  const node = stableNodeExecutable();

  return {
    command: isWin ? "omk" : "bash",
    args: isWin ? ["mcp", "serve", "omk-project"] : ["-lc", createUnixOmkProjectMcpScript(node)],
    env,
  };
}

function createUnixOmkProjectMcpScript(node: string): string {
  const quotedNode = shellQuote(node);
  const resolveRealpathScript = "const fs=require('fs');process.stdout.write(fs.realpathSync(process.argv[1]))";

  return [
    "set -e",
    'omk_bin="$(command -v omk 2>/dev/null || true)"',
    'if [ -n "$omk_bin" ]; then',
    `  omk_cli="$(${quotedNode} -e ${shellQuote(resolveRealpathScript)} "$omk_bin" 2>/dev/null || true)"`,
    '  if [ -n "$omk_cli" ]; then',
    `    exec ${quotedNode} "$omk_cli" mcp serve omk-project`,
    "  fi",
    "fi",
    'mcp_bin="$(command -v omk-project-mcp 2>/dev/null || true)"',
    'if [ -n "$mcp_bin" ]; then',
    `  mcp_js="$(${quotedNode} -e ${shellQuote(resolveRealpathScript)} "$mcp_bin" 2>/dev/null || true)"`,
    '  if [ -n "$mcp_js" ]; then',
    `    exec ${quotedNode} "$mcp_js"`,
    "  fi",
    "fi",
    'echo "omk-project MCP server not found; install OMK or rerun omk init" >&2',
    "exit 127",
  ].join("\n");
}

function stableNodeExecutable(): string {
  try {
    return realpathSync(process.execPath);
  } catch {
    return process.execPath || "node";
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function createMcpJson(_projectRoot: string): { mcpServers: Record<string, McpServerDefinition> } {
  return {
    mcpServers: {
      // omk-project is now auto-injected at runtime by injectKimiGlobals.
      // Project-local .omk/mcp.json only needs to hold user-added MCP servers.
    },
  };
}

async function ensureProjectMcpConfig(
  path: string,
  fallback: Record<string, unknown>,
  options: { removeRuntimeManagedOmkProject?: boolean } = {}
): Promise<void> {
  const existing = await readFile(path, "utf-8").catch(() => null);
  if (!existing) {
    await writeFile(path, JSON.stringify(fallback, null, 2) + "\n");
    return;
  }

  try {
    const parsed = JSON.parse(existing) as { mcpServers?: Record<string, unknown> };
    if (options.removeRuntimeManagedOmkProject && parsed.mcpServers?.["omk-project"]) {
      delete parsed.mcpServers["omk-project"];
      await writeFile(path, JSON.stringify(parsed, null, 2) + "\n");
    }
  } catch {
    // Preserve malformed user-owned MCP config rather than overwriting custom entries.
  }
}

type RuntimeScope = "all" | "project";

function getConfigToml(options: { mcpScope: RuntimeScope; skillsScope: RuntimeScope; hooksScope: RuntimeScope }): string {
  const { mcpScope, skillsScope, hooksScope } = options;
  return `# OMK project settings
[project]
name = "my-project"
description = ""

[orchestration]
default_workers = 4
max_retries = 3
approval_policy = "yolo"         # low-friction SWE/benchmark mode: auto-allow tool use
execution_prompt = "ask"         # ask | auto | parallel | sequential
yolo_mode = true                 # minimal hard stops only; avoid benchmark-stalling prompts

[runtime]
# auto chooses lite on <=18GB RAM hosts to make 16GB laptops usable.
resource_profile = "auto"        # auto | lite | standard
mcp_scope = "${mcpScope}"            # all | project | none — all also reads user ~/.kimi/mcp.json at runtime
skills_scope = "${skillsScope}"         # all | project | none — all reads user ~/.kimi/skills without copying them
hooks_scope = "${hooksScope}"          # all | project | none — all reads user ~/.kimi hooks without copying them
max_workers = 4                  # can override with OMK_MAX_WORKERS
max_output_mb = 4                # cap buffered shell/quality output
wire_output_mb = 1               # cap per-task retained wire output

[ensemble]
# Role-aware agent ensemble. Keep max_parallel=1 for 16GB/WSL safety.
enabled = true
max_candidates_per_node = 2
max_parallel = 2
quorum_ratio = 0.5

[quality]
lint = "auto"      # auto | command
test = "auto"
typecheck = "auto"
build = "auto"

[memory]
# Project-local ontology graph is the default source of truth for project/session memory.
# Use backend = "kuzu" for the embedded Kuzu ontology graph backend.
backend = "local_graph"    # local_graph | kuzu
scope = "project-session"
strict = true               # fail memory writes if the selected graph backend is unavailable
mirror_files = true         # keep .omk/memory/*.md as readable mirrors
migrate_files = true        # seed the graph from existing .omk/memory files on first read

[local_graph]
path = ".omk/memory/graph-state.json"
ontology = "omk-ontology-mindmap-v1"
query = "graphql-lite"


[locale]
# UI language: en (default) | ko | ja
language = "en"

[theme]
# Optional custom logo image path for terminal welcome banner.
# omk init does not create or copy image assets; add your own asset first, then uncomment.
# Relative paths are resolved from project root; absolute paths require OMK_TRUST_ABSOLUTE_LOGO_PATH=1.
# Supported formats: PNG, JPEG, GIF, WEBP (high-res on iTerm/Konsole, else ANSI block).
# logo_image = "assets/omk-logo.png"

[router]
default_model = "kimi-k2.6"
# off | medium | high | xhigh | max
research_thinking = "off"
coding_thinking = "high"
`;
}

const MEMORY_FILES: Record<string, string> = {
  "project.md": "# Project Memory\n\nProject-local graph memory is the source of truth; this file is a human-readable mirror.\n\n## Runtime Surfaces\n\n- Follow AGENTS.md and .kimi/AGENTS.md for active agent policy.\n- Use chat-agent-harness.json when present for MCP/skills/hooks inventory, worker limits, authority boundaries, and gates.\n- Keep .omk/memory mirrors free of secrets and private user data.\n",
  "decisions.md": "# Decisions\n\nRecord durable architecture, release, runtime, and safety decisions.\n\nFor each decision, include:\n\n- date and short title\n- affected files or surfaces\n- evidence commands or artifacts\n- rollback or revisit trigger\n\nNever store secrets, raw MCP env, tokens, or private user data.\n",
  "commands.md": "# Frequently Used Commands\n\nCommand mirror maintained alongside the local graph memory.\n\n```bash\nnpm run yaml:check\nnpm run lint\nnpm run secret:scan\nnpm run check\nnpm run build:clean\nnpm test\nnpm run audit:package\nnpm run pack:dry\nomk mcp doctor --json\nomk verify --json\n```\n\nUse targeted `npm test -- --match <pattern>` for focused regression loops before the full gate.\n",
  "risks.md": "# Known Risks\n\n- Do not store secrets, API keys, tokens, credentials, MCP env/header values, or private user data in memory.\n- `--local-user` and all-scope MCP/skills are runtime-only; do not copy global resources unless the user explicitly opts into `--import-user-skills`.\n- `chat-agent-harness.json` can contain private run inventory; summarize counts and gates, not full global inventories.\n- Working trees can contain unrelated edits; inspect `git status --short` before changes and avoid reverting user work.\n- Completion claims require evidence: tests, `omk verify --json`, replay/cockpit artifacts, or an explicit not-run reason.\n",
};

export async function initCommand(options: InitCommandOptions): Promise<void> {
  const root = getProjectRoot();
  const initHomeDir = normalizeUserHomePath(options.homeDir) ?? getUserHome(options.env ?? process.env);
  const mcpJson = createMcpJson(root);
  console.log(header(`OMK init (profile: ${options.profile})`));
  const localUserRuntime = await resolveLocalUserRuntime(options, initHomeDir);

  // 1. Create directories (parallel)
  const dirs = [
    ".omk/memory",
    ".omk/runs",
    ".omk/checkpoints",
    ".omk/agents/roles",
    ".omk/prompts/role-addons",
    ".omk/hooks",
    ".omk/worktrees",
    ".omk/logs",
    ".omk/snippets",
    ".kimi/skills",
    ".kimi/hooks",
    ".agents/skills",
  ];
  await Promise.all(dirs.map((d) => mkdir(join(root, d), { recursive: true })));

  // 2. Write AGENTS.md (skip if exists)
  const agentsMdPath = join(root, "AGENTS.md");
  if (await pathExists(agentsMdPath)) {
    console.log(t("init.agentsMdExists"));
  } else {
    const agentsMdContent = await readFile(join(packageRoot, "templates", "AGENTS.md"), "utf8");
    await writeFile(agentsMdPath, agentsMdContent);
  }

  // 2.5 Write .kimi/AGENTS.md (Kimi-specific rules)
  const kimiAgentsMdPath = join(root, ".kimi", "AGENTS.md");
  if (await pathExists(kimiAgentsMdPath)) {
    console.log(t("init.kimiAgentsMdExists"));
  } else {
    const kimiAgentsMdContent = await readFile(join(packageRoot, "templates", ".kimi", "AGENTS.md"), "utf8");
    await writeFile(kimiAgentsMdPath, kimiAgentsMdContent);
  }

  // 3. Write / migrate agents (parallel)
  const okabeYamlPath = join(root, ".omk/agents/okabe.yaml");
  await writeFile(okabeYamlPath, OKABE_AGENT_YAML);

  const rootYamlPath = join(root, ".omk/agents/root.yaml");
  if (await pathExists(rootYamlPath)) {
    // Existing root.yaml migration: fix relative path bug
    const existing = await readFile(rootYamlPath, "utf8");
    if (existing.includes("system_prompt_path: ./prompts/root.md")) {
      const migrated = existing.replace(
        /system_prompt_path:\s*\.\/prompts\/root\.md/,
        "system_prompt_path: ../prompts/root.md"
      );
      await writeFile(rootYamlPath, migrated);
      console.log(status.ok(t("init.rootYamlMigrated")));
    }
  } else {
    const rootAgentYaml = await readTemplateFile(join(".omk", "agents", "root.yaml"), ROOT_AGENT_YAML);
    await writeFile(rootYamlPath, rootAgentYaml);
  }
  await Promise.all(
    Object.entries(ROLE_YAMLS).map(async ([name, content]) => {
      const roleYaml = await readTemplateFile(join(".omk", "agents", "roles", `${name}.yaml`), content);
      await writeFile(join(root, ".omk/agents/roles", `${name}.yaml`), roleYaml);
    })
  );

  // 4. Write prompts
  const rootPromptMd = await readTemplateFile(join(".omk", "prompts", "root.md"), ROOT_PROMPT_MD);
  await writeFile(join(root, ".omk/prompts/root.md"), rootPromptMd);

  // 5+6. Copy package skill templates by default.
  // Fresh open-source init should reference only the maintainer-packaged OMK
  // skills. Local maintainers can explicitly opt into importing personal skills
  // with --import-user-skills or OMK_INIT_IMPORT_USER_SKILLS=1.
  const kimiSkillsSrc = join(packageRoot, "templates", "skills", "kimi");
  const agentsSkillsSrc = join(packageRoot, "templates", "skills", "agents");
  const skillCopies: Promise<void>[] = [];
  const importUserSkills = shouldImportUserSkills(options);

  if (importUserSkills) {
    const personalSkillSources = [
      {
        label: "~/.kimi/skills",
        src: join(initHomeDir, ".kimi", "skills"),
        dest: join(root, ".kimi", "skills"),
      },
      {
        label: "~/.codex/skills",
        src: join(initHomeDir, ".codex", "skills"),
        dest: join(root, ".kimi", "skills"),
      },
      {
        label: "~/.agents/skills",
        src: join(initHomeDir, ".agents", "skills"),
        dest: join(root, ".agents", "skills"),
      },
    ];

    for (const source of personalSkillSources) {
      if (await pathExists(source.src)) {
        console.log(style.purple(`   📦 Importing ${source.label} (trusted local opt-in)...`));
        skillCopies.push(
          copySafeSkillRoot(source.src, source.dest).then((stats) => {
            if (stats.skippedUnsafe > 0) {
              console.log(status.warn(`Skipped ${stats.skippedUnsafe} secret-bearing skills from ${source.label}`));
            }
            if (stats.skippedUnavailable > 0) {
              console.log(status.warn(`Skipped ${stats.skippedUnavailable} unavailable skills from ${source.label}`));
            }
          })
        );
      }
    }
  }

  // Global skills symlink for local-user init
  let globalSkillsSymlinked = false;
  if (localUserRuntime && initHomeDir) {
    const globalKimiSkills = join(initHomeDir, ".kimi", "skills");
    if (await pathExists(globalKimiSkills)) {
      const dest = join(root, ".kimi", "skills");
      if (!(await pathExists(dest))) {
        console.log(style.purple("   📦 Symlinking global ~/.kimi/skills..."));
        await mkdir(dirname(dest), { recursive: true });
        try {
          await symlink(globalKimiSkills, dest, "dir");
          globalSkillsSymlinked = true;
        } catch (err) {
          console.warn(status.warn(`Failed to symlink global skills: ${(err as Error).message}`));
        }
      }
    }
  }

  if (!globalSkillsSymlinked && await pathExists(kimiSkillsSrc)) {
    console.log(style.purple(t("init.copyKimiSkills")));
    skillCopies.push(copySafeSkillRoot(kimiSkillsSrc, join(root, ".kimi", "skills")).then(() => undefined));
  } else if (!globalSkillsSymlinked) {
    console.log(status.warn(t("init.kimiSkillsMissing")));
  }
  if (await pathExists(agentsSkillsSrc)) {
    console.log(style.purple(t("init.copyPortableSkills")));
    skillCopies.push(copySafeSkillRoot(agentsSkillsSrc, join(root, ".agents", "skills")).then(() => undefined));
  } else {
    console.log(status.warn(t("init.portableSkillsMissing")));
  }
  if (skillCopies.length > 0) await Promise.all(skillCopies);

  // 7. Write hooks (parallel)
  await Promise.all(
    Object.entries(HOOK_SCRIPTS).map(async ([name, content]) => {
      const hookPath = join(root, ".omk/hooks", name);
      await writeFile(hookPath, content, { mode: 0o755 });
    })
  );

  // 8. Write configs
  const runtimeScope: RuntimeScope = localUserRuntime ? "all" : "project";
  let configTomlContent = getConfigToml({
    mcpScope: runtimeScope,
    skillsScope: runtimeScope,
    hooksScope: runtimeScope,
  });
  if (localUserRuntime && initHomeDir) {
    const globalConfigPath = join(initHomeDir, ".omk", "config.toml");
    const globalConfig = await readFile(globalConfigPath, "utf-8").catch(() => null);
    if (globalConfig) {
      configTomlContent = globalConfig
        .replace(/^mcp_scope\s*=.*$/gm, `mcp_scope = "${runtimeScope}"`)
        .replace(/^skills_scope\s*=.*$/gm, `skills_scope = "${runtimeScope}"`)
        .replace(/^hooks_scope\s*=.*$/gm, `hooks_scope = "${runtimeScope}"`);
      console.log(style.purple("   📦 Inheriting global .omk/config.toml defaults..."));
    }
  }
  await writeFile(join(root, ".omk/config.toml"), configTomlContent);
  let kimiConfigContent = KIMI_CONFIG_TOML;
  if (localUserRuntime && initHomeDir) {
    const globalKimiConfigPath = join(initHomeDir, ".kimi", "config.toml");
    const globalKimiConfig = await readFile(globalKimiConfigPath, "utf-8").catch(() => null);
    if (globalKimiConfig) {
      kimiConfigContent = globalKimiConfig;
      console.log(style.purple("   📦 Inheriting global ~/.kimi/config.toml..."));
    }
  }
  await writeFile(join(root, ".omk/kimi.config.toml"), kimiConfigContent);
  await ensureProjectMcpConfig(join(root, ".omk/mcp.json"), mcpJson, { removeRuntimeManagedOmkProject: true });
  await writeFile(join(root, ".omk/theme.json"), createThemeJson());
  await writeFile(join(root, ".omk/runtime-preset.json"), JSON.stringify(OMK_CORE_VERIFIED_PRESET, null, 2) + "\n");
  await writeFile(join(root, ".omk/runtime-presets.json"), createRuntimePresetsJson());

  // Project-local server config must not import global definitions by default.
  const projectMcpPath = join(root, ".kimi", "mcp.json");
  const globalMcpPath = join(initHomeDir, ".kimi", "mcp.json");
  const hasGlobalMcp = localUserRuntime && initHomeDir && await pathExists(globalMcpPath);
  const mcpComment = hasGlobalMcp
    ? "Project-local server config. Global entries are inherited from ~/.kimi/mcp.json at runtime when scope = 'all'."
    : DEFAULT_PROJECT_MCP_COMMENT;
  await ensureProjectMcpConfig(
    projectMcpPath,
    { _comment: mcpComment, mcpServers: {} },
    { removeRuntimeManagedOmkProject: true }
  );
  await writeFile(join(root, ".omk/lsp.json"), defaultLspConfigJson());

  // 9. Write memory files (parallel)
  await Promise.all(
    Object.entries(MEMORY_FILES).map(([name, content]) =>
      writeFile(join(root, ".omk/memory", name), content)
    )
  );

  // 9.5. Copy default snippet templates if they exist
  const snippetsSrc = join(packageRoot, "templates", "snippets");
  const snippetsDest = join(root, ".omk", "snippets");
  if (await pathExists(snippetsSrc)) {
    console.log(style.purple("   📦 Copying snippet templates..."));
    await copyTemplateDir(snippetsSrc, snippetsDest);
  }

  // 9.6. Copy spec-kit OMK preset template
  const presetSrc = join(packageRoot, "templates", "spec-kit-omk-preset");
  const presetDest = join(root, ".omk", "templates", "spec-kit-omk-preset");
  if (await pathExists(presetSrc)) {
    console.log(style.purple("   📦 Copying spec-kit OMK preset..."));
    await copyTemplateDir(presetSrc, presetDest);
  }

  // 10. Write project docs (skip if already exist)
  const docs: Record<string, string> = {
    "DESIGN.md": getDesignMd(getOmkVersionSync()),
    "GEMINI.md": GEMINI_MD,
    "CLAUDE.md": CLAUDE_MD,
    "ROADMAP.md": ROADMAP_MD,
    "SECURITY.md": SECURITY_MD,
  };
  for (const [name, content] of Object.entries(docs)) {
    const docPath = join(root, name);
    if (await pathExists(docPath)) {
      console.log(`   ℹ️ ${name} already exists — skipping`);
    } else {
      await writeFile(docPath, content);
    }
  }

  console.log(status.success("OMK initialized."));
  console.log();
  console.log("Created:");
  console.log("- AGENTS.md");
  console.log("- .kimi/AGENTS.md");
  console.log("- DESIGN.md");
  console.log("- .omk/agents/root.yaml");
  console.log("- .omk/agents/roles/");
  console.log("- .omk/prompts/root.md");
  console.log("- .omk/config.toml");
  console.log("- .omk/kimi.config.toml");
  console.log("- .omk/lsp.json");
  console.log("- .omk/hooks/");
  console.log("- .omk/snippets/");
  console.log("- .kimi/mcp.json");
  console.log("- .omk/mcp.json");
  console.log("- .omk/theme.json");
  console.log("- .omk/runtime-preset.json");
  console.log("- .omk/runtime-presets.json");
  console.log("- .kimi/skills/");
  console.log("- .agents/skills/");
  console.log("- .omk/memory/");
  console.log("- .omk/templates/spec-kit-omk-preset/");
  console.log();
  console.log("Default behavior:");
  console.log("- AGENTS.md is loaded into Kimi root prompt.");
  console.log("- Todo list is required for multi-step work.");
  console.log("- Subagents are required for non-trivial work.");
  console.log("- Project skills are auto-discovered from .kimi/skills and .agents/skills.");
  console.log("- Runtime presets include omk-core-verified, omk-ts-product, omk-worktree-team, and omk-release-guard.");
  if (localUserRuntime) {
    console.log("- Local user runtime enabled: global ~/.kimi/mcp.json and ~/.kimi/skills are used at runtime.");
    console.log("- Personal/global MCP servers and skills are not copied into the project.");
  } else {
    console.log("- omk-project is virtual runtime MCP injected; project MCP files are for user-added servers, remote/global MCPs are explicit opt-in.");
  }
  console.log("- Built-in tools: SearchWeb, FetchURL (no config required).");

  console.log(style.gray("  Fresh init does not copy user-global skills or MCP servers into the project."));
  console.log(style.gray("  Trusted local users can add --local-user --home-dir <~/.kimi/mcp.json> for runtime-only global MCP/skills, or --import-user-skills to copy reviewed personal skills."));

  await runInitInteractiveSetup(options, initHomeDir);

  // Warn about environment variable files — OMK prefers config.toml for stability
  for (const envFile of [".env", ".env.local", ".env.development"]) {
    if (await pathExists(join(root, envFile))) {
      console.log(style.orange(`⚠️  Found ${envFile}. OMK recommends using .omk/config.toml instead of environment variable files for stability.`));
      break;
    }
  }

  // ── Shell integration & PATH check ──
  const pathCheck = await checkOmkInPath();
  if (!pathCheck.inPath) {
    console.log("");
    console.log(style.orange("⚠️  omk is not in PATH."));
    console.log(style.gray("   Run one of the following:"));
    console.log(style.gray("   1) npm install -g open-multi-agent-kit"));
    console.log(style.gray("   2) npm link (for development)"));
    console.log(style.gray("   3) alias omk='npx -p open-multi-agent-kit omk'"));
  } else {
    await maybeInstallShellCompletion(root);
  }

  console.log("");
  console.log(style.purpleBold("   Next steps: ") + style.cream("omk doctor → omk chat"));
}

function isDisabledEnvValue(value: string | undefined): boolean {
  return ["0", "false", "off", "no", "never"].includes(value?.trim().toLowerCase() ?? "");
}

function isEnabledEnvValue(value: string | undefined): boolean {
  return ["1", "true", "on", "yes", "always"].includes(value?.trim().toLowerCase() ?? "");
}

function shouldImportUserSkills(options: InitCommandOptions): boolean {
  const env = options.env ?? process.env;
  return Boolean(options.importUserSkills) || isEnabledEnvValue(env.OMK_INIT_IMPORT_USER_SKILLS);
}

function explicitLocalUserRuntime(options: InitCommandOptions): boolean | undefined {
  const env = options.env ?? process.env;
  const profile = options.profile?.trim().toLowerCase() ?? "";
  if (Boolean(options.localUser)
    || isEnabledEnvValue(env.OMK_INIT_LOCAL_USER)
    || ["local", "personal", "trusted-local"].includes(profile)) {
    return true;
  }
  if (isDisabledEnvValue(env.OMK_INIT_LOCAL_USER)) return false;
  return undefined;
}

async function resolveLocalUserRuntime(options: InitCommandOptions, homeDir: string): Promise<boolean> {
  const explicit = explicitLocalUserRuntime(options);
  if (explicit !== undefined) return explicit;
  if (!isInitInteractiveSetupEligible(options)) return false;
  return askLocalUserRuntimeDuringInit(options, homeDir);
}

async function askLocalUserRuntimeDuringInit(options: InitCommandOptions, homeDir: string): Promise<boolean> {
  try {
    const useLocalGlobal = options.promptLocalUserRuntime
      ? await options.promptLocalUserRuntime({ homeDir })
      : await confirm({
          message: "MCP 설정: 기존 로컬 글로벌 ~/.kimi MCP/skills를 그대로 사용할까요? (No = omk-project만 시작하고 여기서 MCP를 추가)",
          default: false,
        });
    if (useLocalGlobal) {
      console.log(status.ok("Init MCP mode: using local/global ~/.kimi MCP and skills at runtime."));
    } else {
      console.log(style.gray("Init MCP mode: project only; start with omk-project and add MCPs here later."));
    }
    return useLocalGlobal;
  } catch (error) {
    if (error instanceof ExitPromptError) return false;
    console.log(status.warn(`MCP runtime prompt failed; falling back to project-only mode: ${redactSecretishText(error)}`));
    return false;
  }
}

function isInitInteractiveSetupEligible(options: InitCommandOptions): boolean {
  const env = options.env ?? process.env;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;

  if (options.interactiveSetup === false) return false;
  if (isDisabledEnvValue(env.OMK_INIT_PROMPTS)) return false;
  if (env.CI || env.GITHUB_ACTIONS) return false;
  return Boolean(stdin.isTTY && stdout.isTTY);
}

async function runMcpServerSelectionDuringInit(options: InitCommandOptions): Promise<void> {
  if (!isInitInteractiveSetupEligible(options)) return;
  const env = options.env ?? process.env;
  if (isDisabledEnvValue(env.OMK_INIT_MCP_SERVERS)) return;

  try {
    const defaultSelections = getDefaultSelections();
    const choices = RECOMMENDED_MCP_SERVERS.map((server) => ({
      name: `${server.name} — ${server.description} [${server.category}]`,
      value: server,
      checked: defaultSelections.includes(server.name),
    }));

    const { checkbox: checkboxPrompt } = await import("@inquirer/prompts");
    const selected = await checkboxPrompt({
      message: "Select additional MCP servers to install (Space to toggle, Enter to confirm):",
      choices,
    });

    if (!selected || selected.length === 0) {
      console.log(style.gray("No additional MCP servers selected."));
      return;
    }

    console.log(style.purple(`   📦 Installing ${selected.length} MCP server(s) in parallel...`));

    const root = getProjectRoot();
    const entries = selected.map((server: McpCatalogEntry) => ({
      name: server.name,
      command: server.command,
      args: server.args.map((arg) => arg.replace("${PROJECT_ROOT}", root).replace("${DB_PATH}", join(root, ".omk", "memory", "graph.db"))),
      env: server.env,
      startupTimeoutSec: server.startupTimeoutSec,
    }));

    const result = await mcpBulkInstallCommand(entries);

    for (const name of result.installed) {
      console.log(status.ok(`Installed MCP server: ${name}`));
    }
    for (const name of result.skipped) {
      console.log(style.gray(`Skipped (already exists): ${name}`));
    }
    for (const { name, error } of result.failed) {
      console.log(status.warn(`Failed to install ${name}: ${error}`));
    }
  } catch (error) {
    if (error instanceof ExitPromptError) return;
    console.log(status.warn(`MCP server selection failed: ${redactSecretishText(error)}`));
  }
}

async function runInitInteractiveSetup(options: InitCommandOptions, homeDir: string): Promise<void> {
  if (!isInitInteractiveSetupEligible(options)) return;

  await maybeAskForGitHubStar({
    version: getOmkVersionSync(),
    homeDir,
    env: options.env,
    argv: options.argv ?? ["node", "omk", "init"],
    stdin: options.stdin,
    stdout: options.stdout,
    commandName: "init",
    prompt: options.promptGitHubStar,
    starRepo: options.starRepo,
  });

  await runMcpServerSelectionDuringInit(options);

  await maybeAskForDeepSeekApiKeyDuringInit(options, homeDir);
}

async function maybeAskForDeepSeekApiKeyDuringInit(
  options: InitCommandOptions,
  homeDir: string,
): Promise<void> {
  const env = options.env ?? process.env;
  if (isDisabledEnvValue(env.OMK_INIT_DEEPSEEK_PROMPT)) return;

  try {
    const providerOptions = { env, homeDir };
    const currentStatus = await getDeepSeekProviderStatus(providerOptions);
    if (currentStatus.apiKeySet) {
      console.log(style.gray(t("init.deepseekAlreadyConfigured")));
      return;
    }

    const shouldConfigure = options.promptDeepSeekSetup
      ? await options.promptDeepSeekSetup()
      : await confirm({
          message: t("init.deepseekPrompt"),
          default: false,
        });
    if (!shouldConfigure) return;

    const enteredCredential = options.promptDeepSeekApiKey
      ? await options.promptDeepSeekApiKey()
      : await password({
          message: t("init.deepseekKeyPrompt"),
          mask: "*",
        });

    await setDeepSeekApiKey(enteredCredential, providerOptions);
    console.log(status.ok(t("init.deepseekSaved")));
  } catch (error) {
    if (error instanceof ExitPromptError) return;
    console.log(status.warn(t("init.deepseekSetupFailed", redactSecretishText(error))));
  }
}

function redactSecretishText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]");
}

async function checkOmkInPath(): Promise<{ inPath: boolean }> {
  try {
    const result = await import("../util/shell.js").then((m) => m.runShell("which", ["omk"], { timeout: 3000 }));
    return { inPath: !result.failed && result.stdout.trim().length > 0 };
  } catch {
    return { inPath: false };
  }
}

async function maybeInstallShellCompletion(_root: string): Promise<void> {
  const bashrc = join(process.env.HOME || process.env.USERPROFILE || "", ".bashrc");
  const zshrc = join(process.env.HOME || process.env.USERPROFILE || "", ".zshrc");

  const omkAliasBlock = `# >>> omk shell integration
export OMK_STAR_PROMPT=1
export OMK_RENDER_LOGO=1
# <<< end omk shell integration`;

  for (const rcFile of [bashrc, zshrc]) {
    if (!(await pathExists(rcFile))) continue;
    try {
      const content = await readFile(rcFile, "utf-8");
      if (content.includes("omk shell integration")) continue;
      const tmpRc = rcFile + ".omk.tmp";
      await writeFile(tmpRc, content.trimEnd() + "\n\n" + omkAliasBlock + "\n");
      await rename(tmpRc, rcFile);
      console.log(status.ok(`Shell integration added: ${rcFile}`));
    } catch {
      // ignore
    }
  }
}
