import { runShell } from "../util/shell.js";
import {
  readOmkProvidersConfig,
  writeOmkProvidersConfig,
  type DeepSeekConfigPathOptions,
  type GenericProviderConfig,
} from "./deepseek/deepseek-config.js";
import type {
  KnownProviderId,
  ProviderAuthMethod,
  ProviderId,
  ProviderKind,
  ProviderModelRef,
  ProviderPlanKind,
  ProviderPolicy,
  ProviderProfileType,
  ProviderWireApi,
} from "./types.js";
import { DEFAULT_AUTHORITY_PROVIDER } from "./types.js";

export const KNOWN_PROVIDER_IDS = ["mimo", "kimi", "deepseek", "qwen", "codex", "openrouter"] as const satisfies readonly KnownProviderId[];
export const QWEN_DASHSCOPE_COMPAT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
export const OPENROUTER_COMPAT_BASE_URL = "https://openrouter.ai/api/v1";

export interface ProviderRegistryEntry {
  id: ProviderId;
  enabled: boolean;
  kind: ProviderKind;
  baseUrl?: string;
  apiKeyEnv?: string;
  defaultModel: string;
  aliases: Record<string, string>;
  capabilities: string[];
  wireApi?: ProviderWireApi;
  auth?: { method: ProviderAuthMethod };
  profileType?: ProviderProfileType;
  planKind?: ProviderPlanKind;
  routing?: "runtime" | "advisory" | "external-cli";
  headers?: Record<string, string>;
  contextWindow?: number;
  reservedOutputTokens?: number;
  configured: boolean;
  disabledReason?: string;
  updatedAt?: string;
}

export interface ProviderDoctorStatus {
  provider: ProviderId;
  enabled: boolean;
  available: boolean;
  kind: ProviderKind;
  model: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKeySet?: boolean;
  codexCliAvailable?: boolean;
  authority: ProviderModelRef["authority"];
  capabilities: string[];
  wireApi?: ProviderWireApi;
  authMethod?: ProviderAuthMethod;
  profileType?: ProviderProfileType;
  planKind?: ProviderPlanKind;
  headers?: Record<string, string>;
  fallbackProvider: ProviderId;
  reason?: string;
}

export interface ProviderConfigSetInput {
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  kind?: ProviderKind;
  enabled?: boolean;
  authMethod?: ProviderAuthMethod;
}

