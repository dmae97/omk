import type { DagNode } from "../orchestration/dag.js";
import type {
  DeepSeekModelTier,
  DeepSeekRoutePlan,
  ProviderId,
  ProviderModelRef,
  ProviderComplexity,
  ProviderPolicy,
  ProviderRisk,
  ProviderRouteEnsembleCandidate,
  ProviderRouteEnsembleResult,
  ProviderRouteDecision,
  ProviderRouteInput,
} from "./types.js";
import { resolveFallbackProvider } from "./types.js";
import {
  computeProviderRouteScore,
  buildProviderStatsKey,
  type ProviderRouteScoreInput,
  type ProviderModelStatsEntry,
} from "./provider-stats.js";

const DEEPSEEK_READ_ONLY_ROLES = new Set([
  "explorer",
  "researcher",
  "reviewer",
  "qa",
  "tester",
  "documenter",
  "writer",
  "planner",
]);

const AUTHORITY_ROLES = new Set([
  "orchestrator",
  "coordinator",
  "merger",
  "integrator",
  "security",
]);

const DEEPSEEK_PRO_ADVISORY_FILE_ROLES = new Set([
  "coder",
  "executor",
  "refactorer",
]);

const GENERIC_EXTERNAL_READ_ONLY_ROLES = new Set([
  ...DEEPSEEK_READ_ONLY_ROLES,
  "analyst",
  "auditor",
]);

const GENERIC_EXTERNAL_ADVISORY_FILE_ROLES = new Set([
  ...DEEPSEEK_PRO_ADVISORY_FILE_ROLES,
  "planner",
]);

export const DEEPSEEK_V4_FLASH_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_V4_PRO_MODEL = "deepseek-v4-pro";
export const QWEN_DEFAULT_MODEL = "qwen3-max";
export const CODEX_CLI_DEFAULT_MODEL = "codex-cli";
export const OPENROUTER_DEFAULT_MODEL = "openrouter/auto";
const DEEPSEEK_FLASH_RATIO_OUT_OF_TEN = 6;

