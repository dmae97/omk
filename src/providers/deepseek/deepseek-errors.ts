import type { TaskResult } from "../../contracts/orchestration.js";
import type { ProviderFailureKind } from "../types.js";

const AVAILABILITY_PATTERNS = [
  "402",
  "insufficient balance",
  "balance",
  "api key",
  "authentication",
  "unauthorized",
  "401",
];

const TRANSIENT_PATTERNS = [
  // NOTE: "text content is empty" was removed — it is a Moonshot (Kimi) API error,
  // not a DeepSeek error. It occurs when Kimi CLI < 1.39.0 sends assistant messages
  // with tool_calls but empty content. See Kimi CLI changelog 2026-04-24.
  "rate limit",
  "429",
  "server overloaded",
  "overloaded",
  "server error",
  "500",
  "503",
  "timeout",
  "timed out",
  "econnreset",
  "socket hang up",
  "fetch failed",
];

const POLICY_PATTERNS = [
  "read-only",
  "does not receive tool",
  "mcp authority",
  "write/shell/merge",
];

export function isDeepSeekPaymentOrAvailabilityFailure(result: TaskResult): boolean {
  return classifyDeepSeekFailure(result) === "availability";
}

export function isDeepSeekTransientFailure(result: TaskResult): boolean {
  return classifyDeepSeekFailure(result) === "transient";
}

export function classifyDeepSeekFailure(result: TaskResult): ProviderFailureKind {
  const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (AVAILABILITY_PATTERNS.some((pattern) => text.includes(pattern))) return "availability";
  if (TRANSIENT_PATTERNS.some((pattern) => text.includes(pattern))) return "transient";
  if (POLICY_PATTERNS.some((pattern) => text.includes(pattern))) return "policy";
  return "unknown";
}