const DEFAULT_PROVIDER_CONFIGS: Record<KnownProviderId, Omit<ProviderRegistryEntry, "id" | "configured" | "updatedAt">> = {
  mimo: {
    enabled: true,
    kind: "openai-compatible",
    baseUrl: "https://api.xiaomimimo.com/v1",
    apiKeyEnv: "MIMO_API_KEY",
    defaultModel: "mimo-v2.5-pro",
    aliases: { default: "mimo-v2.5-pro", mimo: "mimo-v2.5-pro", "mimo-v2.5-pro": "mimo-v2.5-pro" },
    capabilities: ["read", "plan", "code", "review", "qa", "research", "advisory"],
    contextWindow: 128_000,
    reservedOutputTokens: 4096,
    wireApi: "openai-chat-completions",
    auth: { method: "api-key-env" },
    profileType: "runtime",
    planKind: "runtime",
    routing: "runtime",
  },
  kimi: {
    enabled: true,
    kind: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnv: "KIMI_API_KEY",
    defaultModel: "kimi-k2.6",
    aliases: { default: "kimi-k2.6", kimi: "kimi-k2.6", moonshot: "kimi-k2.6" },
    capabilities: ["read", "review", "qa", "research", "advisory"],
    contextWindow: 128_000,
    reservedOutputTokens: 4096,
    wireApi: "openai-chat-completions",
    auth: { method: "api-key-env" },
    profileType: "runtime",
    planKind: "runtime",
    routing: "runtime",
  },
  deepseek: {
    enabled: true,
    kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-v4-flash",
    aliases: {
      default: "deepseek-v4-flash",
      flash: "deepseek-v4-flash",
      pro: "deepseek-v4-pro",
      "deepseek-v4-flash": "deepseek-v4-flash",
      "deepseek-v4-pro": "deepseek-v4-pro",
    },
    capabilities: ["read", "review", "qa", "research", "advisory"],
    contextWindow: 128_000,
    reservedOutputTokens: 4096,
    wireApi: "openai-chat-completions",
    auth: { method: "api-key-env" },
    profileType: "runtime",
    planKind: "runtime",
    routing: "advisory",
  },
  codex: {
    enabled: false,
    kind: "codex-cli",
    defaultModel: "codex-cli",
    aliases: { default: "codex-cli", codex: "codex-cli", "codex-cli": "codex-cli" },
    capabilities: ["read", "plan", "review", "advisory"],
    contextWindow: 128_000,
    reservedOutputTokens: 4096,
    wireApi: "external-cli",
    auth: { method: "external-cli" },
    profileType: "compatibility",
    planKind: "chatgpt-plan",
    routing: "external-cli",
  },
  qwen: {
    enabled: false,
    kind: "openai-compatible",
    baseUrl: QWEN_DASHSCOPE_COMPAT_BASE_URL,
    apiKeyEnv: "DASHSCOPE_API_KEY",
    defaultModel: "qwen3-max",
    aliases: {
      default: "qwen3-max",
      max: "qwen3-max",
      "qwen-max": "qwen3-max",
      "qwen3-max": "qwen3-max",
      "qwen-3.7-max": "qwen3-max",
      "qwen 3.7 max": "qwen3-max",
      "Qwen 3.7 MAX": "qwen3-max",
    },
    capabilities: ["read", "research", "review", "qa", "advisory"],
    contextWindow: 128_000,
    reservedOutputTokens: 4096,
    wireApi: "openai-chat-completions",
    auth: { method: "api-key-env" },
    profileType: "runtime",
    planKind: "qwen-coding-plan",
    routing: "advisory",
  },
  openrouter: {
    enabled: false,
    kind: "openai-compatible",
    baseUrl: OPENROUTER_COMPAT_BASE_URL,
    apiKeyEnv: "OPENROUTER_API_KEY",
    defaultModel: "openrouter/auto",
    aliases: {
      default: "openrouter/auto",
      auto: "openrouter/auto",
      "openrouter-default": "openrouter/auto",
      "openrouter/auto": "openrouter/auto",
      fable: "anthropic/claude-fable-5",
      "fable-5": "anthropic/claude-fable-5",
      "claude-fable-5": "anthropic/claude-fable-5",
      "anthropic/claude-fable-5": "anthropic/claude-fable-5",
    },
    capabilities: ["read", "research", "review", "qa", "advisory"],
    contextWindow: 128_000,
    reservedOutputTokens: 4096,
    wireApi: "openai-chat-completions",
    auth: { method: "api-key-env" },
    profileType: "runtime",
    planKind: "openrouter-credits",
    routing: "advisory",
    headers: {
      "HTTP-Referer": "https://github.com/dmae97/open-multi-agent-kit",
      "X-OpenRouter-Title": "open-multi-agent-kit",
    },
  },
};

export function normalizeProviderPolicy(value: string | undefined): ProviderPolicy {
  const normalized = normalizeProviderId(value);
  return normalized === "auto" ? "auto" : normalized as ProviderPolicy;
}

export function normalizeProviderId(value: string | undefined): ProviderId | "auto" {
  const trimmed = value?.trim();
  if (!trimmed) return "auto";
  const lower = trimmed.toLowerCase();
  if (lower === "auto") return "auto";
  if (lower === "mimo" || lower === "xiaomi" || lower === "xiaomi-mimo") return "mimo";
  if (lower === "kimi" || lower === "moonshot") return "kimi";
  if (lower === "deepseek" || lower === "deepseek-v4" || lower === "ds") return "deepseek";
  if (lower === "codex" || lower === "openai-codex") return "codex";
  if (lower === "qwen" || lower === "dashscope" || lower === "qwen3" || lower === "qwen-max") return "qwen";
  if (lower === "openrouter" || lower === "openrouter-ai" || lower === "claude" || lower === "anthropic") return "openrouter";
  return lower;
}

