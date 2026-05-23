import type { ProviderAvailability, ProviderId } from "./types.js";

export class ProviderHealthRegistry {
  private providers = new Map<ProviderId, ProviderAvailability>();

  constructor() {
    this.register("kimi");
  }

  register(provider: ProviderId): void {
    this.providers.set(provider, {
      provider,
      available: true,
      checkedAt: Date.now(),
      disableForRun: false,
    });
  }

  setAvailable(provider: ProviderId): void {
    const entry = this.providers.get(provider);
    if (entry) {
      entry.available = true;
      entry.checkedAt = Date.now();
      entry.disableForRun = false;
      entry.reason = undefined;
    }
  }

  setUnavailable(provider: ProviderId, reason: string): void {
    const entry = this.providers.get(provider);
    if (entry) {
      entry.available = false;
      entry.checkedAt = Date.now();
      entry.reason = reason;
      entry.disableForRun = true;
    }
  }

  isAvailable(provider: ProviderId): boolean {
    const entry = this.providers.get(provider);
    if (!entry) return false;
    return entry.available !== false && entry.disableForRun !== true;
  }

  get(provider: ProviderId): ProviderAvailability | undefined {
    return this.providers.get(provider);
  }

  list(): ProviderAvailability[] {
    return Array.from(this.providers.values());
  }

  // Backward-compatible aliases (delegate to new methods)

  getKimi(): ProviderAvailability {
    return this.get("kimi")!;
  }

  isKimiAvailable(): boolean {
    return this.isAvailable("kimi");
  }

  markKimiUnavailable(reason: string): void {
    this.setUnavailable("kimi", reason);
  }

  markKimiAvailable(): void {
    this.setAvailable("kimi");
  }

  getDeepSeek(): ProviderAvailability | undefined {
    return this.get("deepseek");
  }

  isDeepSeekAvailable(): boolean {
    // Backward compat: before registration, deepseek was implicitly available
    const entry = this.get("deepseek");
    if (!entry) return true;
    return entry.available !== false && entry.disableForRun !== true;
  }

  markDeepSeekUnavailable(reason: string): void {
    if (!this.providers.has("deepseek")) {
      this.register("deepseek");
    }
    this.setUnavailable("deepseek", reason);
  }

  markDeepSeekAvailable(): void {
    if (!this.providers.has("deepseek")) {
      this.register("deepseek");
    }
    this.setAvailable("deepseek");
  }
}
