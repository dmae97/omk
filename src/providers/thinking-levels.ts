export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const DEFAULT_THINKING_LEVELS: readonly ThinkingLevel[] = ["medium", "high", "xhigh", "max"];

const PROVIDER_LEVELS: Record<string, readonly ThinkingLevel[]> = {
  kimi: ["medium", "high", "xhigh", "max"],
  mimo: ["medium", "high", "xhigh", "max"],
  deepseek: ["off", "high", "xhigh", "max"],
  qwen: ["off", "medium", "high", "max"],
  glm: ["off", "medium", "high", "max"],
  anthropic: ["minimal", "low", "medium", "high", "xhigh", "max"],
  openrouter: ["minimal", "low", "medium", "high", "xhigh", "max"],
  duckcoding: ["minimal", "low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh"],
};

const MODEL_LEVELS: readonly { pattern: RegExp; levels: readonly ThinkingLevel[] }[] = [
  { pattern: /kimi|mimo/i, levels: PROVIDER_LEVELS.kimi },
  { pattern: /deepseek/i, levels: PROVIDER_LEVELS.deepseek },
  { pattern: /qwen/i, levels: PROVIDER_LEVELS.qwen },
  { pattern: /glm/i, levels: PROVIDER_LEVELS.glm },
  { pattern: /duck[-_ ]?coding/i, levels: PROVIDER_LEVELS.duckcoding },
  { pattern: /fable|claude|sonnet|opus|haiku|anthropic|gpt|openrouter/i, levels: PROVIDER_LEVELS.anthropic },
  { pattern: /codex/i, levels: PROVIDER_LEVELS.codex },
];

export function thinkingLevelsFor(provider?: string, model?: string): readonly ThinkingLevel[] {
  const modelText = model ?? "";
  for (const entry of MODEL_LEVELS) {
    if (entry.pattern.test(modelText)) return entry.levels;
  }
  const key = provider?.trim().toLowerCase() ?? "";
  return PROVIDER_LEVELS[key] ?? DEFAULT_THINKING_LEVELS;
}

export function normalizeThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "med" || normalized === "normal" || normalized === "mid") return "medium";
  if (normalized === "hi") return "high";
  if (normalized === "lo") return "low";
  if (normalized === "min") return "minimal";
  if (normalized === "extra" || normalized === "x-high" || normalized === "x_high" || normalized === "xhi") return "xhigh";
  if (normalized === "maximum" || normalized === "full") return "max";
  if (["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(normalized)) {
    return normalized as ThinkingLevel;
  }
  return undefined;
}

export function nextThinkingLevel(current: string | undefined, provider?: string, model?: string): ThinkingLevel {
  const levels = thinkingLevelsFor(provider, model);
  const normalized = normalizeThinkingLevel(current);
  const index = normalized ? levels.indexOf(normalized) : -1;
  return levels[(index + 1) % levels.length] ?? "medium";
}

export function normalizeThinkingVariant(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  const level = normalizeThinkingLevel(normalized);
  if (level) return level;
  if (normalized.length > 80) return undefined;
  return /^[a-z0-9][a-z0-9._:-]*$/.test(normalized) ? normalized : undefined;
}

export function formatThinkingModelVariant(model: string | undefined, variant: string): string {
  const base = model?.trim() || "auto";
  return `${base}:${variant}`;
}