export function routeProvider(input: ProviderRouteInput): ProviderRouteDecision {
  const authorityProvider = input.authorityProvider ?? "kimi";
  const policy: ProviderPolicy = input.providerPolicy ?? "auto";
  const role = input.role.toLowerCase();
  const seed = `${input.nodeId ?? ""}:${role}:${input.taskType}`;
  const directDeepSeekAllowed = canUseDirectDeepSeek(role, input);
  const dedicatedDeepSeekAgent = isDedicatedDeepSeekAgent(input);
  const availableProviders = Object.entries(input.providerAvailability ?? {})
    .filter(([, v]) => v === true)
    .map(([k]) => k as ProviderId);
  const fallbackProvider = resolveFallbackProvider(availableProviders.length > 0 ? availableProviders : ["kimi"]);
  const withRouteEnsemble = (
    decision: Omit<ProviderRouteDecision, "routeEnsemble">,
    winner: ProviderRouteEnsembleCandidate["id"]
  ): ProviderRouteDecision => ({
    ...decision,
    routeEnsemble: buildProviderRouteEnsemble({
      input,
      role,
      decision,
      winner,
      directDeepSeekAllowed,
    }),
  });

  if (policy === "kimi" || input.providerHint === authorityProvider) {
    return withRouteEnsemble(authorityProviderDecision(authorityProvider, "Authority provider policy or explicit provider route", 1, undefined, {}, fallbackProvider), "safety-gate");
  }

  if (role === "orchestrator" || role === "merger" || role === "integrator") {
    return withRouteEnsemble(authorityProviderDecision(authorityProvider, "Core orchestration and merge authority stay with authority provider", 1, undefined, {}, fallbackProvider), "safety-gate");
  }

  const externalProvider = requestedExternalProvider(input);
  if (externalProvider) {
    if (!isProviderAvailable(input, externalProvider)) {
      return withRouteEnsemble(
        authorityProviderDecision(authorityProvider, `${providerLabel(externalProvider)} unavailable; using primary fallback`, 0.86, undefined, {
          providerModel: genericProviderModelRef(input, externalProvider, "veto"),
        }, fallbackProvider),
        "safety-gate"
      );
    }

    if (input.risk === "read" && canUseGenericDirectProvider(role, input)) {
      return withRouteEnsemble(
        genericDirectDecision(
          externalProvider,
          `${providerLabel(externalProvider)} read-only provider route`,
          externalProvider === "codex" ? 0.74 : 0.78,
          genericProviderModelRef(input, externalProvider, "direct"),
          fallbackProvider
        ),
        `${externalProvider}-direct`
      );
    }

    if (input.risk === "write" && canUseGenericAdvisoryProvider(role, input)) {
      return withRouteEnsemble(
        authorityProviderDecision(authorityProvider, `Authority provider keeps write authority with ${providerLabel(externalProvider)} advisory`, 0.8, undefined, {
          providerModel: genericProviderModelRef(input, externalProvider, "advisory"),
        }, fallbackProvider),
        `${externalProvider}-advisory`
      );
    }

    return withRouteEnsemble(
      authorityProviderDecision(authorityProvider, `${providerLabel(externalProvider)} route rejected by authority boundary`, 0.88, undefined, {
        providerModel: genericProviderModelRef(input, externalProvider, "veto"),
      }, fallbackProvider),
      "safety-gate"
    );
  }

  const hasAnyExternalProvider =
    input.deepseekAvailable ||
    Object.entries(input.providerAvailability ?? {}).some(
      ([p, v]) => v === true && p !== authorityProvider
    );

  if (!hasAnyExternalProvider) {
    return withRouteEnsemble(authorityProviderDecision(authorityProvider, "No external providers available; using primary fallback", 1, undefined, {}, fallbackProvider), "safety-gate");
  }

  if (input.risk === "write" && canUseDeepSeekProAdvisory(role, input)) {
    return withRouteEnsemble(
      authorityProviderDecision(authorityProvider, "Authority provider keeps file-write authority with DeepSeek V4 Pro Max advisory", 0.82, {
        provider: "deepseek",
        model: DEEPSEEK_V4_PRO_MODEL,
        tier: "pro",
        participation: "advisory",
        reasoningEffort: "max",
        ratioBucket: 9,
      }, {}, fallbackProvider),
      "deepseek-pro-advisory"
    );
  }

  if (input.risk !== "read") {
    return withRouteEnsemble(authorityProviderDecision(authorityProvider, "High-risk tool execution uses primary runtime", 0.9, undefined, {}, fallbackProvider), "safety-gate");
  }

  if (input.needsMcp || input.needsToolCalling) {
    return withRouteEnsemble(authorityProviderDecision(authorityProvider, "MCP/tool authority stays with authority provider", 0.85, undefined, {}, fallbackProvider), "safety-gate");
  }

  if (isDeepSeekRequested(input)) {
    if (!directDeepSeekAllowed) {
      return withRouteEnsemble(authorityProviderDecision(authorityProvider, "Explicit DeepSeek hint rejected for non-read-only provider role", 0.9, undefined, {}, fallbackProvider), "safety-gate");
    }
    if (input.complexity === "complex" && !dedicatedDeepSeekAgent) {
      return withRouteEnsemble(authorityProviderDecision(authorityProvider, "Complex read-only judgment stays with authority provider despite DeepSeek hint", 0.85, undefined, {}, fallbackProvider), "kimi-authority");
    }
    return withRouteEnsemble(
      deepseekDecision(
        dedicatedDeepSeekAgent
          ? `Dedicated DeepSeek ${input.preferredDeepSeekTier?.toUpperCase()} model agent route`
          : "Explicit low-risk DeepSeek route",
        dedicatedDeepSeekAgent ? 0.93 : 0.9,
        selectDeepSeekDirectPlan(seed, role, input.preferredDeepSeekTier, {
          taskType: input.taskType,
          complexity: input.complexity,
          providerModelStats: input.providerModelStats,
        }),
        fallbackProvider
      ),
      "deepseek-direct"
    );
  }

  if (AUTHORITY_ROLES.has(role)) {
    return withRouteEnsemble(authorityProviderDecision(authorityProvider, "Role carries write, merge, or final-judgment authority", 0.85, undefined, {}, fallbackProvider), "kimi-authority");
  }

  // Score-based routing for flexible cases (read-only explorers, reviewers, simple tasks)
  const candidates = scoreProviders(input);
  const eligible = candidates.filter((c) => {
    if (c.provider === "deepseek") {
      return directDeepSeekAllowed;
    }
    return true;
  });

  const winner = eligible.length > 0
    ? eligible.reduce((best, c) => (c.score > best.score ? c : best))
    : candidates.find((c) => c.provider === authorityProvider) ?? candidates[0];

  if (winner.provider === "deepseek") {
    const plan = selectDeepSeekDirectPlan(seed, role, input.preferredDeepSeekTier, {
      taskType: input.taskType,
      complexity: input.complexity,
      providerModelStats: input.providerModelStats,
    });
    return withRouteEnsemble(
      deepseekDecision(winner.reason, winner.confidence, plan, fallbackProvider),
      "deepseek-direct"
    );
  }

  if (winner.provider !== authorityProvider) {
    return withRouteEnsemble(
      genericDirectDecision(
        winner.provider,
        winner.reason,
        winner.confidence,
        genericProviderModelRef(input, winner.provider, "direct"),
        fallbackProvider
      ),
      `${winner.provider}-direct`
    );
  }

  return withRouteEnsemble(
    authorityProviderDecision(authorityProvider, winner.reason, winner.confidence, undefined, {}, fallbackProvider),
    "kimi-authority"
  );
}

