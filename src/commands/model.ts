import {
  listUserModelAliases,
  normalizeProviderId,
  readProviderDefaults,
  readProviderRegistry,
  resolveUserModelAlias,
  setProviderDefaults,
  setUserModelAlias,
  removeUserModelAlias,
} from "../providers/model-registry.js";
import { groupProviderModelsByProvider, renderProviderModelTable } from "../providers/model-table.js";
import {
  formatThinkingModelVariant,
  nextThinkingLevel,
  normalizeThinkingLevel,
  normalizeThinkingVariant,
  thinkingLevelsFor,
} from "../providers/thinking-levels.js";
import { header, label, status } from "../util/theme.js";

export interface ModelJsonOptions {
  json?: boolean;
}

export interface ThinkCommandOptions extends ModelJsonOptions {
  provider?: string;
  model?: string;
  exportEnv?: boolean;
}

export async function modelListCommand(options: ModelJsonOptions = {}): Promise<void> {
  const [providers, userAliases] = await Promise.all([readProviderRegistry(), listUserModelAliases()]);
  const payload = {
    ok: true,
    command: "model list",
    providers: providers.map((entry) => ({
      provider: entry.id,
      defaultModel: entry.defaultModel,
      aliases: entry.aliases,
      enabled: entry.enabled,
    })),
    providerGroups: groupProviderModelsByProvider(providers),
    userAliases,
    secretValuesPrinted: false,
    tokenFilesRead: false,
  };
  if (options.json || process.argv.includes("--json")) {
    emitModelPayload("Model registry", payload, options);
    return;
  }
  console.log(renderProviderModelTable(providers));
  console.log(status.ok("secretValuesPrinted=false tokenFilesRead=false"));
}

export async function modelAliasesCommand(options: ModelJsonOptions = {}): Promise<void> {
  const aliases = await listUserModelAliases();
  const payload = {
    ok: true,
    command: "model aliases",
    aliases,
    secretValuesPrinted: false,
    tokenFilesRead: false,
  };
  emitModelPayload("Model aliases", payload, options);
}

export async function modelAliasAddCommand(
  alias: string,
  target: string,
  options: ModelJsonOptions = {}
): Promise<void> {
  const result = await setUserModelAlias(alias, target);
  const payload = {
    ok: true,
    command: "model alias add",
    alias: result.key,
    target: result.value,
    aliases: result.aliases,
    configPath: result.configPath,
    secretValuesPrinted: false,
    tokenFilesRead: false,
  };
  emitModelPayload("Model alias added", payload, options);
}

export async function modelAliasRemoveCommand(alias: string, options: ModelJsonOptions = {}): Promise<void> {
  const result = await removeUserModelAlias(alias);
  const payload = {
    ok: true,
    command: "model alias remove",
    alias: result.key,
    removed: result.removed,
    aliases: result.aliases,
    configPath: result.configPath,
    secretValuesPrinted: false,
    tokenFilesRead: false,
  };
  emitModelPayload("Model alias removed", payload, options);
}

export async function modelResolveCommand(model: string, options: ModelJsonOptions = {}): Promise<void> {
  const resolved = await resolveUserModelAlias(model);
  const payload = {
    ok: true,
    command: "model resolve",
    input: resolved.input,
    provider: resolved.provider,
    model: resolved.model,
    source: resolved.source,
    secretValuesPrinted: false,
    tokenFilesRead: false,
  };
  emitModelPayload("Model resolved", payload, options);
}

export async function modelUseCommand(model: string, options: ModelJsonOptions = {}): Promise<void> {
  const resolved = await resolveUserModelAlias(model);
  const defaults = await readProviderDefaults();
  const result = await setProviderDefaults({
    provider: resolved.provider ?? defaults.provider,
    model: resolved.model,
  });
  const payload = {
    ok: true,
    command: "model use",
    input: resolved.input,
    defaultProvider: result.defaults.provider,
    defaultModel: result.defaults.model,
    modelSource: resolved.source,
    configPath: result.configPath,
    secretValuesPrinted: false,
    tokenFilesRead: false,
  };
  emitModelPayload("Default model updated", payload, options);
}

