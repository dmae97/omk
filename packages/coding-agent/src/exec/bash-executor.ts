/**
 * Bash command execution with streaming support and cancellation.
 *
 * Uses brush-core via native bindings for shell execution.
 */
import { Shell } from "@oh-my-pi/pi-natives";
import { Settings } from "../config/settings";
import { OutputSink } from "../session/streaming-output";
import { getOrCreateSnapshot } from "../utils/shell-snapshot";

export interface BashExecutorOptions {
	cwd?: string;
	timeout?: number;
	onChunk?: (chunk: string) => void;
	signal?: AbortSignal;
	/** Session key suffix to isolate shell sessions per agent */
	sessionKey?: string;
	/** Additional environment variables to inject */
	env?: Record<string, string>;
	/** Artifact path/id for full output storage */
	artifactPath?: string;
	artifactId?: string;
}

export interface BashResult {
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
	artifactId?: string;
}

const shellSessions = new Map<string, Shell>();

export async function executeBash(command: string, options?: BashExecutorOptions): Promise<BashResult> {
	const settings = await Settings.init();
	const { shell, env: shellEnv, prefix } = settings.getShellConfig();
	const snapshotPath = shell.includes("bash") ? await getOrCreateSnapshot(shell, shellEnv) : null;

	// Apply command prefix if configured
	const prefixedCommand = prefix ? `${prefix} ${command}` : command;
	const finalCommand = prefixedCommand;

	// Create output sink for truncation and artifact handling
	const sink = new OutputSink({
		onChunk: options?.onChunk,
		artifactPath: options?.artifactPath,
		artifactId: options?.artifactId,
	});

	let pendingChunks = Promise.resolve();
	const enqueueChunk = (chunk: string) => {
		pendingChunks = pendingChunks.then(() => sink.push(chunk)).catch(() => {});
	};

	if (options?.signal?.aborted) {
		return {
			exitCode: undefined,
			cancelled: true,
			...(await sink.dump("Command cancelled")),
		};
	}

	try {
		const sessionKey = buildSessionKey(shell, prefix, snapshotPath, shellEnv, options?.sessionKey);
		let shellSession = shellSessions.get(sessionKey);
		if (!shellSession) {
			shellSession = new Shell({ sessionEnv: shellEnv, snapshotPath: snapshotPath ?? undefined });
			shellSessions.set(sessionKey, shellSession);
		}

		const signal = options?.signal;
		const abortHandler = () => {
			shellSession.abort(signal?.reason instanceof Error ? signal.reason.message : undefined);
		};
		if (signal) {
			signal.addEventListener("abort", abortHandler, { once: true });
		}

		try {
			const result = await shellSession.run(
				{
					command: finalCommand,
					cwd: options?.cwd,
					env: options?.env,
					timeoutMs: options?.timeout,
					signal,
				},
				(err, chunk) => {
					if (!err) {
						enqueueChunk(chunk);
					}
				},
			);

			await pendingChunks;

			// Handle timeout
			if (result.timedOut) {
				const annotation = options?.timeout
					? `Command timed out after ${Math.round(options.timeout / 1000)} seconds`
					: "Command timed out";
				return {
					exitCode: undefined,
					cancelled: true,
					...(await sink.dump(annotation)),
				};
			}

			// Handle cancellation
			if (result.cancelled) {
				return {
					exitCode: undefined,
					cancelled: true,
					...(await sink.dump("Command cancelled")),
				};
			}

			// Normal completion
			return {
				exitCode: result.exitCode,
				cancelled: false,
				...(await sink.dump()),
			};
		} finally {
			if (signal) {
				signal.removeEventListener("abort", abortHandler);
			}
		}
	} finally {
		await pendingChunks;
	}
}

function buildSessionKey(
	shell: string,
	prefix: string | undefined,
	snapshotPath: string | null,
	env: Record<string, string>,
	agentSessionKey?: string,
): string {
	const entries = Object.entries(env);
	entries.sort(([a], [b]) => a.localeCompare(b));
	const envSerialized = entries.map(([key, value]) => `${key}=${value}`).join("\n");
	return [agentSessionKey ?? "", shell, prefix ?? "", snapshotPath ?? "", envSerialized].join("\n");
}