export interface ProviderModelArg {
  provider?: ProviderId;
  model?: string;
  thinkingLevel?: string;
}

export function parseProviderModelArg(value: string | undefined): ProviderModelArg {
  const trimmed = value?.trim();
  if (!trimmed) return {};
  // Extract thinking level suffix: model:level or provider/model:level
  const colon = trimmed.lastIndexOf(":");
  let modelPart = trimmed;
  let thinkingLevel: string | undefined;
  if (colon > 0) {
    const suffix = trimmed.slice(colon + 1).trim().toLowerCase();
    // Only treat as thinking level if it looks like one
    if (isThinkingLevelSuffix(suffix)) {
      modelPart = trimmed.slice(0, colon).trim();
      thinkingLevel = suffix;
    }
  }

  const withThinking = (arg: ProviderModelArg): ProviderModelArg => {
    if (thinkingLevel) arg.thinkingLevel = thinkingLevel;
    return arg;
  };

  const slash = modelPart.indexOf("/");
  if (slash > 0) {
    const provider = normalizeProviderId(modelPart.slice(0, slash));
    const arg: ProviderModelArg = { model: normalizeModelAlias(modelPart.slice(slash + 1)) };
    if (provider !== "auto") arg.provider = provider;
    return withThinking(arg);
  }
  const model = normalizeModelAlias(modelPart);
  if (model === "codex-cli") return withThinking({ provider: "codex", model });
  if (model.startsWith("deepseek-v4-")) return withThinking({ provider: "deepseek", model });
  if (model.startsWith("claude-") || model.startsWith("gpt-") || model.startsWith("anthropic/")) return withThinking({ provider: "openrouter", model });
  return withThinking({ model });
}

function isThinkingLevelSuffix(suffix: string): boolean {
  const thinkingAliases = [
    "off", "minimal", "min", "low", "lo",
    "medium", "med", "normal", "mid",
    "high", "hi", "xhigh", "x-high", "x_high", "extra", "xhi",
    "max", "maximum", "full",
  ];
  return thinkingAliases.includes(suffix);
}

export function normalizeModelAlias(value: string): string {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase().replace(/[_\s]+/g, "-");
  if (lower === "sonnet") return "claude-sonnet";
  if (lower === "opus") return "claude-opus";
  if (lower === "haiku") return "claude-haiku";
  if (lower === "fable" || lower === "fable-5" || lower === "claude-fable-5") return "anthropic/claude-fable-5";
  if (lower === "flash" || lower === "thinking" || lower === "non-thinking" || lower === "reasoner") return "deepseek-v4-flash";
  if (lower === "pro") return "deepseek-v4-pro";
  if (lower === "codex") return "codex-cli";
  if (lower === "qwen-max" || lower === "qwen3-max") return "qwen3-max";
  if (lower === "qwen-3.7-max" || lower === "qwen3.7-max" || lower === "qwen-3-7-max") return "qwen3-max";
  return trimmed;
}

export async function readProviderRegistry(options: DeepSeekConfigPathOptions = {}): Promise<ProviderRegistryEntry[]> {
  const config = await readOmkProvidersConfig(options);
  const ids = new Set<string>([...KNOWN_PROVIDER_IDS, ...Object.keys(config.providers)]);
  return [...ids].sort(providerSort).map((id) => mergeProviderConfig(id, config.providers[id]));
}

export async function getProviderRegistryEntry(
  provider: ProviderId,
  options: DeepSeekConfigPathOptions = {}
): Promise<ProviderRegistryEntry> {
  const config = await readOmkProvidersConfig(options);
  return mergeProviderConfig(provider, config.providers[provider]);
}