export function inferNodeRisk(node: DagNode): ProviderRisk {
  const role = node.role.toLowerCase();
  const id = node.id.toLowerCase();
  if (role === "merger" || role === "integrator" || id.includes("merge")) return "merge";
  if ((node.outputs ?? []).some((o) => o.gate === "command-pass" || o.gate === "test-pass")) {
    return "shell";
  }
  if (node.routing?.requiresToolCalling === true) return "shell";
  if (role === "coder" || role === "refactorer" || role === "executor") return "write";
  return "read";
}

export function normalizeProviderComplexity(value: string | undefined): ProviderComplexity {
  return value === "simple" || value === "moderate" || value === "complex" ? value : "moderate";
}

const modelStatsStore = new Map<string, ProviderModelStatsEntry>();

export function recordModelOutcome(
  provider: ProviderId,
  tier: string,
  role: string,
  taskType: string,
  complexity: string,
  outcome: { success: boolean; latencyMs: number }
): void {
  const key = buildProviderStatsKey(tier, role, taskType, complexity);
  const existing = modelStatsStore.get(key) ?? {
    provider,
    tier,
    role,
    taskType: taskType || "unknown",
    complexity: complexity || "unknown",
    attempts: 0,
    passes: 0,
    failures: 0,
    fallbacks: 0,
    timeouts: 0,
    meanLatencyMs: 0,
    lastAttemptAt: Date.now(),
    evidencePassRate: 0.5,
    fallbackRate: 0,
    timeoutRate: 0,
  };
  existing.attempts += 1;
  if (outcome.success) {
    existing.passes += 1;
  } else {
    existing.failures += 1;
  }
  existing.meanLatencyMs =
    (existing.meanLatencyMs * (existing.attempts - 1) + outcome.latencyMs) /
    existing.attempts;
  existing.evidencePassRate = existing.attempts > 0 ? existing.passes / existing.attempts : 0.5;
  existing.lastAttemptAt = Date.now();
  modelStatsStore.set(key, existing);
}

export function syncModelStatsWithPersisted(entries: Record<string, ProviderModelStatsEntry>): void {
  for (const [key, entry] of Object.entries(entries)) {
    modelStatsStore.set(key, entry);
  }
}

