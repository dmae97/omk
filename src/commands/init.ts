import { realpathSync } from "node:fs";
import type { Dirent } from "node:fs";
import { mkdir, writeFile, readFile, copyFile, readdir, stat } from "fs/promises";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..", "..");

interface McpServerDefinition {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

type JsonObject = Record<string, unknown>;

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

const OKABE_AGENT_YAML = `version: 1
agent:
  extend: default
  name: omk-okabe-base
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
    # D-Mail checkpoints: real save/restore substance via MCP tools
    #   omk_save_checkpoint   -> capture git diff + todos + state
    #   omk_list_checkpoints  -> browse saved checkpoints
    #   omk_restore_checkpoint -> apply patch and restore run files
    - "kimi_cli.tools.dmail:SendDMail"
`;

const ROOT_AGENT_YAML = `version: 1
agent:
  extend: ./okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-root
  system_prompt_path: ../prompts/root.md
  system_prompt_args:
    OMK_ROLE: "root-coordinator"
  subagents:
    explorer:
      path: ./roles/explorer.yaml
      description: "Read-only repository exploration and context mapping"
    explore:
      path: ./roles/explorer.yaml
      description: "Alias for explorer; kept for compatibility with older OMK instructions"
    planner:
      path: ./roles/planner.yaml
      description: "Architecture, refactor, migration, and implementation planning"
    plan:
      path: ./roles/planner.yaml
      description: "Alias for planner; kept for compatibility with older OMK instructions"
    coder:
      path: ./roles/coder.yaml
      description: "Scoped implementation in the current project"
    reviewer:
      path: ./roles/reviewer.yaml
      description: "Adversarial code review and risk detection"
    qa:
      path: ./roles/qa.yaml
      description: "Run and analyze lint, typecheck, test, and build results"
`;

const ROLE_YAMLS: Record<string, string> = {
  interviewer: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-interviewer
  system_prompt_args:
    OMK_ROLE: "interviewer"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  architect: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-architect
  system_prompt_args:
    OMK_ROLE: "architect"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  planner: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-planner
  system_prompt_args:
    OMK_ROLE: "planner"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  explorer: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-explorer
  system_prompt_args:
    OMK_ROLE: "explorer"
`,
  coder: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-coder
  system_prompt_args:
    OMK_ROLE: "coder"
`,
  reviewer: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-reviewer
  system_prompt_args:
    OMK_ROLE: "reviewer"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  qa: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-qa
  system_prompt_args:
    OMK_ROLE: "qa"
`,
  integrator: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-integrator
  system_prompt_args:
    OMK_ROLE: "integrator"
`,
  researcher: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-researcher
  system_prompt_args:
    OMK_ROLE: "researcher"
`,
  ontology: `version: 1
agent:
  extend: ../okabe.yaml
  name: omk-ontology
  system_prompt_args:
    OMK_ROLE: "ontology"
  description: >
    Kuzu-backed ontology curator. Creates ontology node/relationship tables,
    ingests project concepts, and answers Cypher/GraphQL-lite queries against
    the local graph. Use omk_graph_query, omk_memory_ontology, and
    omk_memory_mindmap tools to inspect and evolve the project ontology.
`,
  "vision-debugger": `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-vision-debugger
  system_prompt_args:
    OMK_ROLE: "vision-debugger"
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

Use AGENTS.md as the canonical project instruction source.
Use DESIGN.md as the canonical visual identity source.
`;

const CLAUDE_MD = `# CLAUDE.md

@./AGENTS.md
@./DESIGN.md

Use AGENTS.md as the canonical project instruction source.
Use DESIGN.md for UI/frontend work.
`;

const ROADMAP_MD = `# Roadmap

## v0.1
- init / doctor / chat / team
- P0 skills
- AGENTS.md / DESIGN.md generation
- quality gate hooks

## v0.2
- Wire controller
- HUD
- run state
- worker logs

## v0.3
- worktree team
- merge queue
- reviewer / qa / integrator agents

## v0.4
- Google DESIGN.md integration
- Stitch skills installer
- screenshot UI review

## v0.5
- MCP project server
- plugin pack
- CI agent mode
`;

const SECURITY_MD = `# Security Policy

## Reporting Vulnerabilities

Please report security issues via GitHub Issues with the \`security\` label.

## Built-in Protections

oh-my-kimi includes default hooks to block destructive commands and secret leakage.

## Best Practices

- Review hooks before running in production repositories.
- Use \`--print\` mode only in disposable worktrees.
- Never commit secrets into agent memory files.
`;

const ROOT_PROMPT_MD = `# oh-my-kimi Root Agent

You are the oh-my-kimi root coordinator.

You must operate as a Kimi-native coding orchestrator.

## Loaded Project Instructions

\${KIMI_AGENTS_MD}

## Loaded Skills

\${KIMI_SKILLS}

## Global Rules

- Apply AGENTS.md silently.
- Do not repeat boilerplate.
- Use SetTodoList for multi-step tasks.
- Use Agent tool for non-trivial tasks.
- Use skills when relevant.
- Use MCP tools when configured and useful.
- Treat project-local ontology graph memory as mandatory when the omk-project MCP exposes memory tools.
- Recall relevant project memory before work, write durable findings through omk_write_memory, and use omk_memory_mindmap/omk_graph_query for graph recall.
- Prefer plan-first execution.
- Prefer small, reviewable diffs.
- Verify before completion.
- Never claim tests passed unless they were run.

## Kimi-native Context Tools

- Root and generated role agents inherit an Okabe-compatible base that keeps default tools and adds SendDMail for checkpoint rollback scenarios.
- Use D-Mail before risky refactors, compaction, or long-running branch points: send a concise future-facing recovery note to the relevant checkpoint.
- Use Kimi subagents for isolated context and parallel work; keep the root context focused on decisions, integration, and verification.
- Prefer /compact or a D-Mail recovery note over dumping large history back into the prompt.

## Required Workflow

For non-trivial tasks:

1. Read project instructions.
2. Create todos.
3. Launch an appropriate subagent:
   - explorer for repository discovery
   - planner for architecture/refactor/risky work
   - coder for implementation
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
      '디자인', '화면', '프론트', '랜딩', '컴포넌트', '시각', '스크린샷', '반응형', '접근성', '프로토타입',
    ],
    skills: ['open-design', 'awesome-design-md', 'omk-design-md', 'omk-flow-design-to-code', 'omk-multimodal-ui-review'],
    note: 'For visual work, read DESIGN.md, reuse tokens, use awesome-design-md references when a named style is requested, and launch localhost with omk design open-design when interactive design is useful.',
  },
  {
    id: 'bugfix-debug',
    patterns: [
      'bug', 'error', 'failed', 'failure', 'traceback', 'exception', 'fix', 'regression', 'broken', 'debug',
      '버그', '에러', '오류', '실패', '고쳐', '수정', '안됨', '안돼', '문제', '디버그',
    ],
    skills: ['omk-flow-bugfix', 'omk-quality-gate'],
    note: 'For failures, isolate root cause first, keep the patch small, and rerun the failing command plus the quality gate.',
  },
  {
    id: 'feature-build',
    patterns: [
      'implement', 'build', 'add ', 'create', 'scaffold', 'generate', 'feature', 'new command',
      '구현', '추가', '만들', '생성', '기능', '신규',
    ],
    skills: ['omk-plan-first', 'omk-flow-feature-dev', 'omk-quality-gate'],
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
    skills: ['omk-flow-refactor', 'omk-quality-gate'],
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
    skills: ['omk-task-router', 'omk-project-rules', 'omk-kimi-runtime', 'omk-flow-team-run'],
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

if ! command -v node &>/dev/null; then
  echo '{"hookSpecificOutput":{"hookEventName":"SubagentStop","additionalContext":"Subagent finished. Leader must review changed files, integrate results, and run relevant quality gates before final."}}'
  exit 0
fi

node <<'NODE'
const context = [
  'OMK subagent completion audit.',
  '- Do not claim success from a subagent report alone.',
  '- Review the concrete files changed, reconcile conflicts, and keep unrelated user edits intact.',
  '- Run the relevant quality gates locally and report pass/fail/not-run evidence.',
].join('\\n');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SubagentStop',
    additionalContext: context,
  },
}) + '\\n');
NODE
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
COMMAND=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))')
ARGS=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("args",""))')

FULL="$COMMAND $ARGS"

# Block list
BLOCKED=(
  "rm -rf /"
  "rm -rf ~"
  "sudo"
  "git push --force"
  "git push -f"
  "git clean -fdx"
  "chmod -R 777"
  "docker system prune"
  "kubectl delete"
  "aws s3 rm --recursive"
  "curl | bash"
  "curl | sh"
  "wget | bash"
  "wget | sh"
  "mkfs"
  "dd if="
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
# they can publish external state. Require explicit opt-in plus fresh evidence.
RELEASE_GUARDED=(
  "git push"
  "npm publish"
  "pnpm publish"
  "yarn npm publish"
  "gh release create"
  "gh workflow run"
  "npm version"
)

for pattern in "\${RELEASE_GUARDED[@]}"; do
  if [[ "$FULL" == *"$pattern"* ]] && [[ "\${OMK_ALLOW_RELEASE:-0}" != "1" ]]; then
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Release/deploy command blocked by OMK release guard. Re-run with OMK_ALLOW_RELEASE=1 only after an explicit user request and fresh verification evidence."}}'
    exit 0
  fi
done

echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
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
FILEPATH=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))')
CONTENT=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("content",""))')

# Block direct modification of sensitive files
SENSITIVE_PATHS=(".env" ".pem" ".key" "id_rsa" "id_ed25519" "credentials" "service-account" ".p12" ".pfx" ".keystore")
for sp in "\${SENSITIVE_PATHS[@]}"; do
  if [[ "$FILEPATH" == *"$sp"* ]]; then
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Direct modification of sensitive file blocked: '"$sp"'"}}'
    exit 0
  fi
done

# Keyword detection (JWT, cloud tokens, private keys, etc.)
if echo "$CONTENT" | grep -qiE '(password|secret|api_key|auth|bearer|token|private_key|aws_access_key_id|aws_secret_access_key|akiai|asiai|ghp_|github_pat|sk-|glpat-|npm_|pypi_|docker_auth|private.?key|BEGIN .* PRIVATE KEY|ssh-rsa|ssh-ed25519)'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Potential secret leak detected"}}'
  exit 0
fi

echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
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
  "stop-verify.sh": `#!/usr/bin/env bash
# Final verification on Stop
set -euo pipefail

if ! command -v node &>/dev/null; then
  echo '{"hookSpecificOutput":{"hookEventName":"Stop","permissionDecision":"allow","additionalContext":"Before final: list changed files, commands run, passed, failed, not run, and remaining risk. Do not claim deploy/publish unless verified."}}'
  exit 0
fi

node <<'NODE'
const context = [
  'OMK final response checklist.',
  '- Changed files: list authored files and note any ignored local runtime files refreshed.',
  '- Commands run: include exact verification commands and pass/fail/not-run status.',
  '- Deployment status: do not claim push, release, npm publish, or production deploy unless that command actually ran and evidence was read.',
  '- Remaining risk: state known gaps instead of saying complete without evidence.',
].join('\\n');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'Stop',
    permissionDecision: 'allow',
    additionalContext: context,
  },
}) + '\\n');
NODE
`,
};

const KIMI_CONFIG_TOML = `# oh-my-kimi generated Kimi config
# Lifecycle hook settings

