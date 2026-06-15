import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";

export type KnownProviderId = "mimo" | "kimi" | "deepseek" | "codex" | "qwen" | "openrouter" | "anthropic" | "glm";
export type ProviderId = KnownProviderId | (string & {});
export type ProviderPolicy = "auto" | ProviderId;
export const DEFAULT_AUTHORITY_PROVIDER: ProviderId = "mimo";
export const DEFAULT_FALLBACK_RUNTIME = "mimo-api";
export const DEFAULT_RUNTIME_FALLBACK_CHAIN = [
  DEFAULT_FALLBACK_RUNTIME,
  "codex-cli",
  "deepseek-api",
  "opencode-cli",
  "commandcode-cli",
] as const;

const LEGACY_EXTERNAL_RUNTIME_MODES = new Set(["print", "wire"]);

export function resolveFallbackProvider(
  provider?: ProviderId | ProviderPolicy | readonly (ProviderId | ProviderPolicy)[]
): ProviderId {
  const candidates = Array.isArray(provider) ? provider : [provider];
  for (const candidate of candidates) {
    if (candidate && candidate !== "auto") return candidate as ProviderId;
  }
  return DEFAULT_AUTHORITY_PROVIDER;
}

export function resolveAuthorityProvider(
  availableProviders: readonly ProviderId[] = [],
  preferredProvider?: ProviderPolicy
): ProviderId {
  if (preferredProvider && preferredProvider !== "auto" && availableProviders.includes(preferredProvider)) {
    return preferredProvider;
  }

  const defaultAuthority = availableProviders.find((provider) => provider === DEFAULT_AUTHORITY_PROVIDER);
  if (defaultAuthority) return defaultAuthority;

  const neutralProvider = availableProviders.find((provider) => provider !== "kimi" && provider !== "deepseek");
  if (neutralProvider) return neutralProvider;

  return DEFAULT_AUTHORITY_PROVIDER;
}

export function resolveFallbackRuntime(availableRuntimes: readonly string[] = []): string {
  return resolveRuntimeFallbackChain(availableRuntimes)[0] ?? DEFAULT_FALLBACK_RUNTIME;
}

export function resolveRuntimeFallbackChain(availableRuntimes: readonly string[] = []): string[] {
  const runtimes = availableRuntimes.length > 0
    ? [...availableRuntimes]
    : [...DEFAULT_RUNTIME_FALLBACK_CHAIN];
  return runtimes.sort((left, right) => runtimeFallbackRank(left) - runtimeFallbackRank(right));
}

function runtimeFallbackRank(runtimeId: string): number {
  const defaultIndex = DEFAULT_RUNTIME_FALLBACK_CHAIN.indexOf(runtimeId as (typeof DEFAULT_RUNTIME_FALLBACK_CHAIN)[number]);
  if (defaultIndex >= 0) return defaultIndex;
  if (LEGACY_EXTERNAL_RUNTIME_MODES.has(runtimeModeId(runtimeId))) return 10_000;
  return 5_000;
}

function runtimeModeId(runtimeId: string): string {
  const [, ...modeParts] = runtimeId.toLowerCase().split("-");
  return modeParts.join("-");
}
export type ProviderRisk = "read" | "write" | "shell" | "merge";
export type ProviderComplexity = "simple" | "moderate" | "complex";
export type ProviderKind = "kimi-native" | "openai-compatible" | "external-cli" | "codex-cli" | "local";
export type ProviderWireApi = "kimi-native" | "openai-chat-completions" | "openai-responses" | "anthropic-messages" | "external-cli";
export type ProviderAuthMethod = "api-key-env" | "oauth" | "external-cli" | "none";
export type ProviderProfileType = "runtime" | "compatibility";
export type ProviderPlanKind =
  | "runtime"
  | "openai-api"
  | "chatgpt-plan"
  | "claude-code-plan"
  | "gemini-cli-plan"
  | "qwen-coding-plan"
  | "openrouter-credits"
  | "openrouter-byok";
export type DeepSeekModelTier = "flash" | "pro";
export type DeepSeekParticipation = "direct" | "advisory";
export type ProviderAuthority = "authority" | "direct" | "advisory" | "veto";