function computeDeepSeekTierScore(
  tier: DeepSeekModelTier,
  stats: ProviderModelStatsEntry | undefined,
  role: string
): number {
  const evidencePassRate = stats && stats.attempts > 0 ? stats.evidencePassRate : 0.5;
  const meanLatencyMs = stats && stats.attempts > 0 ? stats.meanLatencyMs : 5000;
  const latencyScore = Math.max(0, Math.min(1, 1 - meanLatencyMs / 10000));
  const costScore = tier === "flash" ? 1.0 : 0.6;
  const roleFit = ["reviewer", "planner", "security"].includes(role) ? 1.0 : 0.5;
  const fallbackRate = stats && stats.attempts > 0 ? stats.fallbackRate : 0.1;
  const fallbackReliability = Math.max(0, 1 - fallbackRate);
  const recentFailureRate = stats && stats.attempts > 0 ? stats.failures / stats.attempts : 0;
  const recentFailurePenalty = recentFailureRate > 0.2 ? 0.3 : 0;

  const score =
    evidencePassRate * 0.35 +
    latencyScore * 0.20 +
    costScore * 0.15 +
    roleFit * 0.15 +
    fallbackReliability * 0.10 -
    recentFailurePenalty;

  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

export function selectDeepSeekModelTier(
  seed: string,
  options?: {
    role?: string;
    taskType?: string;
    complexity?: string;
    providerModelStats?: Record<string, ProviderModelStatsEntry>;
  }
): { tier: DeepSeekModelTier; ratioBucket: number; score?: number } {
  const { role = "unknown", taskType = "unknown", complexity = "unknown", providerModelStats } = options ?? {};

  const flashKey = buildProviderStatsKey("flash", role, taskType, complexity);
  const proKey = buildProviderStatsKey("pro", role, taskType, complexity);
  const flashStats = providerModelStats?.[flashKey] ?? modelStatsStore.get(flashKey);
  const proStats = providerModelStats?.[proKey] ?? modelStatsStore.get(proKey);

  const hasStats = Boolean(flashStats || proStats);

  if (hasStats) {
    const flashScore = computeDeepSeekTierScore("flash", flashStats, role);
    const proScore = computeDeepSeekTierScore("pro", proStats, role);

    if (process.env.OMK_DEBUG === "1") {
      console.error("[OMK_DEBUG] DeepSeek tier score breakdown:", {
        flash: flashScore,
        pro: proScore,
        role,
        taskType,
        complexity,
        flashKey,
        proKey,
        flashStatsPresent: !!flashStats,
        proStatsPresent: !!proStats,
      });
    }

    const winner = flashScore >= proScore ? "flash" : "pro";
    return {
      tier: winner,
      ratioBucket: winner === "flash" ? 0 : 9,
      score: winner === "flash" ? flashScore : proScore,
    };
  }

  // Fallback to existing hash-based deterministic selection
  const ratioBucket = stableHash(seed) % 10;
  return {
    tier: ratioBucket < DEEPSEEK_FLASH_RATIO_OUT_OF_TEN ? "flash" : "pro",
    ratioBucket,
  };
}

function selectDeepSeekDirectPlan(
  seed: string,
  role?: string,
  preferredTier?: DeepSeekModelTier,
  options?: {
    taskType?: string;
    complexity?: string;
    providerModelStats?: Record<string, ProviderModelStatsEntry>;
  }
): DeepSeekRoutePlan {
  const selected = preferredTier
    ? { tier: preferredTier, ratioBucket: preferredTier === "flash" ? 0 : 9 }
    : selectDeepSeekModelTier(seed, {
        role,
        taskType: options?.taskType,
        complexity: options?.complexity,
        providerModelStats: options?.providerModelStats,
      });
  return {
    provider: "deepseek",
    model:
      selected.tier === "flash"
        ? DEEPSEEK_V4_FLASH_MODEL
        : DEEPSEEK_V4_PRO_MODEL,
    tier: selected.tier,
    participation: "direct",
    reasoningEffort: "max",
    ratioBucket: selected.ratioBucket,
  };
}

function isDedicatedDeepSeekAgent(input: ProviderRouteInput): boolean {
  return isDeepSeekRequested(input) && Boolean(input.preferredDeepSeekTier);
}

function isDeepSeekRequested(input: ProviderRouteInput): boolean {
  return input.providerHint === "deepseek" || input.providerPolicy === "deepseek";
}

function requestedExternalProvider(input: ProviderRouteInput): ProviderId | undefined {
  const policy = isGenericExternalProvider(input.providerPolicy) ? input.providerPolicy : undefined;
  const hint = isGenericExternalProvider(input.providerHint) ? input.providerHint : undefined;
  return hint ?? policy;
}

function isGenericExternalProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && value !== "auto" && value !== "kimi" && value !== "deepseek";
}

