/**
 * Process tree management utilities for Bun subprocesses.
 *
 * Provides:
 * - Managed tracking of child subprocesses for cleanup on exit/signals.
 * - Windows and Unix support for proper tree killing.
 * - ChildProcess wrapper for capturing output, errors, and kill/detach.
 */
import { $, type FileSink, type Spawn, type Subprocess, spawn } from "bun";
import { postmortem } from ".";

// Platform detection: process tree kill behavior differs.
const isWindows = process.platform === "win32";

// Set of live children for managed termination/cleanup on shutdown.
const managedChildren = new Set<ChildProcess>();

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

	close(options?: { discard?: boolean }): void {
		if (this.#closed) {
			if (options?.discard) {
				this.#items = [];
			}
			return;
		}
		this.#closed = true;
		if (options?.discard) {
			this.#items = [];
		}
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
		return await new Promise<IteratorResult<T>>(resolve => {
			this.#resolvers.push(resolve);
		});
	}
}

function createProcessStream(queue: AsyncQueue<Uint8Array>, onCancel?: () => void): ReadableStream<Uint8Array> {
	const stream = new ReadableStream<Uint8Array>({
		pull: async controller => {
			const result = await queue.next();
			if (result.done) {
				controller.close();
				return;
			}
			controller.enqueue(result.value);
		},
		cancel: () => {
			onCancel?.();
			queue.close({ discard: true });
		},
	});
	return stream;
}

/**
 * Kill a child process and its descendents.
 * - Windows: uses taskkill for tree and forceful kill (/T /F)
 * - Unix: negative PID sends signal to process group (tree kill)
 */
async function killChild(child: ChildProcess) {
	const pid = child.pid;
	if (!pid || child.killed) return;

	const waitForExit = (timeout = 1000) =>
		Promise.race([
			Bun.sleep(timeout).then(() => false),
			child.proc.exited.then(
				() => true,
				() => true,
			),
		]);

	const sendSignal = async (signal?: NodeJS.Signals) => {
		try {
			child.proc.kill(signal);
		} catch {}

		if (child.isProcessGroup) {
			if (await waitForExit(1000)) return;

			try {
				if (isWindows) {
					// /T (tree), /F (force): ensure entire tree is killed.
					await $`taskkill ${signal === "SIGKILL" ? "/F" : ""} /T /PID ${pid}`.quiet().nothrow();
				} else {
					// Send signal to process group (negative PID).
					process.kill(-pid, signal);
				}
			} catch {}
		}
		return await waitForExit(1000);
	};

	if (await sendSignal()) return;
	await sendSignal("SIGKILL");
}

postmortem.register("managed-children", async () => {
	const children = Array.from(managedChildren);
	managedChildren.clear();
	await Promise.all(children.map(killChild));
});

// A Bun subprocess with stdin=Writable/ignore, stdout/stderr=pipe (for tracking/cleanup).
type PipedSubprocess = Subprocess<"pipe" | "ignore" | null, "pipe", "pipe">;

type StreamReadResult = { done: boolean; value: Uint8Array | undefined };

/**
 * Options for capturing process output as text.
 */
export interface CaptureTextOptions {
	/** Allow non-zero exit codes without throwing. */
	allowNonZero?: boolean;
	/** Allow abort/timeout without throwing. */
	allowAbort?: boolean;
	/** Select stderr source: full stream or bounded buffer. */
	stderr?: "full" | "buffer";
}

/**
 * Result from captureText/execText.
 */
export interface CaptureTextResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	ok: boolean;
	exitError?: Exception;
}

/**
 * ChildProcess wraps a managed subprocess, capturing output, errors, and providing
 * cross-platform kill/detach logic plus AbortSignal integration.
 */
export class ChildProcess {
	#nothrow = false;
	#stderrBuffer = "";
	#stdoutQueue = new AsyncQueue<Uint8Array>();
	#stderrQueue = new AsyncQueue<Uint8Array>();
	#stderrDone!: Promise<void>;
	#requestStreamStop: () => void;
	#stdoutActive = true;
	#stdoutStream?: ReadableStream<Uint8Array>;
	#stderrStream?: ReadableStream<Uint8Array>;
	#exitReason?: Exception;
	#exitReasonPending?: Exception;
	#exited: Promise<number>;

