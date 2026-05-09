import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";

export type ProviderId = "kimi" | "deepseek";
export type ProviderPolicy = "auto" | "kimi";
export type ProviderRisk = "read" | "write" | "shell" | "merge";
export type ProviderComplexity = "simple" | "moderate" | "complex";
export type DeepSeekModelTier = "flash" | "pro";
export type DeepSeekParticipation = "direct" | "advisory";

export interface DeepSeekRoutePlan {
  provider: "deepseek";
  model: "deepseek-v4-flash" | "deepseek-v4-pro";
  tier: DeepSeekModelTier;
  participation: DeepSeekParticipation;
  reasoningEffort: "max";
  ratioBucket: number;
}

export type ProviderRouteEnsembleParticipation = DeepSeekParticipation | "authority" | "veto";

export interface ProviderRouteEnsembleCandidate {
  id: "kimi-authority" | "deepseek-direct" | "deepseek-pro-advisory" | "safety-gate";
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
  providerHint?: "auto" | ProviderId;
  providerPolicy?: ProviderPolicy;
  preferredDeepSeekTier?: DeepSeekModelTier;
}

export interface ProviderRouteDecision {
  provider: ProviderId;
  reason: string;
  fallbackProvider: "kimi";
  confidence: number;
  deepseek?: DeepSeekRoutePlan;
  routeEnsemble: ProviderRouteEnsembleResult;
}

export type ProviderFailureKind = "availability" | "transient" | "policy" | "unknown";

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
  to: "kimi";
  reason: string;
  attempts?: number;
  failureKind?: ProviderFailureKind;
}

export interface ProviderAssistMetadata {
  provider: "deepseek";
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
  providerAssist?: ProviderAssistMetadata;
  providerFallback?: ProviderFallbackMetadata;
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