function isProviderAvailable(input: ProviderRouteInput, provider: ProviderId): boolean {
  const explicit = input.providerAvailability?.[provider];
  return explicit === undefined ? true : explicit;
}

function canUseGenericDirectProvider(role: string, input: ProviderRouteInput): boolean {
  if (input.risk !== "read") return false;
  if (input.needsMcp || input.needsToolCalling) return false;
  return input.readOnly === true || GENERIC_EXTERNAL_READ_ONLY_ROLES.has(role);
}

function canUseGenericAdvisoryProvider(role: string, input: ProviderRouteInput): boolean {
  if (!GENERIC_EXTERNAL_ADVISORY_FILE_ROLES.has(role)) return false;
  if (input.complexity === "simple") return false;
  if (input.needsMcp || input.needsToolCalling) return false;
  return true;
}

function canUseDeepSeekProAdvisory(role: string, input: ProviderRouteInput): boolean {
  if (!DEEPSEEK_PRO_ADVISORY_FILE_ROLES.has(role)) return false;
  if (input.complexity === "simple") return false;
  if (input.needsMcp || input.needsToolCalling) return false;
  return true;
}

function canUseDirectDeepSeek(role: string, input: ProviderRouteInput): boolean {
  if (input.risk !== "read") return false;
  return input.readOnly === true || DEEPSEEK_READ_ONLY_ROLES.has(role);
}

