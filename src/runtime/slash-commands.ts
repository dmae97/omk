import { readFile } from "node:fs/promises";

import type { CommandEnvelope, OmkEvent } from "./contracts/command-envelope.js";
import type { CommandBusResult, CommandHandler } from "./command-bus.js";
import {
  KNOWN_PROVIDER_IDS,
  normalizeProviderId,
  parseProviderModelArg,
  providerDoctorStatus,
  readProviderRegistry,
} from "../providers/model-registry.js";
import type { ProviderId } from "../providers/types.js";
import { groupProviderModelsByProvider, renderProviderModelTable } from "../providers/model-table.js";
import {
  formatThinkingModelVariant,
  nextThinkingLevel,
  normalizeThinkingLevel,
  normalizeThinkingVariant,
  thinkingLevelsFor,
} from "../providers/thinking-levels.js";
import { buildMcpDoctorReport } from "../commands/mcp/doctor.js";
import { evaluateHeadroom, isHeadroomEnabled } from "./headroom-policy.js";
import { buildOmkToolPlaneManifest } from "./tool-plane.js";
import { LocalGraphMemoryStore } from "../memory/local-graph-memory-store.js";
import { createReasoningTraceStore, redactTrace, summarizeTrace } from "./reasoning-trace.js";
import { getActiveRuntimePreset, getOmkResourceSettings } from "../util/resource-profile.js";

export interface SlashCommandResult {
  readonly kind: "status" | "mutation" | "error";
  readonly command: string;
  readonly payload: unknown;
  readonly renderMode: "theme" | "nlp" | "json";
  readonly sideEffects: readonly RuntimeSideEffect[];
}

export type RuntimeSideEffect =
  | { readonly type: "provider_changed"; readonly provider: string; readonly model: string }
  | { readonly type: "thinking_changed"; readonly thinking: string; readonly modelVariant: string }
  | { readonly type: "session_updated"; readonly sessionId: string }
  | { readonly type: "memory_written"; readonly memoryId: string }
  | { readonly type: "theme_changed"; readonly theme: string };

export interface SlashCommandInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly rawText: string;
  readonly state: {
    readonly provider?: string;
    readonly model?: string;
    readonly sessionId?: string;
    readonly theme?: string;
    readonly thinking?: string;
    readonly activeProviderTab?: string;
  };
}

export interface SlashCommandHandler {
  execute(input: SlashCommandInput): Promise<SlashCommandResult>;
}

function parseSlashInput(rawText: string): { command: string; args: string[] } {
  const trimmed = rawText.trimStart();
  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)\s*(.*)/s);
  if (!match) return { command: "", args: [] };
  const command = match[1]?.toLowerCase() ?? "";
  const argStr = match[2]?.trim() ?? "";
  const args = argStr ? argStr.split(/\s+/) : [];
  return { command, args };
}

