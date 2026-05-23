import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";
import type { RuntimeRouteDecision, RuntimeId } from "../runtime/adapter.js";

export type KnownProviderId = "codex" | "deepseek" | "kimi" | "openrouter" | "qwen";
export type ProviderId = KnownProviderId | (string & {});
export type ProviderPolicy = "auto" | KnownProviderId;
export type ProviderRisk = "read" | "write" | "shell" | "merge";
export type ProviderComplexity = "simple" | "moderate" | "complex";
export type ProviderKind = "codex-cli" | "external-cli" | "kimi-native" | "local" | "openai-compatible";
export type ProviderWireApi = "kimi-native" | "openai-chat-completions" | "openai-responses" | "external-cli";
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
  preferredModel?: string;
  preferredDeepSeekTier?: DeepSeekModelTier;
  providerModelStats?: Record<string, import("./provider-stats.js").ProviderModelStatsEntry>;
  /** Configurable authority provider. Defaults to "kimi" for backward compatibility. */
  authorityProvider?: ProviderId;
}

/** @deprecated Use resolveFallbackProvider() instead. */
export const DEFAULT_FALLBACK_PROVIDER: ProviderId = "kimi";
/** @deprecated Use resolveFallbackRuntime() instead. */
export const DEFAULT_FALLBACK_RUNTIME: RuntimeId = "kimi-cli";
/** @deprecated Use resolveRuntimeFallbackChain() instead. */
export const DEFAULT_RUNTIME_FALLBACK_CHAIN: RuntimeId[] = [
  "opencode-cli",
  "codex-cli",
  "kimi-cli",
  "openrouter-api",
  "deepseek-api",
];

export function resolveFallbackProvider(availableProviders: ProviderId[]): ProviderId {
  // Priority: deepseek > codex > qwen > openrouter > kimi
  const priority: ProviderId[] = ["deepseek", "codex", "qwen", "openrouter", "kimi"];
  for (const p of priority) {
    if (availableProviders.includes(p)) return p;
  }
  return availableProviders[0] ?? "kimi";
}

export function resolveFallbackRuntime(availableRuntimes: RuntimeId[]): RuntimeId {
  // Priority: deepseek-api > codex-cli > qwen-api > openrouter-api > kimi-cli
  const priority: RuntimeId[] = ["deepseek-api", "codex-cli", "qwen-api", "openrouter-api", "kimi-cli"];
  for (const r of priority) {
    if (availableRuntimes.includes(r)) return r;
  }
  return availableRuntimes[0] ?? "kimi-cli";
}

export function resolveRuntimeFallbackChain(availableRuntimes: RuntimeId[]): RuntimeId[] {
  const priority: RuntimeId[] = ["deepseek-api", "codex-cli", "qwen-api", "openrouter-api", "kimi-cli", "kimi-print", "kimi-wire"];
  const ordered = priority.filter((r) => availableRuntimes.includes(r));
  const remainder = availableRuntimes.filter((r) => !ordered.includes(r));
  return [...ordered, ...remainder];
}

/**
 * Resolve the authority provider from available providers.
 * Priority: explicit preferred > kimi-native runtime > first available > "kimi"
 */
export function resolveAuthorityProvider(
  availableProviders: ProviderId[],
  preferred?: ProviderId
): ProviderId {
  if (preferred && availableProviders.includes(preferred)) return preferred;
  if (availableProviders.includes("kimi")) return "kimi";
  return availableProviders[0] ?? "kimi";
}

export interface ProviderRouteDecision {
  provider: ProviderId;
  reason: string;
  /** @deprecated Use RuntimeRouteDecision.fallbackChain instead */
  fallbackProvider: ProviderId;
  confidence: number;
  providerModel?: ProviderModelRef;
  deepseek?: DeepSeekRoutePlan;
  routeEnsemble: ProviderRouteEnsembleResult;
  /** Decision trace entries for forensic replay */
  trace?: import("../contracts/replay.js").DecisionTraceEntry[];
}

export type ProviderFailureKind = "availability" | "transient" | "policy" | "quota" | "unknown";

export interface ProviderAvailability {
  provider: ProviderId;
  available: boolean;
  checkedAt: number;
  reason?: string;
  disableForRun: boolean;
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

export function legacyProviderDecisionToRuntimeDecision(
  decision: ProviderRouteDecision
): RuntimeRouteDecision {
  const providerToRuntime = (provider: string): RuntimeId => {
    if (provider === "kimi") return "kimi-cli";
    if (provider === "codex") return "codex-cli";
    if (provider === "deepseek") return "deepseek-api";
    if (provider === "qwen") return "qwen-api";
    if (provider === "openrouter") return "openrouter-api";
    return `${provider}-api`;
  };

  return {
    selectedRuntime: providerToRuntime(decision.provider),
    candidateRuntimes: [providerToRuntime(decision.provider)],
    fallbackChain: decision.fallbackProvider
      ? [providerToRuntime(decision.fallbackProvider)]
      : [],
    authorityMode: (decision.providerModel?.authority ?? "advisory") as RuntimeRouteDecision["authorityMode"],
    reason: decision.reason,
    confidence: decision.confidence,
  };
}
