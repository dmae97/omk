import { checkCommand } from "../util/shell.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type RuntimeSessionMode = "interactive-tty" | "one-shot-cli" | "api-turn" | "advisory-only";

export interface RuntimeBootstrap {
  ok: boolean;
  provider: string;
  providerPolicy: string;
  selectedProvider: string;
  selectedRuntimeId?: string;
  selectedModel?: string;
  sessionMode: RuntimeSessionMode;
  authOk: boolean;
  modelOk: boolean;
  runtimeOk: boolean;
  reason?: string;
  setupHints: string[];
}

function detectProvider(
  provider: string,
  env: Record<string, string | undefined>
): { bin?: string; envKey?: string; sessionMode: RuntimeSessionMode; installHint: string; authHint: string; modelHint: string } {
  switch (provider) {
    case "kimi":
      return {
        envKey: "KIMI_API_KEY",
        sessionMode: "api-turn",
        installHint: "Set KIMI_API_KEY env var or configure [providers.kimi] in ~/.omk/config.toml",
        authHint: "Set KIMI_API_KEY env var",
        modelHint: env.KIMI_MODEL ?? "kimi-k2.6",
      };
    case "mimo":
      return {
        envKey: "MIMO_API_KEY",
        sessionMode: "api-turn",
        installHint: "Set MIMO_API_KEY env var or configure [providers.mimo] in ~/.omk/config.toml",
        authHint: "Set MIMO_API_KEY env var",
        modelHint: env.MIMO_MODEL ?? "mimo-v2.5-pro",
      };
    case "codex":
      return {
        bin: env.CODEX_BIN ?? "codex",
        sessionMode: "one-shot-cli",
        installHint: "npm install -g @openai/codex",
        authHint: "codex login",
        modelHint: "codex-cli default",
      };
    case "deepseek":
      return {
        envKey: "DEEPSEEK_API_KEY",
        sessionMode: "api-turn",
        installHint: "export DEEPSEEK_API_KEY=sk-...",
        authHint: "Set DEEPSEEK_API_KEY env var",
        modelHint: env.DEEPSEEK_MODEL ?? "deepseek-chat",
      };
    case "glm":
    case "bigmodel":
    case "zhipu":
      return {
        envKey: env.GLM_API_KEY && !env.BIGMODEL_API_KEY ? "GLM_API_KEY" : "BIGMODEL_API_KEY",
        sessionMode: "api-turn",
        installHint: "export BIGMODEL_API_KEY=...",
        authHint: "Set BIGMODEL_API_KEY env var",
        modelHint: env.GLM_MODEL ?? "glm-5.2",
      };
    case "local":
    case "llama":
    case "local-llm":
      return {
        sessionMode: "api-turn",
        installHint: "LOCAL_LLM_BASE_URL=http://localhost:8080/v1 LOCAL_LLM_MODEL=qwen3-coder-30b-a3b",
        authHint: "Start llama-server or llama.cpp with --port 8080",
        modelHint: env.LOCAL_LLM_MODEL ?? "qwen3-coder-30b-a3b",
      };
    case "commandcode":
      return {
        bin: env.COMMANDCODE_BIN ?? "commandcode",
        sessionMode: "one-shot-cli",
        installHint: "npm install -g commandcode",
        authHint: "commandcode login",
        modelHint: "commandcode default",
      };
    case "opencode":
      return {
        bin: env.OPENCODE_BIN ?? "opencode",
        sessionMode: "one-shot-cli",
        installHint: "cargo install opencode",
        authHint: "opencode login",
        modelHint: "opencode default",
      };
    default:
      return {
        sessionMode: "advisory-only",
        installHint: "omk auth",
        authHint: "omk auth",
        modelHint: "auto-detect",
      };
  }
}

