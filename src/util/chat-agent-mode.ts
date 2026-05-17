import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, relative, resolve } from "path";
import type { OmkMode } from "./mode-preset.js";
import { getRunPath } from "./fs.js";
import type { OmkRuntimeScope } from "./resource-profile.js";
import {
  readRootAgentSubagents,
  writeScopedAgentFile,
  type ScopedSubagentRef,
} from "./scoped-agent-file.js";

export interface ChatAgentModeResources {
  workers: string;
  maxStepsPerTurn?: string;
  resourceProfile?: string;
  approvalPolicy?: string;
  providerPolicy?: string;
  ensembleDefaultEnabled?: boolean;
  mcpScope: OmkRuntimeScope;
  skillsScope: OmkRuntimeScope;
  hooksScope?: OmkRuntimeScope;
  mcpNames: string[];
  skillNames: string[];
  hookNames: string[];
}

export interface PrepareChatAgentModeInput {
  root: string;
  runId: string;
  baseAgentFile: string;
  basePromptPath: string;
  mode: OmkMode;
  resources: ChatAgentModeResources;
}

export interface PreparedChatAgentMode {
  agentFile: string;
  promptPath: string;
  contractPath: string;
  harnessPath: string;
}

export interface ChatAgentHarnessManifest {
  schemaVersion: 1;
  runId: string;
  mode: OmkMode;
  resources: {
    workers: string;
    workerBudget: number;
    workerCap: number;
    maxStepsPerTurn: string;
    resourceProfile: string;
    approvalPolicy: string;
    providerPolicy: string;
    ensembleDefault: "enabled" | "disabled";
    scopes: {
      mcp: string;
      skills: string;
      hooks: string;
    };
    active: {
      mcp: string[];
      skills: string[];
      hooks: string[];
    };
  };
  virtualDag: {
    flow: "chat-agent-parallel-harness";
    nodes: ChatAgentHarnessNode[];
    failurePolicy: {
      optionalLanes: string[];
      blockingLanes: string[];
    };
  };
  capabilityPolicy: {
    maxCapabilityAgents: number;
    useMcp: boolean;
    useSkills: boolean;
    useHooks: boolean;
    mcpNames: string[];
    skillNames: string[];
    hookNames: string[];
  };
  gates: string[];
  authority: string[];
  stopConditions: string[];
}

export interface ChatAgentHarnessNode {
  id: string;
  role: string;
  source: "bootstrap" | "coordinator" | "provider" | "capability" | "worker" | "review" | "quality" | "security" | "design";
  dependsOn: string[];
  required: boolean;
  condition?: string;
}

interface SharedLanePlan {
  providerNodes: ChatAgentHarnessNode[];
  capabilityNodes: ChatAgentHarnessNode[];
  workerNodes: ChatAgentHarnessNode[];
}

