import type {
  AgentProvider,
  ProviderRouteDecision,
  ProviderRouteInput,
  ProviderRouteStrategy,
} from "./provider.js";

export interface ProviderRouterOptions {
  providers: AgentProvider[];
  defaultStrategy?: ProviderRouteStrategy;
}

export function createProviderRouter(options: ProviderRouterOptions) {
  const { providers, defaultStrategy = "cost-aware" } = options;
  const sorted = providers
    .map((provider, index) => ({ provider, index }))
    .sort((a, b) => b.provider.priority - a.provider.priority || a.index - b.index)
    .map((entry) => entry.provider);

  function select(input: ProviderRouteInput): ProviderRouteDecision {
    const strategy = input.strategy ?? defaultStrategy;
    const candidates = sorted.filter((p) => p.supports(input.node));

    if (candidates.length === 0) {
      const fallback = sorted[0];
      if (!fallback) {
        throw new Error("provider-router requires at least one configured provider");
      }
      return {
        provider: fallback,
        reason: "no-supported-provider-matched",
        fallbacks: [],
        confidence: 0.5,
        strategy,
      };
    }

    switch (strategy) {
      case "compatibility-first":
        return selectCompatibilityFirst(candidates, input);
      case "cost-aware":
        return selectCostAware(candidates, input);
      case "fallback-on-evidence-fail":
        return selectFallbackOnEvidenceFail(candidates, input);
      case "round-robin":
        return selectRoundRobin(candidates, input);
      case "lowest-latency":
        return selectLowestLatency(candidates, input);
      default:
        return selectCostAware(candidates, input);
    }
  }

  function selectCompatibilityFirst(
    candidates: AgentProvider[],
    _input: ProviderRouteInput
  ): ProviderRouteDecision {
    const kimi = candidates.find((p) => p.id === "kimi");
    const others = candidates.filter((p) => p.id !== "kimi");

    if (kimi) {
      return {
        provider: kimi,
        reason: "explicit-kimi-compatibility-strategy",
        fallbacks: others,
        confidence: 0.9,
        strategy: "compatibility-first",
      };
    }

    return {
      provider: candidates[0],
      reason: "explicit-kimi-compatibility-unavailable-next-best",
      fallbacks: candidates.slice(1),
      confidence: 0.7,
      strategy: "compatibility-first",
    };
  }

  function selectCostAware(
    candidates: AgentProvider[],
    input: ProviderRouteInput
  ): ProviderRouteDecision {
    const withCost = candidates.map((p) => ({
      provider: p,
      estimatedCost: estimateProviderCost(p, input),
    }));
    withCost.sort((a, b) => a.estimatedCost - b.estimatedCost);

    return {
      provider: withCost[0].provider,
      reason: "lowest-estimated-cost",
      fallbacks: withCost.slice(1).map((c) => c.provider),
      confidence: 0.8,
      strategy: "cost-aware",
    };
  }

  function selectFallbackOnEvidenceFail(
    candidates: AgentProvider[],
    input: ProviderRouteInput
  ): ProviderRouteDecision {
    const ordered = [...candidates].sort((a, b) => {
      const priorityDelta = b.priority - a.priority;
      if (priorityDelta !== 0) return priorityDelta;

      const costDelta = estimateProviderCost(a, input) - estimateProviderCost(b, input);
      if (costDelta !== 0) return costDelta;

      return String(a.id).localeCompare(String(b.id));
    });

    return {
      provider: ordered[0],
      reason: "evidence-fail-fallback-ordered",
      fallbacks: ordered.slice(1),
      confidence: 0.85,
      strategy: "fallback-on-evidence-fail",
    };
  }

  let rrIndex = 0;
  function selectRoundRobin(
    candidates: AgentProvider[],
    _input: ProviderRouteInput
  ): ProviderRouteDecision {
    const idx = rrIndex % candidates.length;
    rrIndex++;
    const selected = candidates[idx];
    const fallbacks = candidates.filter((_, i) => i !== idx);

    return {
      provider: selected,
      reason: `round-robin-index-${idx}`,
      fallbacks,
      confidence: 0.7,
      strategy: "round-robin",
    };
  }

  function selectLowestLatency(
    candidates: AgentProvider[],
    _input: ProviderRouteInput
  ): ProviderRouteDecision {
    const sorted = [...candidates].sort((a, b) => {
      const aLatency = getProviderLatency(a);
      const bLatency = getProviderLatency(b);
      return aLatency - bLatency;
    });

    return {
      provider: sorted[0],
      reason: "lowest-latency",
      fallbacks: sorted.slice(1),
      confidence: 0.75,
      strategy: "lowest-latency",
    };
  }

  return { select };
}

function estimateProviderCost(
  provider: AgentProvider,
  _input: ProviderRouteInput
): number {
  if (provider.estimateCost) {
    return 0.001;
  }
  return provider.priority > 50 ? 0.002 : 0.001;
}

function getProviderLatency(provider: AgentProvider): number {
  return provider.priority > 50 ? 500 : 750;
}
