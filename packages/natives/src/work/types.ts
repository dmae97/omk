/**
 * Types for work scheduling profiling.
 */

/**
 * Profiling results from work scheduling instrumentation.
 */
export interface WorkProfile {
	/** Folded stack format for flamegraph tools. */
	folded: string;
	/** Markdown summary of profiling results. */
	summary: string;
	/** SVG flamegraph (if generation succeeded). */
	svg: string | null;
	/** Total work time in milliseconds. */
	totalMs: number;
	/** Number of samples collected. */
	sampleCount: number;
}

declare module "../bindings" {
	interface NativeBindings {
		/**
		 * Get work profile data from the last N seconds.
		 *
		 * Always-on profiling - samples are collected into a circular buffer.
		 * Call this to retrieve recent activity.
		 */
		getWorkProfile(lastSeconds: number): WorkProfile;
	}
}
