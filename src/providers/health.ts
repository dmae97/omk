import type { ProviderAvailability } from "./types.js";
import type { ProviderHealthVector } from "../contracts/provider-health.js";

function makeAvailableVector(provider: string): ProviderHealthVector {
  return {
    provider,
    binary: "ready",
    auth: "ready",
    model: "ready",
    quota: "ready",
    latencyP50Ms: 0,
    latencyP95Ms: 0,
    supportsRead: true,
    supportsWrite: true,
    supportsShell: true,
    supportsSandbox: true,
    evidencePassRate7d: 1.0,
    failureEwma: 0,
  };
}

function makeUnavailableVector(provider: string, reason?: string): ProviderHealthVector {
  const failureEwma = reason?.includes("402") || reason?.includes("quota") ? 0.8 : 0.5;
  return {
    provider,
    binary: "missing",
    auth: "missing",
    model: "missing",
    quota: "missing",
    latencyP50Ms: 0,
    latencyP95Ms: 0,
    supportsRead: false,
    supportsWrite: false,
    supportsShell: false,
    supportsSandbox: false,
    evidencePassRate7d: 0.5,
    failureEwma,
  };
}

export class ProviderHealthRegistry {
  private kimi: ProviderAvailability = {
    provider: "kimi",
    available: true,
    checkedAt: Date.now(),
    disableForRun: false,
    healthVector: makeAvailableVector("kimi"),
  };

  private deepseek?: ProviderAvailability;

  getKimi(): ProviderAvailability {
    return this.kimi;
  }

  getKimiVector(): ProviderHealthVector | undefined {
    return this.kimi.healthVector;
  }

  isKimiAvailable(): boolean {
    return this.kimi.available !== false && this.kimi.disableForRun !== true;
  }

  markKimiUnavailable(reason: string): void {
    this.kimi = {
      provider: "kimi",
      available: false,
      checkedAt: Date.now(),
      reason,
      disableForRun: true,
      healthVector: makeUnavailableVector("kimi", reason),
    };
  }

  markKimiAvailable(): void {
    this.kimi = {
      provider: "kimi",
      available: true,
      checkedAt: Date.now(),
      disableForRun: false,
      healthVector: makeAvailableVector("kimi"),
    };
  }

  getDeepSeek(): ProviderAvailability | undefined {
    return this.deepseek;
  }

  getDeepSeekVector(): ProviderHealthVector | undefined {
    return this.deepseek?.healthVector;
  }

  isDeepSeekAvailable(): boolean {
    return this.deepseek?.available !== false && this.deepseek?.disableForRun !== true;
  }

  markDeepSeekUnavailable(reason: string): void {
    this.deepseek = {
      provider: "deepseek",
      available: false,
      checkedAt: Date.now(),
      reason,
      disableForRun: true,
      healthVector: makeUnavailableVector("deepseek", reason),
    };
  }

  markDeepSeekAvailable(): void {
    this.deepseek = {
      provider: "deepseek",
      available: true,
      checkedAt: Date.now(),
      disableForRun: false,
      healthVector: makeAvailableVector("deepseek"),
    };
  }
}
