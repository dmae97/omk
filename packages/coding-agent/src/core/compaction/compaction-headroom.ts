import { computeReservedTokenBudget } from "../context-budget-reserved-tokens.ts";

export interface CompactionSettings {
	enabled: boolean;
	reserveTokens: number;
	reservedOutputTokens?: number;
	reservedToolResultTokens?: number;
	safetyMarginTokens?: number;
	imageReserveTokens?: number;
	keepRecentTokens: number;
	/** Maximum fraction of the context window to use before compaction. Default: 0.9. */
	maxUsageRatio?: number;
	rearmRatio?: number;
	emergencyRatio?: number;
}

export const DEFAULT_COMPACTION_MAX_USAGE_RATIO = 0.9;

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 16384,
	keepRecentTokens: 20000,
	maxUsageRatio: DEFAULT_COMPACTION_MAX_USAGE_RATIO,
};

export type CompactionHeadroomLimit = "max_usage_ratio" | "reserve_tokens";

export interface CompactionHeadroomThreshold {
	triggerTokens: number;
	headroomTokens: number;
	maxUsageRatioTokens: number;
	reserveBoundaryTokens: number;
	limitedBy: CompactionHeadroomLimit;
}

/** Return the earliest compaction threshold from ratio-based headroom and absolute reserve. */
export function getCompactionHeadroomThreshold(
	contextWindow: number,
	settings: CompactionSettings,
): CompactionHeadroomThreshold | undefined {
	if (!settings.enabled || !Number.isFinite(contextWindow) || contextWindow <= 0) {
		return undefined;
	}

	const windowTokens = Math.floor(contextWindow);
	const reserveTokens = Number.isFinite(settings.reserveTokens) ? Math.max(0, Math.floor(settings.reserveTokens)) : 0;
	const configuredMaxUsageRatio = settings.maxUsageRatio ?? DEFAULT_COMPACTION_MAX_USAGE_RATIO;
	const maxUsageRatio =
		Number.isFinite(configuredMaxUsageRatio) && configuredMaxUsageRatio > 0 && configuredMaxUsageRatio < 1
			? configuredMaxUsageRatio
			: DEFAULT_COMPACTION_MAX_USAGE_RATIO;
	const maxUsageRatioTokens = Math.max(1, Math.floor(windowTokens * maxUsageRatio));
	const reservedBudget = computeReservedTokenBudget({
		modelContextWindow: windowTokens,
		systemPromptTokens: 0,
		reservedOutputTokens: settings.reservedOutputTokens ?? reserveTokens,
		reservedToolResultTokens: settings.reservedToolResultTokens ?? 0,
		safetyMarginTokens: settings.safetyMarginTokens ?? 0,
		imageReserveTokens: settings.imageReserveTokens ?? 0,
	});
	const reserveBoundaryTokens =
		reservedBudget.overflow || reservedBudget.effectiveBudget === 0
			? maxUsageRatioTokens
			: Math.max(1, reservedBudget.effectiveBudget);
	const triggerTokens = Math.min(maxUsageRatioTokens, reserveBoundaryTokens);

	return {
		triggerTokens,
		headroomTokens: windowTokens - triggerTokens,
		maxUsageRatioTokens,
		reserveBoundaryTokens,
		limitedBy: reserveBoundaryTokens <= maxUsageRatioTokens ? "reserve_tokens" : "max_usage_ratio",
	};
}

/**
 * Check if compaction should trigger based on context usage.
 */
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
	const threshold = getCompactionHeadroomThreshold(contextWindow, settings);
	return threshold !== undefined && Number.isFinite(contextTokens) && contextTokens >= threshold.triggerTokens;
}
