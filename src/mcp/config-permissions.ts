const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);
const MCP_PERMISSION_PROFILES = ["default", "docs", "repo", "browser", "graph"] as const;

export type McpPermissionProfile = typeof MCP_PERMISSION_PROFILES[number];

const WRITE_TOOL_PROFILES = new Map<string, Set<McpPermissionProfile>>([
  ["omk_memory_write", new Set(["docs", "repo", "browser", "graph"])],
  ["omk_write_memory", new Set(["docs", "repo", "browser", "graph"])],
  ["omk_goal_create", new Set(["repo", "browser"])],
  ["omk_goal_close", new Set(["repo", "browser"])],
  ["omk_goal_verify", new Set(["repo", "browser"])],
  ["omk_evidence_add", new Set(["repo", "browser"])],
  ["omk_evidence_check", new Set(["repo", "browser"])],
  ["omk_quality_gate", new Set(["repo", "browser"])],
  ["omk_run_quality_gate", new Set(["repo", "browser"])],
  ["omk_run_quality_gate_print", new Set(["repo", "browser"])],
  ["omk_write_todos", new Set(["repo", "browser"])],
  ["TodoWrite", new Set(["repo", "browser"])],
  ["omk_todo_write", new Set(["repo", "browser"])],
  ["todo_write", new Set(["repo", "browser"])],
  ["omk_save_checkpoint", new Set(["repo", "browser"])],
  ["omk_restore_checkpoint", new Set(["repo", "browser"])],
  ["omk_save_snippet", new Set(["docs", "repo", "browser", "graph"])],
  ["omk_delete_snippet", new Set(["repo", "browser"])],
  ["omk_write_config", new Set(["browser"])],
]);

export function canWriteConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUTHY_VALUES.has(String(env.OMK_MCP_ALLOW_WRITE_CONFIG ?? "").trim().toLowerCase());
}

export function configWriteDeniedMessage(): string {
  return "omk_write_config is disabled by default. Set OMK_MCP_ALLOW_WRITE_CONFIG=1 for trusted local sessions.";
}

export function getMcpPermissionProfile(env: NodeJS.ProcessEnv = process.env): McpPermissionProfile {
  const raw = String(env.OMK_MCP_PERMISSION_PROFILE ?? "default").trim().toLowerCase();
  return (MCP_PERMISSION_PROFILES as readonly string[]).includes(raw) ? (raw as McpPermissionProfile) : "default";
}

export function canCallMcpTool(toolName: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const allowedProfiles = WRITE_TOOL_PROFILES.get(toolName);
  if (!allowedProfiles) return true;
  const profile = getMcpPermissionProfile(env);
  if (!allowedProfiles.has(profile)) return false;
  if (toolName === "omk_write_config") return canWriteConfig(env);
  return true;
}

export function filterAllowedMcpTools<T extends { name: string }>(
  tools: readonly T[],
  env: NodeJS.ProcessEnv = process.env
): T[] {
  return tools.filter((tool) => canCallMcpTool(tool.name, env));
}

export function mcpToolDeniedMessage(toolName: string, env: NodeJS.ProcessEnv = process.env): string {
  if (toolName === "omk_write_config" && getMcpPermissionProfile(env) === "browser" && !canWriteConfig(env)) {
    return configWriteDeniedMessage();
  }
  const profile = getMcpPermissionProfile(env);
  return `${toolName} is not allowed by OMK MCP permission profile '${profile}'. Set OMK_MCP_PERMISSION_PROFILE to a trusted profile for write-capable tools.`;
}

/**
 * Recommended MCP permission profiles:
 *
 * - default : Read-only project info, goals, runs, and memory. Safe for general use.
 * - docs    : Includes default + write access to memory and ontology. For documentation agents.
 * - repo    : Includes docs + quality gates and evidence checks. For code-change agents.
 * - browser : Includes repo + config write approval. For agents that need to mutate project settings.
 * - graph   : Includes repo + full graph query and memory write. For ontology-heavy analysis agents.
 *
 * Profiles are enforced for write-capable omk-project MCP tools. Default sessions expose
 * read-only tools only; trusted local sessions can opt into docs/repo/browser/graph.
 */
