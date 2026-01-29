/**
 * Process tree management utilities for Bun subprocesses.
 *
 * Exposes the same public interface as the original implementation, but with
 * much less code:
 * - Track managed child processes for cleanup on shutdown (postmortem).
 * - Drain stdout/stderr to avoid subprocess pipe deadlocks.
 * - Cross-platform tree kill for process groups (Windows taskkill, Unix -pid).
 * - Convenience helpers: captureText / execText, AbortSignal, timeouts.
 */
import { $, type FileSink, type Spawn, type Subprocess } from "bun";
import { postmortem } from ".";

const isWindows = process.platform === "win32";
const managedChildren = new Set<ChildProcess>();

/** A Bun subprocess with stdout/stderr always piped (stdin may vary). */
type PipedSubprocess = Subprocess<"pipe" | "ignore" | null, "pipe", "pipe">;

/** Minimal push-based ReadableStream that buffers unboundedly (like the old queue). */
function pushStream<T>() {
	let controller!: ReadableStreamDefaultController<T>;
	let closed = false;

	const stream = new ReadableStream<T>({
		start(c) {
			controller = c;
		},
		cancel() {
			closed = true; // consumer no longer cares; keep draining but drop
		},
	});

	return {
		stream,
		push(value: T) {
			if (closed) return;
			try {
				controller.enqueue(value);
			} catch {
				closed = true;
			}
		},
		close() {
			if (closed) return;
			closed = true;
			try {
				controller.close();
			} catch {}
		},
	};
}

const DONE = { done: true, value: undefined } as const;

function abortRead(signal: AbortSignal) {
	if (signal.aborted) return Promise.resolve(DONE);
	const { promise, resolve } = Promise.withResolvers<typeof DONE>();
	signal.addEventListener("abort", () => resolve(DONE), { once: true });
	return promise;
}

/** Drain a ReadableStream into a pushStream, optionally tapping each chunk. */
async function pump(
	src: ReadableStream<Uint8Array>,
	dst: ReturnType<typeof pushStream<Uint8Array>>,
	opts?: { signal?: AbortSignal; onChunk?: (chunk: Uint8Array) => void; onFinally?: () => void },
) {
	const reader = src.getReader();
	const stop = opts?.signal ? abortRead(opts.signal) : null;

	try {
		while (true) {
			const r = stop ? await Promise.race([reader.read(), stop]) : await reader.read();
			if (r.done) break;
			if (!r.value) continue;
			opts?.onChunk?.(r.value);
			dst.push(r.value);
		}
	} catch {
		// ignore; this module is "best effort" for streaming/cleanup
	} finally {
		try {
			await reader.cancel();
		} catch {}
		try {
			reader.releaseLock();
		} catch {}
		dst.close();
		opts?.onFinally?.();
	}
}

/**
 * Kill a child process and its descendents.
 * - Windows: taskkill /T, add /F on SIGKILL
 * - Unix: negative PID signals the process group
 */
async function killChild(child: ChildProcess) {
	const pid = child.pid;
	if (!pid || child.killed) return;

	const exited = child.proc.exited.then(
		() => true,
		() => true,
	);
	const waitForExit = (timeout = 1000) => Promise.race([Bun.sleep(timeout).then(() => false), exited]);

	// Give it a moment to exit gracefully first.
	try {
		child.proc.kill();
	} catch {}
	if (await waitForExit(1000)) return true;

	if (child.isProcessGroup) {
		try {
			if (isWindows) {
				await $`taskkill /F /T /PID ${pid}`.quiet().nothrow();
			} else {
				process.kill(-pid);
			}
		} catch {}
	}
	try {
		child.proc.kill("SIGKILL");
	} catch {}

	return await waitForExit(1000);
}

postmortem.register("managed-children", async () => {
	const children = Array.from(managedChildren);
	managedChildren.clear();
	await Promise.all(children.map(killChild));
});

/**
 * Options for waiting for process exit and capturing output.
 */
