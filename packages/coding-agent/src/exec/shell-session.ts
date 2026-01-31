/**
 * Persistent shell session executor for streaming bash tool output.
 */
import * as crypto from "node:crypto";
import { logger, postmortem, ptree } from "@oh-my-pi/pi-utils";
import { OutputSink, type OutputSummary } from "../session/streaming-output";

export interface ShellSessionConfig {
	shell: string;
	env: Record<string, string | undefined>;
	prefix?: string;
	snapshotPath: string | null;
}

export interface ShellCommandOptions {
	cwd?: string;
	timeout?: number;
	signal?: AbortSignal;
	onChunk?: (chunk: string) => void;
	env?: Record<string, string>;
	artifactPath?: string;
	artifactId?: string;
}

export interface ShellCommandResult extends OutputSummary {
	exitCode: number | undefined;
	cancelled: boolean;
}

const MARKER_PREFIX = "__OMP_CMD_DONE__";
const MARKER_TAIL_MAX = 128;
const ABORT_GRACE_MS = 1500;
const IS_WINDOWS = process.platform === "win32";

interface RunningCommand {
	marker: string;
	markerSentinel: string;
	sink: OutputSink;
	resolve: (result: ShellCommandResult) => void;
	done: Promise<ShellCommandResult>;
	cancelled: boolean;
	abortReason?: "timeout" | "signal";
	abortNotice?: string;
	abortListener?: () => void;
	completed: boolean;
}

function escapePosix(value: string): string {
	return `'${value.split("'").join("'\"'\"'")}'`;
}

function isFishShell(shell: string): boolean {
	return shell.includes("fish");
}

function buildEnvExports(env: Record<string, string> | undefined, fish: boolean): string {
	if (!env) return "";
	const entries = Object.entries(env).filter(([, value]) => value !== undefined);
	if (entries.length === 0) return "";
	if (fish) {
		return entries.map(([key, value]) => `set -lx ${key} ${escapePosix(value)}`).join("\n");
	}
	return entries.map(([key, value]) => `export ${key}=${escapePosix(value)}`).join("\n");
}

function buildPosixCommandScript(
	command: string,
	cwd: string | undefined,
	prefix: string | undefined,
	marker: string,
	commandEnv: Record<string, string> | undefined,
): string {
	const envExports = buildEnvExports(commandEnv, false);
	const commandLine = prefix ? `${prefix} ${command}` : command;
	const lines: string[] = [
		"__omp_restore_errexit=0",
		"case $- in *e*) __omp_restore_errexit=1 ;; esac",
		"set +e",
		"__omp_prev_trap_int=$(trap -p INT 2>/dev/null || true)",
		"trap - INT",
		"__omp_prev_exit=",
		"__omp_prev_logout=",
		"__omp_prev_exec=",
		"if command -v typeset >/dev/null 2>&1; then __omp_prev_exit=$(typeset -f exit 2>/dev/null || true); fi",
		"if command -v typeset >/dev/null 2>&1; then __omp_prev_logout=$(typeset -f logout 2>/dev/null || true); fi",
		"if command -v typeset >/dev/null 2>&1; then __omp_prev_exec=$(typeset -f exec 2>/dev/null || true); fi",
		'exit() { if [ -n "$1" ]; then return "$1"; else return 0; fi; }',
		'logout() { if [ -n "$1" ]; then return "$1"; else return 0; fi; }',
		'exec() { command "$@"; return $?; }',
	];
	if (envExports) lines.push(envExports);
	if (cwd) lines.push(`cd -- ${escapePosix(cwd)}`);
	lines.push(commandLine.length > 0 ? commandLine : ":");
	lines.push("__omp_status=$?");
	lines.push("unset -f exit logout exec 2>/dev/null");
	lines.push('if [ -n "$__omp_prev_exit" ]; then eval "$__omp_prev_exit"; fi');
	lines.push('if [ -n "$__omp_prev_logout" ]; then eval "$__omp_prev_logout"; fi');
	lines.push('if [ -n "$__omp_prev_exec" ]; then eval "$__omp_prev_exec"; fi');
	lines.push('if [ -n "$__omp_prev_trap_int" ]; then eval "$__omp_prev_trap_int"; else trap - INT; fi');
	lines.push("unset __omp_prev_trap_int");
	lines.push("unset __omp_prev_exit __omp_prev_logout __omp_prev_exec");
	lines.push('if [ "$__omp_restore_errexit" -eq 1 ]; then set -e; fi');
	lines.push("unset __omp_restore_errexit");
	lines.push(`printf '\\n${marker}%d\\n' "$__omp_status"`);
	return `${lines.join("\n")}\n`;
}

