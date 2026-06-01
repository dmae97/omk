import type { DagNode } from "../../orchestration/dag.js";

/**
 * Super OMK DeepSeek + Authority-Provider Co-Orchestration Preset
 *
 * This preset maximizes DeepSeek V4 Pro utilization alongside the configured authority provider:
 * - DeepSeek handles: planning, review, analysis, reasoning-heavy tasks
 * - Authority provider handles: file edits, shell execution, MCP/tools, final merge
 * - Parallel worker cap increased for DeepSeek advisory lanes
 */

export interface SuperOmkConfig {
  // Worker settings
  parallelWorkers: number;
  deepseekWorkerCap: number;
  kimiWorkerCap: number;
  authorityWorkerCap: number;

  // Routing rules: which node types go to which provider
  deepseekNodeTypes: string[];
  kimiNodeTypes: string[];
  authorityNodeTypes: string[];

  // Model config
  deepseekModel: string;
  deepseekReasoningEffort: "high" | "max";
  kimiModel: string;
  authorityModel: string;

  // Fallback behavior
  deepseekFallbackToKimi: boolean;
  deepseekFallbackToAuthority: boolean;
  retryEmptyContent: boolean;

  // Advisory mode
  deepseekAdvisoryEnabled: boolean;
  deepseekAdvisoryRatio: number; // 0.0-1.0
}

export const SUPER_OMK_DEFAULTS: SuperOmkConfig = {
  parallelWorkers: 4,
  deepseekWorkerCap: 3,
  kimiWorkerCap: 2,
  authorityWorkerCap: 2,
  deepseekNodeTypes: ["plan", "review", "analyze", "research", "debug"],
  kimiNodeTypes: ["implement", "edit", "shell", "test", "merge"],
  authorityNodeTypes: ["implement", "edit", "shell", "test", "merge"],
  deepseekModel: "deepseek-v4-pro",
  deepseekReasoningEffort: "max",
  kimiModel: "kimi-k2-6",
  authorityModel: "kimi-k2-6",
  deepseekFallbackToKimi: true,
  deepseekFallbackToAuthority: true,
  retryEmptyContent: true,
  deepseekAdvisoryEnabled: true,
  deepseekAdvisoryRatio: 0.7,
};

const DEEPSEEK_TYPE_ALIASES: Record<string, string[]> = {
  plan: ["planner", "architect", "coordinator"],
  review: ["reviewer", "auditor", "aggregator"],
  analyze: ["explorer", "researcher", "analyzer"],
  research: ["researcher", "explorer", "documenter"],
  debug: ["debugger", "tester", "qa"],
};

export function isSuperOmkEnabled(env?: Record<string, string | undefined>): boolean {
  const profile = env?.OMK_RESOURCE_PROFILE ?? process.env.OMK_RESOURCE_PROFILE;
  if (profile === "super") return true;
  const enabled = env?.OMK_SUPER_OMK_ENABLED ?? process.env.OMK_SUPER_OMK_ENABLED;
  return enabled === "1" || enabled === "true";
}