export async function setProviderConfig(
  provider: ProviderId,
  input: ProviderConfigSetInput,
  options: DeepSeekConfigPathOptions = {}
): Promise<ProviderRegistryEntry> {
  const id = normalizeProviderId(provider);
  if (id === "auto") throw new Error("Provider id is required");
  const config = await readOmkProvidersConfig(options);
  const current = mergeProviderConfig(id, config.providers[id]);
  const apiKeyEnv = input.apiKeyEnv === undefined ? current.apiKeyEnv : normalizeApiKeyEnvName(input.apiKeyEnv);
  const updated: GenericProviderConfig = {
    ...(config.providers[id] ?? {}),
    enabled: input.enabled ?? true,
    kind: input.kind && isProviderKind(input.kind) ? input.kind : current.kind,
    baseUrl: input.baseUrl ?? current.baseUrl,
    apiKeyEnv,
    defaultModel: input.model ? normalizeModelAlias(input.model) : current.defaultModel,
    model: input.model ? normalizeModelAlias(input.model) : current.defaultModel,
    aliases: current.aliases,
    capabilities: current.capabilities,
    wireApi: current.wireApi,
    auth: { method: input.authMethod ?? current.auth?.method ?? "api-key-env" },
    profileType: current.profileType,
    planKind: current.planKind,
    routing: current.routing,
    headers: current.headers,
    contextWindow: current.contextWindow,
    reservedOutputTokens: current.reservedOutputTokens,
    disabledAt: input.enabled === false ? new Date().toISOString() : undefined,
    disabledReason: input.enabled === false ? "Disabled by user" : undefined,
    disabledBy: input.enabled === false ? "user" : undefined,
    updatedAt: new Date().toISOString(),
  };
  await writeOmkProvidersConfig({
    version: 1,
    providers: { ...config.providers, [id]: updated },
  }, options);
  return mergeProviderConfig(id, updated);
}

function normalizeApiKeyEnvName(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return trimmed;
  throw new Error("Provider API key env must be an environment variable name, not a secret value");
}

function isProviderKind(value: string): value is ProviderKind {
  return value === "kimi-native" || value === "openai-compatible" || value === "external-cli" || value === "codex-cli" || value === "local";
}

export async function setProviderEnabled(
  provider: ProviderId,
  enabled: boolean,
  reason = "Disabled by user",
  options: DeepSeekConfigPathOptions = {}
): Promise<ProviderRegistryEntry> {
  const id = normalizeProviderId(provider);
  if (id === "auto") throw new Error("Provider id is required");
  const config = await readOmkProvidersConfig(options);
  const current = mergeProviderConfig(id, config.providers[id]);
  const updated: GenericProviderConfig = {
    ...(config.providers[id] ?? {}),
    kind: current.kind,
    baseUrl: current.baseUrl,
    apiKeyEnv: current.apiKeyEnv,
    defaultModel: current.defaultModel,
    model: current.defaultModel,
    aliases: current.aliases,
    capabilities: current.capabilities,
    wireApi: current.wireApi,
    auth: current.auth,
    profileType: current.profileType,
    planKind: current.planKind,
    routing: current.routing,
    headers: current.headers,
    contextWindow: current.contextWindow,
    reservedOutputTokens: current.reservedOutputTokens,
    enabled,
    disabledAt: enabled ? undefined : new Date().toISOString(),
    disabledReason: enabled ? undefined : reason,
    disabledBy: enabled ? undefined : "user",
    updatedAt: new Date().toISOString(),
  };
  await writeOmkProvidersConfig({
    version: 1,
    providers: { ...config.providers, [id]: updated },
  }, options);
  return mergeProviderConfig(id, updated);
}

export function resolveProviderModelRef(
  entry: ProviderRegistryEntry,
  requestedModel: string | undefined,
  authority: ProviderModelRef["authority"]
): ProviderModelRef {
  const raw = requestedModel ? normalizeModelAlias(requestedModel) : entry.defaultModel;
  const model = entry.aliases[raw] ?? entry.aliases[raw.toLowerCase()] ?? raw;
  return {
    provider: entry.id,
    model,
    authority,
    capabilities: entry.capabilities,
  };
}