async function resolveAutoProvider(env: Record<string, string | undefined>): Promise<{ provider: string; runtimeId: string } | undefined> {
  // 1. Check OMK config.toml for explicit default_model (highest priority)
  const configContent = readHomeProviderConfig(env, ".omk");
  if (configContent) {
    const defaultModelMatch = configContent.match(/default_model\s*=\s*"([^"]+)"/);
    if (defaultModelMatch) {
      const defaultModel = defaultModelMatch[1];
      if (defaultModel.startsWith("mimo") && (env.MIMO_API_KEY || providerConfigHasApiKey(configContent, "mimo"))) return { provider: "mimo", runtimeId: "mimo-api" };
      if ((defaultModel.startsWith("kimi") || defaultModel.startsWith("moonshot")) && (env.KIMI_API_KEY || providerConfigHasApiKey(configContent, "kimi"))) return { provider: "kimi", runtimeId: "kimi-api" };
      if (defaultModel.startsWith("deepseek") && env.DEEPSEEK_API_KEY) return { provider: "deepseek", runtimeId: "deepseek-api" };
      if (defaultModel.startsWith("glm") && (env.BIGMODEL_API_KEY || env.GLM_API_KEY || providerConfigHasApiKey(configContent, "glm"))) return { provider: "glm", runtimeId: "glm-api" };
    }
    if (providerConfigHasApiKey(configContent, "mimo")) return { provider: "mimo", runtimeId: "mimo-api" };
    if (providerConfigHasApiKey(configContent, "kimi")) return { provider: "kimi", runtimeId: "kimi-api" };
    if (providerConfigHasApiKey(configContent, "glm")) return { provider: "glm", runtimeId: "glm-api" };
  }

  // 2. Check for API keys in env
  if (env.MIMO_API_KEY) return { provider: "mimo", runtimeId: "mimo-api" };
  if (env.KIMI_API_KEY) return { provider: "kimi", runtimeId: "kimi-api" };
  if (env.DEEPSEEK_API_KEY) return { provider: "deepseek", runtimeId: "deepseek-api" };
  if (env.BIGMODEL_API_KEY || env.GLM_API_KEY) return { provider: "glm", runtimeId: "glm-api" };
  if (env.LOCAL_LLM_BASE_URL) return { provider: "local-llm", runtimeId: "local-llm" };

  // 3. CLI binary detection (lowest priority)
  const codexBin = env.CODEX_BIN ?? "codex";
  if (await checkCommand(codexBin).catch(() => false)) return { provider: "codex", runtimeId: "codex-cli" };

  let commandcodeBin: string | undefined;
  if (env.COMMANDCODE_BIN) {
    commandcodeBin = await checkCommand(env.COMMANDCODE_BIN).catch(() => false) ? env.COMMANDCODE_BIN : undefined;
  } else if (await checkCommand("commandcode").catch(() => false)) {
    commandcodeBin = "commandcode";
  }
  if (commandcodeBin) return { provider: "commandcode", runtimeId: "commandcode-cli" };

  const opencodeBin = env.OPENCODE_BIN ?? "opencode";
  if (await checkCommand(opencodeBin).catch(() => false)) return { provider: "opencode", runtimeId: "opencode-cli" };


  return undefined;
}

export async function resolveRuntimeBootstrap(options: {
  provider: string;
  model?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
}): Promise<RuntimeBootstrap> {
  const providerPolicy = options.provider.trim().toLowerCase() || "auto";
  const env = options.env ?? process.env;
  const resolvedPolicy = await resolveProviderPolicy(providerPolicy, env);
  if (!resolvedPolicy.ok) {
    return {
      ok: false,
      provider: providerPolicy,
      providerPolicy,
      selectedProvider: providerPolicy,
      selectedRuntimeId: "unresolved",
      selectedModel: options.model,
      sessionMode: "advisory-only",
      authOk: false,
      modelOk: false,
      runtimeOk: false,
      reason: resolvedPolicy.reason,
      setupHints: resolvedPolicy.remediation,
    };
  }
  const authorityProvider = resolvedPolicy.provider;
  const effectiveProviderPolicy = authorityProvider;
  const autoSelection = effectiveProviderPolicy === "auto" ? await resolveAutoProvider(env) : undefined;
  const selectedProvider = autoSelection?.provider ?? effectiveProviderPolicy;
  const info = detectProvider(selectedProvider, env);
  const hints: string[] = [];

  let runtimeOk = false;
  let authOk = false;
  let modelOk = false;
  const reasons: string[] = [];

  if (effectiveProviderPolicy === "auto" && !autoSelection) {
    reasons.push("no runnable runtime detected for auto provider policy");
    hints.push("Configure a provider: mimo, deepseek, codex, commandcode, opencode, or local-llm");
    hints.push("Use an explicit provider, e.g. omk chat --provider mimo --mcp-scope none");
  } else if (info.bin) {
    runtimeOk = await checkCommand(info.bin).catch(() => false);
    if (!runtimeOk) {
      reasons.push(`${info.bin} CLI not found`);
      hints.push(info.installHint);
    } else {
      authOk = true;
    }
  } else if (info.envKey) {
    runtimeOk = Boolean(env[info.envKey]);
    if (!runtimeOk && (selectedProvider === "mimo" || selectedProvider === "kimi" || selectedProvider === "glm")) {
      const configContent = readHomeProviderConfig(env, ".omk");
      runtimeOk = configContent ? providerConfigHasApiKey(configContent, selectedProvider) : false;
    }
    if (!runtimeOk) {
      reasons.push(`${info.envKey} is not set`);
      hints.push(info.installHint);
    } else {
      authOk = true;
    }
  }

  if (runtimeOk) modelOk = true;

  if (!runtimeOk && effectiveProviderPolicy !== "auto") {
    hints.push(info.authHint);
    hints.push(`omk chat --provider ${selectedProvider} --model ${info.modelHint}`);
  }

  const ok = runtimeOk && authOk && modelOk;

  return {
    ok,
    provider: selectedProvider,
    providerPolicy,
    selectedProvider,
    selectedRuntimeId: autoSelection?.runtimeId ?? resolvedPolicy.runtimeId ?? info.bin ?? info.envKey ?? "auto",
    selectedModel: options.model ?? info.modelHint,
    sessionMode: info.sessionMode,
    authOk,
    modelOk,
    runtimeOk,
    reason: reasons.length > 0 ? reasons.join("; ") : undefined,
    setupHints: hints,
  };
}

