import { UsageError } from "./cli-contract.js";
import type { OmkRuntimeScope } from "./resource-profile.js";

export function parseRuntimeScopeOption(
  value: string | undefined,
  fallback: OmkRuntimeScope,
  optionName = "--mcp-scope"
): OmkRuntimeScope {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "none" || normalized === "off" || normalized === "disabled") return "none";
  if (normalized === "project" || normalized === "local") return "project";
  if (
    normalized === "all" ||
    normalized === "global" ||
    normalized === "local-user" ||
    normalized === "local_user" ||
    normalized === "personal" ||
    normalized === "user"
  ) {
    return "all";
  }
  throw new UsageError(`Invalid ${optionName}: ${value}. Use all, project, or none.`);
}
