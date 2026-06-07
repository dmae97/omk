/**
 * Section 21 — Chat REPL for CLI v2
 *
 * Interactive REPL that integrates:
 * - RuntimeSidecar pipeline (debloat-nlp)
 * - CommandBus for slash commands
 * - OutputRouter for themed rendering
 * - ProviderEventNormalizer for bilingual output
 */

import { createCommandBus, type CommandBusResult } from "../../runtime/command-bus.js";
import { registerSlashCommands } from "../../runtime/slash-commands.js";
import {
  classifyIntent,
  selectCapabilities,
  compileBloatToNlp,
  selectProviderRuntime,
} from "../../runtime/debloat-nlp.js";
import { createOutputRouter } from "../../runtime/output-router.js";
import type { OmkEvent, OutputProfile } from "../../runtime/contracts/command-envelope.js";
import { normalizeProviderId, readProviderRegistry } from "../../providers/model-registry.js";
import { renderProviderModelTable } from "../../providers/model-table.js";
import {
  ALL_PROVIDER_TAB,
  buildProviderTabs,
  createModelPickerState,
  debugModelTabs,
  handleModelPickerKey,
  initializeModelPickerState,
  providerTabIdForProvider,
} from "../../providers/model-tabs.js";

export interface ChatReplOptions {
  provider?: string;
  model?: string;
  cwd?: string;
  json?: boolean;
}

export interface ChatReplState {
  provider?: string;
  model?: string;
  thinking?: string;
  modelVariant?: string;
  activeProviderTab?: string;
}

export function createChatReplState(options: ChatReplOptions = {}): ChatReplState {
  return {
    provider: options.provider,
    model: options.model,
  };
}

export function createChatReplCommandBus(
  options: ChatReplOptions = {},
  state: ChatReplState = createChatReplState(options),
) {
  const bus = createCommandBus();
  registerSlashCommands(bus, state);
  return bus;
}

export function applyChatReplSlashResultToState(state: ChatReplState, result: CommandBusResult): void {
  if (!result.handled || !result.output) return;
  let payload: unknown;
  try {
    payload = JSON.parse(result.output);
  } catch {
    return;
  }
  if (!payload || typeof payload !== "object") return;
  const data = payload as { provider?: unknown; model?: unknown; thinking?: unknown; modelVariant?: unknown };
  const routeChanged = typeof data.provider === "string" || typeof data.model === "string";
  if (typeof data.provider === "string") state.provider = data.provider;
  if (typeof data.model === "string") state.model = data.model;
  if (typeof data.thinking === "string") state.thinking = data.thinking;
  if (typeof data.modelVariant === "string") {
    state.modelVariant = data.modelVariant;
  } else if (routeChanged) {
    delete state.modelVariant;
  }
}
function explicitProviderTabFromModelLine(line: string, providerIds: readonly string[]): string | undefined {
  const trimmed = line.trim();
  if (!/^\/(?:model|m)(?:\s|$)/.test(trimmed)) {
    return undefined;
  }

  const tokens = trimmed.split(/\s+/);
  const rawArg = tokens[1];
  if (!rawArg) {
    return undefined;
  }

  const slashIndex = rawArg.indexOf("/");
  const providerPart = (slashIndex > 0 ? rawArg.slice(0, slashIndex) : rawArg)
    .split(":")[0]
    ?.trim()
    .toLowerCase();
  if (!providerPart) {
    return undefined;
  }

  const tabs = buildProviderTabs(providerIds);
  if (tabs.includes(providerPart)) {
    return providerPart;
  }

  const normalized = normalizeProviderId(providerPart);
  const normalizedTab = normalized === "auto" ? null : providerTabIdForProvider(normalized);
  if (normalizedTab && tabs.includes(normalizedTab)) {
    return normalizedTab;
  }

  return undefined;
}

function countVisibleProviderRows(
  providerIds: readonly string[],
  activeProviderTab: string,
): number {
  return providerIds.filter((providerId) =>
    activeProviderTab === ALL_PROVIDER_TAB || providerTabIdForProvider(providerId) === activeProviderTab
  ).length;
}
function isModelShowInput(input: string): boolean {
  return input === "/model" || input === "/m";
}

export function prepareChatReplModelPickerForShow(args: {
  input: string;
  state: ChatReplState;
  modelPickerState: ReturnType<typeof createModelPickerState>;
  providerIds: readonly string[];
}): boolean {
  if (!isModelShowInput(args.input)) {
    return false;
  }

  initializeModelPickerState({
    state: args.modelPickerState,
    providerIds: args.providerIds,
  });
  args.modelPickerState.query = "";
  args.state.activeProviderTab = args.modelPickerState.activeProviderTab;
  return true;
}


/**
 * Start an interactive chat REPL that routes all input through the full pipeline.
 */
