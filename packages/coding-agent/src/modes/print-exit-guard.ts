/**
 * Print-mode exit guard.
 *
 * `omk -p` returns from `main()` after the answer is written and the runtime is
 * disposed, leaving Node to exit once the event loop drains. A stray ref'd
 * handle (an unclosed socket, child process, or timer) would otherwise keep a
 * finished headless run alive until an outer timeout kills it. This guard arms
 * an unref'd timer: it never fires when the loop drains normally, and when the
 * process is still held after the grace period it reports the active resources
 * on stderr and exits with the run's exit code.
 */

export const DEFAULT_PRINT_EXIT_GRACE_MS = 2_000;
export const PRINT_EXIT_GRACE_ENV = "OMK_PRINT_EXIT_GRACE_MS";

interface UnrefableTimer {
	unref(): unknown;
}

export interface PrintExitGuardDeps {
	env?: Readonly<Record<string, string | undefined>>;
	setTimer?: (callback: () => void, ms: number) => UnrefableTimer;
	getActiveResources?: () => readonly string[];
	writeStderr?: (text: string) => void;
	exit?: (code: number) => void;
}

/** Grace period in ms; `0` disables the guard. Invalid values fall back to the default. */
export function resolvePrintExitGraceMs(env: Readonly<Record<string, string | undefined>>): number {
	const raw = env[PRINT_EXIT_GRACE_ENV]?.trim();
	if (!raw) return DEFAULT_PRINT_EXIT_GRACE_MS;
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0) return DEFAULT_PRINT_EXIT_GRACE_MS;
	return Math.floor(value);
}

/** Counts active resources by kind, e.g. `TCPSocketWrap x1, ProcessWrap x1`. */
export function summarizeActiveResources(resources: readonly string[]): string {
	const counts = new Map<string, number>();
	for (const resource of resources) {
		counts.set(resource, (counts.get(resource) ?? 0) + 1);
	}
	if (counts.size === 0) return "none reported";
	return [...counts.entries()].map(([name, count]) => `${name} x${count}`).join(", ");
}

/** Records the print-mode exit code and arms the unref'd forced-exit timer. */
export function settlePrintModeExit(exitCode: number, deps: PrintExitGuardDeps = {}): void {
	if (exitCode !== 0) {
		process.exitCode = exitCode;
	}
	const graceMs = resolvePrintExitGraceMs(deps.env ?? process.env);
	if (graceMs === 0) return;
	const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
	const getActiveResources = deps.getActiveResources ?? (() => process.getActiveResourcesInfo());
	const writeStderr = deps.writeStderr ?? ((text: string) => process.stderr.write(text));
	const exit = deps.exit ?? ((code: number) => process.exit(code));
	const timer = setTimer(() => {
		const held = getActiveResources().filter((resource) => resource !== "Timeout");
		writeStderr(
			`omk: print mode finished but the process was still held open after ${graceMs}ms ` +
				`(${summarizeActiveResources(held)}); exiting with code ${exitCode}.\n`,
		);
		exit(exitCode);
	}, graceMs);
	timer.unref();
}
