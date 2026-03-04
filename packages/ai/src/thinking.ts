/** Provider-level thinking levels (no "off"), ordered least to most. */
export type ThinkingEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * ThinkingLevel extended with "off" to disable reasoning entirely.
 * Used in UI, config, session state, and CLI args.
 * "off" is never sent to providers — callers strip it before streaming.
 */
export type ThinkingLevel = ThinkingEffort | "off";

/**
 * ThinkingSelector extended with "inherit" to indicate the role should
 * use the session-level default rather than an explicit choice.
 * Used in per-role model assignment UI.
 */
export type ThinkingMode = ThinkingLevel | "inherit";

/** Provider-level thinking levels (no "off"), ordered least to most. */
export const THINKING_LEVELS = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const satisfies readonly ThinkingEffort[];

/** All selectable thinking levels including "off", ordered none to maximum. */
export const ALL_THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const satisfies readonly ThinkingLevel[];

/** All thinking modes including "inherit", ordered inherit → none → maximum. */
export const ALL_THINKING_MODES = [
	"inherit",
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const satisfies readonly ThinkingMode[];

/** Human-readable descriptions for every thinking mode. */
export const THINKING_MODE_DESCRIPTIONS: Record<ThinkingMode, string> = {
	inherit: "Inherit session default",
	off: "No reasoning",
	minimal: "Very brief reasoning (~1k tokens)",
	low: "Light reasoning (~2k tokens)",
	medium: "Moderate reasoning (~8k tokens)",
	high: "Deep reasoning (~16k tokens)",
	xhigh: "Maximum reasoning (~32k tokens)",
};

/** Compact display labels for every thinking mode. */
export const THINKING_MODE_LABELS: Record<ThinkingMode, string> = {
	inherit: "inherit",
	off: "off",
	minimal: "min",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
};

const F_LEVEL = 3;
const F_SEL = 2;
const F_MODE = 1;

const F_THINKING: Record<string, number> = {
	inherit: F_MODE,
	off: F_SEL,
	minimal: F_LEVEL,
	low: F_LEVEL,
	medium: F_LEVEL,
	high: F_LEVEL,
	xhigh: F_LEVEL,
};

// Parses an unknown value and returns a ThinkingLevel if valid, otherwise undefined.
export function parseThinkingEffort(level: string | null | undefined): ThinkingEffort | undefined {
	return level && (F_THINKING[level] ?? 0) >= F_LEVEL ? (level as ThinkingEffort) : undefined;
}

// Parses an unknown value and returns a ThinkingSelector if valid, otherwise undefined.
export function parseThinkingLevel(level: string | null | undefined): ThinkingLevel | undefined {
	return level && (F_THINKING[level] ?? 0) >= F_SEL ? (level as ThinkingLevel) : undefined;
}

// Parses an unknown value and returns a ThinkingMode if valid, otherwise undefined.
export function parseThinkingMode(level: string | null | undefined): ThinkingMode | undefined {
	return level && (F_THINKING[level] ?? 0) >= F_MODE ? (level as ThinkingMode) : undefined;
}

/** Format a thinking mode as a compact display label. */
export function formatThinking(mode: ThinkingMode): string {
	return THINKING_MODE_LABELS[mode];
}

const REG_LVL: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];
const XHI_LVL: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

/** Returns the available thinking modes for a model based on whether it supports xhigh. */
export function getAvailableThinkingLevel(hasXhigh: boolean): ReadonlyArray<ThinkingLevel> {
	return hasXhigh ? XHI_LVL : REG_LVL;
}

const REG_EFF: readonly ThinkingEffort[] = ["minimal", "low", "medium", "high"];
const XHI_EFF: readonly ThinkingEffort[] = ["minimal", "low", "medium", "high", "xhigh"];

export function getAvailableThinkingEffort(hasXhigh: boolean): ReadonlyArray<ThinkingEffort> {
	return hasXhigh ? XHI_EFF : REG_EFF;
}