export function buildChatAgentModeContract(input: {
  mode: OmkMode;
  runId: string;
  resources: ChatAgentModeResources;
}): string {
  const modeContract = modeBehaviorLines(input.mode);
  const resources = input.resources;
  const parallelContract = buildParallelAlgorithmInjection(resources);
  const harness = buildChatAgentHarnessManifest(input);
  return [
    "# OMK Chat Agent Runtime Contract",
    "",
    `- Run ID: ${input.runId}`,
    `- Mode: ${input.mode}`,
    `- Worker budget: ${resources.workers}`,
    `- Parallel worker cap: ${parallelContract.workerCap}`,
    `- Max steps per turn: ${resources.maxStepsPerTurn ?? "runtime-default"}`,
    `- Resource profile: ${resources.resourceProfile ?? "runtime-default"}`,
    `- Approval policy: ${resources.approvalPolicy ?? "interactive"}`,
    `- Provider policy: ${resources.providerPolicy ?? "auto"}`,
    `- Ensemble default: ${resources.ensembleDefaultEnabled === false ? "disabled" : "enabled"}`,
    `- MCP scope: ${resources.mcpScope}`,
    `- Skills scope: ${resources.skillsScope}`,
    `- Hooks scope: ${resources.hooksScope ?? "project"}`,
    `- Active MCP (${harness.resources.active.mcp.length}): ${formatInventoryList(harness.resources.active.mcp)}`,
    `- Active skills (${harness.resources.active.skills.length}): ${formatInventoryList(harness.resources.active.skills)}`,
    `- Active hooks (${harness.resources.active.hooks.length}): ${formatInventoryList(harness.resources.active.hooks)}`,
    `- Harness manifest: ./chat-agent-harness.json`,
    "",
    "## Mode behavior",
    ...modeContract.map((line) => `- ${line}`),
    "",
    "## Agent-mode orchestration rules",
    "- Treat every non-trivial user prompt as an orchestration request unless the user explicitly asks for plain chat.",
    "- Classify the request first: direct answer, plan-only, implement, debug, review, docs, or security.",
    "- Convert raw user input into an IntentFrame and ActionAtoms before delegation; raw prompt text is audit-only and must not be reused as worker prompts or lane names.",
    "- For implement/debug/review/security work: create todos, use the relevant skills, activate useful MCP tools, and delegate bounded subagents when the task is non-trivial.",
    "- Keep the root chat context focused on decisions, integration, and verification; send repo exploration, coding, review, or QA details to subagents.",
    "- Do not ask for permission for safe local reversible inspect/edit/test loops; ask only for destructive, credential-gated, external-production, or materially branching actions.",
    "- Before finalizing a task, report changed files, commands run, pass/fail evidence, and remaining risk.",
    "",
    parallelContract.text,
  ].join("\n");
}

export function buildChatAgentHarnessManifest(input: {
  mode: OmkMode;
  runId: string;
  resources: ChatAgentModeResources;
}): ChatAgentHarnessManifest {
  const resources = normalizeHarnessResources(input.resources);
  const lanePlan = buildSharedLanePlan(resources);
  const maxCapabilityAgents = lanePlan.capabilityNodes.length;
  const { providerNodes, capabilityNodes, workerNodes } = lanePlan;
  const synthesisInputs = [...providerNodes, ...capabilityNodes, ...workerNodes].map((node) => node.id);

  return {
    schemaVersion: 1,
    runId: input.runId,
    mode: input.mode,
    resources,
    virtualDag: {
      flow: "chat-agent-parallel-harness",
      nodes: [
        { id: "bootstrap", role: "omk", source: "bootstrap", dependsOn: [], required: true },
        { id: "root-coordinator", role: "orchestrator-or-architect", source: "coordinator", dependsOn: ["bootstrap"], required: true },
        ...providerNodes,
        ...capabilityNodes,
        ...workerNodes,
        { id: "review-merge", role: "reviewer-or-aggregator", source: "review", dependsOn: synthesisInputs, required: true },
        { id: "quality-check", role: "qa-or-tester", source: "quality", dependsOn: ["review-merge"], required: true, condition: "implementation, bugfix, refactor, migrate, security, test, or general task" },
        { id: "security-audit", role: "security", source: "security", dependsOn: ["review-merge"], required: true, condition: "intent.needsSecurityReview" },
        { id: "design-review", role: "designer", source: "design", dependsOn: ["review-merge"], required: false, condition: "intent.needsDesignReview" },
      ],
      failurePolicy: {
        optionalLanes: [...providerNodes, ...capabilityNodes, { id: "design-review" }].map((node) => node.id),
        blockingLanes: ["bootstrap", "root-coordinator", "review-merge", "security-audit"],
      },
    },
    capabilityPolicy: {
      maxCapabilityAgents,
      useMcp: resources.active.mcp.length > 0,
      useSkills: resources.active.skills.length > 0,
      useHooks: resources.active.hooks.length > 0,
      mcpNames: resources.active.mcp,
      skillNames: resources.active.skills,
      hookNames: resources.active.hooks,
    },
    gates: [
      "create/update todos for multi-step work",
      "load relevant memory/MCP context before planning when available",
      "run smallest proving check first",
      "run targeted tests for changed behavior",
      "run npm run check before final implementation claims",
      "run npm test when risk or changed scope warrants full validation",
      "report changed files, commands, pass/fail, not-run items, remaining risk",
    ],
    authority: [
      "Kimi/OMK chat owns edits, merge, and final synthesis",
      "DeepSeek lanes are read-only or advisory",
      "MCP/tool lanes may use live authority only through Kimi-owned guarded execution",
      "Hooks are constraints and guardrails, not bypasses",
      "Secrets must never be printed, stored, or copied into artifacts",
    ],
    stopConditions: [
      "no pending virtual lanes",
      "review-merge synthesis complete",
      "required quality/security gates are passed or explicitly reported",
      "known failures and verification gaps are reported",
    ],
  };
}

