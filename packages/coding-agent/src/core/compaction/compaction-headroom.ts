import { computeReservedTokenBudget } from "../context-budget-reserved-tokens.ts";
import { type CompactionHysteresisConfig, createCompactionHysteresisConfig } from "./hysteresis.ts";

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

export type CompactionHeadroomLimit = "max_usage_ratio" | "reserve_tokens" | "input_ceiling";

export interface CompactionHeadroomThreshold {
	triggerTokens: number;
	headroomTokens: number;
	maxUsageRatioTokens: number;
	reserveBoundaryTokens: number;
	limitedBy: CompactionHeadroomLimit;
}

/**
 * Return the earliest compaction threshold from ratio-based headroom, absolute reserve and,
 * when known, the hard input ceiling that prompt admission enforces.
 */
export function getCompactionHeadroomThreshold(
	contextWindow: number,
	settings: CompactionSettings,
	inputCeilingTokens?: number,
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
	const windowTriggerTokens = Math.min(maxUsageRatioTokens, reserveBoundaryTokens);
	const ceilingTriggerTokens = inputCeilingTriggerTokens(inputCeilingTokens, maxUsageRatio, settings);
	const triggerTokens = Math.min(windowTriggerTokens, ceilingTriggerTokens);
	const windowLimit: CompactionHeadroomLimit =
		reserveBoundaryTokens <= maxUsageRatioTokens ? "reserve_tokens" : "max_usage_ratio";

	return {
		triggerTokens,
		headroomTokens: windowTokens - triggerTokens,
		maxUsageRatioTokens,
		reserveBoundaryTokens,
		limitedBy: ceilingTriggerTokens < windowTriggerTokens ? "input_ceiling" : windowLimit,
	};
}

/**
 * The window bounds applied to the admissible input, so compaction runs before admission rejects.
 * The ceiling already excludes the output reserve and safety margin; only incoming tool-result and
 * image reserves are subtracted again.
 */
function inputCeilingTriggerTokens(
	inputCeilingTokens: number | undefined,
	maxUsageRatio: number,
	settings: CompactionSettings,
): number {
	if (inputCeilingTokens === undefined || !Number.isSafeInteger(inputCeilingTokens) || inputCeilingTokens <= 0) {
		return Number.POSITIVE_INFINITY;
	}
	const ratioTokens = Math.max(1, Math.floor(inputCeilingTokens * maxUsageRatio));
	const incoming = computeReservedTokenBudget({
		modelContextWindow: inputCeilingTokens,
		systemPromptTokens: 0,
		reservedOutputTokens: 0,
		reservedToolResultTokens: settings.reservedToolResultTokens ?? 0,
		safetyMarginTokens: 0,
		imageReserveTokens: settings.imageReserveTokens ?? 0,
	});
	const reserveBoundary = incoming.overflow || incoming.effectiveBudget === 0 ? ratioTokens : incoming.effectiveBudget;
	return Math.min(ratioTokens, reserveBoundary);
}

/** Runtime hysteresis ratios; the trigger stays below the hard input ceiling when one is known. */
export function compactionHysteresisConfigFor(
	contextWindow: number,
	settings: CompactionSettings,
	inputCeilingTokens?: number,
): CompactionHysteresisConfig | undefined {
	const threshold = getCompactionHeadroomThreshold(contextWindow, settings, inputCeilingTokens);
	if (!threshold) return undefined;
	const triggerRatio = Math.min(1, Math.max(1 / Math.floor(contextWindow), threshold.triggerTokens / contextWindow));
	const rearmRatio = Math.min(settings.rearmRatio ?? triggerRatio * 0.75, triggerRatio * 0.999);
	// A disarmed hysteresis compacts only at the emergency ratio: it must fire before admission rejects.
	const ceilingRatio =
		inputCeilingTokens !== undefined && Number.isSafeInteger(inputCeilingTokens) && inputCeilingTokens > 0
			? inputCeilingTokens / contextWindow
			: 1;
	const emergencyRatio = Math.max(triggerRatio, Math.min(settings.emergencyRatio ?? 0.98, ceilingRatio));
	return createCompactionHysteresisConfig({ rearmRatio, triggerRatio, emergencyRatio });
}

/**
 * Check if compaction should trigger based on context usage.
 */
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
	const threshold = getCompactionHeadroomThreshold(contextWindow, settings);
	return threshold !== undefined && Number.isFinite(contextTokens) && contextTokens >= threshold.triggerTokens;
}