export async function providerDoctorStatus(
  provider: ProviderId,
  options: DeepSeekConfigPathOptions & { env?: NodeJS.ProcessEnv } = {}
): Promise<ProviderDoctorStatus> {
  const entry = await getProviderRegistryEntry(provider, options);
  if (entry.id === "codex") {
    const codexCliAvailable = await isCodexCliAvailable();
    const available = entry.enabled && codexCliAvailable;
    return {
      provider: entry.id,
      enabled: entry.enabled,
      available,
      kind: entry.kind,
      model: entry.defaultModel,
      capabilities: entry.capabilities,
      wireApi: entry.wireApi,
      authMethod: entry.auth?.method,
      profileType: entry.profileType,
      planKind: entry.planKind,
      codexCliAvailable,
      authority: "advisory",
      fallbackProvider: DEFAULT_AUTHORITY_PROVIDER,
      reason: available
        ? "Codex CLI available; OMK does not read ~/.codex/auth.json"
        : "Codex CLI missing/disabled or authentication not verified; configured authority fallback is active",
    };
  }
  const apiKeySet = entry.apiKeyEnv ? Boolean((options.env ?? process.env)[entry.apiKeyEnv]?.trim()) : undefined;
  const needsKey = entry.kind === "openai-compatible";
  const available = entry.enabled && (!needsKey || apiKeySet === true);
  return {
    provider: entry.id,
    enabled: entry.enabled,
    available,
    kind: entry.kind,
    model: entry.defaultModel,
    baseUrl: entry.baseUrl,
    apiKeyEnv: entry.apiKeyEnv,
    apiKeySet,
    capabilities: entry.capabilities,
    wireApi: entry.wireApi,
    authMethod: entry.auth?.method,
    profileType: entry.profileType,
    planKind: entry.planKind,
    headers: entry.headers,
    authority: entry.id === DEFAULT_AUTHORITY_PROVIDER ? "authority" : "advisory",
    fallbackProvider: DEFAULT_AUTHORITY_PROVIDER,
    reason: available
      ? "Provider configured"
      : entry.enabled
        ? `Missing ${entry.apiKeyEnv ?? "provider"} environment variable; configured authority fallback is active`
        : entry.disabledReason ?? "Provider disabled; configured authority fallback is active",
  };
}

function mergeProviderConfig(id: string, stored: GenericProviderConfig | undefined): ProviderRegistryEntry {
  const known = isKnownProviderId(id) ? DEFAULT_PROVIDER_CONFIGS[id] : undefined;
  const aliases = { ...(known?.aliases ?? {}), ...(stored?.aliases ?? {}) };
  const defaultModel = stored?.defaultModel ?? stored?.model ?? known?.defaultModel ?? "default";
  return {
    id,
    enabled: stored?.enabled ?? known?.enabled ?? false,
    kind: stored?.kind ?? known?.kind ?? "openai-compatible",
    baseUrl: stored?.baseUrl ?? known?.baseUrl,
    apiKeyEnv: stored?.apiKeyEnv ?? known?.apiKeyEnv,
    defaultModel: normalizeModelAlias(defaultModel),
    aliases,
    capabilities: stored?.capabilities ?? known?.capabilities ?? ["read", "advisory"],
    wireApi: normalizeWireApi(stored?.wireApi) ?? known?.wireApi ?? "openai-chat-completions",
    auth: { method: normalizeAuthMethod(stored?.auth?.method) ?? known?.auth?.method ?? "api-key-env" },
    profileType: normalizeProfileType(stored?.profileType) ?? known?.profileType ?? "runtime",
    planKind: normalizePlanKind(stored?.planKind) ?? known?.planKind ?? "runtime",
    routing: normalizeRouting(stored?.routing) ?? known?.routing ?? "advisory",
    headers: { ...(known?.headers ?? {}), ...(stored?.headers ?? {}) },
    contextWindow: stored?.contextWindow ?? known?.contextWindow,
    reservedOutputTokens: stored?.reservedOutputTokens ?? known?.reservedOutputTokens,
    configured: Boolean(stored),
    disabledReason: stored?.disabledReason,
    updatedAt: stored?.updatedAt,
  };
}