export function buildParallelAlgorithmInjection(resources: ChatAgentModeResources): {
  text: string;
  workerCap: number;
  workerLanes: number;
  capabilityLanes: number;
  providerLanes: number;
} {
  const normalized = normalizeHarnessResources(resources);
  const workerCap = normalized.workerCap;
  const lanePlan = buildSharedLanePlan(normalized);
  const providerPolicy = normalized.providerPolicy;
  const approvalPolicy = normalized.approvalPolicy;
  const resourceProfile = normalized.resourceProfile;
  const ensembleDefault = normalized.ensembleDefault;

  return {
    workerCap,
    workerLanes: lanePlan.workerNodes.length,
    capabilityLanes: lanePlan.capabilityNodes.length,
    providerLanes: lanePlan.providerNodes.length,
    text: [
      "## Injected parallel DAG algorithm",
      "- Treat OMK Chat agent mode as the interactive front-door for the same planning model used by `omk parallel`.",
      "- Progressive intent algorithm: Raw Input -> IntentFrame -> ActionAtoms -> Evidence DAG -> Novelty Guard -> Replan/Continue.",
      "- Strict action DAG: keep raw input in audit/digest artifacts only; worker/capability/model lanes receive role, scope, input evidence, expected output, and done condition from ActionAtoms.",
      "- For every non-trivial prompt, synthesize a virtual DAG before acting: bootstrap(done) -> root-coordinator -> model/capability/worker lanes -> review-merge -> quality/security/design gates.",
      `- Runtime defaults: profile=${resourceProfile}; approval=${approvalPolicy}; provider=${providerPolicy}; ensemble=${ensembleDefault}; workerCap=${workerCap}; workerLanes=${lanePlan.workerNodes.length}; capabilityLanes=${lanePlan.capabilityNodes.length}; providerLanes=${lanePlan.providerNodes.length}.`,
      "- Intent schema to infer before delegation: taskType, complexity, estimatedWorkers, requiredRoles, isReadOnly, needsResearch, needsSecurityReview, needsTesting, needsDesignReview, parallelizable, rationale.",
      "- Effective lanes: use the shared OMK_WORKERS budget for model, capability, and worker lanes together; create at least one worker lane when the budget is non-zero.",
      "- Coordinator role: use architect for plan/migrate/security; otherwise use orchestrator. Coordinator owns plan, lane boundaries, conflict control, and final synthesis.",
      "- Worker role selection: remove planner/orchestrator/architect/router from requiredRoles; cycle remaining roles across worker-N lanes; default to coder when no worker role remains.",
      `- Capability-agent routing: when workers>=2 and intent is parallelizable, non-simple, or taskType is bugfix/implement/migrate/plan/refactor/review/security/test/general, allocate up to ${lanePlan.capabilityNodes.length} lanes to active MCP, skills, and hooks routing within the shared lane cap.`,
      "- DeepSeek model-agent routing: for read-only, parallelizable, non-simple, or bugfix/implement/migrate/plan/refactor/review/security/test tasks, spawn read-only Flash quick-decomposition and Pro critique lanes when DeepSeek is available.",
      "- DeepSeek authority boundary: DeepSeek direct lanes are read-only; file-affecting DeepSeek output is advisory only; Kimi/OMK chat owns edits, merge authority, and final verification.",
      "- Worker failure policy: worker/deepseek/capability lanes are retryable and may be skipped without blocking synthesis; security-audit blocks dependents; QA/design report risks without widening scope.",
      "- Synthesis: review-merge depends on every model, capability, and worker lane; DeepSeek/capability lane outputs are optional evidence, normal worker outputs are required unless explicitly marked unavailable.",
      "- Quality gate: for implement/bugfix/refactor/migrate/security/test/general, run the smallest proving check first; default command-pass gate is `npm run check`, then targeted tests, then full suite when risk warrants.",
      "- Security/design gates: add security-audit when intent.needsSecurityReview is true; add design-review when intent.needsDesignReview is true; do not expose secrets in findings.",
      "- Task playbooks:",
      "  - explore/research: split by subsystem/question, stay read-only, synthesize findings.",
      "  - bugfix: one lane reproduces, others isolate root cause; patch minimally; add regression test.",
      "  - refactor: preserve behavior; split by file group or abstraction boundary; test before/after when possible.",
      "  - review: split correctness/security/maintainability; cite files/lines; rank severity.",
      "  - test: split happy path/edge/failure/isolation checks; report deterministic coverage delta.",
      "  - security: audit trust boundaries, secret handling, input validation; provide remediation.",
      "  - implement: split by component/file boundary; follow existing conventions; include tests/docs.",
      "- Memory/MCP/skills: load relevant project memory before planning when available, use only role-relevant skills/MCP per lane, and checkpoint durable decisions after risky or multi-lane work.",
      "- Chat stop condition: no pending lanes, synthesis complete, verification evidence captured, known failures/risks reported.",
      "- Run artifact: read `chat-agent-harness.json` for the full MCP/skills/hooks inventory, virtual DAG template, authority boundaries, and gate list instead of expanding huge inventories in the chat prompt.",
    ].join("\n"),
  };
}