	constructor(
		public readonly proc: PipedSubprocess,
		public readonly isProcessGroup: boolean,
	) {
		const { promise: stopStreaming, resolve: resolveStopStreaming } = Promise.withResolvers<StreamReadResult>();
		this.#requestStreamStop = () => void resolveStopStreaming({ done: true, value: undefined });

		const { promise: stderrDone, resolve: resolveStderrDone } = Promise.withResolvers<void>();
		this.#stderrDone = stderrDone;

		// Capture stdout while active. Buffering starts enabled and is disabled when the
		// stream is cancelled. The underlying process stdout is always drained to prevent
		// the process from blocking on a full pipe buffer.
		void (async () => {
			const reader = proc.stdout.getReader();
			try {
				while (this.#stdoutActive) {
					const result = await Promise.race([reader.read(), stopStreaming]);
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
					const result = await Promise.race([reader.read(), stopStreaming]);
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
				resolveStderrDone();
			}
		})().catch(() => {
			this.#stderrQueue.close();
			resolveStderrDone();
		});

		const { promise, resolve, reject } = Promise.withResolvers<number>();
		this.#exited = promise;

		// On exit, resolve with a ChildError if nonzero code.
		if (this.proc.exitCode === null) {
			managedChildren.add(this);
		}
		proc.exited
			.catch(() => null)
			.then(async exitCode => {
				// If we have an exit reason pending (e.g., kill() was called), use it immediately.
				if (this.#exitReasonPending) {
					this.#exitReason = this.#exitReasonPending;
					reject(this.#exitReasonPending);
					return;
				}

				// If successful, resolve as 0.
				if (exitCode === 0) {
					resolve(0);
					return;
				}

				// Wait for stderr capture to complete before creating error with stderr content.
				await this.#stderrDone;

				let ex: Exception;
				if (exitCode !== null) {
					this.#exitReason = new NonZeroExitError(exitCode, this.#stderrBuffer);
					resolve(exitCode);
					return;
				} else if (this.proc.killed) {
					ex = new AbortError(new Error("process killed"), this.#stderrBuffer);
				} else {
					ex = new NonZeroExitError(-1, this.#stderrBuffer);
				}
				this.#exitReason = ex;
				reject(ex);
			})
			.finally(() => {
				managedChildren.delete(this);
			});
	}

	get pid(): number | undefined {
		return this.proc.pid;
	}
	get exited(): Promise<number> {
		return this.#exited;
	}
	get exitedCleanly(): Promise<number> {
		if (this.#nothrow) return this.exited;
		return this.exited.then(code => {
			if (code !== 0) {
				throw new NonZeroExitError(code, this.#stderrBuffer);
			}
			return code;
		});
	}
	get exitCode(): number | null {
		return this.proc.exitCode;
	}
	get exitReason(): Exception | undefined {
		return this.#exitReason;
	}
	get killed(): boolean {
		return this.proc.killed;
	}
	get stdin(): FileSink | undefined {
		return this.proc.stdin;
	}
	get stdout(): ReadableStream<Uint8Array> {
		if (!this.#stdoutStream) {
			this.#stdoutStream = createProcessStream(this.#stdoutQueue, () => {
				this.#stdoutActive = false;
			});
		}
		return this.#stdoutStream;
	}
	get stderr(): ReadableStream<Uint8Array> {
		if (!this.#stderrStream) {
			// stderr cancellation doesn't affect the internal buffer used for error context
			this.#stderrStream = createProcessStream(this.#stderrQueue, () => {});
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
	kill(reason?: Exception) {
		if (reason && !this.#exitReasonPending) {
			this.#exitReasonPending = reason;
		}
		this.#requestStreamStop();
		if (this.proc.killed) return;
		killChild(this);
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
			this.exitedCleanly.catch(reject);
		}
		blob.then(resolve, reject);
		return promise;
	}

	/**
	 * Capture stdout/stderr as text with optional exit handling.
	 */
	async captureText(options?: CaptureTextOptions): Promise<CaptureTextResult> {
		const stderrMode = options?.stderr ?? "buffer";
		const stdoutPromise = this.stdout.text();
		const stderrPromise =
			stderrMode === "full"
				? this.stderr.text()
				: (async () => {
						await Promise.allSettled([stdoutPromise, this.exited, this.#stderrDone]);
						return this.peekStderr();
					})();

		const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

		let exitError: Exception | undefined;
		try {
			await this.exited;
		} catch (err) {
			if (err instanceof Exception) {
				exitError = err;
			} else {
				throw err;
			}
		}

		const exitCode = this.exitCode ?? (exitError && !exitError.aborted ? exitError.exitCode : null);
		const ok = exitCode === 0;

		if (exitError) {
			const allowAbort = options?.allowAbort ?? false;
			const allowNonZero = options?.allowNonZero ?? false;
			if ((exitError.aborted && !allowAbort) || (!exitError.aborted && !allowNonZero)) {
				throw exitError;
			}
		}

		return { stdout, stderr, exitCode, ok, exitError };
	}

	/**
	 * Attach an AbortSignal to this process. Will kill tree with SIGKILL if aborted.
	 */
	attachSignal(signal: AbortSignal): void {
		const onAbort = () => {
			const cause = new AbortError(signal.reason, "<cancelled>");
			this.kill(cause);
		};
		if (signal.aborted) {
			return void onAbort();
		}
		signal.addEventListener("abort", onAbort, { once: true });
		// Use .finally().catch() to avoid unhandled rejection when #exited rejects
		this.#exited
			.catch(() => {})
			.finally(() => {
				signal.removeEventListener("abort", onAbort);
			});
	}

	/**
	 * Attach a timeout to this process. Will kill the process with SIGKILL if the timeout is reached.
	 */
	attachTimeout(timeout: number): void {
		if (timeout <= 0) return;
		if (this.proc.killed) return;
		void (async () => {
			const result = await Promise.race([
				Bun.sleep(timeout).then(() => true),
				this.proc.exited.then(
					() => false,
					() => false,
				),
			]);
			if (result) {
				this.kill(new TimeoutError(timeout, this.#stderrBuffer));
			}
		});
	}

	[Symbol.dispose](): void {
		this.kill(new AbortError("process disposed", this.#stderrBuffer));
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

function spawnManaged(
	cmd: string[],
	options: ChildSpawnOptions | undefined,
	config: { detached: boolean; processGroup: boolean },
): ChildProcess {
	const { timeout, ...rest } = options ?? {};
	const child = spawn(cmd, {
		stdin: "ignore",
		...rest,
		stdout: "pipe",
		stderr: "pipe",
		...(config.detached ? { detached: true } : {}),
	});
	const cproc = new ChildProcess(child, config.processGroup);
	if (options?.signal) {
		cproc.attachSignal(options.signal);
	}
	if (timeout && timeout > 0) {
		cproc.attachTimeout(timeout);
	}
	return cproc;
}

/**
 * Spawn a subprocess as a managed child process.
 * - Always pipes stdout/stderr, launches in new session/process group (detached).
 * - Optional AbortSignal integrates with kill-on-abort.
 */
export function spawnGroup(cmd: string[], options?: ChildSpawnOptions): ChildProcess {
	return spawnManaged(cmd, options, { detached: true, processGroup: true });
}

/**
 * Spawn a subprocess as a managed child process.
 * - Always pipes stdout/stderr, inherits the current session (not detached).
 * - Optional AbortSignal integrates with kill-on-abort.
 */
export function spawnAttached(cmd: string[], options?: ChildSpawnOptions): ChildProcess {
	return spawnManaged(cmd, options, { detached: false, processGroup: false });
}

/**
 * Options for execText.
 */
export interface ExecTextOptions extends Omit<ChildSpawnOptions, "stdin">, CaptureTextOptions {
	/** Spawn mode (process group or attached). */
	mode?: "group" | "attached";
	/** Input to write to stdin (Buffer or UTF-8 string). */
	input?: string | Buffer | Uint8Array;
}

function toStdinBuffer(input: string | Buffer | Uint8Array): Buffer {
	if (typeof input === "string") {
		return Buffer.from(input);
	}
	return Buffer.isBuffer(input) ? input : Buffer.from(input);
}

/**
 * Spawn a process and capture stdout/stderr as text.
 */
export async function execText(cmd: string[], options?: ExecTextOptions): Promise<CaptureTextResult> {
	const { mode = "attached", input, stderr, allowAbort, allowNonZero, ...spawnOptions } = options ?? {};
	const stdin = input === undefined ? undefined : toStdinBuffer(input);
	const resolvedOptions: ChildSpawnOptions = stdin === undefined ? { ...spawnOptions } : { ...spawnOptions, stdin };
	using child = mode === "group" ? spawnGroup(cmd, resolvedOptions) : spawnAttached(cmd, resolvedOptions);
	return await child.captureText({ stderr, allowAbort, allowNonZero });
}
