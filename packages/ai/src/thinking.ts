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

/** Metadata for a thinking mode. */
export type ThinkingMetadata = {
	/** The value of the thinking mode. */
	value: ThinkingMode;
	/** The label to display for the thinking mode. */
	label: string;
	/** The description to display for the thinking mode. */
	description: string;
};

const THINKING_META: Record<ThinkingMode, ThinkingMetadata> = {
	inherit: { value: "inherit", label: "inherit", description: "Inherit session default" },
	off: { value: "off", label: "off", description: "No reasoning" },
	minimal: { value: "minimal", label: "min", description: "Very brief reasoning (~1k tokens)" },
	low: { value: "low", label: "low", description: "Light reasoning (~2k tokens)" },
	medium: { value: "medium", label: "medium", description: "Moderate reasoning (~8k tokens)" },
	high: { value: "high", label: "high", description: "Deep reasoning (~16k tokens)" },
	xhigh: { value: "xhigh", label: "xhigh", description: "Maximum reasoning (~32k tokens)" },
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

/** Get the information for a thinking mode. */
export function getThinkingMetadata(mode: ThinkingMode): ThinkingMetadata {
	return THINKING_META[mode];
}

const REG_LVL: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];
const XHI_LVL: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

/** Returns the available thinking modes for a model based on whether it supports xhigh. */
export function getAvailableThinkingLevels(hasXhigh: boolean = true): ReadonlyArray<ThinkingLevel> {
	return hasXhigh ? XHI_LVL : REG_LVL;
}

const REG_EFF: readonly ThinkingEffort[] = ["minimal", "low", "medium", "high"];
const XHI_EFF: readonly ThinkingEffort[] = ["minimal", "low", "medium", "high", "xhigh"];

export function getAvailableThinkingEfforts(hasXhigh: boolean = true): ReadonlyArray<ThinkingEffort> {
	return hasXhigh ? XHI_EFF : REG_EFF;
}