function providerSort(a: string, b: string): number {
  const ai = KNOWN_PROVIDER_IDS.indexOf(a as KnownProviderId);
  const bi = KNOWN_PROVIDER_IDS.indexOf(b as KnownProviderId);
  if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  return a.localeCompare(b);
}

function isKnownProviderId(value: string): value is KnownProviderId {
  return (KNOWN_PROVIDER_IDS as readonly string[]).includes(value);
}

function normalizeWireApi(value: string | undefined): ProviderWireApi | undefined {
  if (value === "kimi-native" || value === "openai-chat-completions" || value === "openai-responses" || value === "external-cli") return value;
  return undefined;
}

function normalizeAuthMethod(value: string | undefined): ProviderAuthMethod | undefined {
  if (value === "api-key-env" || value === "oauth" || value === "external-cli" || value === "none") return value;
  return undefined;
}

function normalizeProfileType(value: string | undefined): ProviderProfileType | undefined {
  if (value === "runtime" || value === "compatibility") return value;
  return undefined;
}

function normalizePlanKind(value: string | undefined): ProviderPlanKind | undefined {
  if (
    value === "runtime" ||
    value === "openai-api" ||
    value === "chatgpt-plan" ||
    value === "claude-code-plan" ||
    value === "gemini-cli-plan" ||
    value === "qwen-coding-plan" ||
    value === "openrouter-credits" ||
    value === "openrouter-byok"
  ) return value;
  return undefined;
}

function normalizeRouting(value: string | undefined): "runtime" | "advisory" | "external-cli" | undefined {
  if (value === "runtime" || value === "advisory" || value === "external-cli") return value;
  return undefined;
}

async function isCodexCliAvailable(): Promise<boolean> {
  const result = await runShell("codex", ["--version"], { timeout: 5000 });
  return !result.failed;
}

export interface ProviderDefaults {
  provider: ProviderId;
  authorityProvider: ProviderId;
  model: string;
}

export interface UserModelAliasResolution {
  input: string;
  provider?: ProviderId;
  model: string;
  source: "user-alias" | "provider-alias" | "literal";
}

const USER_MODEL_ALIASES_KEY = "__userModelAliases";
const PROVIDER_DEFAULTS_KEY = "__providerDefaults";

export async function listUserModelAliases(options: DeepSeekConfigPathOptions = {}): Promise<Record<string, string>> {
  const config = await readOmkProvidersConfig(options);
  return { ...(config.providers[USER_MODEL_ALIASES_KEY]?.aliases ?? {}) };
}

export async function setUserModelAlias(
  alias: string,
  target: string,
  options: DeepSeekConfigPathOptions = {}
): Promise<{ key: string; value: string; aliases: Record<string, string>; configPath: string }> {
  const key = normalizeUserAlias(alias);
  const value = normalizeAliasTarget(target);
  if (!value) throw new Error("Model alias target is required");
  const config = await readOmkProvidersConfig(options);
  const aliases = { ...(config.providers[USER_MODEL_ALIASES_KEY]?.aliases ?? {}), [key]: value };
  const configPath = await writeOmkProvidersConfig({
    version: 1,
    providers: {
      ...config.providers,
      [USER_MODEL_ALIASES_KEY]: {
        enabled: true,
        kind: "local",
        defaultModel: "aliases",
        model: "aliases",
        aliases,
        updatedAt: new Date().toISOString(),
      },
    },
  }, options);
  return { key, value, aliases, configPath };
}

function normalizeAliasTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return "";
  const parsed = parseProviderModelArg(trimmed);
  if (parsed.provider && parsed.model) return `${parsed.provider}/${parsed.model}`;
  return parsed.model ?? trimmed;
}

