import type { ProviderAvailability } from "./types.js";

export class ProviderHealthRegistry {
  private kimi: ProviderAvailability = {
    provider: "kimi",
    available: true,
    checkedAt: Date.now(),
    disableForRun: false,
  };

  private deepseek?: ProviderAvailability;

  getKimi(): ProviderAvailability {
    return this.kimi;
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
    };
  }

  markKimiAvailable(): void {
    this.kimi = {
      provider: "kimi",
      available: true,
      checkedAt: Date.now(),
      disableForRun: false,
    };
  }

  getDeepSeek(): ProviderAvailability | undefined {
    return this.deepseek;
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
    };
  }

  markDeepSeekAvailable(): void {
    this.deepseek = {
      provider: "deepseek",
      available: true,
      checkedAt: Date.now(),
      disableForRun: false,
    };
  }
}
