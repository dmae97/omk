export type KimiProviderFailureKind = "monthly-quota" | "rate-limit" | "provider";

export interface KimiProviderFailureDiagnosis {
  kind: KimiProviderFailureKind;
  title: string;
  remediation: string[];
}

export function classifyKimiProviderFailure(output: string): KimiProviderFailureDiagnosis | null {
  const normalized = output.toLowerCase();
  const isMonthlyQuota =
    normalized.includes("exceeded_current_quota_error") ||
    normalized.includes("monthly usage limit") ||
    (normalized.includes("billing cycle") && (normalized.includes("quota") || normalized.includes("usage limit"))) ||
    (normalized.includes("quota") && normalized.includes("refreshed in the next cycle"));
  const isRateLimit =
    normalized.includes("error code: 429") ||
    normalized.includes("rate limit") ||
    (/\b429\b/.test(normalized) &&
      (normalized.includes("llm") || normalized.includes("provider") || normalized.includes("kimi") || normalized.includes("moonshot")));
  const isProviderError =
    normalized.includes("llm provider error") ||
    normalized.includes("provider error") ||
    isMonthlyQuota ||
    isRateLimit;
  if (!isProviderError) return null;

  if (isMonthlyQuota) {
    return {
      kind: "monthly-quota",
      title: "Kimi monthly quota exhausted",
      remediation: [
        "Login/auth can be valid while the Kimi account's monthly provider quota is exhausted.",
        "This is a provider quota/billing limit, not an MCP or repository failure.",
        "Use a non-Kimi provider/profile until the quota refreshes, or upgrade Kimi quota.",
        "For this repo, try: omk provider deepseek enable (if configured) or rerun with a non-Kimi provider.",
      ],
    };
  }

  if (isRateLimit) {
    return {
      kind: "rate-limit",
      title: "Kimi provider rate limit reached",
      remediation: [
        "Wait and retry later, reduce parallel workers, or switch to a configured fallback provider.",
        "For worker runs, reduce concurrency with --workers 1 or OMK_WORKERS=1.",
      ],
    };
  }

  return {
    kind: "provider",
    title: "Kimi provider unavailable",
    remediation: [
      "Check Kimi account/provider status and retry, or switch to a configured fallback provider.",
    ],
  };
}

export function formatKimiProviderFailureHint(output: string): string | null {
  const diagnosis = classifyKimiProviderFailure(output);
  if (!diagnosis) return null;
  const lines = [
    `[omk] ${diagnosis.title}.`,
    ...diagnosis.remediation.map((line) => `      - ${line}`),
  ];
  return lines.join("\n") + "\n";
}