function readHomeProviderConfig(env: Record<string, string | undefined>, configDir: ".omk"): string | undefined {
  try {
    const home = env.HOME ?? env.USERPROFILE;
    if (!home) return undefined;
    return readFileSync(join(home, configDir, "config.toml"), "utf-8");
  } catch {
    return undefined;
  }
}

function providerConfigHasApiKey(configContent: string, provider: string): boolean {
  return new RegExp(`\\[providers\\.${escapeRegExp(provider)}\\][\\s\\S]*?api_key\\s*=\\s*"[^"]+"`).test(configContent);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type ResolvedProviderPolicy =
  | { ok: true; provider: string; runtimeId?: string; reason?: string }
  | { ok: false; provider: string; reason: string; remediation: string[] };

export async function resolveProviderPolicy(
  providerPolicy: string,
  env: Record<string, string | undefined>
): Promise<ResolvedProviderPolicy> {
  const normalized = providerPolicy.trim().toLowerCase() || "auto";
  if (!["authority", "primary", "omk"].includes(normalized)) {
    return { ok: true, provider: normalized };
  }

  const configured =
    env.OMK_AUTHORITY_PROVIDER?.trim().toLowerCase()
    || env.OMK_DEFAULT_PROVIDER?.trim().toLowerCase();

  if (configured && !["authority", "primary", "omk"].includes(configured)) {
    return { ok: true, provider: configured, reason: `resolved from OMK_AUTHORITY_PROVIDER` };
  }

  // Default authority chain: mimo > kimi > auto
  if (env.MIMO_API_KEY || (await hasProviderConfigApiKey(env, "mimo"))) {
    return { ok: true, provider: "mimo", runtimeId: "mimo-api", reason: "default authority resolved to mimo" };
  }
  if (env.KIMI_API_KEY || (await hasProviderConfigApiKey(env, "kimi"))) {
    return { ok: true, provider: "kimi", runtimeId: "kimi-api", reason: "default authority resolved to kimi" };
  }
  const auto = await resolveAutoProvider(env);
  if (auto) {
    return { ok: true, provider: auto.provider, runtimeId: auto.runtimeId, reason: "authority fell back to auto-selected provider" };
  }

  return {
    ok: false,
    provider: normalized,
    reason: "no authority provider is configured or healthy",
    remediation: [
      "Set OMK_AUTHORITY_PROVIDER to a concrete provider (e.g. mimo, kimi, codex).",
      "Set the provider API key env var (e.g. MIMO_API_KEY, KIMI_API_KEY).",
      "Or configure [providers.<name>] api_key in ~/.omk/config.toml.",
    ],
  };
}

async function hasProviderConfigApiKey(env: Record<string, string | undefined>, provider: string): Promise<boolean> {
  const configContent = readHomeProviderConfig(env, ".omk");
  return configContent ? providerConfigHasApiKey(configContent, provider) : false;
}