function buildProviderRouteEnsemble(options: {
  input: ProviderRouteInput;
  role: string;
  decision: Omit<ProviderRouteDecision, "routeEnsemble">;
  winner: ProviderRouteEnsembleCandidate["id"];
  directDeepSeekAllowed: boolean;
}): ProviderRouteEnsembleResult {
  const { input, role, decision, winner, directDeepSeekAllowed } = options;
  const authorityProvider = input.authorityProvider ?? "kimi";
  const advisoryAllowed = input.risk === "write" && canUseDeepSeekProAdvisory(role, input);
  const safetyReason = providerSafetyReason(input, role);
  const dedicatedDeepSeekAgent = isDedicatedDeepSeekAgent(input);
  const explicitExternalProvider = requestedExternalProvider(input);
  const directCandidateAllowed =
    !safetyReason &&
    input.deepseekAvailable &&
    directDeepSeekAllowed &&
    input.risk === "read" &&
    (input.complexity !== "complex" || dedicatedDeepSeekAgent) &&
    !input.needsMcp &&
    !input.needsToolCalling;
  const advisoryCandidateAllowed = !safetyReason && advisoryAllowed && input.deepseekAvailable;
  const genericExternalDirectEligible = !safetyReason && canUseGenericDirectProvider(role, input);
  const genericExternalAdvisoryEligible = !safetyReason && canUseGenericAdvisoryProvider(role, input);

  const availableExternalProviders = Object.entries(input.providerAvailability ?? {})
    .filter(([p, v]) => v === true && p !== authorityProvider && p !== "auto" && p !== "deepseek")
    .map(([p]) => p as ProviderId);

  const candidates: ProviderRouteEnsembleCandidate[] = [
    {
      id: "kimi-authority",
      provider: authorityProvider,
      participation: "authority",
      score: winner === "kimi-authority" ? decision.confidence : scoreAuthorityProvider(input, role),
      reason: authorityProviderReason(input, role),
      selected: winner === "kimi-authority",
    },
    {
      id: "deepseek-direct",
      provider: "deepseek",
      participation: "direct",
      score: directCandidateAllowed ? scoreDeepSeekDirect(input) : 0,
      reason: directCandidateAllowed
        ? dedicatedDeepSeekAgent
          ? "Dedicated read-only DeepSeek model agent selected during initial orchestration"
          : "Read-only, no-tool node can be evaluated by DeepSeek as an independent worker"
        : safetyReason ?? directDeepSeekRejectionReason(input, role),
      selected: winner === "deepseek-direct",
      veto: !directCandidateAllowed,
    },
    {
      id: "deepseek-pro-advisory",
      provider: "deepseek",
      participation: "advisory",
      score: advisoryCandidateAllowed ? 0.82 : 0,
      reason: advisoryCandidateAllowed
        ? "File-affecting node can use DeepSeek V4 Pro Max advisory while authority provider keeps write authority"
        : safetyReason ?? advisoryRejectionReason(input, role),
      selected: winner === "deepseek-pro-advisory",
      veto: !advisoryCandidateAllowed,
    },
    {
      id: "safety-gate",
      provider: authorityProvider,
      participation: "veto",
      score: winner === "safety-gate" ? decision.confidence : safetyReason ? 0.74 : 0,
      reason: safetyReason ?? "No safety veto; external providers may participate when other route candidates win",
      selected: winner === "safety-gate",
      veto: Boolean(safetyReason),
    },
  ];

  const providersToAdd = explicitExternalProvider
    ? [explicitExternalProvider, ...availableExternalProviders.filter((p) => p !== explicitExternalProvider)]
    : availableExternalProviders;

  for (const extProvider of providersToAdd) {
    const extDirectAllowed = genericExternalDirectEligible;
    const extAdvisoryAllowed = genericExternalAdvisoryEligible && input.risk === "write";
    candidates.splice(1, 0, {
      id: `${extProvider}-direct`,
      provider: extProvider,
      participation: "direct",
      score: extDirectAllowed ? 0.78 : 0,
      reason: extDirectAllowed
        ? `${providerLabel(extProvider)} read-only lane has no write/shell/MCP authority`
        : safetyReason ?? `${providerLabel(extProvider)} direct lanes require read-only, no-tool scope`,
      selected: winner === `${extProvider}-direct`,
      veto: !extDirectAllowed,
    }, {
      id: `${extProvider}-advisory`,
      provider: extProvider,
      participation: "advisory",
      score: extAdvisoryAllowed ? 0.8 : 0,
      reason: extAdvisoryAllowed
        ? `${providerLabel(extProvider)} may advise while authority provider keeps write authority`
        : safetyReason ?? `${providerLabel(extProvider)} advisory lanes require bounded file-affecting scope`,
      selected: winner === `${extProvider}-advisory`,
      veto: !extAdvisoryAllowed,
    });
  }

  const normalized = candidates.map((candidate) => ({
    ...candidate,
    score: clampScore(candidate.selected ? decision.confidence : candidate.score),
  }));

  return {
    winner,
    confidence: clampScore(decision.confidence),
    quorum: normalized.filter((candidate) => candidate.score >= 0.5 && !candidate.veto).length,
    candidates: normalized,
  };
}

function providerSafetyReason(input: ProviderRouteInput, role: string): string | undefined {
  const policy: ProviderPolicy = input.providerPolicy ?? "auto";
  const authorityProvider = input.authorityProvider ?? "kimi";
  if (policy === "kimi" || input.providerHint === authorityProvider) return "Authority provider policy or explicit authority provider hint";
  if (role === "orchestrator" || role === "merger" || role === "integrator") return "Core orchestration and merge authority";
  const externalProvider = requestedExternalProvider(input);
  if (externalProvider) {
    if (!isProviderAvailable(input, externalProvider)) return `${providerLabel(externalProvider)} unavailable for this run`;
    if (input.risk !== "read" && !(input.risk === "write" && canUseGenericAdvisoryProvider(role, input))) {
      return "External provider lanes cannot own non-read execution";
    }
    if (input.needsMcp || input.needsToolCalling) return "MCP or tool-calling authority stays with authority provider";
    if (input.risk === "read" && !canUseGenericDirectProvider(role, input)) {
      return `${providerLabel(externalProvider)} direct lane is not read-only safe for this role`;
    }
    return undefined;
  }
  const hasExternalProvider =
    input.deepseekAvailable ||
    Object.entries(input.providerAvailability ?? {}).some(
      ([p, v]) => v === true && p !== authorityProvider && p !== "auto" && p !== "deepseek"
    );

  if (!hasExternalProvider) return "No external providers available for this run";

  if (input.risk !== "read" && !(input.risk === "write" && canUseGenericAdvisoryProvider(role, input))) {
    return "Non-read execution requires authority provider authority";
  }
  if (input.needsMcp || input.needsToolCalling) return "MCP or tool-calling authority stays with authority provider";
  if (isDeepSeekRequested(input) && !canUseDirectDeepSeek(role, input)) {
    return "Explicit DeepSeek hint is not read-only safe for this role";
  }
  return undefined;
}

