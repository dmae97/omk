/** When a single agent should read directly and when it should use the read-only explorer. */

export const EXPLORATION_THRESHOLDS = {
	/** Expected separate searches before exploration pays off. */
	minSearches: 2,
	/** Expected files to inspect before exploration pays off. */
	minFiles: 4,
	/** Main-context pressure that makes a compressed evidence pack preferable. */
	contextPressure: 0.7,
} as const;

export type ExplorationMode = "direct" | "explore";

export interface ExplorationDecision {
	readonly mode: ExplorationMode;
	readonly reason: string;
}

export interface ExplorationSignals {
	readonly expectedSearches?: number;
	readonly expectedFiles?: number;
	readonly contextPressure?: number;
}

/**
 * Decide automatically, with no subagent: narrow reads stay direct, broader or
 * context-pressured questions go through the in-process explorer.
 */
export function decideExploration(signals: ExplorationSignals): ExplorationDecision {
	const pressure = signals.contextPressure ?? 0;
	if (pressure >= EXPLORATION_THRESHOLDS.contextPressure) {
		return { mode: "explore", reason: `context pressure ${pressure} >= ${EXPLORATION_THRESHOLDS.contextPressure}` };
	}
	const searches = signals.expectedSearches ?? 0;
	if (searches >= EXPLORATION_THRESHOLDS.minSearches) {
		return { mode: "explore", reason: `expected ${searches} searches >= ${EXPLORATION_THRESHOLDS.minSearches}` };
	}
	const files = signals.expectedFiles ?? 0;
	if (files >= EXPLORATION_THRESHOLDS.minFiles) {
		return { mode: "explore", reason: `expected ${files} files >= ${EXPLORATION_THRESHOLDS.minFiles}` };
	}
	return { mode: "direct", reason: "narrow read: few searches, few files, low context pressure" };
}