export async function startChatRepl(options: ChatReplOptions): Promise<void> {
  const readline = await import("readline");
  const replState = createChatReplState(options);
  const bus = createChatReplCommandBus(options, replState);
  const modelProviderRegistry = await readProviderRegistry().catch(() => []);
  const modelProviderIds = modelProviderRegistry.map((entry) => entry.id);
  const modelPickerState = createModelPickerState(ALL_PROVIDER_TAB);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: options.json ? "omk> " : "\x1b[36momk>\x1b[0m ",
    completer: (line: string) => {
      const trimmed = line.trim();
      if (/^\/(?:model|m)(?:\s|$)/.test(trimmed) || (trimmed.length === 0 && replState.activeProviderTab)) {
        const previousActiveProviderTab = modelPickerState.activeProviderTab;
        const explicitProviderTab = explicitProviderTabFromModelLine(line, modelProviderIds);
        const isFreshQuery = modelPickerState.query !== line;

        if (isFreshQuery) {
          initializeModelPickerState({
            state: modelPickerState,
            providerIds: modelProviderIds,
            explicitProviderTab,
          });
        } else {
          handleModelPickerKey({ key: "\t", state: modelPickerState, providerIds: modelProviderIds });
        }

        modelPickerState.query = line;
        replState.activeProviderTab = modelPickerState.activeProviderTab;
        const tabs = buildProviderTabs(modelProviderIds);
        debugModelTabs({
          providerIds: modelProviderIds,
          tabs,
          activeProviderTab: isFreshQuery ? modelPickerState.activeProviderTab : previousActiveProviderTab,
          key: isFreshQuery ? (explicitProviderTab ? "/model explicit" : "/model") : "\t",
          nextProviderTab: isFreshQuery ? undefined : modelPickerState.activeProviderTab,
          runtimeProvider: replState.provider,
          runtimeModel: replState.model,
          visibleRowCount: countVisibleProviderRows(modelProviderIds, modelPickerState.activeProviderTab),
        });
        console.log(renderProviderModelTable(modelProviderRegistry, {
          currentProvider: replState.provider,
          currentModel: replState.model,
          currentThinking: replState.thinking,
          activeProviderTab: replState.activeProviderTab,
        }));
      }
      return [[], line];
    },
  });

  const outputMode = options.json ? "json" as const : "theme" as const;
  const profile: OutputProfile = {
    format: options.json ? "json" : "nlp",
    progress: "live",
    color: "auto",
    rawProvider: false,
    explainRouting: false,
    stdoutMode: outputMode,
  };
  const router = createOutputRouter(profile);

  // Emit turn_started event
  const startEvent: OmkEvent = {
    type: "turn_started",
    data: {
      kind: "turn_started",
      intent: "chat",
      provider: options.provider || "auto",
    },
    turnId: Date.now().toString(),
    timestamp: new Date().toISOString(),
  };
  router.route(startEvent);
  router.flush();

  console.log("Type /help for commands, /exit to quit.\n");
  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // Handle exit
    if (input === "/exit" || input === "/quit") {
      const endEvent: OmkEvent = {
        type: "turn_finished",
        data: {
          kind: "turn_finished",
          durationMs: 0,
        },
        turnId: Date.now().toString(),
        timestamp: new Date().toISOString(),
      };
      router.route(endEvent);
      router.flush();
      rl.close();
      return;
    }

    const preparedModelPicker = prepareChatReplModelPickerForShow({
      input,
      state: replState,
      modelPickerState,
      providerIds: modelProviderIds,
    });

    // Route through CommandBus first (handles slash commands)
    const busResult = await bus.dispatch({
      kind: "chat",
      source: "cli",
      rawText: input,
    });

    if (busResult.handled) {
      applyChatReplSlashResultToState(replState, busResult);
      if (preparedModelPicker) {
        replState.activeProviderTab = modelPickerState.activeProviderTab;
      } else if (input.startsWith("/") || input.startsWith(":")) {
        delete replState.activeProviderTab;
      }
      for (const ev of busResult.events) {
        router.route(ev);
      }
      router.flush();
      rl.prompt();
      return;
    }

    // For regular messages: classify intent → build sidecar → render
    const intent = classifyIntent(input);
    const capabilityPlan = selectCapabilities({
      intent,
      availableMcp: [],
      availableSkills: [],
      failedMcp: [],
    });

    const result = compileBloatToNlp({
      rawText: input,
      provider: replState.provider || undefined,
      model: replState.modelVariant ?? replState.model ?? undefined,
    });
    const sidecar = result.runtimeSidecar;

    const runtimeMode = selectProviderRuntime({
      provider: sidecar.provider || "auto",
      intent,
    });
    const selectedMcpCount = capabilityPlan.requiredMcp.length + capabilityPlan.optionalMcp.length;
    const selectedSkillCount = capabilityPlan.selectedSkills.length;

    // Emit progress event
    const progressEvent: OmkEvent = {
      type: "progress",
      data: {
        kind: "progress",
        message: `Processing: ${intent} via ${runtimeMode} (${selectedMcpCount} MCP, ${selectedSkillCount} skills)`,
      },
      turnId: Date.now().toString(),
      timestamp: new Date().toISOString(),
    };
    router.route(progressEvent);
    router.flush();

    // In a real implementation, this would send to the provider adapter.
    // For now, emit a result event showing the pipeline worked.
    const resultEvent: OmkEvent = {
      type: "result",
      data: {
        kind: "result",
        content: `[${intent}] Pipeline processed via ${runtimeMode}. Provider adapter integration pending.`,
        format: "nlp",
      },
      turnId: Date.now().toString(),
      timestamp: new Date().toISOString(),
    };
    router.route(resultEvent);
    router.flush();

    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}