export async function thinkCommand(
  level?: string,
  variant?: string,
  options: ThinkCommandOptions = {}
): Promise<void> {
  const defaults = await readProviderDefaults();
  const requestedModel = options.model ?? process.env.OMK_PROVIDER_MODEL ?? process.env.OMK_MODEL ?? defaults.model;
  const resolved = options.model
    ? await resolveUserModelAlias(options.model)
    : {
        input: requestedModel,
        provider: undefined,
        model: requestedModel,
        source: "default",
      };
  const provider = normalizeProviderId(
    options.provider ?? resolved.provider ?? process.env.OMK_PROVIDER ?? process.env.OMK_DEFAULT_PROVIDER ?? defaults.provider
  );
  const model = resolved.model ?? requestedModel;
  const supportedLevels = thinkingLevelsFor(provider, model);
  const requested = level?.trim().toLowerCase();
  const wantsCustomVariant = requested === "variant" || requested === "varint" || requested === "v";
  const customVariant = wantsCustomVariant ? normalizeThinkingVariant(variant) : undefined;

  if (wantsCustomVariant && !customVariant) {
    const payload = {
      ok: false,
      command: "think",
      error: "custom variant is required",
      usage: "omk think variant <name>",
      supportedLevels,
      secretValuesPrinted: false,
      tokenFilesRead: false,
    };
    process.exitCode = 1;
    emitThinkPayload(payload, options);
    return;
  }

  const normalizedLevel = wantsCustomVariant
    ? undefined
    : !requested || requested === "next" || requested === "tab"
      ? nextThinkingLevel(process.env.OMK_THINKING, provider, model)
      : normalizeThinkingLevel(requested);

  if (!wantsCustomVariant && (!normalizedLevel || !supportedLevels.includes(normalizedLevel))) {
    const payload = {
      ok: false,
      command: "think",
      error: `unsupported thinking level: ${requested ?? "next"}`,
      provider,
      model,
      supportedLevels,
      usage: `omk think ${supportedLevels.join("|")} | omk think variant <name>`,
      secretValuesPrinted: false,
      tokenFilesRead: false,
    };
    process.exitCode = 1;
    emitThinkPayload(payload, options);
    return;
  }

  const thinking = customVariant ?? normalizedLevel ?? supportedLevels[0] ?? "medium";
  const modelVariant = formatThinkingModelVariant(model, thinking);
  const payload = {
    ok: true,
    command: "think",
    provider,
    model,
    thinking,
    modelVariant,
    mode: customVariant ? "custom-variant" : "level",
    persisted: false,
    env: {
      OMK_THINKING: thinking,
      OMK_MODEL_VARIANT: modelVariant,
    },
    supportedLevels,
    secretValuesPrinted: false,
    tokenFilesRead: false,
  };

  emitThinkPayload(payload, options);
}

function emitThinkPayload(payload: Record<string, unknown>, options: ThinkCommandOptions): void {
  if (options.json || process.argv.includes("--json")) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const env = payload.env as { OMK_THINKING?: string; OMK_MODEL_VARIANT?: string } | undefined;
  if (options.exportEnv && env?.OMK_THINKING && env.OMK_MODEL_VARIANT) {
    console.log(`export OMK_THINKING=${shellExportValue(env.OMK_THINKING)}`);
    console.log(`export OMK_MODEL_VARIANT=${shellExportValue(env.OMK_MODEL_VARIANT)}`);
    return;
  }

  console.log(header(payload.ok === false ? "Thinking command error" : "Thinking command"));
  for (const [key, value] of Object.entries(payload)) {
    if (key === "env" || key === "supportedLevels") continue;
    console.log(label(key, String(value)));
  }
  if (env?.OMK_THINKING && env.OMK_MODEL_VARIANT) {
    console.log(label("env", `OMK_THINKING=${env.OMK_THINKING} OMK_MODEL_VARIANT=${env.OMK_MODEL_VARIANT}`));
  }
  const supported = payload.supportedLevels;
  if (Array.isArray(supported)) {
    console.log(label("supportedLevels", supported.join(" -> ")));
  }
  console.log(status.ok("persisted=false secretValuesPrinted=false tokenFilesRead=false"));
}

function shellExportValue(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function emitModelPayload(title: string, payload: Record<string, unknown>, options: ModelJsonOptions): void {
  if (options.json || process.argv.includes("--json")) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(header(title));
  for (const [key, value] of Object.entries(payload)) {
    if (key === "aliases" || key === "providers") continue;
    console.log(label(key, String(value)));
  }
  console.log(status.ok("secretValuesPrinted=false tokenFilesRead=false"));
}