function buildFishCommandScript(
	command: string,
	cwd: string | undefined,
	prefix: string | undefined,
	marker: string,
	commandEnv: Record<string, string> | undefined,
): string {
	const envExports = buildEnvExports(commandEnv, true);
	const commandLine = prefix ? `${prefix} ${command}` : command;
	const lines: string[] = [
		"begin",
		"functions -e __omp_prev_exit 2>/dev/null",
		"functions -e __omp_prev_logout 2>/dev/null",
		"functions -e __omp_prev_exec 2>/dev/null",
		"functions -q exit; and functions -c exit __omp_prev_exit",
		"functions -q logout; and functions -c logout __omp_prev_logout",
		"functions -q exec; and functions -c exec __omp_prev_exec",
		"function exit",
		"  if test (count $argv) -gt 0",
		"    set -g __omp_exit_code $argv[1]",
		"  else",
		"    set -g __omp_exit_code 0",
		"  end",
		"  return $__omp_exit_code",
		"end",
		"function logout",
		"  if test (count $argv) -gt 0",
		"    set -g __omp_exit_code $argv[1]",
		"  else",
		"    set -g __omp_exit_code 0",
		"  end",
		"  return $__omp_exit_code",
		"end",
		"function exec",
		"  command $argv",
		"  return $status",
		"end",
	];
	if (envExports) lines.push(envExports);
	if (cwd) lines.push(`cd -- ${escapePosix(cwd)}`);
	lines.push(commandLine.length > 0 ? commandLine : ":");
	lines.push("if set -q __omp_exit_code");
	lines.push("  set -l __omp_status $__omp_exit_code");
	lines.push("  set -e __omp_exit_code");
	lines.push("else");
	lines.push("  set -l __omp_status $status");
	lines.push("end");
	lines.push("functions -e exit logout exec");
	lines.push("functions -q __omp_prev_exit; and functions -c __omp_prev_exit exit; and functions -e __omp_prev_exit");
	lines.push(
		"functions -q __omp_prev_logout; and functions -c __omp_prev_logout logout; and functions -e __omp_prev_logout",
	);
	lines.push("functions -q __omp_prev_exec; and functions -c __omp_prev_exec exec; and functions -e __omp_prev_exec");
	lines.push(`printf "\\n${marker}%d\\n" $__omp_status`);
	lines.push("end");
	return `${lines.join("\n")}\n`;
}

function getSessionArgs(shell: string, snapshotPath: string | null): string[] {
	if (snapshotPath) return [];
	const noLogin = process.env.OMP_BASH_NO_LOGIN || process.env.CLAUDE_BASH_NO_LOGIN;
	if (noLogin) return [];
	if (shell.includes("bash") || shell.includes("zsh") || shell.includes("fish")) return ["-l"];
	return [];
}

function serializeEnv(env: Record<string, string | undefined>): string {
	const entries = Object.entries(env).filter(([, value]) => value !== undefined);
	entries.sort(([a], [b]) => a.localeCompare(b));
	return entries.map(([key, value]) => `${key}=${value}`).join("\n");
}

function sanitizePersistentEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
	const sanitized = { ...env };
	delete sanitized.BASH_ENV;
	delete sanitized.ENV;
	return sanitized;
}

