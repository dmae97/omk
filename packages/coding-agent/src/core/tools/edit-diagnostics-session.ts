/**
 * Spec 107 pre-registration: per-session `checkerRan` and checker versions for the run log.
 * State exists only when OMK_EDIT_DIAGNOSTICS is on or shadow; OFF writes nothing.
 */
import { appendRunLog, type RunLogValue } from "../run-log.ts";
import { type CheckerVersions, type FileDiagnosticsResult, probeCheckerVersions } from "./diagnostics-checkers.ts";

export type EditDiagnosticsMode = "off" | "on" | "shadow";

/** Once per session (process exit): `checkerRan` for the task. */
export const EDIT_DIAG_SESSION_LOG = "edit-diag-session";
/** Once per session: checker `--version` strings, probed after the first executed check. */
export const EDIT_DIAG_CHECKERS_LOG = "edit-diag-checkers";

type VersionProbe = (cwd: string) => Promise<CheckerVersions>;
let versionProbe: VersionProbe | undefined;

/** Test seam: replace the `--version` probe. Returns a restore function. */
export function setCheckerVersionProbeForTest(next: VersionProbe | undefined): () => void {
	const previous = versionProbe;
	versionProbe = next;
	return () => {
		versionProbe = previous;
	};
}

/**
 * Session-level state (one process = one task in bench runs). Only touched when the flag
 * is on or shadow, so OFF never registers the exit hook or writes any line.
 */
export interface SessionState {
	mode: EditDiagnosticsMode;
	checks: number;
	checkerRuns: number;
	versions: CheckerVersions | undefined;
	versionsPending: boolean;
	exitHook: (() => void) | undefined;
}
let session: SessionState | undefined;

export function sessionState(mode: EditDiagnosticsMode): SessionState {
	if (session) return session;
	const state: SessionState = {
		mode,
		checks: 0,
		checkerRuns: 0,
		versions: undefined,
		versionsPending: false,
		exitHook: undefined,
	};
	state.exitHook = () => {
		writeSessionLog(state);
	};
	process.once("exit", state.exitHook);
	session = state;
	return state;
}

function writeSessionLog(state: SessionState): Record<string, RunLogValue> {
	const record = {
		mode: state.mode === "shadow" ? "shadow" : "on",
		checkerRan: state.checkerRuns > 0,
		checks: state.checks,
		checkerRuns: state.checkerRuns,
		checkerVersions: state.versions ?? null,
	};
	appendRunLog(EDIT_DIAG_SESSION_LOG, record);
	return record;
}

/**
 * Write the `edit-diag-session` line now and reset the session state (the exit hook is
 * removed). Returns the record, or `undefined` when no checked edit happened (OFF).
 */
export function flushEditDiagnosticsSession(): Record<string, RunLogValue> | undefined {
	const state = session;
	if (!state) return undefined;
	session = undefined;
	if (state.exitHook) process.removeListener("exit", state.exitHook);
	return writeSessionLog(state);
}

export function probeVersionsOnce(state: SessionState, cwd: string, realCollector: boolean): void {
	if (state.versions || state.versionsPending) return;
	// A fake collector without a fake probe means a unit test: never spawn real binaries.
	const probe = versionProbe ?? (realCollector ? probeCheckerVersions : undefined);
	if (!probe) return;
	state.versionsPending = true;
	void probe(cwd)
		.then((versions) => {
			state.versions = versions;
			appendRunLog(EDIT_DIAG_CHECKERS_LOG, { mode: state.mode === "shadow" ? "shadow" : "on", ...versions });
		})
		.catch(() => {
			state.versionsPending = false;
		});
}

/** A check counts as executed when the checker process ran (completed or hit its deadline). */
export function checkerExecuted(result: FileDiagnosticsResult): boolean {
	return !result.skipped || result.timedOut === true;
}

/** Count one check for the session; true when the checker executed (then probe versions once). */
export function recordCheck(
	mode: EditDiagnosticsMode,
	result: FileDiagnosticsResult,
	cwd: string,
	realCollector: boolean,
): boolean {
	const state = sessionState(mode);
	state.checks++;
	if (!checkerExecuted(result)) return false;
	state.checkerRuns++;
	probeVersionsOnce(state, cwd, realCollector);
	return true;
}
