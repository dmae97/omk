/**
 * Cross-extension gate: suppress near-duplicate / no-progress steers while a
 * finish-check verification turn is running. Exact-identical stop/warn stays active.
 *
 * The built-in finish-check does not call this: it emits `finish_check` on the
 * extension event bus and the identical-loop extension listens per instance.
 * This process-wide switch is only for callers outside the event bus (e.g. a
 * host that runs its own verification turn); prefer the event for new code.
 */
let suppressed = false;

export function setProgressStallSteerSuppressed(value: boolean): void {
	suppressed = value;
}

export function isProgressStallSteerSuppressed(): boolean {
	return suppressed;
}