[[hooks]]
event = "SessionStart"
command = ".omk/hooks/session-context.sh"
timeout = 5

[[hooks]]
event = "UserPromptSubmit"
command = ".omk/hooks/awesome-agent-skills-router.sh"
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
event = "PostToolUse"
matcher = "WriteFile|StrReplaceFile"
command = ".omk/hooks/post-format.sh"
timeout = 20

[[hooks]]
event = "Stop"
command = ".omk/hooks/stop-verify.sh"
timeout = 30
`;

const DEFAULT_PROJECT_MCP_COMMENT =
  "Project-local MCP config. Global MCP servers remain in ~/.kimi/mcp.json; import explicitly only after secret review.";

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
    'omk_bin="$(command -v omk 2>/dev/null || command -v oh-my-kimi 2>/dev/null || true)"',
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
    'echo "omk-project MCP server not found; install @oh-my-kimi/cli or rerun omk init" >&2',
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

function createMcpJson(projectRoot: string): { mcpServers: Record<string, McpServerDefinition> } {
  return {
    mcpServers: {
      // Safe default for open-source scaffolds: local project server only.
      // Remote MCPs that require API keys should be added explicitly by the user.
      "omk-project": createOmkProjectMcpServer(projectRoot),
    },
  };
}

function mergeProjectMcpConfig(existingRaw: string | null, omkProjectServer: McpServerDefinition): JsonObject {
  const existing = parseProjectMcpConfig(existingRaw);
  const next: JsonObject = { ...existing };
  const existingServers = isJsonObject(existing.mcpServers) ? existing.mcpServers : {};
  next._comment = typeof next._comment === "string" && next._comment.trim() ? next._comment : DEFAULT_PROJECT_MCP_COMMENT;
  next.mcpServers = {
    ...existingServers,
    "omk-project": omkProjectServer,
  };
  return next;
}

function parseProjectMcpConfig(raw: string | null): JsonObject {
  if (raw === null || !raw.trim()) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isJsonObject(parsed)) return parsed;
  } catch {
    // Fall through to a safe project-local MCP scaffold. Global MCPs are never
    // imported here, so an invalid project file cannot leak user secrets.
  }
  return {};
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RuntimeScope = "all" | "project";

function getConfigToml(options: { mcpScope: RuntimeScope; skillsScope: RuntimeScope }): string {
  const { mcpScope, skillsScope } = options;
  return `# oh-my-kimi project settings