function authorityProviderReason(input: ProviderRouteInput, role: string): string {
  if (AUTHORITY_ROLES.has(role)) return "Role carries write, merge, or final-judgment authority";
  if (input.complexity === "complex") return "Complex judgment benefits from primary provider's full project context";
  if (input.risk !== "read") return "Authority provider owns side effects, shell, file writes, and final acceptance";
  return "Primary provider remains the baseline authority and fallback provider";
}

function toScoreInput(input: ProviderRouteInput): ProviderRouteScoreInput {
  return {
    role: input.role,
    risk: input.risk,
    complexity: input.complexity,
    estimatedTokens: input.estimatedTokens,
    needsMcp: input.needsMcp,
    needsToolCalling: input.needsToolCalling,
    readOnly: input.readOnly ?? false,
    providerModelStats: input.providerModelStats,
    authorityProvider: input.authorityProvider,
  };
}

function scoreProviders(input: ProviderRouteInput): Array<{
  provider: ProviderId;
  score: number;
  reason: string;
  confidence: number;
}> {
  const scoreInput = toScoreInput(input);
  const authorityProvider = input.authorityProvider ?? "kimi";
  const available = input.providerAvailability ?? {};
  const candidates: ProviderId[] = [authorityProvider];
  for (const [provider, isAvailable] of Object.entries(available)) {
    if (isAvailable && provider !== authorityProvider && !candidates.includes(provider as ProviderId)) {
      candidates.push(provider as ProviderId);
    }
  }
  // Also add deepseek if deepseekAvailable and not already included
  if (input.deepseekAvailable && !candidates.includes("deepseek") && available["deepseek"] !== false) {
    candidates.push("deepseek");
  }
  return candidates.map((provider) => ({
    provider,
    ...computeProviderRouteScore(provider, scoreInput),
  }));
}

function scoreAuthorityProvider(input: ProviderRouteInput, role: string): number {
  const authorityProvider = input.authorityProvider ?? "kimi";
  if (AUTHORITY_ROLES.has(role)) return 0.9;
  if (input.risk !== "read") return 0.86;
  if (input.complexity === "complex") return 0.82;
  if (input.needsMcp || input.needsToolCalling) return 0.78;
  return computeProviderRouteScore(authorityProvider, toScoreInput(input)).score;
}

function scoreDeepSeekDirect(input: ProviderRouteInput): number {
  if (isDedicatedDeepSeekAgent(input)) return 0.93;
  return computeProviderRouteScore("deepseek", toScoreInput(input)).score;
}

function directDeepSeekRejectionReason(input: ProviderRouteInput, role: string): string {
  if (!input.deepseekAvailable) return "DeepSeek is unavailable";
  if (input.risk !== "read") return "Direct DeepSeek is limited to read-only risk";
  if (!canUseDirectDeepSeek(role, input)) return "Role is not read-only safe for direct DeepSeek";
  if (input.complexity === "complex" && !isDedicatedDeepSeekAgent(input)) return "Complex read-only judgment stays with authority provider";
  if (input.needsMcp || input.needsToolCalling) return "MCP/tool-calling requirements stay with authority provider";
  return "Direct DeepSeek candidate did not win this route";
}