export async function prepareChatAgentModeAgent(input: PrepareChatAgentModeInput): Promise<PreparedChatAgentMode> {
  const runDir = getRunPath(input.runId, undefined, input.root);
  await mkdir(runDir, { recursive: true });

  const contract = buildChatAgentModeContract({
    mode: input.mode,
    runId: input.runId,
    resources: input.resources,
  });
  const basePrompt = await readFile(input.basePromptPath, "utf-8").catch(() => defaultRootPrompt());
  const prompt = [
    basePrompt.trimEnd(),
    "",
    "---",
    "",
    contract,
    "",
  ].join("\n");

  const promptPath = resolve(runDir, "chat-agent-prompt.md");
  const contractPath = resolve(runDir, "chat-agent-contract.md");
  const harnessPath = resolve(runDir, "chat-agent-harness.json");
  const agentFile = resolve(runDir, "chat-agent.yaml");
  const roleWrappersDir = resolve(runDir, "roles");
  const baseAgentRel = relative(dirname(agentFile), input.baseAgentFile) || input.baseAgentFile;
  const harness = buildChatAgentHarnessManifest({
    mode: input.mode,
    runId: input.runId,
    resources: input.resources,
  });

  await writeFile(promptPath, prompt, "utf-8");
  await writeFile(contractPath, `${contract}\n`, "utf-8");
  await writeFile(harnessPath, `${JSON.stringify(harness, null, 2)}\n`, "utf-8");
  const subagents = await writeRunScopedSubagentWrappers({
    baseAgentFile: input.baseAgentFile,
    roleWrappersDir,
    agentFile,
    resources: input.resources,
  });
  await writeFile(agentFile, renderChatAgentYaml(baseAgentRel, input.resources, subagents), "utf-8");

  return { agentFile, promptPath, contractPath, harnessPath };
}

function modeBehaviorLines(mode: OmkMode): string[] {
  if (mode === "chat") {
    return [
      "Chat-only: answer conversationally and do not modify files unless the user explicitly switches mode or asks for code changes.",
      "Use repo/MCP context only when it materially improves the answer.",
    ];
  }
  if (mode === "plan") {
    return [
      "Plan-only: produce a concrete plan, acceptance criteria, risk list, and verification commands before implementation.",
      "Do not edit files unless the user explicitly approves execution.",
    ];
  }
  if (mode === "debugging") {
    return [
      "Debugging: reproduce or inspect the exact failing path, isolate root cause, patch minimally, and rerun the failing check.",
      "Do not broaden into unrelated refactors.",
    ];
  }
  if (mode === "review") {
    return [
      "Review: inspect changed scope, identify correctness/security/test risks, and produce actionable findings with evidence.",
      "Do not modify files unless the user asks for fixes.",
    ];
  }
  return [
    "Agent: autonomously execute clear local tasks end-to-end with plan, subagents, implementation, and verification.",
    "Prefer parallel subagents for independent discovery/review/QA lanes when that improves throughput.",
  ];
}