[project]
name = "my-project"
description = ""

[orchestration]
default_workers = 2
max_retries = 3
approval_policy = "auto"         # safe default: safe tools auto, destructive ask
yolo_mode = false                # safe guards still block secrets/destructive shell hooks

[runtime]
# auto chooses lite on <=18GB RAM hosts to make 16GB laptops usable.
resource_profile = "auto"        # auto | lite | standard
mcp_scope = "${mcpScope}"            # all | project | none — all also reads user ~/.kimi/mcp.json at runtime
skills_scope = "${skillsScope}"         # all | project | none — all reads user ~/.kimi/skills without copying them
max_workers = 1                  # can override with OMK_MAX_WORKERS
max_output_mb = 4                # cap buffered shell/quality output
wire_output_mb = 1               # cap per-task retained wire output

[ensemble]
# Role-aware agent ensemble. Keep max_parallel=1 for 16GB/WSL safety.
enabled = true
max_candidates_per_node = 2
max_parallel = 1
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
research_thinking = "disabled"
coding_thinking = "enabled"
`;
}

const MEMORY_FILES: Record<string, string> = {
  "project.md": "# Project Memory\n\nThe project-local ontology graph (.omk/memory/graph-state.json) is the source of truth; this file is a human-readable mirror.\n",
  "decisions.md": "# Decisions\n\nRecord important architecture/design decisions. Also decomposed into Decision nodes in the local graph memory.\n",
  "commands.md": "# Frequently Used Commands\n\nCommand mirror maintained alongside the local graph memory.\n\n```bash\n# example\n```\n",
  "risks.md": "# Known Risks\n\n- \n",
};

