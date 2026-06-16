import { maskSensitiveText } from "../util/secret-mask.js";

export type RuntimeFailureClass =
  | "none"
  | "runtime"
  | "auth"
  | "model"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "authority"
  | "abort"
  | "transient"
  | "unknown";

export interface RuntimeFailureClassification {
  readonly failureClass: RuntimeFailureClass;
  readonly retryable: boolean;
  readonly circuitBreaker: boolean;
  readonly cooldownMs: number;
  readonly reason: string;
}

export interface RuntimeFailureInput {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const DEFAULT_COOLDOWNS: Readonly<Record<Exclude<RuntimeFailureClass, "none">, number>> = {
  runtime: 120_000,
  auth: 300_000,
  model: 300_000,
  quota: 300_000,
  rate_limit: 60_000,
  timeout: 45_000,
  authority: 120_000,
  abort: 0,
  transient: 30_000,
  unknown: 0,
};

const RETRYABLE_FAILURES = new Set<RuntimeFailureClass>(["runtime", "rate_limit", "timeout", "transient"]);
const CIRCUIT_BREAKER_FAILURES = new Set<RuntimeFailureClass>([
  "runtime",
  "auth",
  "model",
  "quota",
  "rate_limit",
  "timeout",
  "authority",
  "transient",
]);

export function classifyRuntimeFailure(input: RuntimeFailureInput): RuntimeFailureClassification {
  const metadataClass = normalizeFailureClass(
    input.metadata?.failureClass ?? input.metadata?.failureKind ?? nestedFailureKind(input.metadata?.providerFallback),
  );
  const failureClass = metadataClass ?? classifyRuntimeFailureFromSignals(input);
  if (failureClass === "none") {
    return { failureClass, retryable: false, circuitBreaker: false, cooldownMs: 0, reason: "runtime result succeeded" };
  }

  return {
    failureClass,
    retryable: RETRYABLE_FAILURES.has(failureClass),
    circuitBreaker: CIRCUIT_BREAKER_FAILURES.has(failureClass),
    cooldownMs: DEFAULT_COOLDOWNS[failureClass],
    reason: reasonForFailureClass(failureClass),
  };
}

function classifyRuntimeFailureFromSignals(input: RuntimeFailureInput): RuntimeFailureClass {
  if (input.exitCode === 0) return "none";
  if (input.exitCode === 130) return "abort";
  if (input.exitCode === 78) return "authority";

  const text = maskSensitiveText(`${input.stderr ?? ""}\n${input.stdout ?? ""}`).toLowerCase();
  if (/\b(unauthorized|forbidden|invalid api key|api key|authentication|auth failed|permission denied|401|403)\b/.test(text)) return "auth";
  if (/\b(insufficient balance|quota|billing|payment required|402|credit exhausted)\b/.test(text)) return "quota";
  if (/\b(rate[-\s_]*limit|too many requests|429)\b/.test(text)) return "rate_limit";
  if (/\b(timeout|timed out|etimedout|deadline exceeded)\b/.test(text)) return "timeout";
  if (/\b(model not found|unknown model|invalid model|model unavailable|404 model)\b/.test(text)) return "model";
  if (/\b(command not found|enoent|spawn .* failed|runtime unavailable|binary missing|not installed)\b/.test(text)) return "runtime";
  if (/\b(econnreset|econnrefused|network|temporarily unavailable|503|502|504|5\d\d)\b/.test(text)) return "transient";
  return "unknown";
}

function normalizeFailureClass(value: unknown): RuntimeFailureClass | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "none":
    case "runtime":
    case "auth":
    case "model":
    case "quota":
    case "rate_limit":
    case "timeout":
    case "authority":
    case "abort":
    case "transient":
    case "unknown":
      return normalized;
    case "availability":
      return "runtime";
    case "policy":
      return "authority";
    default:
      return undefined;
  }
}

function nestedFailureKind(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as { failureKind?: unknown }).failureKind;
}

function reasonForFailureClass(failureClass: RuntimeFailureClass): string {
  switch (failureClass) {
    case "runtime": return "runtime unavailable or adapter launch failed";
    case "auth": return "runtime authentication failed";
    case "model": return "runtime model is unavailable or invalid";
    case "quota": return "runtime quota or billing is exhausted";
    case "rate_limit": return "runtime rate limit was reached";
    case "timeout": return "runtime timed out";
    case "authority": return "runtime authority or policy boundary blocked execution";
    case "abort": return "runtime execution was aborted";
    case "transient": return "transient runtime or network failure";
    case "unknown": return "unclassified runtime failure";
    case "none": return "runtime result succeeded";
  }
}
