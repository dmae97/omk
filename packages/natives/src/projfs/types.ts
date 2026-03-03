/**
 * Types for Windows ProjFS-backed overlay lifecycle.
 */

/** Result for probing whether ProjFS can be used on this machine. */
export interface ProjfsOverlayProbeResult {
	available: boolean;
	reason?: string;
}

declare module "../bindings" {
	interface NativeBindings {
		/**
		 * Probe whether ProjFS APIs are available and loadable on the current machine.
		 */
		projfsOverlayProbe(): ProjfsOverlayProbeResult;

		/**
		 * Start a ProjFS-backed projection at `projectionRoot` serving files from `lowerRoot`.
		 */
		projfsOverlayStart(lowerRoot: string, projectionRoot: string): void;

		/**
		 * Stop a ProjFS-backed projection previously started at `projectionRoot`.
		 */
		projfsOverlayStop(projectionRoot: string): void;
	}
}