function resultToCommandBusResult(result: SlashCommandResult): CommandBusResult {
  const output = JSON.stringify(result.payload, null, 2);
  const events: OmkEvent[] = [
    {
      type: "result",
      timestamp: new Date().toISOString(),
      data: {
        kind: "result",
        content: renderSlashResultContent(result, output),
        format: result.renderMode,
      },
    },
  ];
  return {
    handled: true,
    events,
    output,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(payload: Record<string, unknown>, key: string, fallback = 0): number {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(payload: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = payload[key];
  return typeof value === "boolean" ? value : fallback;
}

function recordArrayValue(payload: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isRecord(item)) : [];
}

function stringValue(payload: Record<string, unknown>, key: string, fallback = "unknown"): string {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function stringListValue(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function renderSlashResultContent(result: SlashCommandResult, fallback: string): string {
  if (result.renderMode === "json" || !isRecord(result.payload)) return fallback;
  const payload = result.payload;
  const providers = payload.providers;
  if (typeof providers === "string" && providers.trim()) return providers;
  if (result.kind === "error") {
    const usage = stringValue(payload, "usage", "Use /help for available commands.");
    const requested = stringValue(payload, "requestedThinking", "");
    const supported = stringListValue(payload, "supportedThinkingLevels");
    return [
      "\n  Command error",
      requested ? `  Requested thinking: ${requested}` : undefined,
      supported.length > 0 ? `  Supported: ${supported.join(" → ")}` : undefined,
      `  Usage: ${usage}`,
      "",
    ].filter((line): line is string => typeof line === "string").join("\n");
  }

  switch (result.command) {
    case "model.set": {
      const provider = stringValue(payload, "provider");
      const model = stringValue(payload, "model", "default");
      const lines = [`\n  Model override for this session: ${provider}/${model}`];
      const thinking = stringValue(payload, "thinking", "");
      const modelVariant = stringValue(payload, "modelVariant", "");
      if (thinking) lines.push(`  Thinking: ${thinking}${modelVariant ? `  (${modelVariant})` : ""}`);
      lines.push("  Persistent default unchanged; use `omk model use` to persist.\n");
      return lines.join("\n");
    }
    case "think.set": {
      const thinking = stringValue(payload, "thinking");
      const modelVariant = stringValue(payload, "modelVariant", "auto");
      const cycle = stringListValue(payload, "cycle");
      return [
        `\n  Thinking variant: ${thinking}`,
        `  Active: ${modelVariant}`,
        cycle.length > 0 ? `  Cycle: ${cycle.join(" → ")}` : undefined,
        "",
      ].filter((line): line is string => typeof line === "string").join("\n");
    }
    case "status.show":
      return `\n  Status: ${stringValue(payload, "provider")}/${stringValue(payload, "model")}  theme=${stringValue(payload, "theme")}`;
    case "theme.show": {
      const current = stringValue(payload, "current", stringValue(payload, "theme", "omk"));
      const available = stringListValue(payload, "available");
      return `\n  Theme: ${current}${available.length > 0 ? `\n  Available: ${available.join(", ")}` : ""}`;
    }
    case "theme.set":
      return `\n  Theme updated: ${stringValue(payload, "theme", "omk")}`;
    case "help": {
      const commands = stringListValue(payload, "commands");
      return [`\n  OMK Slash Commands`, ...commands.map((command) => `  - ${command}`), ""].join("\n");
    }
    case "mcp.show": {
      const scope = stringValue(payload, "scope");
      const configured = numberValue(payload, "configured");
      const servers = recordArrayValue(payload, "servers");
      const lines = [`\n  MCP servers (${configured} configured, scope: ${scope})`];
      for (const srv of servers) {
        const name = stringValue(srv, "name");
        const status = stringValue(srv, "status");
        const active = booleanValue(srv, "active");
        lines.push(`  ${active ? "●" : "○"} ${name}  ${status}`);
      }
      return lines.join("\n");
    }
    case "provider.show": {
      const provider = stringValue(payload, "provider");
      const model = stringValue(payload, "model");
      const lines = [`\n  Provider: ${provider}/${model}`];
      const current = isRecord(payload.current) ? payload.current : undefined;
      if (current) {
        lines.push(
          `  Available: ${booleanValue(current, "available")}  Auth: ${booleanValue(current, "authPresent")}`,
        );
      }
      const fallbacks = recordArrayValue(payload, "fallbacks");
      if (fallbacks.length > 0) {
        lines.push("  Fallbacks:");
        for (const fb of fallbacks) {
          lines.push(
            `    ${stringValue(fb, "provider")}  available=${booleanValue(fb, "available")} auth=${booleanValue(fb, "authPresent")}`,
          );
        }
      }
      return lines.join("\n");
    }
    case "headroom.show": {
      const enabled = booleanValue(payload, "enabled");
      const utilization = numberValue(payload, "utilization");
      const threshold = numberValue(payload, "threshold");
      const shouldCompact = booleanValue(payload, "shouldCompact");
      return `\n  Headroom: ${enabled ? "enabled" : "disabled"}  usage=${(utilization * 100).toFixed(1)}%  threshold=${(threshold * 100).toFixed(1)}%  compact=${shouldCompact}`;
    }
    case "tools.show": {
      const groups = recordArrayValue(payload, "groups");
      const total = groups.reduce((sum, group) => sum + numberValue(group, "count"), 0);
      const lines = [`\n  Tools: ${total} total`];
      for (const group of groups) {
        const name = stringValue(group, "name");
        const count = numberValue(group, "count");
        const items = stringListValue(group, "items");
        lines.push(`  ${name}: ${count}${items.length > 0 ? `  [${items.join(", ")}]` : ""}`);
      }
      return lines.join("\n");
    }
    case "memory.show": {
      const available = booleanValue(payload, "available", true);
      if (!available) {
        return `\n  Memory: unavailable (${stringValue(payload, "reason")})`;
      }
      const backend = stringValue(payload, "backend");
      const nodeCount = numberValue(payload, "nodeCount");
      const edgeCount = numberValue(payload, "edgeCount");
      const lastUpdated = stringValue(payload, "lastUpdated", "—");
      const queryRaw = payload.query;
      const query = typeof queryRaw === "string" && queryRaw.trim() ? queryRaw : undefined;
      const results = recordArrayValue(payload, "results");
      const lines = [`\n  Memory: ${backend}  nodes=${nodeCount}  edges=${edgeCount}  updated=${lastUpdated}`];
      if (query) {
        lines.push(`  Query: "${query}"`);
        for (const result of results) {
          lines.push(`    - ${stringValue(result, "path")}  ${stringValue(result, "updatedAt")}`);
        }
      }
      return lines.join("\n");
    }
    case "trace.show": {
      const count = numberValue(payload, "count");
      const traces = recordArrayValue(payload, "traces");
      const lines = [`\n  Reasoning traces (latest ${count}):`];
      for (const trace of traces) {
        const outcome = stringValue(trace, "outcome");
        const icon = outcome === "success" ? "✔" : outcome === "partial" ? "◐" : "✖";
        const redacted = booleanValue(trace, "redacted") ? " (redacted)" : "";
        lines.push(`  ${icon} ${stringValue(trace, "intent")} → ${outcome} [${stringValue(trace, "duration")}]${redacted}`);
      }
      return lines.join("\n");
    }
    default:
      return fallback;
  }
}

class ModelCommandHandler implements SlashCommandHandler {
  async execute(input: SlashCommandInput): Promise<SlashCommandResult> {
    const raw = input.args.join(" ").trim();
    if (!raw) {
      const registry = await readProviderRegistry();
      return {
        kind: "status",
        command: "model.show",
        payload: {
          schema: "omk.runtime.model-groups.v1",
          currentProvider: input.state.provider ?? "unknown",
          currentModel: input.state.model ?? "unknown",
          currentThinking: input.state.thinking,
          usage: "/model <provider>/<model>[:level] or /think variant <name>",
          providerGroups: groupProviderModelsByProvider(registry),
          providers: renderProviderModelTable(registry, {
            currentProvider: input.state.provider,
            currentModel: input.state.model,
            currentThinking: input.state.thinking,
            activeProviderTab: input.state.activeProviderTab,
          }),
        },
        renderMode: "theme",
        sideEffects: [],
      };
    }

    const parsed = parseProviderModelArg(raw);
    const normalizedProvider = normalizeProviderId(raw);
    const providerOnly = !raw.includes(":")
      && !raw.includes("/")
      && normalizedProvider !== "auto"
      && (KNOWN_PROVIDER_IDS as readonly string[]).includes(normalizedProvider);
    const provider = providerOnly ? normalizedProvider : parsed.provider ?? input.state.provider ?? "auto";
    const model = providerOnly ? await defaultModelForProvider(provider) : parsed.model ?? raw;
    const sideEffects: RuntimeSideEffect[] = [
      { type: "provider_changed", provider, model },
    ];
    const payload: Record<string, unknown> = { provider, model };

    if (parsed.thinkingLevel) {
      const level = normalizeThinkingLevel(parsed.thinkingLevel);
      const supportedLevels = thinkingLevelsFor(provider, model);
      if (!level || !supportedLevels.includes(level)) {
        return {
          kind: "error",
          command: "model.set",
          payload: {
            provider,
            model,
            requestedThinking: parsed.thinkingLevel,
            supportedThinkingLevels: supportedLevels,
            usage: `/model ${provider}/${model}:${supportedLevels.join("|")}`,
          },
          renderMode: "theme",
          sideEffects: [],
        };
      }
      const modelVariant = formatThinkingModelVariant(model, level);
      payload.thinking = level;
      payload.modelVariant = modelVariant;
      payload.supportedThinkingLevels = supportedLevels;
      sideEffects.push({ type: "thinking_changed", thinking: level, modelVariant });
    }

    return {
      kind: "mutation",
      command: "model.set",
      payload,
      renderMode: "theme",
      sideEffects,
    };
  }
}

async function defaultModelForProvider(provider: string): Promise<string> {
  const registry = await readProviderRegistry();
  return registry.find((entry) => entry.id === provider)?.defaultModel ?? "default";
}

class ThinkCommandHandler implements SlashCommandHandler {
  async execute(input: SlashCommandInput): Promise<SlashCommandResult> {
    const requested = input.args[0]?.toLowerCase();
    const levels = thinkingLevelsFor(input.state.provider, input.state.model);
    const wantsCustomVariant = requested === "variant" || requested === "varint" || requested === "v";
    if (wantsCustomVariant) {
      const variant = normalizeThinkingVariant(input.args[1]);
      if (!variant) {
        return {
          kind: "error",
          command: "think.set",
          payload: { usage: "/think variant <name>", aliases: ["/think varint <name>"] },
          renderMode: "theme",
          sideEffects: [],
        };
      }
      const modelVariant = formatThinkingModelVariant(input.state.model, variant);
      return {
        kind: "mutation",
        command: "think.set",
        payload: { thinking: variant, modelVariant, custom: true, cycle: levels },
        renderMode: "theme",
        sideEffects: [{ type: "thinking_changed", thinking: variant, modelVariant }],
      };
    }
    const level = !requested || requested === "next" || requested === "tab"
      ? nextThinkingLevel(input.state.thinking, input.state.provider, input.state.model)
      : normalizeThinkingLevel(requested);
    if (!level || !levels.includes(level)) {
      return {
        kind: "error",
        command: "think.set",
        payload: { usage: `/think next | ${levels.join(" | ")} | variant <name>`, supported: levels },
        renderMode: "theme",
        sideEffects: [],
      };
    }
    const modelVariant = formatThinkingModelVariant(input.state.model, level);
    return {
      kind: "mutation",
      command: "think.set",
      payload: { thinking: level, modelVariant, cycle: levels },
      renderMode: "theme",
      sideEffects: [{ type: "thinking_changed", thinking: level, modelVariant }],
    };
  }
}

class StatusCommandHandler implements SlashCommandHandler {
  async execute(input: SlashCommandInput): Promise<SlashCommandResult> {
    return {
      kind: "status",
      command: "status.show",
      payload: {
        provider: input.state.provider ?? "unknown",
        model: input.state.model ?? "unknown",
        sessionId: input.state.sessionId ?? "none",
        theme: input.state.theme ?? "default",
      },
      renderMode: "theme",
      sideEffects: [],
    };
  }
}

class ThemeCommandHandler implements SlashCommandHandler {
  async execute(input: SlashCommandInput): Promise<SlashCommandResult> {
    if (!input.args[0]) {
      return {
        kind: "status",
        command: "theme.show",
        payload: {
          current: input.state.theme ?? "omk",
          usage: "/theme <name>",
          available: ["omk", "night-city", "omk-control", "green-rain", "rust-forge", "neon-circuit", "minimal", "mono", "dark", "light"],
        },
        renderMode: "theme",
        sideEffects: [],
      };
    }
    return {
      kind: "mutation",
      command: "theme.set",
      payload: { theme: input.args[0] },
      renderMode: "theme",
      sideEffects: [{ type: "theme_changed", theme: input.args[0] }],
    };
  }
}

class McpCommandHandler implements SlashCommandHandler {
  async execute(): Promise<SlashCommandResult> {
    const report = await buildMcpDoctorReport();
    const servers = report.servers.map((srv) => ({
      name: srv.name,
      status: srv.status === "ok" ? "ok" : srv.status === "warn" ? "degraded" : "down",
      active: srv.active,
    }));
    return {
      kind: "status",
      command: "mcp.show",
      payload: {
        configured: report.data.serverCount,
        scope: report.activeScope,
        servers,
      },
      renderMode: "theme",
      sideEffects: [],
    };
  }
}

class ProviderCommandHandler implements SlashCommandHandler {
  async execute(input: SlashCommandInput): Promise<SlashCommandResult> {
    const currentProvider = input.state.provider ?? "unknown";
    const currentModel = input.state.model ?? "unknown";
    const registry = await readProviderRegistry();
    const statuses = await Promise.all(
      registry.map(async (entry) => {
        const doctor = await providerDoctorStatus(entry.id as ProviderId).catch(() => undefined);
        return doctor ? { ...doctor, configured: entry.configured } : undefined;
      }),
    );
    const statusesDefined = statuses.filter((s): s is NonNullable<typeof s> => s !== undefined);
    const current = statusesDefined.find((s) => s.provider === currentProvider);
    const fallbacks = statusesDefined
      .filter((s) => s.provider !== currentProvider && s.configured)
      .sort((a, b) => Number(b.available) - Number(a.available));
    return {
      kind: "status",
      command: "provider.show",
      payload: {
        provider: currentProvider,
        model: currentModel,
        current: current
          ? {
              provider: current.provider,
              model: current.model,
              available: current.available,
              authPresent: current.apiKeySet === true,
              kind: current.kind,
            }
          : undefined,
        fallbacks: fallbacks.map((s) => ({
          provider: s.provider,
          model: s.model,
          available: s.available,
          authPresent: s.apiKeySet === true,
        })),
      },
      renderMode: "theme",
      sideEffects: [],
    };
  }
}

class HeadroomCommandHandler implements SlashCommandHandler {
  async execute(input: SlashCommandInput): Promise<SlashCommandResult> {
    const registry = await readProviderRegistry();
    const entry = registry.find((e) => e.id === input.state.provider);
    const contextWindow =
      typeof entry?.contextWindow === "number" && entry.contextWindow > 0 ? entry.contextWindow : 0;
    const decision = evaluateHeadroom({ usedTokens: 0, contextWindow });
    return {
      kind: "status",
      command: "headroom.show",
      payload: {
        enabled: isHeadroomEnabled(),
        utilization: decision.utilization,
        threshold: decision.threshold,
        usedTokens: decision.usedTokens,
        contextWindow: decision.contextWindow,
        shouldCompact: decision.shouldCompact,
      },
      renderMode: "theme",
      sideEffects: [],
    };
  }
}

class ToolsCommandHandler implements SlashCommandHandler {
  async execute(): Promise<SlashCommandResult> {
    const [settings, preset] = await Promise.all([
      getOmkResourceSettings(),
      getActiveRuntimePreset().catch(() => undefined),
    ]);
    const manifest = await buildOmkToolPlaneManifest({
      mcpScope: settings.mcpScope,
      skills: preset?.skills ?? [],
      hooks: preset?.hooks ?? [],
      tools: [],
    });
    const groups = [
      { name: "MCP servers", count: manifest.mcpServers.length, items: [...manifest.mcpServers] },
      { name: "Skills", count: manifest.skills.length, items: [...manifest.skills] },
      { name: "Hooks", count: manifest.hooks.length, items: [...manifest.hooks] },
      { name: "Tools", count: manifest.tools.length, items: [...manifest.tools] },
    ];
    return {
      kind: "status",
      command: "tools.show",
      payload: { groups },
      renderMode: "theme",
      sideEffects: [],
    };
  }
}

class MemoryCommandHandler implements SlashCommandHandler {
  async execute(input: SlashCommandInput): Promise<SlashCommandResult> {
    const store = await LocalGraphMemoryStore.create();
    if (!store) {
      return {
        kind: "status",
        command: "memory.show",
        payload: { available: false, reason: "local graph memory not configured" },
        renderMode: "theme",
        sideEffects: [],
      };
    }
    const status = store.status;
    const raw = await readFile(status.localGraph.path, "utf-8").catch(() => "{}");
    const parsed = JSON.parse(raw) as { nodes?: unknown[]; edges?: unknown[]; updatedAt?: string };
    const nodeCount = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
    const edgeCount = Array.isArray(parsed.edges) ? parsed.edges.length : 0;
    const lastUpdated = typeof parsed.updatedAt === "string" ? parsed.updatedAt : "—";
    const query = input.args.join(" ").trim();
    let results: { path: string; updatedAt: string }[] = [];
    if (query) {
      const hits = await store.search(query, 5);
      results = hits.map((hit) => ({ path: hit.path, updatedAt: hit.updatedAt }));
    }
    return {
      kind: "status",
      command: "memory.show",
      payload: {
        available: true,
        backend: status.backend,
        nodeCount,
        edgeCount,
        lastUpdated,
        query: query || undefined,
        results,
      },
      renderMode: "theme",
      sideEffects: [],
    };
  }
}

class TraceCommandHandler implements SlashCommandHandler {
  async execute(input: SlashCommandInput): Promise<SlashCommandResult> {
    const store = createReasoningTraceStore();
    const limit = Math.min(20, Math.max(1, Number(input.args[0]) || 5));
    const traces = await store.list(limit);
    const summaries = traces.map((trace) => {
      const redacted = trace.privacy.level === "l0" || !trace.privacy.consentGiven;
      const source = redacted ? redactTrace(trace) : trace;
      const summary = summarizeTrace(source);
      return {
        id: trace.id,
        intent: summary.intent,
        outcome: summary.outcome,
        duration: summary.duration,
        confidence: summary.confidence,
        redacted,
      };
    });
    return {
      kind: "status",
      command: "trace.show",
      payload: { count: summaries.length, traces: summaries },
      renderMode: "theme",
      sideEffects: [],
    };
  }
}

class HelpCommandHandler implements SlashCommandHandler {
  async execute(): Promise<SlashCommandResult> {
    return {
      kind: "status",
      command: "help",
      payload: {
        commands: [
          "/model [provider/model] - Show or set provider/model by provider group",
          "/think [next|medium|high|xhigh|max|variant <name>] - Cycle or set thinking variant",
          "/status - Show current runtime status",
          "/theme [name] - Show or set theme",
          "/mcp - Show MCP server health",
          "/provider - Show current provider, model, and fallback status",
          "/headroom - Show context headroom status",
          "/tools - Show tool plane manifest",
          "/memory [query] - Show memory summary or search top-N",
          "/trace - Show latest reasoning trace summaries",
          "/help - Show this help",
        ],
      },
      renderMode: "theme",
      sideEffects: [],
    };
  }
}

const defaultHandlers: Record<string, SlashCommandHandler> = {
  model: new ModelCommandHandler(),
  think: new ThinkCommandHandler(),
  thinking: new ThinkCommandHandler(),
  status: new StatusCommandHandler(),
  theme: new ThemeCommandHandler(),
  mcp: new McpCommandHandler(),
  provider: new ProviderCommandHandler(),
  headroom: new HeadroomCommandHandler(),
  tools: new ToolsCommandHandler(),
  memory: new MemoryCommandHandler(),
  trace: new TraceCommandHandler(),
  help: new HelpCommandHandler(),
};

export function createSlashCommandHandler(
  state: SlashCommandInput["state"] = {},
): CommandHandler {
  return async (envelope: CommandEnvelope): Promise<CommandBusResult> => {
    const { command, args } = parseSlashInput(envelope.rawText);
    const handler = defaultHandlers[command];
    if (!handler) {
      return {
        handled: false,
        events: [],
        output: `Unknown command: /${command}. Use /help for available commands.`,
      };
    }
    const input: SlashCommandInput = {
      command,
      args,
      rawText: envelope.rawText,
      state,
    };
    const result = await handler.execute(input);
    return resultToCommandBusResult(result);
  };
}

export function registerSlashCommands(
  bus: { registerHandler(command: string, handler: CommandHandler): void },
  state: SlashCommandInput["state"] = {},
): void {
  const handler = createSlashCommandHandler(state);
  bus.registerHandler("model", handler);
  bus.registerHandler("think", handler);
  bus.registerHandler("thinking", handler);
  bus.registerHandler("status", handler);
  bus.registerHandler("theme", handler);
  bus.registerHandler("mcp", handler);
  bus.registerHandler("provider", handler);
  bus.registerHandler("headroom", handler);
  bus.registerHandler("tools", handler);
  bus.registerHandler("memory", handler);
  bus.registerHandler("trace", handler);
  bus.registerHandler("help", handler);
}