export interface DeepSeekRoutePlan {
  provider: "deepseek";
  model: "deepseek-v4-flash" | "deepseek-v4-pro";
  tier: DeepSeekModelTier;
  participation: DeepSeekParticipation;
  reasoningEffort: "max";
  ratioBucket: number;
}

export interface ProviderModelRef {
  provider: ProviderId;
  model: string;
  authority: ProviderAuthority;
  capabilities: string[];
}

export interface ProviderModelDefault {
  model: string;
  capabilities: string[];
}

export type ProviderRouteEnsembleParticipation = DeepSeekParticipation | ProviderAuthority;

export interface ProviderRouteEnsembleCandidate {
  id: string;
  provider: ProviderId;
  participation: ProviderRouteEnsembleParticipation;
  score: number;
  reason: string;
  selected: boolean;
  veto?: boolean;
}

export interface ProviderRouteEnsembleResult {
  winner: ProviderRouteEnsembleCandidate["id"];
  confidence: number;
  quorum: number;
  candidates: ProviderRouteEnsembleCandidate[];
}

export interface ProviderRouteInput {
  nodeId?: string;
  role: string;
  taskType: string;
  risk: ProviderRisk;
  complexity: ProviderComplexity;
  needsToolCalling: boolean;
  needsMcp: boolean;
  readOnly?: boolean;
  estimatedTokens: number;
  deepseekAvailable: boolean;
  providerAvailability?: Partial<Record<ProviderId, boolean>>;
  providerModels?: Partial<Record<ProviderId, ProviderModelDefault>>;
  providerHint?: "auto" | ProviderId;
  providerPolicy?: ProviderPolicy;
  authorityProvider?: ProviderId;
  preferredModel?: string;
  preferredDeepSeekTier?: DeepSeekModelTier;
  /** v2 capability vectors for hard-constraint filtering. */
  providerHealthVectors?: Partial<Record<ProviderId, import("../contracts/provider-health.js").ProviderHealthVector>>;
}

export interface ProviderRouteDecision {
  provider: ProviderId;
  reason: string;
  fallbackProvider: ProviderId;
  confidence: number;
  providerModel?: ProviderModelRef;
  deepseek?: DeepSeekRoutePlan;
  routeEnsemble: ProviderRouteEnsembleResult;
  /** Decision trace entries for forensic replay */
  trace?: import("../contracts/replay.js").DecisionTraceEntry[];
}

export type ProviderFailureKind = "availability" | "transient" | "policy" | "quota" | "refusal" | "unknown";

export interface ProviderAvailability {
  provider: ProviderId;
  available: boolean;
  checkedAt: number;
  reason?: string;
  disableForRun: boolean;
  /** v2 capability vector (optional; present when profiler v2 is active). */
  healthVector?: import("../contracts/provider-health.js").ProviderHealthVector;
}

export interface AgentProvider {
  id: ProviderId;
  runner: TaskRunner;
}

export interface ProviderFallbackMetadata {
  from: ProviderId;
  to: ProviderId;
  reason: string;
  attempts?: number;
  failureKind?: ProviderFailureKind;
}

export interface ProviderSkipMetadata {
  provider: ProviderId;
  reason: string;
  skippable: true;
  attempts?: number;
  failureKind?: ProviderFailureKind;
}

export interface ProviderAssistMetadata {
  provider: ProviderId;
  model?: string;
  modelTier?: DeepSeekModelTier;
  participation: "advisory";
  invocationKey?: string;
  success: boolean;
  summary?: string;
  failureReason?: string;
}

export interface ProviderTaskMetadata extends Record<string, unknown> {
  provider: ProviderId;
  requestedProvider?: ProviderId;
  providerRouteReason?: string;
  providerRouteConfidence?: number;
  providerRouteEnsemble?: ProviderRouteEnsembleResult;
  providerInvocationKey?: string;
  providerAttemptCount?: number;
  providerModel?: string;
  providerModelTier?: DeepSeekModelTier;
  providerParticipation?: DeepSeekParticipation;
  providerAuthority?: ProviderAuthority;
  providerModelRef?: ProviderModelRef;
  providerAssist?: ProviderAssistMetadata;
  providerFallback?: ProviderFallbackMetadata;
  providerSkip?: ProviderSkipMetadata;
}

export function withProviderMetadata(
  result: TaskResult,
  metadata: ProviderTaskMetadata
): TaskResult {
  return {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      ...metadata,
    },
  };
}
