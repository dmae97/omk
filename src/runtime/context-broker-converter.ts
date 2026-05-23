import type { ContextCapsule } from "./context-capsule.js";
import type {
  AgentTask,
  AgentContext,
  ToolManifest,
  ProviderPolicy,
  CapabilityManifest,
} from "./agent-runtime.js";

export async function capsuleToTask(
  capsule: ContextCapsule,
  signal?: AbortSignal
): Promise<AgentTask> {
  const node = capsule.node;
  const routing = node.routing;

  const context: AgentContext = {
    runId: capsule.runId,
    nodeId: capsule.nodeId,
    role: node.role,
    goal: capsule.goal,
    system: capsule.system,
    files: capsule.relevantFiles.map((f) => f.path),
    memory: capsule.graphMemory.map((m) => ({
      key: m.key,
      source: m.kind,
      summary: m.value,
    })),
    abortSignal: signal,
    cwd: undefined,
    env: undefined,
  };

  const toolNames =
    routing?.tools ?? routing?.assignedCapabilities?.tools ?? [];
  const tools: ToolManifest = {
    available: toolNames.map((name) => ({
      name,
      description: "",
      inputSchema: {},
    })),
    mcpServers: routing?.mcpServers ?? [],
    skills: routing?.skills ?? [],
    hooks: routing?.hooks ?? [],
  };

  const preferredProviders: string[] = [];
  if (routing?.provider && routing.provider !== "auto") {
    preferredProviders.push(routing.provider);
  }
  if (routing?.candidateProviders?.length) {
    preferredProviders.push(...routing.candidateProviders);
  }

  const fallbackChain: string[] = [];
  if (routing?.fallbackProvider) {
    fallbackChain.push(routing.fallbackProvider);
  }

  const providerPolicy: ProviderPolicy = {
    strategy: "priority-first",
    preferredProviders,
    fallbackChain,
    maxCost: undefined,
    maxLatencyMs: undefined,
  };

  const capabilities: CapabilityManifest = {
    read: true,
    write: routing?.readOnly === true ? false : true,
    shell: true,
    mcp: routing?.requiresMcp ?? false,
    patch: true,
    review: true,
    merge: true,
    vision: true,
    streaming: true,
    structuredOutput: true,
    toolCalling: routing?.requiresToolCalling ?? false,
    maxTokens: capsule.budget.maxInputTokens,
  };

  const task: AgentTask = {
    prompt: capsule.task,
    context,
    tools,
    providerPolicy,
    capabilities,
  };

  return task;
}
