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
