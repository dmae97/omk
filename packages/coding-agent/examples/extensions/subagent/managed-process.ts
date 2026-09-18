import {
	type ChildProcessByStdio,
	type SpawnOptionsWithStdioTuple,
	type StdioNull,
	type StdioPipe,
	spawn,
} from "node:child_process";
import type { Readable } from "node:stream";
import { processGroupState, signalProcessTree } from "./managed-process-tree.ts";

type ManagedChild = ChildProcessByStdio<null, Readable, Readable>;
type ManagedSpawnOptions = SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>;

export type ManagedProcessReason = "completed" | "cutoff" | "aborted" | "spawn-error" | "signal" | "callback-error";

export interface ManagedProcessCleanup {
	readonly termSent: boolean;
	readonly killSent: boolean;
	readonly processGroup: boolean;
}

export interface ManagedProcessResult {
	readonly pid: number;
	readonly exitCode: number;
	readonly signal: NodeJS.Signals | null;
	readonly reason: ManagedProcessReason;
	readonly elapsedMs: number;
	readonly cleanup: ManagedProcessCleanup;
	/** Snapshot at response time. False means the owner must retain its reservation. */
	readonly terminationObserved: boolean;
	/** Resolves only on confirmed termination or confirmed failure to start, never on a timeout. */
	readonly settlement: Promise<void>;
	readonly errorMessage?: string;
}

export interface RunManagedProcessOptions {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly cutoffMs: number;
	readonly terminationGraceMs?: number;
	readonly forceSettleMs?: number;
	readonly signal?: AbortSignal;
	readonly onStdout?: (chunk: string) => void;
	readonly onStderr?: (chunk: string) => void;
	readonly spawnProcess?: (command: string, args: readonly string[], options: ManagedSpawnOptions) => ManagedChild;
}

export async function runManagedProcess(options: RunManagedProcessOptions): Promise<ManagedProcessResult> {
	const startedAtMs = performance.now();
	const processGroup = process.platform !== "win32";
	if (options.signal?.aborted) return withoutChild("aborted", startedAtMs, processGroup);
	let child: ManagedChild;
	try {
		child = (options.spawnProcess ?? defaultSpawn)(options.command, options.args, {
			cwd: options.cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			detached: processGroup,
			windowsHide: true,
		});
	} catch (error) {
		return withoutChild(
			"spawn-error",
			startedAtMs,
			processGroup,
			error instanceof Error ? error.message : String(error),
		);
	}
	const pid = child.pid ?? -1;
	let confirmSettlement: () => void = () => {};
	const settlement = new Promise<void>((resolve) => {
		confirmSettlement = resolve;
	});

	return await new Promise<ManagedProcessResult>((resolve) => {
		let responded = false;
		let terminated = false;
		let closeObserved = false;
		let exitCode: number | null = null;
		let processSignal: NodeJS.Signals | null = null;
		let reason: ManagedProcessReason = "completed";
		let errorMessage: string | undefined;
		let termSent = false;
		let killSent = false;
		let cutoffTimer: NodeJS.Timeout | undefined;
		let escalationTimer: NodeJS.Timeout | undefined;
		let responseTimer: NodeJS.Timeout | undefined;
		let observationTimer: NodeJS.Timeout | undefined;

		const respond = (): void => {
			if (responded) return;
			responded = true;
			if (cutoffTimer) clearTimeout(cutoffTimer);
			if (responseTimer) clearTimeout(responseTimer);
			options.signal?.removeEventListener("abort", onAbort);
			child.stdout.destroy();
			child.stderr.destroy();
			resolve({
				pid,
				exitCode: normalizeExitCode(exitCode, reason, processSignal, terminated),
				signal: processSignal,
				reason,
				elapsedMs: performance.now() - startedAtMs,
				cleanup: { termSent, killSent, processGroup },
				terminationObserved: terminated,
				settlement,
				...(errorMessage === undefined ? {} : { errorMessage }),
			});
		};
		const confirm = (): void => {
			if (terminated) return;
			terminated = true;
			if (escalationTimer) clearTimeout(escalationTimer);
			if (observationTimer) clearTimeout(observationTimer);
			confirmSettlement();
			respond();
		};
		const observe = (): void => {
			if (terminated || !closeObserved) return;
			if (processGroupState(pid) === "gone") {
				confirm();
				return;
			}
			// After the cleanup deadline only observe: never send late signals to a reused PID.
			observationTimer = setTimeout(observe, 25);
			observationTimer.unref();
		};
		const startCleanup = (): void => {
			if (terminated || termSent) return;
			termSent = true;
			signalProcessTree(child, "SIGTERM", processGroup);
			const graceMs = Math.max(0, options.terminationGraceMs ?? 1_500);
			escalationTimer = setTimeout(() => {
				if (terminated) return;
				killSent = true;
				signalProcessTree(child, "SIGKILL", processGroup);
			}, graceMs);
			responseTimer = setTimeout(respond, graceMs + Math.max(1, options.forceSettleMs ?? 2_000));
		};
		const requestTermination = (nextReason: ManagedProcessReason): void => {
			if (responded || terminated) return;
			if (reason === "completed") reason = nextReason;
			startCleanup();
		};
		function onAbort(): void {
			requestTermination("aborted");
		}
		const deliver = (callback: ((chunk: string) => void) | undefined, chunk: string): void => {
			if (responded || reason === "callback-error") return;
			try {
				callback?.(chunk);
			} catch {
				errorMessage = "process.output_callback_failed";
				requestTermination("callback-error");
			}
		};
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => deliver(options.onStdout, chunk));
		child.stderr.on("data", (chunk: string) => deliver(options.onStderr, chunk));
		child.on("error", (error: Error) => {
			if (terminated) return;
			errorMessage = error.message;
			if (pid < 1) {
				reason = "spawn-error";
				confirm();
			} else requestTermination("spawn-error");
		});
		child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
			closeObserved = true;
			exitCode = code;
			processSignal = signal;
			if (reason === "completed" && signal !== null) reason = "signal";
			if (processGroupState(pid) !== "gone" && !responded) startCleanup();
			observe();
		});
		if (options.cutoffMs > 0) cutoffTimer = setTimeout(() => requestTermination("cutoff"), options.cutoffMs);
		if (options.signal?.aborted) onAbort();
		else options.signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function withoutChild(
	reason: "aborted" | "spawn-error",
	startedAtMs: number,
	processGroup: boolean,
	errorMessage?: string,
): ManagedProcessResult {
	return {
		pid: -1,
		exitCode: reason === "aborted" ? 130 : 1,
		signal: null,
		reason,
		elapsedMs: performance.now() - startedAtMs,
		cleanup: { termSent: false, killSent: false, processGroup },
		terminationObserved: true,
		settlement: Promise.resolve(),
		...(errorMessage === undefined ? {} : { errorMessage }),
	};
}

function defaultSpawn(command: string, args: readonly string[], options: ManagedSpawnOptions): ManagedChild {
	return spawn(command, [...args], options);
}

function normalizeExitCode(
	exitCode: number | null,
	reason: ManagedProcessReason,
	signal: NodeJS.Signals | null,
	terminated: boolean,
): number {
	if (reason === "cutoff") return 124;
	if (reason === "aborted") return 130;
	if (!terminated || signal !== null || reason !== "completed") return exitCode || 1;
	return exitCode ?? 1;
}
