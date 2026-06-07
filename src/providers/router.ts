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
import { DEFAULT_AUTHORITY_PROVIDER, resolveFallbackProvider } from "./types.js";

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

const AUTHORITY_PROVIDER_ROLES = new Set([
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
  const policy: ProviderPolicy = input.providerPolicy ?? "auto";
  const role = input.role.toLowerCase();
  const seed = `${input.nodeId ?? ""}:${role}:${input.taskType}`;
  const authorityProvider = resolveFallbackProvider(input.authorityProvider);
  const authorityDecision = (
    reason: string,
    confidence: number,
    deepseek?: DeepSeekRoutePlan,
    extra: { providerModel?: ProviderModelRef } = {}
  ): Omit<ProviderRouteDecision, "routeEnsemble"> =>
    authorityProviderDecision(authorityProvider, reason, confidence, deepseek, extra);
  const directDeepSeekAllowed = canUseDirectDeepSeek(role, input);
  const dedicatedDeepSeekAgent = isDedicatedDeepSeekAgent(input);
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

  if (policy === "kimi" || input.providerHint === "kimi") {
    return withRouteEnsemble(authorityProviderDecision("kimi", "Kimi-only provider policy or explicit Kimi route", 1), "safety-gate");
  }

  if (role === "orchestrator" || role === "merger" || role === "integrator") {
    return withRouteEnsemble(authorityDecision("Core orchestration and merge authority stay with the configured authority provider", 1), "safety-gate");
  }

  const externalProvider = requestedExternalProvider(input);
  if (externalProvider) {
    if (!isProviderAvailable(input, externalProvider)) {
      return withRouteEnsemble(
        authorityDecision(`${providerLabel(externalProvider)} unavailable; using configured authority fallback`, 0.86, undefined, {
          providerModel: genericProviderModelRef(input, externalProvider, "veto"),
        }),
        "safety-gate"
      );
    }

    // If the external provider is the authority provider, route to it as authority
    if (externalProvider === authorityProvider) {
      return withRouteEnsemble(
        authorityDecision(`${providerLabel(externalProvider)} is the configured authority provider`, 0.9, undefined, {
          providerModel: genericProviderModelRef(input, externalProvider, "authority"),
        }),
        "authority-provider"
      );
    }

    if (input.risk === "read" && canUseGenericDirectProvider(role, input)) {
      return withRouteEnsemble(
        genericDirectDecision(
          externalProvider,
          `${providerLabel(externalProvider)} read-only provider route`,
          externalProvider === "codex" ? 0.74 : 0.78,
          genericProviderModelRef(input, externalProvider, "direct"),
          authorityProvider
        ),
        `${externalProvider}-direct`
      );
    }

    if (input.risk === "write" && canUseGenericAdvisoryProvider(role, input)) {
      return withRouteEnsemble(
        authorityDecision(`Configured authority provider keeps write authority with ${providerLabel(externalProvider)} advisory`, 0.8, undefined, {
          providerModel: genericProviderModelRef(input, externalProvider, "advisory"),
        }),
        `${externalProvider}-advisory`
      );
    }

    return withRouteEnsemble(
      authorityDecision(`${providerLabel(externalProvider)} route rejected by authority boundary`, 0.88, undefined, {
        providerModel: genericProviderModelRef(input, externalProvider, "veto"),
      }),
      "safety-gate"
    );
  }

  if (!input.deepseekAvailable) {
    return withRouteEnsemble(authorityDecision("DeepSeek unavailable; using configured authority fallback", 1), "safety-gate");
  }

  if (input.risk === "write" && canUseDeepSeekProAdvisory(role, input)) {
    return withRouteEnsemble(
      authorityDecision("Configured authority provider keeps file-write authority with DeepSeek V4 Pro Max advisory", 0.82, {
        provider: "deepseek",
        model: DEEPSEEK_V4_PRO_MODEL,
        tier: "pro",
        participation: "advisory",
        reasoningEffort: "max",
        ratioBucket: 9,
      }),
      "deepseek-pro-advisory"
    );
  }

  if (input.risk !== "read") {
    return withRouteEnsemble(authorityDecision("High-risk tool execution uses the configured authority runtime", 0.9), "safety-gate");
  }

  if (input.needsMcp || input.needsToolCalling) {
    return withRouteEnsemble(authorityDecision("MCP/tool authority stays with the configured authority provider in DeepSeek alpha", 0.85), "safety-gate");
  }

  if (isDeepSeekRequested(input)) {
    if (!directDeepSeekAllowed) {
      return withRouteEnsemble(authorityDecision("Explicit DeepSeek hint rejected for non-read-only provider role", 0.9), "safety-gate");
    }
    if (input.complexity === "complex" && !dedicatedDeepSeekAgent) {
      return withRouteEnsemble(authorityDecision("Complex read-only judgment stays with the configured authority provider despite DeepSeek hint", 0.85), "authority-provider");
    }
    return withRouteEnsemble(
      deepseekDecision(
        dedicatedDeepSeekAgent
          ? `Dedicated DeepSeek ${input.preferredDeepSeekTier?.toUpperCase()} model agent route`
          : "Explicit low-risk DeepSeek route",
        dedicatedDeepSeekAgent ? 0.93 : 0.9,
        selectDeepSeekDirectPlan(seed, input.preferredDeepSeekTier),
        authorityProvider
      ),
      "deepseek-direct"
    );
  }

  if (AUTHORITY_PROVIDER_ROLES.has(role)) {
    return withRouteEnsemble(authorityDecision("Role carries write, merge, or final-judgment authority", 0.85), "authority-provider");
  }

  if (directDeepSeekAllowed && input.complexity !== "complex") {
    const confidence = input.estimatedTokens > 120_000 ? 0.7 : 0.8;
    return withRouteEnsemble(
      deepseekDecision("Low-risk parallel worker suitable for DeepSeek", confidence, selectDeepSeekDirectPlan(seed), authorityProvider),
      "deepseek-direct"
    );
  }

  if (input.complexity === "simple" && input.risk === "read" && input.readOnly === true) {
    return withRouteEnsemble(
      deepseekDecision("Explicit simple read-only task can be offloaded to DeepSeek", 0.72, selectDeepSeekDirectPlan(seed), authorityProvider),
      "deepseek-direct"
    );
  }

  return withRouteEnsemble(authorityDecision("Default provider-neutral authority route", 0.7), "authority-provider");
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

export function selectDeepSeekModelTier(seed: string): { tier: DeepSeekModelTier; ratioBucket: number } {
  const ratioBucket = stableHash(seed) % 10;
  return {
    tier: ratioBucket < DEEPSEEK_FLASH_RATIO_OUT_OF_TEN ? "flash" : "pro",
    ratioBucket,
  };
}

function selectDeepSeekDirectPlan(seed: string, preferredTier?: DeepSeekModelTier): DeepSeekRoutePlan {
  const selected = preferredTier
    ? { tier: preferredTier, ratioBucket: preferredTier === "flash" ? 0 : 9 }
    : selectDeepSeekModelTier(seed);
  return {
    provider: "deepseek",
    model: selected.tier === "flash" ? DEEPSEEK_V4_FLASH_MODEL : DEEPSEEK_V4_PRO_MODEL,
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
  const advisoryAllowed = input.risk === "write" && canUseDeepSeekProAdvisory(role, input);
  const safetyReason = providerSafetyReason(input, role);
  const dedicatedDeepSeekAgent = isDedicatedDeepSeekAgent(input);
  const externalProvider = requestedExternalProvider(input);
  const directCandidateAllowed =
    !safetyReason &&
    input.deepseekAvailable &&
    directDeepSeekAllowed &&
    input.risk === "read" &&
    (input.complexity !== "complex" || dedicatedDeepSeekAgent) &&
    !input.needsMcp &&
    !input.needsToolCalling;
  const advisoryCandidateAllowed = !safetyReason && advisoryAllowed && input.deepseekAvailable;
  const externalDirectAllowed = Boolean(externalProvider) && !safetyReason && canUseGenericDirectProvider(role, input);
  const externalAdvisoryAllowed = Boolean(externalProvider) && !safetyReason && canUseGenericAdvisoryProvider(role, input);

  const candidates: ProviderRouteEnsembleCandidate[] = [
    {
      id: "authority-provider",
      provider: decision.fallbackProvider,
      participation: "authority",
      score: winner === "authority-provider" ? decision.confidence : scoreAuthorityProvider(input, role),
      reason: authorityProviderReason(input, role),
      selected: winner === "authority-provider",
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
        ? "File-affecting node can use DeepSeek V4 Pro Max advisory while the authority provider keeps write authority"
        : safetyReason ?? advisoryRejectionReason(input, role),
      selected: winner === "deepseek-pro-advisory",
      veto: !advisoryCandidateAllowed,
    },
    {
      id: "safety-gate",
      provider: decision.fallbackProvider,
      participation: "veto",
      score: winner === "safety-gate" ? decision.confidence : safetyReason ? 0.74 : 0,
      reason: safetyReason ?? "No safety veto; DeepSeek may participate when other route candidates win",
      selected: winner === "safety-gate",
      veto: Boolean(safetyReason),
    },
  ];

  if (externalProvider) {
    candidates.splice(1, 0, {
      id: `${externalProvider}-direct`,
      provider: externalProvider,
      participation: "direct",
      score: externalDirectAllowed ? 0.78 : 0,
      reason: externalDirectAllowed
        ? `${providerLabel(externalProvider)} read-only lane has no write/shell/MCP authority`
        : safetyReason ?? `${providerLabel(externalProvider)} direct lanes require read-only, no-tool scope`,
      selected: winner === `${externalProvider}-direct`,
      veto: !externalDirectAllowed,
    }, {
      id: `${externalProvider}-advisory`,
      provider: externalProvider,
      participation: "advisory",
      score: externalAdvisoryAllowed ? 0.8 : 0,
      reason: externalAdvisoryAllowed
        ? `${providerLabel(externalProvider)} may advise while the authority provider keeps write authority`
        : safetyReason ?? `${providerLabel(externalProvider)} advisory lanes require bounded file-affecting scope`,
      selected: winner === `${externalProvider}-advisory`,
      veto: !externalAdvisoryAllowed,
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
  if (policy === "kimi" || input.providerHint === "kimi") return "Kimi-only policy or explicit Kimi provider hint";
  if (role === "orchestrator" || role === "merger" || role === "integrator") return "Core orchestration and merge authority";
  const externalProvider = requestedExternalProvider(input);
  if (externalProvider) {
    if (!isProviderAvailable(input, externalProvider)) return `${providerLabel(externalProvider)} unavailable for this run`;
    if (input.risk !== "read" && !(input.risk === "write" && canUseGenericAdvisoryProvider(role, input))) {
      return "External provider lanes cannot own non-read execution";
    }
    if (input.needsMcp || input.needsToolCalling) return "MCP or tool-calling authority stays with the authority provider";
    if (input.risk === "read" && !canUseGenericDirectProvider(role, input)) {
      return `${providerLabel(externalProvider)} direct lane is not read-only safe for this role`;
    }
    return undefined;
  }
  if (!input.deepseekAvailable) return "DeepSeek unavailable for this run";
  if (input.risk !== "read" && !(input.risk === "write" && canUseDeepSeekProAdvisory(role, input))) {
    return "Non-read execution requires the configured authority provider";
  }
  if (input.needsMcp || input.needsToolCalling) return "MCP or tool-calling authority stays with the authority provider";
  if (isDeepSeekRequested(input) && !canUseDirectDeepSeek(role, input)) {
    return "Explicit DeepSeek hint is not read-only safe for this role";
  }
  return undefined;
}

function authorityProviderReason(input: ProviderRouteInput, role: string): string {
  if (AUTHORITY_PROVIDER_ROLES.has(role)) return "Role carries write, merge, or final-judgment authority";
  if (input.complexity === "complex") return "Complex judgment uses the configured authority provider's full project context";
  if (input.risk !== "read") return "The configured authority provider owns side effects, shell, file writes, and final acceptance";
  return "Configured authority provider remains the baseline authority and fallback provider";
}

function scoreAuthorityProvider(input: ProviderRouteInput, role: string): number {
  if (AUTHORITY_PROVIDER_ROLES.has(role)) return 0.9;
  if (input.risk !== "read") return 0.86;
  if (input.complexity === "complex") return 0.82;
  if (input.needsMcp || input.needsToolCalling) return 0.78;
  return 0.58;
}

function scoreDeepSeekDirect(input: ProviderRouteInput): number {
  if (isDedicatedDeepSeekAgent(input)) return 0.93;
  if (input.estimatedTokens > 120_000) return 0.7;
  return isDeepSeekRequested(input) ? 0.9 : 0.8;
}

function directDeepSeekRejectionReason(input: ProviderRouteInput, role: string): string {
  if (!input.deepseekAvailable) return "DeepSeek is unavailable";
  if (input.risk !== "read") return "Direct DeepSeek is limited to read-only risk";
  if (!canUseDirectDeepSeek(role, input)) return "Role is not read-only safe for direct DeepSeek";
  if (input.complexity === "complex" && !isDedicatedDeepSeekAgent(input)) return "Complex read-only judgment stays with the configured authority provider";
  if (input.needsMcp || input.needsToolCalling) return "MCP/tool-calling requirements stay with the configured authority provider";
  return "Direct DeepSeek candidate did not win this route";
}

function advisoryRejectionReason(input: ProviderRouteInput, role: string): string {
  if (!input.deepseekAvailable) return "DeepSeek is unavailable";
  if (!DEEPSEEK_PRO_ADVISORY_FILE_ROLES.has(role)) return "Role is not a file-affecting advisory role";
  if (input.risk !== "write") return "Advisory Pro Max is reserved for file-affecting write-risk nodes";
  if (input.complexity === "simple") return "Simple write nodes do not need DeepSeek advisory overhead";
  if (input.needsMcp || input.needsToolCalling) return "MCP/tool-calling requirements stay with the configured authority provider";
  return "Advisory candidate did not win this route";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function authorityProviderDecision(
  provider: ProviderId,
  reason: string,
  confidence: number,
  deepseek?: DeepSeekRoutePlan,
  extra: { providerModel?: ProviderModelRef } = {}
): Omit<ProviderRouteDecision, "routeEnsemble"> {
  return {
    provider,
    fallbackProvider: provider,
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
  fallbackProvider: ProviderId = DEFAULT_AUTHORITY_PROVIDER
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
  fallbackProvider: ProviderId = DEFAULT_AUTHORITY_PROVIDER
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
  if (lower === "qwen-3.7-max" || lower === "qwen3.7-max" || lower === "qwen-3-7-max") return QWEN_DEFAULT_MODEL;
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