export function getSuperOmkConfig(env?: Record<string, string | undefined>): SuperOmkConfig {
  const config: SuperOmkConfig = { ...SUPER_OMK_DEFAULTS };
  if (!env) return config;

  const parseIntEnv = (key: string, min: number): number | undefined => {
    const v = env[key];
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= min ? Math.floor(n) : undefined;
  };

  const parseFloatEnv = (key: string, min: number): number | undefined => {
    const v = env[key];
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= min ? n : undefined;
  };

  const workers = parseIntEnv("OMK_PARALLEL_WORKERS", 1);
  if (workers !== undefined) config.parallelWorkers = workers;

  const dsCap = parseIntEnv("OMK_DEEPSEEK_WORKER_CAP", 1);
  if (dsCap !== undefined) config.deepseekWorkerCap = dsCap;

  const kmCap = parseIntEnv("OMK_KIMI_WORKER_CAP", 1);
  if (kmCap !== undefined) config.kimiWorkerCap = kmCap;
  const authorityCap = parseIntEnv("OMK_AUTHORITY_WORKER_CAP", 1);
  config.authorityWorkerCap = authorityCap ?? config.kimiWorkerCap;
  if (authorityCap !== undefined) config.kimiWorkerCap = authorityCap;

  if (env.OMK_DEEPSEEK_NODE_TYPES) {
    config.deepseekNodeTypes = env.OMK_DEEPSEEK_NODE_TYPES.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (env.OMK_KIMI_NODE_TYPES) {
    config.kimiNodeTypes = env.OMK_KIMI_NODE_TYPES.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    config.authorityNodeTypes = config.kimiNodeTypes;
  }
  if (env.OMK_AUTHORITY_NODE_TYPES) {
    config.authorityNodeTypes = env.OMK_AUTHORITY_NODE_TYPES.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    config.kimiNodeTypes = config.authorityNodeTypes;
  }
  if (env.OMK_DEEPSEEK_MODEL) config.deepseekModel = env.OMK_DEEPSEEK_MODEL;
  if (env.OMK_DEEPSEEK_REASONING_EFFORT === "high" || env.OMK_DEEPSEEK_REASONING_EFFORT === "max") {
    config.deepseekReasoningEffort = env.OMK_DEEPSEEK_REASONING_EFFORT;
  }
  if (env.OMK_KIMI_MODEL) config.kimiModel = env.OMK_KIMI_MODEL;
  config.authorityModel = config.kimiModel;
  if (env.OMK_AUTHORITY_MODEL) {
    config.authorityModel = env.OMK_AUTHORITY_MODEL;
    config.kimiModel = env.OMK_AUTHORITY_MODEL;
  }

  const fallback = env.OMK_DEEPSEEK_FALLBACK_TO_KIMI;
  if (fallback !== undefined) config.deepseekFallbackToKimi = fallback === "1" || fallback === "true";
  config.deepseekFallbackToAuthority = config.deepseekFallbackToKimi;
  const authorityFallback = env.OMK_DEEPSEEK_FALLBACK_TO_AUTHORITY;
  if (authorityFallback !== undefined) {
    config.deepseekFallbackToAuthority = authorityFallback === "1" || authorityFallback === "true";
    config.deepseekFallbackToKimi = config.deepseekFallbackToAuthority;
  }

  const retry = env.OMK_RETRY_EMPTY_CONTENT;
  if (retry !== undefined) config.retryEmptyContent = retry === "1" || retry === "true";

  const advisory = env.OMK_DEEPSEEK_ADVISORY_ENABLED;
  if (advisory !== undefined) config.deepseekAdvisoryEnabled = advisory === "1" || advisory === "true";

  const ratio = parseFloatEnv("OMK_DEEPSEEK_ADVISORY_RATIO", 0);
  if (ratio !== undefined) config.deepseekAdvisoryRatio = Math.min(1, ratio);

  return config;
}

export function matchesDeepSeekNodeType(
  node: DagNode,
  env: Record<string, string>,
  config: SuperOmkConfig
): boolean {
  const role = node.role.toLowerCase();
  const taskType = (env.OMK_TASK_TYPE ?? "general").toLowerCase();

  for (const type of config.deepseekNodeTypes) {
    const t = type.toLowerCase();
    // Direct match
    if (role === t || taskType === t) return true;
    // Substring match
    if (role.includes(t) || t.includes(role)) return true;
    if (taskType.includes(t) || t.includes(taskType)) return true;
    // Alias match
    const aliases = DEEPSEEK_TYPE_ALIASES[t];
    if (aliases) {
      for (const alias of aliases) {
        if (role === alias || role.includes(alias) || alias.includes(role)) return true;
      }
    }
  }
  return false;
}
