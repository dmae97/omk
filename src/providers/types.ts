import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";

export type KnownProviderId = "kimi" | "deepseek" | "codex" | "qwen" | "openrouter";
export type ProviderId = KnownProviderId | (string & {});
export type ProviderPolicy = "auto" | KnownProviderId;
export type ProviderRisk = "read" | "write" | "shell" | "merge";
export type ProviderComplexity = "simple" | "moderate" | "complex";
export type ProviderKind = "kimi-native" | "openai-compatible" | "external-cli" | "codex-cli" | "local";
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
}

export const DEFAULT_FALLBACK_PROVIDER: ProviderId = "kimi";

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