export async function initCommand(options: InitCommandOptions): Promise<void> {
  const root = getProjectRoot();
  const initHomeDir = normalizeUserHomePath(options.homeDir) ?? getUserHome(options.env ?? process.env);
  const mcpJson = createMcpJson(root);
  console.log(header(`oh-my-kimi init (profile: ${options.profile})`));
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
    await writeFile(rootYamlPath, ROOT_AGENT_YAML);
  }
  await Promise.all(
    Object.entries(ROLE_YAMLS).map(([name, content]) =>
      writeFile(join(root, ".omk/agents/roles", `${name}.yaml`), content)
    )
  );

  // 4. Write prompts
  await writeFile(join(root, ".omk/prompts/root.md"), ROOT_PROMPT_MD);

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

  if (await pathExists(kimiSkillsSrc)) {
    console.log(style.purple(t("init.copyKimiSkills")));
    skillCopies.push(copySafeSkillRoot(kimiSkillsSrc, join(root, ".kimi", "skills")).then(() => undefined));
  } else {
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
  await writeFile(join(root, ".omk/config.toml"), getConfigToml({
    mcpScope: localUserRuntime ? "all" : "project",
    skillsScope: localUserRuntime ? "all" : "project",
  }));
  await writeFile(join(root, ".omk/kimi.config.toml"), KIMI_CONFIG_TOML);
  await writeFile(join(root, ".omk/mcp.json"), JSON.stringify(mcpJson, null, 2) + "\n");

  // Project-local MCP config must not import global server definitions by default:
  // global configs can contain inline headers/env secrets that should stay in the user scope.
  const projectMcpPath = join(root, ".kimi", "mcp.json");
  const existingProjectMcp = await readFile(projectMcpPath, "utf-8").catch(() => null);
  await writeFile(
    projectMcpPath,
    JSON.stringify(mergeProjectMcpConfig(existingProjectMcp, mcpJson.mcpServers["omk-project"]), null, 2) + "\n"
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

  console.log(status.success("oh-my-kimi initialized."));
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
  if (localUserRuntime) {
    console.log("- Local user runtime enabled: global ~/.kimi/mcp.json and ~/.kimi/skills are used at runtime.");
    console.log("- Personal/global MCP servers and skills are not copied into the project.");
  } else {
    console.log("- Project MCP defaults to omk-project only; remote/global MCPs are explicit opt-in.");
  }
  console.log("- Built-in tools: SearchWeb, FetchURL (no config required).");

  console.log(style.gray("  Fresh init does not copy user-global skills or MCP servers into the project."));
  console.log(style.gray("  Trusted local users can add --local-user --home-dir <~/.kimi/mcp.json> for runtime-only global MCP/skills, or --import-user-skills to copy reviewed personal skills."));

  await runInitInteractiveSetup(options, initHomeDir);

  // ── Shell integration & PATH check ──
  const pathCheck = await checkOmkInPath();
  if (!pathCheck.inPath) {
    console.log("");
    console.log(style.orange("⚠️  omk is not in PATH."));
    console.log(style.gray("   Run one of the following:"));
    console.log(style.gray("   1) npm install -g @oh-my-kimi/cli"));
    console.log(style.gray("   2) npm link (for development)"));
    console.log(style.gray("   3) alias omk='npx @oh-my-kimi/cli'"));
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
      await writeFile(rcFile, content.trimEnd() + "\n\n" + omkAliasBlock + "\n");
      console.log(status.ok(`Shell integration added: ${rcFile}`));
    } catch {
      // ignore
    }
  }
}
