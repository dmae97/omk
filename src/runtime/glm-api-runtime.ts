import type { AgentRuntime } from "./agent-runtime.js";
import { KimiApiRuntime, type KimiApiRuntimeOptions } from "./kimi-api-runtime.js";

export type GlmApiRuntimeOptions = KimiApiRuntimeOptions;

export function createGlmApiRuntime(options: GlmApiRuntimeOptions = {}): AgentRuntime {
  const env = options.env ?? process.env;
  return new KimiApiRuntime({
    ...options,
    id: options.id ?? "glm-api",
    providerId: "glm",
    providerName: "Zhipu GLM",
    apiKeyEnvName: env.GLM_API_KEY && !env.BIGMODEL_API_KEY ? "GLM_API_KEY" : "BIGMODEL_API_KEY",
    priority: options.priority ?? 84,
    apiKey: options.apiKey ?? env.BIGMODEL_API_KEY ?? env.GLM_API_KEY,
    model: options.model ?? env.GLM_MODEL ?? "glm-5.2",
    baseUrl: options.baseUrl ?? env.GLM_BASE_URL ?? env.BIGMODEL_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v1",
  });
}