function normalizeHarnessResources(resources: ChatAgentModeResources): ChatAgentHarnessManifest["resources"] {
  const workerBudget = parseWorkerBudget(resources.workers);
  const workerCap = Math.min(workerBudget, 6);
  return {
    workers: resources.workers,
    workerBudget,
    workerCap,
    maxStepsPerTurn: resources.maxStepsPerTurn ?? "runtime-default",
    resourceProfile: resources.resourceProfile ?? "runtime-default",
    approvalPolicy: resources.approvalPolicy ?? "interactive",
    providerPolicy: resources.providerPolicy ?? "auto",
    ensembleDefault: resources.ensembleDefaultEnabled === false ? "disabled" : "enabled",
    scopes: {
      mcp: resources.mcpScope,
      skills: resources.skillsScope,
      hooks: resources.hooksScope ?? "project",
    },
    active: {
      mcp: normalizeNameList(resources.mcpNames),
      skills: normalizeNameList(resources.skillNames),
      hooks: normalizeNameList(resources.hookNames),
    },
  };
}

function buildSharedLanePlan(resources: ChatAgentHarnessManifest["resources"]): SharedLanePlan {
  const capabilityCandidates = buildCapabilityHarnessNodeCandidates(resources);
  const providerNodes: ChatAgentHarnessNode[] = [];
  const capabilityNodes: ChatAgentHarnessNode[] = [];
  const workerNodes: ChatAgentHarnessNode[] = [];
  let remaining = resources.workerCap;

  if (remaining > 0 && capabilityCandidates.length > 0) {
    capabilityNodes.push(capabilityCandidates[0]);
    remaining -= 1;
  }

  while (remaining > 0) {
    workerNodes.push(createWorkerHarnessNode(workerNodes.length + 1));
    remaining -= 1;
  }

  return { providerNodes, capabilityNodes, workerNodes };
}

function createWorkerHarnessNode(index: number): ChatAgentHarnessNode {
  return {
    id: `worker-${index}`,
    role: "intent-selected",
    source: "worker",
    dependsOn: ["root-coordinator"],
    required: true,
  };
}

function buildCapabilityHarnessNodeCandidates(resources: ChatAgentHarnessManifest["resources"]): ChatAgentHarnessNode[] {
  const nodes: ChatAgentHarnessNode[] = [];
  if (resources.active.skills.length > 0) {
    nodes.push({
      id: "capability-skill-agent",
      role: "explorer",
      source: "capability",
      dependsOn: ["root-coordinator"],
      required: false,
      condition: "active skill inventory matches task intent",
    });
  }
  if (resources.active.mcp.length > 0) {
    nodes.push({
      id: "capability-mcp-agent",
      role: "researcher",
      source: "capability",
      dependsOn: ["root-coordinator"],
      required: false,
      condition: "active MCP/tool inventory matches task intent",
    });
  }
  if (resources.active.hooks.length > 0) {
    nodes.push({
      id: "capability-hook-agent",
      role: "reviewer",
      source: "capability",
      dependsOn: ["root-coordinator"],
      required: false,
      condition: "active hooks provide guardrails for task intent",
    });
  }
  return nodes;
}

function formatInventoryList(values: string[]): string {
  if (values.length === 0) return "none";
  const normalized = normalizeNameList(values);
  return `count=${normalized.length}; digest=${inventoryDigest(normalized)}; full=chat-agent-harness.json`;
}

function renderInventoryHint(values: string[], scope: OmkRuntimeScope): string {
  if (scope === "none") return "disabled";
  const normalized = normalizeNameList(values);
  if (normalized.length === 0) return "count=0;digest=000000000000";
  return `count=${normalized.length};digest=${inventoryDigest(normalized)};top=${normalized.slice(0, 3).join("|")}`;
}

