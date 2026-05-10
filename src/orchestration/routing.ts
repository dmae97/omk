import type { DagContextBudget, DagNode, DagNodeDefinition, DagNodeRouting } from "./dag.js";
import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { normalizeUserHomePath } from "../util/fs.js";

type RouteKind = "skill" | "mcp" | "tool" | "hook";
type RouteSource = "project" | "global" | "builtin";
type WriteRisk = "none" | "low" | "high";

interface RouteCandidate {
  kind: RouteKind;
  id: string;
  source: RouteSource;
  roles: string[];
  keywords: string[];
  readOnly: boolean;
  writeRisk: WriteRisk;
  contextCost: 1 | 2 | 3;
  capabilities: string[];
}

interface ScoredRoute {
  candidate: RouteCandidate;
  score: number;
  reason: string;
}

type RoutingInput = Pick<DagNodeDefinition, "id" | "name" | "role" | "inputs" | "outputs" | "cost">;

const MAX_SKILLS = 3;
const MAX_MCP_SERVERS = 2;
const MAX_TOOLS = 4;
const MAX_HOOKS = 4;
const OMK_PROJECT_TOOLS = [
  "omk_search_memory",
  "omk_read_memory",
  "omk_memory_mindmap",
  "omk_graph_query",
  "omk_list_agents",
  "omk_read_agent",
  "omk_list_runs",
  "omk_read_run",
  "omk_run_quality_gate",
  "omk_save_checkpoint",
  "omk_list_checkpoints",
  "omk_search_snippets",
  "omk_get_snippet",
];

export interface RoutingInventory {
  skills: Map<string, RouteSource>;
  mcpServers: Map<string, RouteSource>;
  hooks: Map<string, RouteSource>;
  tools: Set<string>;
  diagnostics: RoutingDiagnostic[];
  skillsScope: "project" | "all" | "none";
  mcpScope: "project" | "all" | "none";
  hooksScope: "project" | "all" | "none";
}

export interface RoutingDiagnostic {
  kind: "mcp-config";
  source: "project" | "global";
  path: string;
  message: string;
}

let inventoryCache: { key: string; value: RoutingInventory } | undefined;