export interface WaitOptions {
	allowNonZero?: boolean;
	allowAbort?: boolean;
	stderr?: "full" | "buffer";
}

/**
 * Result from wait and captureText.
 */
export interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	ok: boolean;
	exitError?: Exception;
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
 * ChildProcess wraps a managed subprocess, capturing stderr tail, providing
 * cross-platform kill/detach logic plus AbortSignal integration.
 */
export class ChildProcess {
	#nothrow = false;

	#stderrBuffer = "";
	#exitReason?: Exception;
	#exitReasonPending?: Exception;

	#stop = new AbortController();

	#stdoutOut = pushStream<Uint8Array>();
	#stderrOut = pushStream<Uint8Array>();

	#stderrDone: Promise<void>;
	#exited: Promise<number>;

	constructor(
		public readonly proc: PipedSubprocess,
		public readonly isProcessGroup: boolean,
	) {
		const { promise: stderrDone, resolve: resolveStderrDone } = Promise.withResolvers<void>();
		this.#stderrDone = stderrDone;

		// Drain stdout always -> expose our buffered stream to the user.
		void pump(proc.stdout, this.#stdoutOut, { signal: this.#stop.signal }).catch(() => this.#stdoutOut.close());

		// Drain stderr always -> expose stream + keep a bounded tail buffer.
		const decoder = new TextDecoder();
		const trim = () => {
			if (this.#stderrBuffer.length > NonZeroExitError.MAX_TRACE) {
				this.#stderrBuffer = this.#stderrBuffer.slice(-NonZeroExitError.MAX_TRACE);
			}
		};
		void pump(proc.stderr, this.#stderrOut, {
			signal: this.#stop.signal,
			onChunk: chunk => {
				this.#stderrBuffer += decoder.decode(chunk, { stream: true });
				trim();
			},
			onFinally: () => {
				this.#stderrBuffer += decoder.decode();
				trim();
				resolveStderrDone();
			},
		}).catch(() => {
			try {
				this.#stderrBuffer += decoder.decode();
				trim();
			} catch {}
			this.#stderrOut.close();
			resolveStderrDone();
		});

		const { promise, resolve, reject } = Promise.withResolvers<number>();
		this.#exited = promise;

		if (this.proc.exitCode === null) managedChildren.add(this);

		// Normalize Bun's exited promise into our "exitReason / exitedCleanly" model.
		proc.exited
			.catch(() => null)
			.then(async exitCode => {
				if (this.#exitReasonPending) {
					this.#exitReason = this.#exitReasonPending;
					reject(this.#exitReasonPending);
					return;
				}

				if (exitCode === 0) {
					resolve(0);
					return;
				}

				await this.#stderrDone;

				if (exitCode !== null) {
					this.#exitReason = new NonZeroExitError(exitCode, this.#stderrBuffer);
					resolve(exitCode);
					return;
				}

				const ex = this.proc.killed
					? new AbortError(new Error("process killed"), this.#stderrBuffer)
					: new NonZeroExitError(-1, this.#stderrBuffer);

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
			if (code !== 0) throw new NonZeroExitError(code, this.#stderrBuffer);
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
		return this.#stdoutOut.stream;
	}
	get stderr(): ReadableStream<Uint8Array> {
		return this.#stderrOut.stream;
	}

	peekStderr(): string {
		return this.#stderrBuffer;
	}

	nothrow(): this {
		this.#nothrow = true;
		return this;
	}

	kill(reason?: Exception) {
		if (reason && !this.#exitReasonPending) this.#exitReasonPending = reason;
		this.#stop.abort();
		if (this.proc.killed) return;
		void killChild(this);
	}

	// Output helpers
	async blob(): Promise<Blob> {
		const blobPromise = new Response(this.stdout).blob();
		if (this.#nothrow) return await blobPromise;
		const [blob] = await Promise.all([blobPromise, this.exitedCleanly]);
		return blob;
	}
	async text(): Promise<string> {
		return (await this.blob()).text();
	}
	async json(): Promise<unknown> {
		return await new Response(await this.blob()).json();
	}
	async arrayBuffer(): Promise<ArrayBuffer> {
		return (await this.blob()).arrayBuffer();
	}
	async bytes(): Promise<Uint8Array> {
		return new Uint8Array(await this.arrayBuffer());
	}

	async wait(options?: WaitOptions): Promise<ExecResult> {
		const { allowNonZero = false, allowAbort = false, stderr: stderrMode = "buffer" } = options ?? {};

		const stdoutPromise = new Response(this.stdout).text();
		const stderrPromise =
			stderrMode === "full"
				? new Response(this.stderr).text()
				: (async () => {
						await Promise.allSettled([stdoutPromise, this.exited, this.#stderrDone]);
						return this.peekStderr();
					})();

		const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

		let exitError: Exception | undefined;
		try {
			await this.exited;
		} catch (err) {
			if (err instanceof Exception) exitError = err;
			else throw err;
		}

		const exitCode = this.exitCode ?? (exitError && !exitError.aborted ? exitError.exitCode : null);
		const ok = exitCode === 0;

		if (exitError) {
			if ((exitError.aborted && !allowAbort) || (!exitError.aborted && !allowNonZero)) {
				throw exitError;
			}
		}

		return { stdout, stderr, exitCode, ok, exitError };
	}

	attachSignal(signal: AbortSignal): void {
		const onAbort = () => this.kill(new AbortError(signal.reason, "<cancelled>"));
		if (signal.aborted) return void onAbort();

		signal.addEventListener("abort", onAbort, { once: true });
		this.#exited
			.catch(() => {})
			.finally(() => {
				signal.removeEventListener("abort", onAbort);
			});
	}

	attachTimeout(timeout: number): void {
		if (timeout <= 0 || this.proc.killed) return;
		void (async () => {
			const timedOut = await Promise.race([
				Bun.sleep(timeout).then(() => true),
				this.proc.exited.then(
					() => false,
					() => false,
				),
			]);
			if (timedOut) this.kill(new TimeoutError(timeout, this.#stderrBuffer));
		})();
	}

	[Symbol.dispose](): void {
		this.kill(new AbortError("process disposed", this.#stderrBuffer));
	}
}

/**
 * Options for cspawn (child spawn). Always pipes stdout/stderr, allows signal.
 */
type ChildSpawnOptions = Omit<
	Spawn.SpawnOptions<"pipe" | "ignore" | Buffer | Uint8Array | null, "pipe", "pipe">,
	"stdout" | "stderr"
> & { signal?: AbortSignal; detached?: boolean };

/**
 * Spawn a child process.
 * @param cmd - The command to spawn.
 * @param options - The options for the spawn.
 * @returns A ChildProcess instance.
 */
export function spawn(cmd: string[], options?: ChildSpawnOptions): ChildProcess {
	const { detached = false, timeout, signal, ...rest } = options ?? {};
	const child = Bun.spawn(cmd, {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		detached,
		...rest,
	});
	const cproc = new ChildProcess(child, detached);
	if (signal) cproc.attachSignal(signal);
	if (timeout && timeout > 0) cproc.attachTimeout(timeout);
	return cproc;
}

/**
 * Options for execText.
 */
export interface ExecOptions extends Omit<ChildSpawnOptions, "stdin">, WaitOptions {
	input?: string | Buffer | Uint8Array;
}

export async function exec(cmd: string[], options?: ExecOptions): Promise<ExecResult> {
	const { input, stderr, allowAbort, allowNonZero, ...spawnOptions } = options ?? {};
	const stdin = typeof input === "string" ? Buffer.from(input) : input;
	const resolvedOptions: ChildSpawnOptions = stdin === undefined ? { ...spawnOptions } : { ...spawnOptions, stdin };
	using child = spawn(cmd, resolvedOptions);
	return await child.wait({ stderr, allowAbort, allowNonZero });
}