function inventoryDigest(values: string[]): string {
  return createHash("sha256").update(values.join("\n")).digest("hex").slice(0, 12);
}

function normalizeNameList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean).map((value) => value.slice(0, 120)))].sort();
}

function parseWorkerBudget(value: string): number {
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "auto") {
    return parseWorkerBudget(process.env.OMK_MAX_WORKERS ?? "1");
  }
  if (!/^[1-9]\d*$/.test(trimmed)) return 1;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

async function writeRunScopedSubagentWrappers(input: {
  baseAgentFile: string;
  roleWrappersDir: string;
  agentFile: string;
  resources: ChatAgentModeResources;
}): Promise<ScopedSubagentRef[]> {
  const refs = await readRootAgentSubagents(input.baseAgentFile);
  const outputs = new Map<string, string>();
  for (const ref of refs) {
    if (outputs.has(ref.role)) continue;
    const outputFile = resolve(input.roleWrappersDir, `${ref.role}.yaml`);
    outputs.set(ref.role, outputFile);
    await writeScopedAgentFile({
      baseAgentFile: ref.baseAgentFile,
      outputFile,
      role: ref.role,
      resources: {
        mcpScope: input.resources.mcpScope,
        skillsScope: input.resources.skillsScope,
        hooksScope: input.resources.hooksScope ?? "project",
        mcpNames: input.resources.mcpNames,
        skillNames: input.resources.skillNames,
        hookNames: input.resources.hookNames,
      },
    });
  }
  return refs.map((ref) => {
    const outputFile = outputs.get(ref.role) ?? ref.baseAgentFile;
    const relPath = relative(dirname(input.agentFile), outputFile).replace(/\\/g, "/");
    return {
      alias: ref.alias,
      path: relPath.startsWith(".") ? relPath : `./${relPath}`,
      description: ref.description,
    };
  });
}

function renderChatAgentYaml(baseAgentRel: string, resources: ChatAgentModeResources, subagents: ScopedSubagentRef[] = []): string {
  const mcpEnabled = resources.mcpScope === "none" ? "false" : "true";
  const skillsEnabled = resources.skillsScope === "none" ? "false" : "true";
  const hooksEnabled = resources.hooksScope === "none" ? "false" : "true";
  const lines = [
    "version: 1",
    "agent:",
    `  extend: ${JSON.stringify(baseAgentRel)}`,
    "  name: omk-chat-agent",
    "  system_prompt_path: ./chat-agent-prompt.md",
    "  system_prompt_args:",
    "    OMK_ROLE: \"root-coordinator\"",
    `    OMK_MCP_ENABLED: "${mcpEnabled}"`,
    `    OMK_SKILLS_ENABLED: "${skillsEnabled}"`,
    `    OMK_HOOKS_ENABLED: "${hooksEnabled}"`,
    `    OMK_MCP_HINTS: ${JSON.stringify(renderInventoryHint(resources.mcpNames, resources.mcpScope))}`,
    `    OMK_SKILL_HINTS: ${JSON.stringify(renderInventoryHint(resources.skillNames, resources.skillsScope))}`,
    `    OMK_TOOL_HINTS: "count=0;digest=000000000000"`,
    `    OMK_HOOK_HINTS: ${JSON.stringify(renderInventoryHint(resources.hookNames, resources.hooksScope ?? "project"))}`,
    `    OMK_CONTEXT_BUDGET: "normal"`,
    `    OMK_ROUTE_READ_ONLY: "false"`,
  ];
  if (subagents.length) {
    lines.push("  subagents:");
    for (const subagent of subagents) {
      lines.push(`    ${subagent.alias}:`);
      lines.push(`      path: ${JSON.stringify(subagent.path)}`);
      if (subagent.description) {
        lines.push(`      description: ${JSON.stringify(subagent.description)}`);
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}

function defaultRootPrompt(): string {
  return [
    "# oh-my-kimi Root Agent",
    "",
    "You are the oh-my-kimi root coordinator.",
    "",
    "Apply AGENTS.md silently, use relevant skills/MCP tools, and verify before completion.",
  ].join("\n");
}
