/**
 * Shared, provider-neutral health shape.
 *
 * This contract is intentionally additive: it is embedded alongside the
 * existing `omk provider doctor <x> --json` payloads without removing or
 * renaming any pre-existing keys. It never carries secret values — only
 * boolean signals (e.g. `authOk`) and non-sensitive remediation hints.
 */

/** Classified failure category for a provider health check. */
export type ProviderFailureKind =
  | "none"
  | "runtime"
  | "auth"
  | "model"
  | "quota"
  | "policy"
  | "transient"
  | "unknown";

/** Authority level a provider holds for a given capability lane. */
export type ProviderAuthorityLevel = "none" | "advisory" | "direct" | "full";

/** Capability-vector state machine for a single provider dimension. */
export type ProviderCapabilityState =
  | "missing"
  | "installed"
  | "auth_present"
  | "auth_valid"
  | "model_available"
  | "quota_available"
  | "sandbox_supported"
  | "tool_contract_verified"
  | "ready";

/** Ordinal ordering for capability states (higher = more mature). */
export const PROVIDER_CAPABILITY_ORDINAL: Readonly<Record<ProviderCapabilityState, number>> = {
  missing: 0,
  installed: 1,
  auth_present: 2,
  auth_valid: 3,
  model_available: 4,
  quota_available: 5,
  sandbox_supported: 6,
  tool_contract_verified: 7,
  ready: 8,
};

/** Provider health as a capability vector (Profiler v2). */
export interface ProviderHealthVector {
  /** Provider id (e.g. "kimi", "deepseek", "codex"). */
  provider: string;
  /** Binary/runtime installation state. */
  binary: ProviderCapabilityState;
  /** Authentication state. */
  auth: ProviderCapabilityState;
  /** Model resolution state. */
  model: ProviderCapabilityState;
  /** Quota/balance state. */
  quota: ProviderCapabilityState;
  /** P50 latency in milliseconds (0 = unknown). */
  latencyP50Ms: number;
  /** P95 latency in milliseconds (0 = unknown). */
  latencyP95Ms: number;
  /** Whether the provider supports read operations. */
  supportsRead: boolean;
  /** Whether the provider supports write operations. */
  supportsWrite: boolean;
  /** Whether the provider supports shell execution. */
  supportsShell: boolean;
  /** Whether the provider supports sandboxed execution. */
  supportsSandbox: boolean;
  /** 7-day evidence pass rate [0, 1] (default 0.5 = no data). */
  evidencePassRate7d: number;
  /** Exponentially-weighted moving average of failures [0, 1] (0 = healthy). */
  failureEwma: number;
}

/** Derive a backward-compatible `healthy` boolean from a capability vector. */
export function isHealthy(vector: ProviderHealthVector): boolean {
  return (
    vector.binary === "ready" &&
    vector.auth === "ready" &&
    vector.model === "ready" &&
    vector.quota === "ready"
  );
}

/** Convert the legacy {@link ProviderHealth} contract into a v2 capability vector. */
export function providerHealthToVector(health: ProviderHealth): ProviderHealthVector {
  const binary: ProviderCapabilityState = health.runtimeOk ? "ready" : "missing";
  const auth: ProviderCapabilityState = health.authOk
    ? "ready"
    : health.failureKind === "auth"
      ? "auth_present"
      : "missing";
  const model: ProviderCapabilityState = health.modelOk ? "ready" : "missing";
  const quota: ProviderCapabilityState = health.quotaOk
    ? "ready"
    : health.failureKind === "quota"
      ? "auth_valid"
      : "missing";

  return {
    provider: health.provider,
    binary,
    auth,
    model,
    quota,
    latencyP50Ms: 0,
    latencyP95Ms: 0,
    supportsRead: true,
    supportsWrite: health.writeAuthority !== "none" && health.writeAuthority !== "advisory",
    supportsShell: health.shellAuthority !== "none",
    supportsSandbox: health.shellAuthority !== "none",
    evidencePassRate7d: health.failureKind === "none" ? 1.0 : 0.5,
    failureEwma: health.failureKind === "none" ? 0 : 0.5,
  };
}

/**
 * Normalized provider health snapshot.
 *
 * All fields are required so consumers can rely on a stable shape regardless
 * of which provider produced it.
 */
export interface ProviderHealth {
  /** Provider id (e.g. "kimi", "deepseek", "codex"). */
  provider: string;
  /** ISO-8601 timestamp of when the health snapshot was produced. */
  checkedAt: string;
  /** Runtime/transport reachable and enabled. */
  runtimeOk: boolean;
  /** Authentication satisfied (API key present or externally managed auth). */
  authOk: boolean;
  /** A resolvable default model is configured. */
  modelOk: boolean;
  /** No known quota/balance/rate-limit blocker. */
  quotaOk: boolean;
  /** Authority to perform write/merge work. */
  writeAuthority: ProviderAuthorityLevel;
  /** Authority to run shell/CLI work. */
  shellAuthority: ProviderAuthorityLevel;
  /** Authority to drive MCP tools. */
  mcpAuthority: ProviderAuthorityLevel;
  /** Classified failure category ("none" when healthy). */
  failureKind: ProviderFailureKind;
  /** Non-sensitive remediation hints (never includes secret values). */
  remediation: string[];
}