export async function removeUserModelAlias(
  alias: string,
  options: DeepSeekConfigPathOptions = {}
): Promise<{ key: string; removed: boolean; aliases: Record<string, string>; configPath: string }> {
  const key = normalizeUserAlias(alias);
  const config = await readOmkProvidersConfig(options);
  const aliases = { ...(config.providers[USER_MODEL_ALIASES_KEY]?.aliases ?? {}) };
  const removed = Object.prototype.hasOwnProperty.call(aliases, key);
  delete aliases[key];
  const configPath = await writeOmkProvidersConfig({
    version: 1,
    providers: {
      ...config.providers,
      [USER_MODEL_ALIASES_KEY]: {
        enabled: true,
        kind: "local",
        defaultModel: "aliases",
        model: "aliases",
        aliases,
        updatedAt: new Date().toISOString(),
      },
    },
  }, options);
  return { key, removed, aliases, configPath };
}

export async function resolveUserModelAlias(
  input: string,
  options: DeepSeekConfigPathOptions = {}
): Promise<UserModelAliasResolution> {
  const raw = input.trim();
  if (!raw) throw new Error("Model is required");
  const aliases = await listUserModelAliases(options);
  const aliased = aliases[normalizeUserAlias(raw)];
  const candidate = aliased ?? raw;
  const parsed = parseProviderModelArg(candidate);
  if (parsed.provider || parsed.model !== raw) {
    return {
      input: raw,
      provider: parsed.provider,
      model: parsed.model ?? candidate,
      source: aliased ? "user-alias" : "literal",
    };
  }

  const providers = await readProviderRegistry(options);
  for (const provider of providers) {
    const model = provider.aliases[candidate] ?? provider.aliases[candidate.toLowerCase()];
    if (model) {
      return { input: raw, provider: provider.id, model, source: aliased ? "user-alias" : "provider-alias" };
    }
  }
  return { input: raw, model: candidate, source: aliased ? "user-alias" : "literal" };
}

export async function readProviderDefaults(options: DeepSeekConfigPathOptions = {}): Promise<ProviderDefaults> {
  const config = await readOmkProvidersConfig(options);
  const stored = config.providers[PROVIDER_DEFAULTS_KEY];
  const provider = stored?.aliases?.provider ?? process.env.OMK_DEFAULT_PROVIDER ?? DEFAULT_AUTHORITY_PROVIDER;
  const authorityProvider = stored?.aliases?.authorityProvider ?? process.env.OMK_AUTHORITY_PROVIDER ?? provider;
  const model = stored?.model ?? stored?.defaultModel ?? process.env.OMK_DEFAULT_MODEL ?? "mimo-v2.5-pro";
  const normalized = normalizeProviderId(provider);
  const normalizedAuthority = normalizeProviderId(authorityProvider);
  return {
    provider: normalized === "auto" ? DEFAULT_AUTHORITY_PROVIDER : normalized,
    authorityProvider: normalizedAuthority === "auto" ? DEFAULT_AUTHORITY_PROVIDER : normalizedAuthority,
    model: normalizeModelAlias(model),
  };
}

export async function setProviderDefaults(
  defaults: Partial<ProviderDefaults>,
  options: DeepSeekConfigPathOptions = {}
): Promise<{ defaults: ProviderDefaults; configPath: string }> {
  const current = await readProviderDefaults(options);
  const provider = defaults.provider ? normalizeProviderId(defaults.provider) : current.provider;
  const authorityProvider = defaults.authorityProvider ? normalizeProviderId(defaults.authorityProvider) : current.authorityProvider;
  const next: ProviderDefaults = {
    provider: provider === "auto" ? current.provider : provider,
    authorityProvider: authorityProvider === "auto" ? current.authorityProvider : authorityProvider,
    model: defaults.model ? normalizeModelAlias(defaults.model) : current.model,
  };
  const config = await readOmkProvidersConfig(options);
  const configPath = await writeOmkProvidersConfig({
    version: 1,
    providers: {
      ...config.providers,
      [PROVIDER_DEFAULTS_KEY]: {
        enabled: true,
        kind: "local",
        defaultModel: next.model,
        model: next.model,
        aliases: { provider: next.provider, authorityProvider: next.authorityProvider },
        updatedAt: new Date().toISOString(),
      },
    },
  }, options);
  return { defaults: next, configPath };
}

function normalizeUserAlias(value: string): string {
  const key = value.trim().toLowerCase();
  if (!key) throw new Error("Model alias is required");
  return key;
}