function advisoryRejectionReason(input: ProviderRouteInput, role: string): string {
  if (!input.deepseekAvailable) return "DeepSeek is unavailable";
  if (!DEEPSEEK_PRO_ADVISORY_FILE_ROLES.has(role)) return "Role is not a file-affecting advisory role";
  if (input.risk !== "write") return "Advisory Pro Max is reserved for file-affecting write-risk nodes";
  if (input.complexity === "simple") return "Simple write nodes do not need DeepSeek advisory overhead";
  if (input.needsMcp || input.needsToolCalling) return "MCP/tool-calling requirements stay with authority provider";
  return "Advisory candidate did not win this route";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function authorityProviderDecision(
  authorityProvider: ProviderId,
  reason: string,
  confidence: number,
  deepseek?: DeepSeekRoutePlan,
  extra: { providerModel?: ProviderModelRef } = {},
  fallbackProvider: ProviderId = resolveFallbackProvider(["kimi"])
): Omit<ProviderRouteDecision, "routeEnsemble"> {
  return {
    provider: authorityProvider,
    fallbackProvider,
    confidence,
    reason,
    providerModel: extra.providerModel,
    deepseek,
  };
}

function deepseekDecision(
  reason: string,
  confidence: number,
  deepseek: DeepSeekRoutePlan,
  fallbackProvider: ProviderId
): Omit<ProviderRouteDecision, "routeEnsemble"> {
  return {
    provider: "deepseek",
    fallbackProvider,
    confidence,
    reason,
    providerModel: {
      provider: "deepseek",
      model: deepseek.model,
      authority: deepseek.participation,
      capabilities: ["read", "review", "qa", deepseek.participation],
    },
    deepseek,
  };
}

function genericDirectDecision(
  provider: ProviderId,
  reason: string,
  confidence: number,
  providerModel: ProviderModelRef,
  fallbackProvider: ProviderId = resolveFallbackProvider(["kimi"])
): Omit<ProviderRouteDecision, "routeEnsemble"> {
  return {
    provider,
    fallbackProvider,
    confidence,
    reason,
    providerModel,
  };
}

function genericProviderModelRef(
  input: ProviderRouteInput,
  provider: ProviderId,
  authority: ProviderModelRef["authority"]
): ProviderModelRef {
  const providerDefault = input.providerModels?.[provider];
  return {
    provider,
    model: normalizeProviderModelAlias(input.preferredModel) ?? providerDefault?.model ?? defaultModelForExternalProvider(provider),
    authority,
    capabilities: providerDefault?.capabilities ?? capabilitiesForExternalProvider(provider),
  };
}

function normalizeProviderModelAlias(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase().replace(/[_\s]+/g, "-");
  if (lower === "qwen-3.7-max" || lower === "qwen3.7-max" || lower === "qwen-3-7-max" || lower === "qwen-max") return QWEN_DEFAULT_MODEL;
  if (lower === "sonnet") return "claude-sonnet";
  if (lower === "opus") return "claude-opus";
  if (lower === "haiku") return "claude-haiku";
  if (lower === "gpt-4") return "gpt-4";
  if (lower === "gpt-4o") return "gpt-4o";
  if (lower === "gpt-4o-mini") return "gpt-4o-mini";
  if (lower === "gemini-pro") return "gemini-pro";
  if (lower === "gemini-flash") return "gemini-flash";
  if (lower === "flash") return "deepseek-v4-flash";
  if (lower === "pro") return "deepseek-v4-pro";
  if (lower === "codex") return "codex-cli";
  return trimmed;
}

function providerLabel(provider: ProviderId): string {
  if (provider === "qwen") return "Qwen";
  if (provider === "codex") return "Codex";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "kimi") return "Kimi";
  return provider;
}

function defaultModelForExternalProvider(provider: ProviderId): string {
  if (provider === "qwen") return QWEN_DEFAULT_MODEL;
  if (provider === "codex") return CODEX_CLI_DEFAULT_MODEL;
  if (provider === "openrouter") return OPENROUTER_DEFAULT_MODEL;
  return "default";
}

function capabilitiesForExternalProvider(provider: ProviderId): string[] {
  if (provider === "codex") return ["read", "plan", "review", "advisory"];
  if (provider === "openrouter") return ["read", "research", "review", "qa", "advisory"];
  if (provider === "qwen") return ["read", "research", "review", "qa", "advisory"];
  return ["read", "advisory"];
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
