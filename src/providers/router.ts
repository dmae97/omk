import type { DagNode } from "../orchestration/dag.js";
import type {
  DeepSeekModelTier,
  DeepSeekRoutePlan,
  ProviderComplexity,
  ProviderPolicy,
  ProviderRisk,
  ProviderRouteEnsembleCandidate,
  ProviderRouteEnsembleResult,
  ProviderRouteDecision,
  ProviderRouteInput,
} from "./types.js";

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

const KIMI_AUTHORITY_ROLES = new Set([
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

export const DEEPSEEK_V4_FLASH_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_V4_PRO_MODEL = "deepseek-v4-pro";
const DEEPSEEK_FLASH_RATIO_OUT_OF_TEN = 6;

export function routeProvider(input: ProviderRouteInput): ProviderRouteDecision {
  const policy: ProviderPolicy = input.providerPolicy ?? "auto";
  const role = input.role.toLowerCase();
  const seed = `${input.nodeId ?? ""}:${role}:${input.taskType}`;
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
    return withRouteEnsemble(kimiDecision("Kimi-only provider policy or explicit Kimi route", 1), "safety-gate");
  }

  if (role === "orchestrator" || role === "merger" || role === "integrator") {
    return withRouteEnsemble(kimiDecision("Core orchestration and merge authority stay with Kimi", 1), "safety-gate");
  }

  if (!input.deepseekAvailable) {
    return withRouteEnsemble(kimiDecision("DeepSeek unavailable; using Kimi fallback", 1), "safety-gate");
  }

  if (input.risk === "write" && canUseDeepSeekProAdvisory(role, input)) {
    return withRouteEnsemble(
      kimiDecision("Kimi keeps file-write authority with DeepSeek V4 Pro Max advisory", 0.82, {
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
    return withRouteEnsemble(kimiDecision("High-risk tool execution uses Kimi-first runtime", 0.9), "safety-gate");
  }

  if (input.needsMcp || input.needsToolCalling) {
    return withRouteEnsemble(kimiDecision("MCP/tool authority stays with Kimi in DeepSeek alpha", 0.85), "safety-gate");
  }

  if (input.providerHint === "deepseek") {
    if (!directDeepSeekAllowed) {
      return withRouteEnsemble(kimiDecision("Explicit DeepSeek hint rejected for non-read-only provider role", 0.9), "safety-gate");
    }
    if (input.complexity === "complex" && !dedicatedDeepSeekAgent) {
      return withRouteEnsemble(kimiDecision("Complex read-only judgment stays with Kimi despite DeepSeek hint", 0.85), "kimi-authority");
    }
    return withRouteEnsemble(
      deepseekDecision(
        dedicatedDeepSeekAgent
          ? `Dedicated DeepSeek ${input.preferredDeepSeekTier?.toUpperCase()} model agent route`
          : "Explicit low-risk DeepSeek route",
        dedicatedDeepSeekAgent ? 0.93 : 0.9,
        selectDeepSeekDirectPlan(seed, input.preferredDeepSeekTier)
      ),
      "deepseek-direct"
    );
  }

  if (KIMI_AUTHORITY_ROLES.has(role)) {
    return withRouteEnsemble(kimiDecision("Role carries write, merge, or final-judgment authority", 0.85), "kimi-authority");
  }

  if (directDeepSeekAllowed && input.complexity !== "complex") {
    const confidence = input.estimatedTokens > 120_000 ? 0.7 : 0.8;
    return withRouteEnsemble(
      deepseekDecision("Low-risk parallel worker suitable for DeepSeek", confidence, selectDeepSeekDirectPlan(seed)),
      "deepseek-direct"
    );
  }

  if (input.complexity === "simple" && input.risk === "read" && input.readOnly === true) {
    return withRouteEnsemble(
      deepseekDecision("Explicit simple read-only task can be offloaded to DeepSeek", 0.72, selectDeepSeekDirectPlan(seed)),
      "deepseek-direct"
    );
  }

  return withRouteEnsemble(kimiDecision("Default Kimi-first route", 0.7), "kimi-authority");
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
  return input.providerHint === "deepseek" && Boolean(input.preferredDeepSeekTier);
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
  const directCandidateAllowed =
    !safetyReason &&
    input.deepseekAvailable &&
    directDeepSeekAllowed &&
    input.risk === "read" &&
    (input.complexity !== "complex" || dedicatedDeepSeekAgent) &&
    !input.needsMcp &&
    !input.needsToolCalling;
  const advisoryCandidateAllowed = !safetyReason && advisoryAllowed && input.deepseekAvailable;

  const candidates: ProviderRouteEnsembleCandidate[] = [
    {
      id: "kimi-authority",
      provider: "kimi",
      participation: "authority",
      score: winner === "kimi-authority" ? decision.confidence : scoreKimiAuthority(input, role),
      reason: kimiAuthorityReason(input, role),
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
        ? "File-affecting node can use DeepSeek V4 Pro Max advisory while Kimi keeps write authority"
        : safetyReason ?? advisoryRejectionReason(input, role),
      selected: winner === "deepseek-pro-advisory",
      veto: !advisoryCandidateAllowed,
    },
    {
      id: "safety-gate",
      provider: "kimi",
      participation: "veto",
      score: winner === "safety-gate" ? decision.confidence : safetyReason ? 0.74 : 0,
      reason: safetyReason ?? "No safety veto; DeepSeek may participate when other route candidates win",
      selected: winner === "safety-gate",
      veto: Boolean(safetyReason),
    },
  ];

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
  if (!input.deepseekAvailable) return "DeepSeek unavailable for this run";
  if (input.risk !== "read" && !(input.risk === "write" && canUseDeepSeekProAdvisory(role, input))) {
    return "Non-read execution requires Kimi authority";
  }
  if (input.needsMcp || input.needsToolCalling) return "MCP or tool-calling authority stays with Kimi";
  if (input.providerHint === "deepseek" && !canUseDirectDeepSeek(role, input)) {
    return "Explicit DeepSeek hint is not read-only safe for this role";
  }
  return undefined;
}

function kimiAuthorityReason(input: ProviderRouteInput, role: string): string {
  if (KIMI_AUTHORITY_ROLES.has(role)) return "Role carries write, merge, or final-judgment authority";
  if (input.complexity === "complex") return "Complex judgment benefits from Kimi's full project context";
  if (input.risk !== "read") return "Kimi owns side effects, shell, file writes, and final acceptance";
  return "Kimi remains the baseline authority and fallback provider";
}

function scoreKimiAuthority(input: ProviderRouteInput, role: string): number {
  if (KIMI_AUTHORITY_ROLES.has(role)) return 0.9;
  if (input.risk !== "read") return 0.86;
  if (input.complexity === "complex") return 0.82;
  if (input.needsMcp || input.needsToolCalling) return 0.78;
  return 0.58;
}

function scoreDeepSeekDirect(input: ProviderRouteInput): number {
  if (isDedicatedDeepSeekAgent(input)) return 0.93;
  if (input.estimatedTokens > 120_000) return 0.7;
  return input.providerHint === "deepseek" ? 0.9 : 0.8;
}

function directDeepSeekRejectionReason(input: ProviderRouteInput, role: string): string {
  if (!input.deepseekAvailable) return "DeepSeek is unavailable";
  if (input.risk !== "read") return "Direct DeepSeek is limited to read-only risk";
  if (!canUseDirectDeepSeek(role, input)) return "Role is not read-only safe for direct DeepSeek";
  if (input.complexity === "complex" && !isDedicatedDeepSeekAgent(input)) return "Complex read-only judgment stays with Kimi";
  if (input.needsMcp || input.needsToolCalling) return "MCP/tool-calling requirements stay with Kimi";
  return "Direct DeepSeek candidate did not win this route";
}

function advisoryRejectionReason(input: ProviderRouteInput, role: string): string {
  if (!input.deepseekAvailable) return "DeepSeek is unavailable";
  if (!DEEPSEEK_PRO_ADVISORY_FILE_ROLES.has(role)) return "Role is not a file-affecting advisory role";
  if (input.risk !== "write") return "Advisory Pro Max is reserved for file-affecting write-risk nodes";
  if (input.complexity === "simple") return "Simple write nodes do not need DeepSeek advisory overhead";
  if (input.needsMcp || input.needsToolCalling) return "MCP/tool-calling requirements stay with Kimi";
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

function kimiDecision(
  reason: string,
  confidence: number,
  deepseek?: DeepSeekRoutePlan
): Omit<ProviderRouteDecision, "routeEnsemble"> {
  return {
    provider: "kimi",
    fallbackProvider: "kimi",
    confidence,
    reason,
    deepseek,
  };
}

function deepseekDecision(
  reason: string,
  confidence: number,
  deepseek: DeepSeekRoutePlan
): Omit<ProviderRouteDecision, "routeEnsemble"> {
  return {
    provider: "deepseek",
    fallbackProvider: "kimi",
    confidence,
    reason,
    deepseek,
  };
}
