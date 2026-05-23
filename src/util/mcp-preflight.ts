export type RuntimeMcpPreflightMode = "warn-skip" | "strict" | "off";
export type RuntimeMcpPreflightFailureReason = "timeout" | "exit" | "missing-env" | "http-fail" | "stdio-fail";
export type RuntimeMcpPreflightEntryStatus = "ok" | "failed" | "skipped";

export interface RuntimeMcpPreflightOptions {
  timeoutMs: number;
  concurrency: number;
}

export interface RuntimeMcpPreflightEntry {
  name: string;
  status: RuntimeMcpPreflightEntryStatus;
  reason?: RuntimeMcpPreflightFailureReason | "not-npm-family" | "no-package-spec";
  detail?: string;
  packageSpec?: string;
}

export interface RuntimeMcpPreflightResult {
  failed: Set<string>;
  details: Map<string, { reason: RuntimeMcpPreflightFailureReason; detail: string }>;
  entries: RuntimeMcpPreflightEntry[];
}

export function resolveRuntimeMcpPreflightMode(
  env: Record<string, string | undefined> = process.env
): RuntimeMcpPreflightMode {
  const raw = env.OMK_MCP_PREFLIGHT?.trim();
  if (!raw) return "warn-skip";
  if (raw === "strict" || raw === "warn-skip") return raw;
  return "off";
}

function resolvePreflightTimeout(env: Record<string, string | undefined> = process.env): number {
  const raw = env.OMK_MCP_PREFLIGHT_TIMEOUT_MS;
  if (!raw) return 5000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

function resolvePreflightConcurrency(env: Record<string, string | undefined> = process.env): number {
  const raw = env.OMK_MCP_PREFLIGHT_CONCURRENCY;
  if (!raw) return 3;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export function resolveRuntimeMcpPreflightOptions(
  env: Record<string, string | undefined> = process.env
): RuntimeMcpPreflightOptions & { mode: RuntimeMcpPreflightMode } {
  return {
    mode: resolveRuntimeMcpPreflightMode(env),
    timeoutMs: resolvePreflightTimeout(env),
    concurrency: resolvePreflightConcurrency(env),
  };
}
