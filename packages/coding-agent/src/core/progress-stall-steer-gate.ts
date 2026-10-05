/**
 * Cross-extension gate: suppress near-duplicate / no-progress steers while a
 * finish-check verification turn is running. Exact-identical stop/warn stays active.
 *
 * Finish-check (when present) should call {@link setProgressStallSteerSuppressed}
 * around its verification turn; this package does not ship finish-check on main yet.
 */
let suppressed = false;

export function setProgressStallSteerSuppressed(value: boolean): void {
	suppressed = value;
}

export function isProgressStallSteerSuppressed(): boolean {
	return suppressed;
}
