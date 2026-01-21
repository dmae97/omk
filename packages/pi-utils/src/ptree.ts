/**
 * Process tree management utilities for Bun subprocesses.
 *
 * Provides:
 * - Managed tracking of child subprocesses for cleanup on exit/signals.
 * - Windows and Unix support for proper tree killing.
 * - ChildProcess wrapper for capturing output, errors, and kill/detach.
 */

import { type FileSink, type Spawn, type Subprocess, spawn, spawnSync } from "bun";
import { postmortem } from ".";

// Platform detection: process tree kill behavior differs.
const isWindows = process.platform === "win32";

// Set of live children for managed termination/cleanup on shutdown.
const managedChildren = new Set<PipedSubprocess>();

class AsyncQueue<T> {
	#items: T[] = [];
	#resolvers: Array<(result: IteratorResult<T>) => void> = [];
	#closed = false;

	push(item: T): void {
		if (this.#closed) return;
		const resolver = this.#resolvers.shift();
		if (resolver) {
			resolver({ value: item, done: false });
			return;
		}
		this.#items.push(item);
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		while (this.#resolvers.length > 0) {
			const resolver = this.#resolvers.shift();
			if (resolver) {
				resolver({ value: undefined, done: true });
			}
		}
	}

	async next(): Promise<IteratorResult<T>> {
		if (this.#items.length > 0) {
			return { value: this.#items.shift() as T, done: false };
		}
		if (this.#closed) {
			return { value: undefined, done: true };
		}
		return await new Promise<IteratorResult<T>>((resolve) => {
			this.#resolvers.push(resolve);
		});
	}
}

function createProcessStream(queue: AsyncQueue<Uint8Array>): ReadableStream<Uint8Array> {
	const stream = new ReadableStream<Uint8Array>({
		pull: async (controller) => {
			const result = await queue.next();
			if (result.done) {
				controller.close();
				return;
			}
			controller.enqueue(result.value);
		},
	});
	return stream;
}

/**
 * Kill a child process and its descendents.
 * - Windows: uses taskkill for tree and forceful kill (/T /F)
 * - Unix: negative PID sends signal to process group (tree kill)
 */
function killChild(child: PipedSubprocess, signal: NodeJS.Signals = "SIGTERM"): void {
	const pid = child.pid;
	if (!pid) return;

	try {
		if (isWindows) {
			// /T (tree), /F (force): ensure entire tree is killed.
			spawnSync(["taskkill", ...(signal === "SIGKILL" ? ["/F"] : []), "/T", "/PID", pid.toString()], {
				stdout: "ignore",
				stderr: "ignore",
				timeout: 1000,
			});
		} else {
			// Send signal to process group (negative PID).
			process.kill(-pid, signal);
		}

		// If killed, remove from managed set and clean up.
		if (child.killed) {
			managedChildren.delete(child);
			child.unref();
		}
	} catch {
		// Ignore: process may already be dead.
	}
}

postmortem.register("managed-children", () => {
	for (const child of [...managedChildren]) {
		killChild(child, "SIGKILL");
		managedChildren.delete(child);
	}
});

/**
 * Register a subprocess for managed cleanup.
 * Will attach to exit Promise so removal happens even if child exits "naturally".
 */
function registerManaged(child: PipedSubprocess): void {
	if (child.exitCode !== null) return;
	if (managedChildren.has(child)) return;
	child.ref();
	managedChildren.add(child);

	child.exited.then(() => {
		managedChildren.delete(child);
		child.unref();
	});
}

// A Bun subprocess with stdin=Writable/ignore, stdout/stderr=pipe (for tracking/cleanup).
type PipedSubprocess = Subprocess<"pipe" | "ignore" | null, "pipe", "pipe">;

/**
 * ChildProcess wraps a managed subprocess, capturing output, errors, and providing
 * cross-platform kill/detach logic plus AbortSignal integration.
 */
export class ChildProcess {
	#proc: PipedSubprocess;
	#detached = false;
	#nothrow = false;
	#stderrBuffer = "";
	#stdoutQueue = new AsyncQueue<Uint8Array>();
	#stderrQueue = new AsyncQueue<Uint8Array>();
	#stdoutStream?: ReadableStream<Uint8Array>;
	#stderrStream?: ReadableStream<Uint8Array>;
	#exitReason?: Exception;
	#exitReasonPending?: Exception;
	#exited: Promise<void>;
	#resolveExited: (ex?: PromiseLike<Exception> | Exception) => void;

	constructor(proc: PipedSubprocess) {
		registerManaged(proc);

		const exitSettled = proc.exited.then(
			() => {},
			() => {},
		);

		// Capture stdout at all times. Close the passthrough when the process exits.
		void (async () => {
			const reader = proc.stdout.getReader();
			try {
				while (true) {
					const result = await Promise.race([
						reader.read(),
						exitSettled.then(() => ({ done: true, value: undefined as Uint8Array | undefined })),
					]);
					if (result.done) break;
					if (!result.value) continue;
					this.#stdoutQueue.push(result.value);
				}
			} catch {
				// ignore
			} finally {
				try {
					await reader.cancel();
				} catch {}
				try {
					reader.releaseLock();
				} catch {}
				this.#stdoutQueue.close();
			}
		})().catch(() => {
			this.#stdoutQueue.close();
		});

		// Capture stderr at all times, with a capped buffer for errors.
		const decoder = new TextDecoder();
		void (async () => {
			const reader = proc.stderr.getReader();
			try {
				while (true) {
					const result = await Promise.race([
						reader.read(),
						exitSettled.then(() => ({ done: true, value: undefined as Uint8Array | undefined })),
					]);
					if (result.done) break;
					if (!result.value) continue;
					this.#stderrQueue.push(result.value);
					this.#stderrBuffer += decoder.decode(result.value, { stream: true });
					if (this.#stderrBuffer.length > NonZeroExitError.MAX_TRACE) {
						this.#stderrBuffer = this.#stderrBuffer.slice(-NonZeroExitError.MAX_TRACE);
					}
				}
			} catch {
				// ignore
			} finally {
				this.#stderrBuffer += decoder.decode();
				if (this.#stderrBuffer.length > NonZeroExitError.MAX_TRACE) {
					this.#stderrBuffer = this.#stderrBuffer.slice(-NonZeroExitError.MAX_TRACE);
				}
				try {
					await reader.cancel();
				} catch {}
				try {
					reader.releaseLock();
				} catch {}
				this.#stderrQueue.close();
			}
		})().catch(() => {
			this.#stderrQueue.close();
		});

		const { promise, resolve } = Promise.withResolvers<Exception | undefined>();

		this.#exited = promise.then((ex?: Exception) => {
			if (!ex) return; // success, no exception
			if (proc.killed && this.#exitReasonPending) {
				ex = this.#exitReasonPending; // propagate reason if killed
			}
			this.#exitReason = ex;
			return Promise.reject(ex);
		});
		this.#resolveExited = resolve;

		// On exit, resolve with a ChildError if nonzero code.
		proc.exited.then((exitCode) => {
			if (exitCode !== 0) {
				resolve(new NonZeroExitError(exitCode, this.#stderrBuffer));
			} else {
				resolve(undefined);
			}
		});

		this.#proc = proc;
	}

	get pid(): number | undefined {
		return this.#proc.pid;
	}
	get exited(): Promise<void> {
		return this.#exited;
	}
	get exitCode(): number | null {
		return this.#proc.exitCode;
	}
	get exitReason(): Exception | undefined {
		return this.#exitReason;
	}
	get killed(): boolean {
		return this.#proc.killed;
	}
	get stdin(): FileSink | undefined {
		return this.#proc.stdin;
	}
	get stdout(): ReadableStream<Uint8Array> {
		if (!this.#stdoutStream) {
			this.#stdoutStream = createProcessStream(this.#stdoutQueue);
		}
		return this.#stdoutStream;
	}
	get stderr(): ReadableStream<Uint8Array> {
		if (!this.#stderrStream) {
			this.#stderrStream = createProcessStream(this.#stderrQueue);
		}
		return this.#stderrStream;
	}

	/**
	 * Peek at the stderr buffer.
	 * @returns The stderr buffer.
	 */
	peekStderr(): string {
		return this.#stderrBuffer;
	}

	/**
	 * Detach this process from management (no cleanup on shutdown).
	 */
	detach(): void {
		if (this.#detached || this.#proc.killed) return;
		this.#detached = true;
		if (managedChildren.delete(this.#proc)) {
			this.#proc.unref();
		}
	}

	/**
	 * Prevents thrown ChildError on nonzero exit code, for optional error handling.
	 */
	nothrow(): this {
		this.#nothrow = true;
		return this;
	}

	/**
	 * Kill the process tree.
	 * Optionally set an exit reason (for better error propagation on cancellation).
	 */
	kill(signal: NodeJS.Signals = "SIGTERM", reason?: Exception) {
		if (this.#proc.killed) return;
		if (reason) {
			this.#exitReasonPending = reason;
		}
		killChild(this.#proc, signal);
	}

	async killAndWait(): Promise<void> {
		// Try killing with SIGTERM, then SIGKILL if it doesn't exit within 1 second
		this.kill("SIGTERM");
		const exitedOrTimeout = await Promise.race([
			this.exited.then(() => "exited" as const),
			Bun.sleep(1000).then(() => "timeout" as const),
		]);
		if (exitedOrTimeout === "timeout") {
			this.kill("SIGKILL");
			await this.exited.catch(() => {});
		}
	}

	// Output utilities (aliases for easy chaining)
	async text(): Promise<string> {
		return (await this.blob()).text();
	}
	async json(): Promise<unknown> {
		return (await this.blob()).json();
	}
	async arrayBuffer(): Promise<ArrayBuffer> {
		return (await this.blob()).arrayBuffer();
	}
	async bytes() {
		return (await this.blob()).bytes();
	}
	async blob() {
		const { promise, resolve, reject } = Promise.withResolvers<Blob>();

		const blob = this.stdout.blob();
		if (!this.#nothrow) {
			this.#exited.catch((ex: Exception) => {
				reject(ex);
			});
		}
		blob.then(resolve, reject);
		return promise;
	}

	/**
	 * Attach an AbortSignal to this process. Will kill tree with SIGKILL if aborted.
	 */
	attachSignal(signal: AbortSignal): void {
		const onAbort = () => {
			const cause = new AbortError(signal.reason, "<cancelled>");
			this.kill("SIGKILL", cause);
			if (this.#proc.killed) {
				queueMicrotask(() => {
					try {
						this.#resolveExited(cause);
					} catch {
						// Ignore
					}
				});
			}
		};
		if (signal.aborted) {
			return void onAbort();
		}
		signal.addEventListener("abort", onAbort, { once: true });
		// Use .finally().catch() to avoid unhandled rejection when #exited rejects
		this.#exited
			.finally(() => {
				signal.removeEventListener("abort", onAbort);
			})
			.catch(() => {});
	}

	/**
	 * Attach a timeout to this process. Will kill the process with SIGKILL if the timeout is reached.
	 */
	attachTimeout(timeout: number): void {
		if (timeout <= 0) return;
		const timeoutId = setTimeout(() => {
			this.kill("SIGKILL", new TimeoutError(timeout, this.#stderrBuffer));
		}, timeout);
		// Use .finally().catch() to avoid unhandled rejection when #exited rejects
		this.#exited
			.finally(() => {
				clearTimeout(timeoutId);
			})
			.catch(() => {});
	}
}

/**
 * Base for all exceptions representing child process nonzero exit, killed, or cancellation.
 */
export abstract class Exception extends Error {
	constructor(
		message: string,
		public readonly exitCode: number,
		public readonly stderr: string,
	) {
		super(message);
		this.name = this.constructor.name;
	}
	abstract get aborted(): boolean;
}

/**
 * Exception for nonzero exit codes (not cancellation).
 */
export class NonZeroExitError extends Exception {
	static readonly MAX_TRACE = 32 * 1024;

	constructor(
		public readonly exitCode: number,
		public readonly stderr: string,
	) {
		super(`Process exited with code ${exitCode}:\n${stderr}`, exitCode, stderr);
	}
	get aborted(): boolean {
		return false;
	}
}

/**
 * Exception for explicit process abortion (via signal).
 */
export class AbortError extends Exception {
	constructor(
		public readonly reason: unknown,
		stderr: string,
	) {
		const reasonString = reason instanceof Error ? reason.message : String(reason ?? "aborted");
		super(`Operation cancelled: ${reasonString}`, -1, stderr);
	}
	get aborted(): boolean {
		return true;
	}
}

/**
 * Exception for process timeout.
 */
export class TimeoutError extends AbortError {
	constructor(timeout: number, stderr: string) {
		super(new Error(`Timed out after ${Math.round(timeout / 1000)}s`), stderr);
	}
}

/**
 * Options for cspawn (child spawn). Always pipes stdout/stderr, allows signal.
 */
type ChildSpawnOptions = Omit<
	Spawn.SpawnOptions<"pipe" | "ignore" | Buffer | null, "pipe", "pipe">,
	"stdout" | "stderr"
> & {
	signal?: AbortSignal;
};

/**
 * Spawn a subprocess as a managed child process.
 * - Always pipes stdout/stderr, launches in new session/process group (detached).
 * - Optional AbortSignal integrates with kill-on-abort.
 */
export function cspawn(cmd: string[], options?: ChildSpawnOptions): ChildProcess {
	const { timeout, ...rest } = options ?? {};
	const child = spawn(cmd, {
		stdin: "ignore",
		...rest,
		stdout: "pipe",
		stderr: "pipe",
		// Windows: new console/pgroup; Unix: setsid for process group.
		detached: true,
	});
	const cproc = new ChildProcess(child);
	if (options?.signal) {
		cproc.attachSignal(options.signal);
	}
	if (timeout && timeout > 0) {
		cproc.attachTimeout(timeout);
	}
	return cproc;
}
