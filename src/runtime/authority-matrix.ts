import type { AgentRuntime, AgentTask } from "./agent-runtime.js";

export type RuntimeMode = "api" | "cli" | "wire" | "mcp" | "local" | "composite" | string;

export type AuthorityOperation =
  | "read"
  | "review"
  | "write"
  | "patch"
  | "shell"
  | "mcp"
  | "merge"
  | "vision"
  | "toolCalling";

export interface RuntimeAuthorityMatrixEntry {
  readonly providerId: string;
  readonly runtimeMode: RuntimeMode;
  readonly authorities: readonly AuthorityOperation[];
  readonly advisory: boolean;
  readonly notes?: string;
}

export const RUNTIME_AUTHORITY_MATRIX: readonly RuntimeAuthorityMatrixEntry[] = [
  {
    providerId: "kimi",
    runtimeMode: "api",
    authorities: ["read", "review", "vision", "toolCalling"],
    advisory: true,
    notes: "Moonshot/Kimi API is advisory; no direct workspace write/shell/merge authority.",
  },
  {
    providerId: "kimi",
    runtimeMode: "wire",
    authorities: ["read", "review", "write", "patch", "vision", "toolCalling"],
    advisory: false,
    notes: "Kimi wire/CLI compatibility path can edit through the OMK-controlled adapter, but shell/merge still require explicit authority.",
  },
  {
    providerId: "kimi",
    runtimeMode: "cli",
    authorities: ["read", "review", "write", "patch", "vision", "toolCalling"],
    advisory: false,
    notes: "Legacy Kimi CLI compatibility path is available only when explicitly requested; shell/merge remain separately gated.",
  },
  {
    providerId: "mimo",
    runtimeMode: "api",
    authorities: ["read", "review"],
    advisory: true,
    notes: "MiMo API is read/review/thinking only until a write-capable runtime-mode contract exists.",
  },
  {
    providerId: "deepseek",
    runtimeMode: "api",
    authorities: ["read", "review"],
    advisory: true,
  },
  {
    providerId: "glm",
    runtimeMode: "api",
    authorities: ["read", "review"],
    advisory: true,
  },
  {
    providerId: "codex",
    runtimeMode: "cli",
    authorities: ["read", "review", "write", "patch", "shell"],
    advisory: false,
    notes: "Codex CLI authority is bounded by OMK approval/sandbox policy; merge remains withheld.",
  },
  {
    providerId: "opencode",
    runtimeMode: "cli",
    authorities: ["read", "review", "write", "patch", "shell"],
    advisory: false,
  },
  {
    providerId: "commandcode",
    runtimeMode: "cli",
    authorities: ["read", "review", "write", "patch", "shell"],
    advisory: false,
  },
  {
    providerId: "local-llm",
    runtimeMode: "api",
    authorities: ["read", "review"],
    advisory: true,
  },
  {
    providerId: "openrouter",
    runtimeMode: "api",
    authorities: ["read", "review", "vision", "toolCalling"],
    advisory: true,
    notes: "OpenRouter API is advisory unless paired with an OMK-owned write/shell adapter.",
  },
  {
    providerId: "qwen",
    runtimeMode: "api",
    authorities: ["read", "review", "vision", "toolCalling"],
    advisory: true,
    notes: "Qwen API is advisory unless paired with an OMK-owned write/shell adapter.",
  },
];

export function runtimeProviderId(runtime: Pick<AgentRuntime, "providerId" | "id">): string {
  return runtime.providerId ?? runtime.id.split("-")[0] ?? runtime.id;
}

export function runtimeModeOf(runtime: Pick<AgentRuntime, "runtimeMode" | "kind" | "id">): RuntimeMode {
  if (runtime.runtimeMode) return runtime.runtimeMode;
  if (runtime.kind) return runtime.kind;
  const suffix = runtime.id.split("-").slice(1).join("-");
  if (suffix === "api" || suffix === "cli" || suffix === "wire") return suffix;
  return "api";
}

export function getRuntimeAuthorityEntry(runtime: Pick<AgentRuntime, "providerId" | "runtimeMode" | "kind" | "id">): RuntimeAuthorityMatrixEntry | undefined {
  const providerId = runtimeProviderId(runtime);
  const runtimeMode = runtimeModeOf(runtime);
  return RUNTIME_AUTHORITY_MATRIX.find((entry) => entry.providerId === providerId && entry.runtimeMode === runtimeMode);
}

export function authoritiesForRuntime(runtime: Pick<AgentRuntime, "providerId" | "runtimeMode" | "kind" | "id" | "capabilities">): readonly AuthorityOperation[] {
  const entry = getRuntimeAuthorityEntry(runtime);
  const caps = runtime.capabilities;
  if (entry) {
    const granted = new Set<AuthorityOperation>(entry.authorities);
    // Provider/mode entries remain the source of truth for write/shell/merge.
    // Add only explicitly declared auxiliary capabilities so test/fake runtimes
    // and future adapters can expose MCP/tool contracts without broadening
    // destructive authority by provider name alone.
    if (caps?.mcp === true) granted.add("mcp");
    if (caps?.vision === true) granted.add("vision");
    if (caps?.toolCalling === true || caps?.supportsToolCalling === true) granted.add("toolCalling");
    return [...granted];
  }
  if (!caps) return ["read"];
  const derived: AuthorityOperation[] = [];
  for (const op of ["read", "review", "write", "patch", "shell", "mcp", "merge", "vision"] as const) {
    if (caps[op] === true) derived.push(op);
  }
  if (caps.toolCalling === true || caps.supportsToolCalling === true) derived.push("toolCalling");
  return derived.length > 0 ? derived : ["read"];
}

export function runtimeIsAdvisory(runtime: Pick<AgentRuntime, "providerId" | "runtimeMode" | "kind" | "id" | "capabilities">): boolean {
  const entry = getRuntimeAuthorityEntry(runtime);
  if (entry) return entry.advisory;
  return runtime.capabilities?.advisory === true;
}

export function requiredAuthorityForTask(task: Pick<AgentTask, "capabilities">): readonly AuthorityOperation[] {
  const required: AuthorityOperation[] = ["read"];
  const caps = task.capabilities;
  if (caps.review) required.push("review");
  if (caps.write) required.push("write");
  if (caps.patch) required.push("patch");
  if (caps.shell) required.push("shell");
  if (caps.mcp) required.push("mcp");
  if (caps.merge) required.push("merge");
  if (caps.vision) required.push("vision");
  if (caps.toolCalling) required.push("toolCalling");
  return [...new Set(required)];
}

export function runtimeSatisfiesAuthority(runtime: AgentRuntime, task: AgentTask): { ok: boolean; missing: readonly AuthorityOperation[]; reason?: string } {
  const granted = new Set(authoritiesForRuntime(runtime));
  const required = requiredAuthorityForTask(task);
  const missing = required.filter((op) => !granted.has(op));
  if (missing.length === 0) return { ok: true, missing: [] };
  return {
    ok: false,
    missing,
    reason: `runtime ${runtime.id} (${runtimeProviderId(runtime)}:${runtimeModeOf(runtime)}) lacks required authority: ${missing.join(", ")}`,
  };
}

export function authorityCapableProviderIds(required: readonly AuthorityOperation[]): string[] {
  return [...new Set(
    RUNTIME_AUTHORITY_MATRIX
      .filter((entry) => required.every((op) => entry.authorities.includes(op)))
      .map((entry) => entry.providerId),
  )];
}