const ROUTE_CANDIDATES: RouteCandidate[] = [
  {
    kind: "skill",
    id: "omk-repo-explorer",
    source: "project",
    roles: ["explorer", "researcher", "architect", "planner"],
    keywords: ["repo", "repository", "file", "symbol", "grep", "search", "map", "inspect", "discover", "코드", "검색", "탐색"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 1,
    capabilities: ["repo-map", "symbol-search", "small-context"],
  },
  {
    kind: "skill",
    id: "omk-industrial-control-loop",
    source: "project",
    roles: ["planner", "architect", "orchestrator", "router"],
    keywords: ["dag", "dependency", "graph", "workflow", "orchestration", "scheduler", "agent", "앙상블", "에이전트"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 1,
    capabilities: ["dag-design", "dependency-check", "quality-gate-shape"],
  },
  {
    kind: "skill",
    id: "omk-quality-gate",
    source: "project",
    roles: ["qa", "reviewer", "verifier", "tester"],
    keywords: ["quality", "gate", "test", "lint", "build", "typecheck", "verify", "검증", "테스트"],
    readOnly: false,
    writeRisk: "low",
    contextCost: 1,
    capabilities: ["verification", "test-command-selection"],
  },
  {
    kind: "skill",
    id: "omk-test-debug-loop",
    source: "project",
    roles: ["debugger", "tester", "coder"],
    keywords: ["bug", "error", "failure", "regression", "debug", "fix", "버그", "오류", "실패"],
    readOnly: false,
    writeRisk: "low",
    contextCost: 2,
    capabilities: ["debug-loop", "regression-tests"],
  },
  {
    kind: "skill",
    id: "omk-code-review",
    source: "project",
    roles: ["reviewer", "architect", "verifier"],
    keywords: ["review", "audit", "risk", "maintainability", "품질", "리뷰"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 1,
    capabilities: ["code-review", "risk-check"],
  },
  {
    kind: "skill",
    id: "omk-security-review",
    source: "project",
    roles: ["security", "reviewer"],
    keywords: ["security", "secret", "auth", "permission", "token", "credential", "보안", "시크릿"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 1,
    capabilities: ["security-review", "trust-boundary"],
  },
  {
    kind: "skill",
    id: "omk-secret-guard",
    source: "project",
    roles: ["security", "reviewer"],
    keywords: ["secret", "token", "credential", "env", "api key", "시크릿", "키"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 1,
    capabilities: ["secret-hygiene"],
  },
  {
    kind: "skill",
    id: "omk-research-verify",
    source: "project",
    roles: ["researcher", "architect", "planner"],
    keywords: ["paper", "docs", "official", "current", "api", "research", "논문", "문서", "공식"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 2,
    capabilities: ["official-docs", "citation-backed"],
  },
  {
    kind: "skill",
    id: "omk-context-broker",
    source: "project",
    roles: ["router", "planner", "architect"],
    keywords: ["context", "memory", "handoff", "checkpoint", "small context", "컨텍스트", "메모리"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 1,
    capabilities: ["context-pruning", "handoff"],
  },
  {
    kind: "skill",
    id: "omk-typescript-strict",
    source: "project",
    roles: ["coder", "reviewer"],
    keywords: ["typescript", "ts", "type", "strict", "타입"],
    readOnly: false,
    writeRisk: "low",
    contextCost: 1,
    capabilities: ["typescript", "strict-types"],
  },
  {
    kind: "skill",
    id: "omk-frontend-implementation",
    source: "project",
    roles: ["coder", "designer"],
    keywords: ["frontend", "ui", "component", "react", "design", "폼", "화면"],
    readOnly: false,
    writeRisk: "low",
    contextCost: 2,
    capabilities: ["frontend-implementation"],
  },
  {
    kind: "skill",
    id: "omk-design-system",
    source: "project",
    roles: ["designer", "reviewer"],
    keywords: ["design", "visual", "brand", "token", "ui", "디자인"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 1,
    capabilities: ["design-system"],
  },
  {
    kind: "mcp",
    id: "omk-project",
    source: "project",
    roles: ["router", "planner", "qa", "reviewer", "explorer"],
    keywords: ["memory", "quality", "run", "agent", "config", "checkpoint", "worktree", "mcp"],
    readOnly: false,
    writeRisk: "low",
    contextCost: 1,
    capabilities: ["project-memory", "quality-gate", "run-state", "agent-registry"],
  },
  {
    kind: "tool",
    id: "omk_search_memory",
    source: "project",
    roles: ["router", "planner", "explorer"],
    keywords: ["memory", "prior", "previous", "recall", "메모리", "이전"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 1,
    capabilities: ["memory-search"],
  },
  {
    kind: "tool",
    id: "omk_run_quality_gate",
    source: "project",
    roles: ["qa", "verifier", "reviewer"],
    keywords: ["quality", "gate", "lint", "typecheck", "test", "build", "검증"],
    readOnly: false,
    writeRisk: "low",
    contextCost: 1,
    capabilities: ["quality-gate"],
  },
  {
    kind: "tool",
    id: "SearchWeb",
    source: "builtin",
    roles: ["researcher", "architect", "planner"],
    keywords: ["paper", "official", "docs", "current", "latest", "논문", "최신", "공식"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 2,
    capabilities: ["external-research"],
  },
  {
    kind: "tool",
    id: "FetchURL",
    source: "builtin",
    roles: ["researcher", "architect", "planner"],
    keywords: ["paper", "official", "docs", "source", "citation", "논문", "문서"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 2,
    capabilities: ["source-reading"],
  },
  {
    kind: "hook",
    id: "awesome-agent-skills-router.sh",
    source: "project",
    roles: ["router", "orchestrator", "planner"],
    keywords: ["prompt", "route", "skill", "agent", "orchestration", "hook", "프롬프트", "라우팅", "에이전트"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 1,
    capabilities: ["prompt-routing", "skill-activation"],
  },
  {
    kind: "hook",
    id: "subagent-stop-audit.sh",
    source: "project",
    roles: ["reviewer", "qa", "verifier", "orchestrator"],
    keywords: ["subagent", "agent", "audit", "review", "verify", "parallel", "병렬", "검증"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 1,
    capabilities: ["subagent-audit", "completion-check"],
  },
  {
    kind: "hook",
    id: "stop-verify.sh",
    source: "project",
    roles: ["reviewer", "qa", "verifier"],
    keywords: ["stop", "verify", "quality", "gate", "test", "검증", "테스트"],
    readOnly: true,
    writeRisk: "none",
    contextCost: 1,
    capabilities: ["stop-verification", "quality-gate"],
  },
  {
    kind: "hook",
    id: "protect-secrets.sh",
    source: "project",
    roles: ["security", "reviewer", "coder"],
    keywords: ["secret", "token", "credential", "env", "write", "edit", "보안", "시크릿"],
    readOnly: false,
    writeRisk: "low",
    contextCost: 1,
    capabilities: ["secret-protection"],
  },
  {
    kind: "hook",
    id: "pre-shell-guard.sh",
    source: "project",
    roles: ["security", "coder", "qa"],
    keywords: ["shell", "command", "guard", "danger", "rm", "security", "명령", "보안"],
    readOnly: false,
    writeRisk: "low",
    contextCost: 1,
    capabilities: ["shell-guard"],
  },
  {
    kind: "hook",
    id: "post-format.sh",
    source: "project",
    roles: ["coder", "qa", "reviewer"],
    keywords: ["format", "write", "edit", "typescript", "lint", "코드", "수정"],
    readOnly: false,
    writeRisk: "low",
    contextCost: 1,
    capabilities: ["post-format"],
  },
];

export function selectTaskRouting(input: RoutingInput): DagNodeRouting {
  const inventory = discoverRoutingInventory();
  const text = normalizeText([
    input.id,
    input.name,
    input.role,
    ...(input.inputs ?? []).flatMap((item) => [item.name, item.ref, item.from ?? ""]),
    ...(input.outputs ?? []).flatMap((item) => [item.name, item.ref ?? "", item.gate ?? ""]),
  ].join(" "));
  const readOnly = inferReadOnly(input, text);
  const evidenceRequired = inferEvidenceRequired(input, text);
  const contextBudget = inferContextBudget(input, readOnly, evidenceRequired);
  const rejected: Array<{ id: string; reason: string }> = inventory.diagnostics
    .slice(0, 3)
    .map((diagnostic) => ({
      id: `mcp-config:${diagnostic.source}`,
      reason: `${diagnostic.path}: ${diagnostic.message}`,
    }));

  const scored = routeCandidates(inventory).flatMap((candidate): ScoredRoute[] => {
    const rejectReason = rejectionReason(candidate, readOnly, contextBudget, inventory);
    if (rejectReason) {
      rejected.push({ id: candidate.id, reason: rejectReason });
      return [];
    }
    const scoredRoute = scoreRoute(candidate, input.role, text, evidenceRequired, contextBudget);
    return scoredRoute.score > 0 ? [scoredRoute] : [];
  }).sort((a, b) => b.score - a.score || a.candidate.contextCost - b.candidate.contextCost || a.candidate.id.localeCompare(b.candidate.id));

  const skills = unique(scored.filter((item) => item.candidate.kind === "skill").map((item) => item.candidate.id)).slice(0, limitForBudget(contextBudget, MAX_SKILLS));
  const mcpServers = unique(scored.filter((item) => item.candidate.kind === "mcp").map((item) => item.candidate.id)).slice(0, limitForBudget(contextBudget, MAX_MCP_SERVERS));
  const tools = unique(scored.filter((item) => item.candidate.kind === "tool").map((item) => item.candidate.id)).slice(0, limitForBudget(contextBudget, MAX_TOOLS));
  const hooks = unique(scored.filter((item) => item.candidate.kind === "hook").map((item) => item.candidate.id)).slice(0, limitForBudget(contextBudget, MAX_HOOKS));

  if (skills.length === 0 && readOnly) skills.push("omk-repo-explorer");
  if (skills.length === 0) skills.push("omk-context-broker");
  addDefaultHookHints(hooks, inventory, input.role, readOnly, evidenceRequired);

  return {
    provider: "auto",
    fallbackProvider: "kimi",
    providerReason: "Kimi-first provider router decides at node execution time",
    skills,
    mcpServers,
    tools,
    hooks,
    contextBudget,
    readOnly,
    evidenceRequired,
    rationale: renderRationale(scored.slice(0, 3), contextBudget),
    rejected: rejected.slice(0, 6),
  };
}

export function resetRoutingInventoryCache(): void {
  inventoryCache = undefined;
}

export function mergeDagNodeRouting(auto: DagNodeRouting, override: DagNodeRouting | undefined): DagNodeRouting {
  if (!override) return auto;
  return {
    ...auto,
    ...override,
    provider: override.provider ?? auto.provider,
    fallbackProvider: override.fallbackProvider ?? auto.fallbackProvider,
    providerReason: override.providerReason ?? auto.providerReason,
    providerModelTier: override.providerModelTier ?? auto.providerModelTier,
    autoSpawned: override.autoSpawned ?? auto.autoSpawned,
    spawnReason: override.spawnReason ?? auto.spawnReason,
    routeSource: override.routeSource ?? auto.routeSource,
    skills: override.skills ? unique(override.skills) : auto.skills,
    mcpServers: override.mcpServers ? unique(override.mcpServers) : auto.mcpServers,
    tools: override.tools ? unique(override.tools) : auto.tools,
    hooks: override.hooks ? unique(override.hooks) : auto.hooks,
    rejected: override.rejected ?? auto.rejected,
  };
}

export function dagNodeRoutingEnv(node: DagNode): Record<string, string> {
  const routing = node.routing;
  if (!routing) return {};
  return {
    OMK_SKILL_HINTS: (routing.skills ?? []).join(","),
    OMK_MCP_HINTS: (routing.mcpServers ?? []).join(","),
    OMK_TOOL_HINTS: (routing.tools ?? []).join(","),
    OMK_HOOK_HINTS: (routing.hooks ?? []).join(","),
    OMK_ROUTE_SOURCE: routing.routeSource ?? "",
    OMK_ROUTE_AUTO_SPAWNED: String(routing.autoSpawned ?? false),
    OMK_ROUTE_SPAWN_REASON: routing.spawnReason ?? "",
    OMK_CONTEXT_BUDGET: routing.contextBudget ?? "small",
    OMK_ROUTE_READ_ONLY: String(routing.readOnly ?? false),
    OMK_ROUTE_EVIDENCE_REQUIRED: String(routing.evidenceRequired ?? false),
    OMK_ROUTE_RATIONALE: routing.rationale ?? "",
    OMK_PROVIDER_HINT: routing.provider ?? "auto",
    OMK_PROVIDER_MODEL_TIER: routing.providerModelTier ?? "",
    OMK_PROVIDER_FALLBACK: routing.fallbackProvider ?? "kimi",
    OMK_PROVIDER_REASON: routing.providerReason ?? "",
    OMK_ROUTE_REQUIRES_MCP: String(routing.requiresMcp ?? false),
    OMK_ROUTE_REQUIRES_TOOL_CALLING: String(routing.requiresToolCalling ?? false),
  };
}

function scoreRoute(
  candidate: RouteCandidate,
  role: string,
  text: string,
  evidenceRequired: boolean,
  contextBudget: DagContextBudget
): ScoredRoute {
  const roleMatch = candidate.roles.includes(role) ? 1 : 0;
  const keywordMatches = candidate.keywords.filter((keyword) => textMatchesKeyword(text, keyword)).length;
  const keywordScore = Math.min(1, keywordMatches / 2);
  const evidenceFit = evidenceRequired && candidate.capabilities.some((capability) => /quality|verification|review|official|citation/.test(capability)) ? 1 : 0;
  const smallContextFit = contextBudget === "tiny"
    ? candidate.contextCost === 1 ? 1 : 0
    : candidate.contextCost <= 2 ? 1 : 0.5;
  const safetyFit = candidate.writeRisk === "none" ? 1 : candidate.writeRisk === "low" ? 0.5 : 0;
  const localFit = candidate.source === "project" ? 0.08 : candidate.source === "builtin" ? 0.04 : 0;
  const score = (0.3 * roleMatch) + (0.25 * keywordScore) + (0.2 * evidenceFit) + (0.15 * smallContextFit) + (0.1 * safetyFit) + localFit;

  return {
    candidate,
    score,
    reason: [
      roleMatch ? "role" : "",
      keywordMatches > 0 ? `${keywordMatches} keyword` : "",
      evidenceFit ? "evidence" : "",
      smallContextFit ? "small-context" : "",
    ].filter(Boolean).join(", ") || "fallback",
  };
}

export function discoverRoutingInventory(projectRoot = getRoutingProjectRoot()): RoutingInventory {
  const root = resolve(projectRoot);
  const config = readFlatConfig(root);
  const skillsScope = normalizeScope(process.env.OMK_SKILLS_SCOPE ?? config["runtime.skills_scope"], "project");
  const mcpScope = normalizeScope(process.env.OMK_MCP_SCOPE ?? config["runtime.mcp_scope"], "project");
  const hooksScope = normalizeScope(process.env.OMK_HOOKS_SCOPE ?? config["runtime.hooks_scope"] ?? config["runtime.skills_scope"], "project");
  const key = [root, skillsScope, mcpScope, hooksScope].join("|");
  if (inventoryCache?.key === key) return inventoryCache.value;

  const skills = new Map<string, RouteSource>();
  for (const dir of skillDirs(root, skillsScope)) {
    for (const skill of readSkillNames(dir.path)) {
      if (!skills.has(skill)) skills.set(skill, dir.source);
    }
  }

  const mcpServers = new Map<string, RouteSource>();
  const mergedMcp = loadMergedMcpConfigSync(root, mcpScope);
  for (const server of readMcpServerNames({ mcpServers: mergedMcp.servers })) {
    const source = mergedMcp.sources.get(server) ?? "project";
    if (!mcpServers.has(server)) mcpServers.set(server, source);
  }

  const tools = new Set<string>(["SearchWeb", "FetchURL"]);
  if (mcpServers.has("omk-project")) {
    for (const tool of OMK_PROJECT_TOOLS) tools.add(tool);
  }

  const hooks = new Map<string, RouteSource>();
  for (const hook of readActiveHookNames(root, hooksScope)) {
    if (!hooks.has(hook.name)) hooks.set(hook.name, hook.source);
  }

  const value = { skills, mcpServers, hooks, tools, diagnostics: mergedMcp.diagnostics, skillsScope, mcpScope, hooksScope };
  inventoryCache = { key, value };
  return value;
}

function routeCandidates(inventory: RoutingInventory): RouteCandidate[] {
  const staticIds = new Set(ROUTE_CANDIDATES.map((candidate) => `${candidate.kind}:${candidate.id}`));
  const dynamicSkills: RouteCandidate[] = [...inventory.skills.entries()]
    .filter(([id]) => !staticIds.has(`skill:${id}`))
    .map(([id, source]) => dynamicSkillCandidate(id, source));
  const dynamicMcps: RouteCandidate[] = [...inventory.mcpServers.entries()]
    .filter(([id]) => !staticIds.has(`mcp:${id}`))
    .map(([id, source]) => dynamicMcpCandidate(id, source));
  const dynamicHooks: RouteCandidate[] = [...inventory.hooks.entries()]
    .filter(([id]) => !staticIds.has(`hook:${id}`))
    .map(([id, source]) => dynamicHookCandidate(id, source));
  return [...ROUTE_CANDIDATES, ...dynamicSkills, ...dynamicMcps, ...dynamicHooks];
}

function dynamicSkillCandidate(id: string, source: RouteSource): RouteCandidate {
  const keywords = keywordsFromId(id);
  const readOnly = !keywords.some((keyword) => ["write", "delete", "commit", "git", "fix", "implementation"].includes(keyword));
  return {
    kind: "skill",
    id,
    source,
    roles: rolesFromKeywords(keywords),
    keywords,
    readOnly,
    writeRisk: readOnly ? "none" : "low",
    contextCost: id.includes("flow") ? 2 : 1,
    capabilities: keywords,
  };
}

function dynamicMcpCandidate(id: string, source: RouteSource): RouteCandidate {
  const keywords = keywordsFromId(id);
  return {
    kind: "mcp",
    id,
    source,
    roles: rolesFromKeywords(keywords),
    keywords,
    readOnly: true,
    writeRisk: "none",
    contextCost: 1,
    capabilities: keywords,
  };
}

function dynamicHookCandidate(id: string, source: RouteSource): RouteCandidate {
  const keywords = keywordsFromId(id.replace(/\.(sh|js|mjs|ts)$/i, ""));
  return {
    kind: "hook",
    id,
    source,
    roles: rolesFromKeywords(keywords),
    keywords: [...keywords, "hook"],
    readOnly: !keywords.some((keyword) => ["write", "format", "shell", "guard", "secret"].includes(keyword)),
    writeRisk: keywords.some((keyword) => ["write", "format", "shell", "guard", "secret"].includes(keyword)) ? "low" : "none",
    contextCost: 1,
    capabilities: keywords,
  };
}

function rejectionReason(candidate: RouteCandidate, readOnly: boolean, budget: DagContextBudget, inventory: RoutingInventory): string | undefined {
  if (readOnly && candidate.writeRisk === "high") return "read-only node excludes high-risk write route";
  if (budget === "tiny" && candidate.contextCost === 3) return "tiny context budget excludes high-context route";
  if (candidate.kind === "skill" && !inventory.skills.has(candidate.id)) return `skill not installed in ${inventory.skillsScope} scope`;
  if (candidate.kind === "mcp" && !inventory.mcpServers.has(candidate.id)) return `MCP server not installed in ${inventory.mcpScope} scope`;
  if (candidate.kind === "hook" && !inventory.hooks.has(candidate.id)) return `hook not active in ${inventory.hooksScope} scope`;
  if (candidate.kind === "tool" && !inventory.tools.has(candidate.id)) return "tool unavailable from discovered MCP/builtin inventory";
  return undefined;
}

function inferReadOnly(input: RoutingInput, text: string): boolean {
  if ((input.outputs ?? []).some((output) => output.gate && output.gate !== "none")) return false;
  if (["explorer", "researcher", "reviewer", "architect", "planner", "router"].includes(input.role)) return true;
  return !/\b(write|edit|implement|fix|create|delete|modify|코드작성|수정|구현)\b/.test(text);
}

function inferEvidenceRequired(input: RoutingInput, text: string): boolean {
  return (input.outputs ?? []).some((output) => output.gate && output.gate !== "none")
    || ["qa", "reviewer", "verifier"].includes(input.role)
    || /\b(test|verify|evidence|quality|gate|citation|검증|테스트|근거)\b/.test(text);
}

function inferContextBudget(input: RoutingInput, readOnly: boolean, evidenceRequired: boolean): DagContextBudget {
  if (input.cost === 1 || (readOnly && !evidenceRequired)) return "tiny";
  if (input.cost === 3) return "normal";
  return "small";
}

function limitForBudget(budget: DagContextBudget, max: number): number {
  if (budget === "tiny") return Math.max(1, Math.min(max, 2));
  if (budget === "small") return Math.max(1, max);
  return max;
}

function renderRationale(scored: ScoredRoute[], budget: DagContextBudget): string {
  const summary = scored.map((item) => `${item.candidate.id}(${item.reason})`).join("; ");
  return `budget=${budget}; selected=${summary || "direct"}`;
}

function addDefaultHookHints(
  hooks: string[],
  inventory: RoutingInventory,
  role: string,
  readOnly: boolean,
  evidenceRequired: boolean
): void {
  const maybePush = (id: string): void => {
    if (hooks.length >= MAX_HOOKS) return;
    if (inventory.hooks.has(id) && !hooks.includes(id)) hooks.push(id);
  };
  if (["router", "orchestrator", "planner"].includes(role)) {
    maybePush("awesome-agent-skills-router.sh");
    maybePush("session-context.sh");
  }
  if (evidenceRequired || ["reviewer", "qa", "verifier"].includes(role)) {
    maybePush("subagent-stop-audit.sh");
    maybePush("stop-verify.sh");
  }
  if (!readOnly) {
    maybePush("protect-secrets.sh");
    maybePush("post-format.sh");
    maybePush("pre-shell-guard.sh");
  }
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function textMatchesKeyword(text: string, keyword: string): boolean {
  const normalized = normalizeText(keyword);
  if (normalized.length < 2) return false;
  if (/^[a-z0-9]+$/.test(normalized)) {
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
  }
  return text.includes(normalized);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function getRoutingProjectRoot(): string {
  return process.env.OMK_PROJECT_ROOT ? resolve(process.env.OMK_PROJECT_ROOT) : process.cwd();
}

function getRoutingUserHome(): string {
  return (
    normalizeUserHomePath(process.env.OMK_ORIGINAL_HOME)
    ?? normalizeUserHomePath(process.env.HOME)
    ?? normalizeUserHomePath(homedir())
    ?? homedir()
  );
}

function skillDirs(root: string, scope: RoutingInventory["skillsScope"]): Array<{ path: string; source: RouteSource }> {
  if (scope === "none") return [];
  const dirs: Array<{ path: string; source: RouteSource }> = [
    { path: join(root, ".agents", "skills"), source: "project" },
    { path: join(root, ".kimi", "skills"), source: "project" },
    { path: join(root, ".omk", "skills"), source: "project" },
  ];
  if (scope === "all") {
    const userHome = getRoutingUserHome();
    dirs.push(
      { path: join(userHome, ".codex", "skills"), source: "global" },
      { path: join(userHome, ".agents", "skills"), source: "global" },
      { path: join(userHome, ".kimi", "skills"), source: "global" },
    );
  }
  return dirs;
}

function readActiveHookNames(root: string, scope: RoutingInventory["hooksScope"]): Array<{ name: string; source: RouteSource }> {
  if (scope === "none") return [];
  const files: Array<{ path: string; source: RouteSource }> = [
    { path: join(root, ".omk", "kimi.config.toml"), source: "project" },
    { path: join(root, ".kimi", "kimi.config.toml"), source: "project" },
  ];
  if (scope === "all") {
    const userHome = getRoutingUserHome();
    files.unshift(
      { path: join(userHome, ".kimi", "kimi.config.toml"), source: "global" },
      { path: join(userHome, ".codex", "kimi.config.toml"), source: "global" },
    );
  }
  const result: Array<{ name: string; source: RouteSource }> = [];
  for (const file of files) {
    try {
      const content = readFileSync(file.path, "utf-8");
      for (const match of content.matchAll(/^\s*command\s*=\s*["']([^"']*hooks\/([^/"']+))["']/gm)) {
        const name = match[2]?.trim();
        if (name) result.push({ name, source: file.source });
      }
    } catch {
      // ignore missing or invalid hook config
    }
  }
  return result;
}

const SECRET_PATTERNS = ["apikey", "token", "password", "secret", "authorization"];

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  return SECRET_PATTERNS.some((pattern) => normalized === pattern || normalized.endsWith(pattern));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const sVal = source[key];
    const tVal = result[key];
    if (isPlainObject(sVal) && isPlainObject(tVal)) {
      result[key] = deepMerge(tVal, sVal);
    } else {
      result[key] = sVal;
    }
  }
  return result;
}

export function redactMcpConfig(cfg: unknown): unknown {
  if (isPlainObject(cfg)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(cfg)) {
      if (isSecretKey(key)) {
        result[key] = "***";
      } else if (isPlainObject(value)) {
        result[key] = redactMcpConfig(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) => redactMcpConfig(item));
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  if (Array.isArray(cfg)) {
    return cfg.map((item) => redactMcpConfig(item));
  }
  return cfg;
}

function loadMergedMcpConfigSync(
  projectRoot: string,
  scope: "project" | "all" | "none"
): { servers: Record<string, unknown>; sources: Map<string, "project" | "global">; diagnostics: RoutingDiagnostic[] } {
  const root = resolve(projectRoot);
  const servers: Record<string, unknown> = {};
  const sources = new Map<string, "project" | "global">();
  const diagnostics: RoutingDiagnostic[] = [];

  if (scope === "none") {
    return { servers, sources, diagnostics };
  }

  const globalFiles = scope === "all" ? [join(getRoutingUserHome(), ".kimi", "mcp.json")] : [];

  for (const path of globalFiles) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as { mcpServers?: Record<string, unknown> };
      for (const [name, cfg] of Object.entries(parsed.mcpServers ?? {})) {
        if (!sources.has(name)) {
          servers[name] = cfg;
          sources.set(name, "global");
        }
      }
    } catch (err) {
      diagnostics.push(createMcpConfigDiagnostic(root, "global", path, err));
    }
  }

  const projectFiles = [
    join(root, ".omk", "mcp.json"),
    join(root, ".kimi", "mcp.json"),
  ];

  for (const path of projectFiles) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as { mcpServers?: Record<string, unknown> };
      for (const [name, cfg] of Object.entries(parsed.mcpServers ?? {})) {
        if (!sources.has(name) || sources.get(name) === "global") {
          if (sources.has(name) && isPlainObject(servers[name]) && isPlainObject(cfg)) {
            servers[name] = deepMerge(servers[name] as Record<string, unknown>, cfg as Record<string, unknown>);
          } else {
            servers[name] = cfg;
          }
          sources.set(name, "project");
        }
      }
    } catch (err) {
      diagnostics.push(createMcpConfigDiagnostic(root, "project", path, err));
    }
  }

  return { servers, sources, diagnostics };
}

export function loadMergedMcpConfig(
  projectRoot: string,
  scope: "project" | "all" | "none"
): Promise<{ servers: Record<string, unknown>; sources: Map<string, "project" | "global">; diagnostics: RoutingDiagnostic[] }> {
  return Promise.resolve(loadMergedMcpConfigSync(projectRoot, scope));
}

function createMcpConfigDiagnostic(
  root: string,
  source: "project" | "global",
  path: string,
  err: unknown
): RoutingDiagnostic {
  return {
    kind: "mcp-config",
    source,
    path: formatRoutingPath(root, path),
    message: mcpConfigErrorMessage(err),
  };
}

function formatRoutingPath(root: string, path: string): string {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  if (resolvedPath === resolvedRoot) return ".";
  if (resolvedPath.startsWith(`${resolvedRoot}/`)) return resolvedPath.slice(resolvedRoot.length + 1);
  const home = getRoutingUserHome();
  if (resolvedPath.startsWith(`${home}/`)) return `~/${resolvedPath.slice(home.length + 1)}`;
  return resolvedPath;
}

function mcpConfigErrorMessage(err: unknown): string {
  if (err instanceof SyntaxError) return "invalid JSON";
  if (err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string") {
    return `unreadable MCP config (${(err as { code: string }).code})`;
  }
  return "invalid MCP config";
}

function readSkillNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "SKILL.md")))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readMcpServerNames(config: { mcpServers?: Record<string, unknown> }): string[] {
  return Object.keys(config.mcpServers ?? {});
}

function readFlatConfig(root: string): Record<string, string> {
  try {
    return parseSimpleToml(readFileSync(join(root, ".omk", "config.toml"), "utf-8"));
  } catch {
    return {};
  }
}

function parseSimpleToml(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  let section = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = section ? `${section}.${kv[1].trim()}` : kv[1].trim();
    result[key] = normalizeConfigValue(kv[2].trim());
  }
  return result;
}

function normalizeConfigValue(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeScope(value: string | undefined, fallback: RoutingInventory["skillsScope"]): RoutingInventory["skillsScope"] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "none" || normalized === "off" || normalized === "disabled") return "none";
  if (normalized === "all" || normalized === "global") return "all";
  if (normalized === "project" || normalized === "local") return "project";
  return fallback;
}

function keywordsFromId(id: string): string[] {
  return unique(id.replace(/^omk-/, "").split(/[-_]/).filter((keyword) => keyword.length >= 2));
}

function rolesFromKeywords(keywords: string[]): string[] {
  if (keywords.some((keyword) => ["review", "security", "quality"].includes(keyword))) return ["reviewer", "qa"];
  if (keywords.some((keyword) => ["test", "debug", "fix"].includes(keyword))) return ["debugger", "tester", "coder"];
  if (keywords.some((keyword) => ["frontend", "implementation", "typescript", "python"].includes(keyword))) return ["coder"];
  if (keywords.some((keyword) => ["repo", "research", "docs"].includes(keyword))) return ["researcher", "explorer"];
  if (keywords.some((keyword) => ["plan", "flow", "dag", "context", "router"].includes(keyword))) return ["planner", "router"];
  return ["planner", "router", "reviewer"];
}
