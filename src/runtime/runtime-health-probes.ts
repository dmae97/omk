import { maskSensitiveText } from "../util/secret-mask.js";
import type { RuntimeHealth, RuntimeHealthProbeKind } from "./contracts/shared.js";

export interface RuntimeHealthProbeInput {
  readonly probeKind?: RuntimeHealthProbeKind;
  readonly timeoutMs?: number;
  readonly highRisk?: boolean;
}

export interface StaticHealthInput {
  readonly runtimeId: string;
  readonly available: boolean;
  readonly reason?: string;
  readonly authOk?: boolean;
  readonly modelOk?: boolean;
  readonly runtimeOk?: boolean;
  readonly quotaOk?: boolean;
  readonly rateLimitOk?: boolean;
  readonly probeKind?: RuntimeHealthProbeKind;
  readonly ttlMs?: number;
  readonly latencyMs?: number;
}

export function staticRuntimeHealth(input: StaticHealthInput): RuntimeHealth {
  const now = new Date();
  const runtimeOk = input.runtimeOk ?? input.available;
  const authOk = input.authOk ?? input.available;
  const modelOk = input.modelOk ?? input.available;
  const quotaOk = input.quotaOk ?? true;
  const rateLimitOk = input.rateLimitOk ?? true;
  return {
    runtimeId: input.runtimeId,
    available: input.available,
    reason: input.reason,
    checkedAt: now.toISOString(),
    vector: {
      runtimeOk,
      authOk,
      modelOk,
      quotaOk,
      rateLimitOk,
      runtime: runtimeOk ? "pass" : "fail",
      auth: authOk ? "pass" : "fail",
      model: modelOk ? "pass" : "fail",
      quota: quotaOk ? "unknown" : "fail",
      rateLimit: rateLimitOk ? "unknown" : "fail",
      ...(input.latencyMs !== undefined && { latencyMs: input.latencyMs }),
      lastProbeKind: input.probeKind ?? "static",
      checkedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? 60_000)).toISOString(),
    },
  };
}

export async function probeOpenAiCompatibleModels(input: {
  readonly runtimeId: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly apiKeyName: string;
  readonly model: string;
  readonly providerName: string;
  readonly probeKind: RuntimeHealthProbeKind;
  readonly timeoutMs?: number;
}): Promise<RuntimeHealth> {
  const staticAuthOk = Boolean(input.apiKey);
  const staticModelOk = input.model.trim().length > 0 && input.model !== "default";
  if (!staticAuthOk || !staticModelOk || input.probeKind === "static" || input.probeKind === "none") {
    const reason = !staticAuthOk
      ? `${input.apiKeyName} is not set`
      : !staticModelOk
        ? `${input.providerName} model is not configured`
        : undefined;
    return staticRuntimeHealth({
      runtimeId: input.runtimeId,
      available: staticAuthOk && staticModelOk,
      reason,
      authOk: staticAuthOk,
      modelOk: staticModelOk,
      runtimeOk: true,
      probeKind: input.probeKind === "none" ? "static" : input.probeKind,
    });
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 5000);
  try {
    const response = await fetch(`${input.baseUrl.replace(/\/+$/, "")}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const authOk = response.status !== 401 && response.status !== 403;
    const rateLimitOk = response.status !== 429;
    const quotaOk = response.status !== 402;
    const modelOk = staticModelOk && response.status !== 404;
    const runtimeOk = response.status < 500;
    const available = response.ok && authOk && modelOk && quotaOk && rateLimitOk;
    const reason = available ? undefined : `${input.providerName} health probe returned ${response.status}`;
    return staticRuntimeHealth({
      runtimeId: input.runtimeId,
      available,
      reason,
      authOk,
      modelOk,
      runtimeOk,
      quotaOk,
      rateLimitOk,
      latencyMs,
      probeKind: input.probeKind,
      ttlMs: 30_000,
    });
  } catch (err) {
    const latencyMs = Date.now() - started;
    const reason = maskSensitiveText(err instanceof Error ? err.message : String(err));
    return staticRuntimeHealth({
      runtimeId: input.runtimeId,
      available: false,
      reason: `${input.providerName} health probe failed: ${reason}`,
      authOk: staticAuthOk,
      modelOk: staticModelOk,
      runtimeOk: false,
      quotaOk: true,
      rateLimitOk: true,
      latencyMs,
      probeKind: input.probeKind,
      ttlMs: 30_000,
    });
  } finally {
    clearTimeout(timeout);
  }
}