class ShellSession {
	#child: ReturnType<typeof ptree.spawn<"pipe">> | null = null;
	#stdinWriter: WritableStreamDefaultWriter<Uint8Array> | Bun.FileSink | null = null;
	#buffer = "";
	#queue: Promise<void> = Promise.resolve();
	#chunkQueue: Promise<void> = Promise.resolve();
	#current: RunningCommand | null = null;
	#startPromise: Promise<void> | null = null;
	#closed = false;
	#encoder = new TextEncoder();
	#lastExitCode: number | null | undefined = undefined;

	constructor(private readonly config: ShellSessionConfig) {}

	async execute(command: string, options: ShellCommandOptions): Promise<ShellCommandResult> {
		const run = async () => {
			try {
				await this.#start();
				return await this.#runCommand(command, options);
			} catch (error) {
				if (this.#shouldRestart(error)) {
					await this.#terminateSession();
					await this.#start();
					return await this.#runCommand(command, options);
				}
				throw error;
			}
		};

		const queued = this.#queue.then(run, run);
		this.#queue = queued.then(
			() => {},
			() => {},
		);
		return queued;
	}

	async dispose(): Promise<void> {
		this.#closed = true;
		const child = this.#child;
		this.#child = null;
		this.#stdinWriter = null;
		if (child) {
			child.kill();
			await child.exited.catch(() => {});
		}
	}

	async #start(): Promise<void> {
		if (this.#closed) {
			throw new Error("Shell session is closed");
		}
		if (this.#startPromise) return this.#startPromise;
		this.#startPromise = this.#spawnShell().catch(error => {
			this.#startPromise = null;
			throw error;
		});
		return this.#startPromise;
	}

	async #spawnShell(): Promise<void> {
		const args = getSessionArgs(this.config.shell, this.config.snapshotPath);
		this.#child = ptree.spawn([this.config.shell, ...args], {
			stdin: "pipe",
			env: this.config.env,
			detached: !IS_WINDOWS,
		});

		if (this.#child.proc.exitCode !== null) {
			this.#lastExitCode = this.#child.proc.exitCode;
			throw new Error(`Shell exited immediately with code ${this.#child.proc.exitCode}`);
		}

		const stdin = this.#child.stdin;
		if (stdin && typeof stdin === "object" && "getWriter" in stdin) {
			this.#stdinWriter = (stdin as unknown as WritableStream<Uint8Array>).getWriter();
		} else {
			this.#stdinWriter = stdin as Bun.FileSink;
		}
		this.#attachStreams(this.#child);
		this.#child.exited.then(code => this.#handleShellExit(code)).catch(() => this.#handleShellExit(null));

		const initCommand = this.#buildInitCommand();
		if (initCommand) {
			await this.#runCommand(initCommand, {});
		}
	}

	#buildInitCommand(): string | null {
		if (!this.config.snapshotPath) return null;
		const snapshotPath = escapePosix(this.config.snapshotPath);
		if (isFishShell(this.config.shell)) {
			return `source ${snapshotPath}`;
		}
		return `source ${snapshotPath} 2>/dev/null`;
	}

	#attachStreams(child: ReturnType<typeof ptree.spawn<"pipe">>): void {
		const readStream = async (stream: ReadableStream<Uint8Array>) => {
			const reader = stream.getReader();
			const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (!value) continue;
					const text = decoder.decode(value, { stream: true });
					if (text) {
						await this.#enqueueChunk(text);
					}
				}
				const remaining = decoder.decode();
				if (remaining) {
					await this.#enqueueChunk(remaining);
				}
			} catch {
				// ignore
			} finally {
				try {
					await reader.cancel();
				} catch {}
				reader.releaseLock();
			}
		};

		void readStream(child.stdout);
		void readStream(child.stderr);
	}

	async #enqueueChunk(text: string): Promise<void> {
		this.#chunkQueue = this.#chunkQueue.then(() => this.#processChunk(text));
		return this.#chunkQueue;
	}

	async #processChunk(text: string): Promise<void> {
		const running = this.#current;
		if (!running) return;
		this.#buffer += text;

		const sentinel = running.markerSentinel;
		while (this.#buffer.length > 0) {
			const markerIndex = this.#buffer.indexOf(sentinel);
			if (markerIndex === -1) {
				const lastNewline = this.#buffer.lastIndexOf("\n");
				if (lastNewline > -1) {
					const tail = this.#buffer.slice(lastNewline);
					const flushLength = tail.length <= MARKER_TAIL_MAX ? lastNewline : this.#buffer.length - MARKER_TAIL_MAX;
					if (flushLength > 0) {
						await running.sink.push(this.#buffer.slice(0, flushLength));
						this.#buffer = this.#buffer.slice(flushLength);
					}
					return;
				}
				const flushLength = Math.max(0, this.#buffer.length - Math.min(sentinel.length, MARKER_TAIL_MAX));
				if (flushLength > 0) {
					await running.sink.push(this.#buffer.slice(0, flushLength));
					this.#buffer = this.#buffer.slice(flushLength);
				}
				return;
			}

			if (markerIndex > 0) {
				await running.sink.push(this.#buffer.slice(0, markerIndex));
			}

			const markerValueStart = markerIndex + sentinel.length;
			const lineEnd = this.#buffer.indexOf("\n", markerValueStart);
			if (lineEnd === -1) {
				this.#buffer = this.#buffer.slice(markerIndex);
				return;
			}

			const exitText = this.#buffer.slice(markerValueStart, lineEnd).trim();
			const exitCode = Number.parseInt(exitText, 10);
			this.#buffer = this.#buffer.slice(lineEnd + 1);
			await this.#finishCommand(running, Number.isFinite(exitCode) ? exitCode : undefined);
			this.#buffer = "";
			return;
		}
	}

	async #runCommand(command: string, options: ShellCommandOptions): Promise<ShellCommandResult> {
		if (!this.#child || !this.#stdinWriter) {
			const exitInfo = this.#lastExitCode === undefined ? "unknown" : String(this.#lastExitCode);
			throw new Error(`Shell session not started (shell=${this.config.shell}, exit=${exitInfo})`);
		}
		this.#buffer = "";

		const markerId = crypto.randomUUID().replace(/-/g, "");
		const marker = `${MARKER_PREFIX}${markerId}__`;
		const markerSentinel = `\n${marker}`;

		const sink = new OutputSink({
			onChunk: options.onChunk,
			artifactPath: options.artifactPath,
			artifactId: options.artifactId,
		});

		const { promise, resolve } = Promise.withResolvers<ShellCommandResult>();
		const running: RunningCommand = {
			marker,
			markerSentinel,
			sink,
			resolve,
			done: promise,
			cancelled: false,
			completed: false,
		};

		this.#current = running;

		const timeoutSignal = options.timeout ? AbortSignal.timeout(options.timeout) : undefined;
		let timeoutFired = false;
		if (timeoutSignal) {
			timeoutSignal.addEventListener(
				"abort",
				() => {
					timeoutFired = true;
				},
				{ once: true },
			);
		}

		const combinedSignal = options.signal
			? AbortSignal.any(timeoutSignal ? [options.signal, timeoutSignal] : [options.signal])
			: timeoutSignal;

		if (combinedSignal) {
			const onAbort = () => {
				void this.#abortCommand(running, timeoutFired ? "timeout" : "signal", options.timeout);
			};
			running.abortListener = () => combinedSignal.removeEventListener("abort", onAbort);
			if (combinedSignal.aborted) {
				void this.#abortCommand(running, timeoutFired ? "timeout" : "signal", options.timeout);
			} else {
				combinedSignal.addEventListener("abort", onAbort, { once: true });
			}
		}

		try {
			const script = isFishShell(this.config.shell)
				? buildFishCommandScript(command, options.cwd, this.config.prefix, marker, options.env)
				: buildPosixCommandScript(command, options.cwd, this.config.prefix, marker, options.env);
			await this.#writeToStdin(script);
		} catch (error) {
			await this.#handleWriteFailure(error instanceof Error ? error : new Error(String(error)));
		}

		return await promise;
	}

	async #finishCommand(running: RunningCommand, exitCode: number | undefined): Promise<void> {
		if (running.completed) return;
		running.completed = true;
		running.abortListener?.();
		this.#current = null;
		const summary = await running.sink.dump(running.cancelled ? running.abortNotice : undefined);
		running.resolve({
			exitCode: running.cancelled ? undefined : exitCode,
			cancelled: running.cancelled,
			...summary,
		});
	}

	async #abortCommand(
		running: RunningCommand,
		reason: "timeout" | "signal",
		timeoutMs: number | undefined,
	): Promise<void> {
		if (running.completed) return;
		running.cancelled = true;
		running.abortReason = reason;
		const notice =
			reason === "timeout" && timeoutMs
				? `Command timed out after ${Math.round(timeoutMs / 1000)} seconds`
				: "Command cancelled";
		running.abortNotice = notice;

		await this.#sendInterrupt();
		const completed = await Promise.race([
			running.done.then(
				() => true,
				() => true,
			),
			Bun.sleep(ABORT_GRACE_MS).then(() => false),
		]);
		if (completed) return;

		await this.#terminateSession();
		if (running.completed) return;
		running.completed = true;
		running.abortListener?.();
		this.#current = null;
		const summary = await running.sink.dump(notice);
		running.resolve({
			exitCode: undefined,
			cancelled: true,
			...summary,
		});
	}

	async #sendInterrupt(): Promise<void> {
		const child = this.#child;
		if (!child?.pid) return;
		try {
			if (IS_WINDOWS) {
				child.proc.kill("SIGINT");
				return;
			}
			if (child.isProcessGroup) {
				process.kill(-child.pid, "SIGINT");
			} else {
				process.kill(child.pid, "SIGINT");
			}
		} catch {}
	}

	async #terminateSession(): Promise<void> {
		const child = this.#child;
		this.#child = null;
		this.#stdinWriter = null;
		this.#startPromise = null;
		if (child) {
			child.kill();
			await child.exited.catch(() => {});
		}
	}

	async #handleShellExit(exitCode: number | null): Promise<void> {
		const running = this.#current;
		this.#lastExitCode = exitCode;
		this.#child = null;
		this.#stdinWriter = null;
		this.#startPromise = null;
		this.#buffer = "";

		if (!running || running.completed) return;
		running.cancelled = true;
		running.abortReason = "signal";
		running.completed = true;
		running.abortListener?.();
		this.#current = null;
		const summary = await running.sink.dump(running.abortNotice ?? "Shell session terminated");
		running.resolve({
			exitCode: undefined,
			cancelled: true,
			...summary,
		});
	}

	async #handleWriteFailure(error: Error): Promise<void> {
		logger.warn("Shell session write failed", { error: error.message });
		await this.#terminateSession();
		throw error;
	}

	#shouldRestart(error: unknown): boolean {
		if (!(error instanceof Error)) return false;
		return (
			error.message.includes("Shell session not started") ||
			error.message.includes("Shell session stdin unavailable")
		);
	}

	async #writeToStdin(script: string): Promise<void> {
		if (!this.#stdinWriter) {
			throw new Error("Shell session stdin unavailable");
		}
		const payload = this.#encoder.encode(script);
		const writer = this.#stdinWriter;
		await Promise.resolve(writer.write(payload));
	}
}

const sessions = new Map<string, ShellSession>();

function buildSessionKey(config: ShellSessionConfig): string {
	return [config.shell, config.prefix ?? "", config.snapshotPath ?? "", serializeEnv(config.env)].join("\n");
}

export async function executeShellCommand(
	config: ShellSessionConfig,
	command: string,
	options: ShellCommandOptions,
): Promise<ShellCommandResult> {
	const sanitizedConfig = { ...config, env: sanitizePersistentEnv(config.env) };
	const key = buildSessionKey(sanitizedConfig);
	let session = sessions.get(key);
	if (!session) {
		session = new ShellSession(sanitizedConfig);
		sessions.set(key, session);
	}
	return await session.execute(command, options);
}

export const __testing = {
	buildPosixCommandScript,
	buildFishCommandScript,
	escapePosix,
	getSessionArgs,
};

postmortem.register("shell-session", async () => {
	const active = Array.from(sessions.values());
	sessions.clear();
	await Promise.all(active.map(session => session.dispose()));
});
