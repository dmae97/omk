/**
 * Bash command execution with streaming support and cancellation.
 *
 * Provides unified bash execution for AgentSession.executeBash() and direct calls.
 */
import { Exception, ptree } from "@oh-my-pi/pi-utils";
import { SettingsManager } from "../config/settings-manager";
import { OutputSink } from "../session/streaming-output";
import { getOrCreateSnapshot, getSnapshotSourceCommand } from "../utils/shell-snapshot";
import { executeShellCommand } from "./shell-session";

export interface BashExecutorOptions {
	cwd?: string;
	timeout?: number;
	onChunk?: (chunk: string) => void;
	signal?: AbortSignal;
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

export async function executeBash(command: string, options?: BashExecutorOptions): Promise<BashResult> {
	const { shell, args, env, prefix } = await SettingsManager.getGlobalShellConfig();
	const snapshotPath = await getOrCreateSnapshot(shell, env);

	if (shouldUsePersistentShell(shell)) {
		return await executeShellCommand({ shell, env, prefix, snapshotPath }, command, {
			cwd: options?.cwd,
			timeout: options?.timeout,
			signal: options?.signal,
			onChunk: options?.onChunk,
			env: options?.env,
			artifactPath: options?.artifactPath,
			artifactId: options?.artifactId,
		});
	}

	return await executeBashOnce(command, options, { shell, args, env, prefix, snapshotPath });
}

function shouldUsePersistentShell(shell: string): boolean {
	const flag = parseEnvFlag(process.env.OMP_SHELL_PERSIST);
	if (flag !== undefined) return flag;
	if (process.platform === "win32") return false;
	const normalized = shell.toLowerCase();
	return (
		normalized.includes("bash") ||
		normalized.includes("zsh") ||
		normalized.includes("fish") ||
		normalized.endsWith("/sh") ||
		normalized.endsWith("\\\\sh") ||
		normalized.endsWith("sh")
	);
}

function parseEnvFlag(value: string | undefined): boolean | undefined {
	if (!value) return undefined;
	const normalized = value.toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return undefined;
}

async function executeBashOnce(
	command: string,
	options: BashExecutorOptions | undefined,
	config: {
		shell: string;
		args: string[];
		env: Record<string, string | undefined>;
		prefix?: string;
		snapshotPath: string | null;
	},
): Promise<BashResult> {
	const { shell, args, env, prefix, snapshotPath } = config;

	// Merge additional env vars if provided
	const finalEnv = options?.env ? { ...env, ...options.env } : env;
	const snapshotPrefix = getSnapshotSourceCommand(snapshotPath);
	const prefixedCommand = prefix ? `${prefix} ${command}` : command;
	const finalCommand = `${snapshotPrefix}${prefixedCommand}`;

	const sink = new OutputSink({
		onChunk: options?.onChunk,
		artifactPath: options?.artifactPath,
		artifactId: options?.artifactId,
	});

	using child = ptree.spawn([shell, ...args, finalCommand], {
		cwd: options?.cwd,
		env: finalEnv,
		signal: options?.signal,
		timeout: options?.timeout,
		detached: true,
	});

	// Pump streams - errors during abort/timeout are expected
	// Use preventClose to avoid closing the shared sink when either stream finishes
	await Promise.allSettled([child.stdout.pipeTo(sink.createInput()), child.stderr.pipeTo(sink.createInput())]).catch(
		() => {},
	);

	// Wait for process exit
	try {
		return {
			exitCode: await child.exited,
			cancelled: false,
			...(await sink.dump()),
		};
	} catch (err: unknown) {
		// Exception covers NonZeroExitError, AbortError, TimeoutError
		if (err instanceof Exception) {
			if (err.aborted) {
				const isTimeout = err instanceof ptree.TimeoutError || err.message.toLowerCase().includes("timed out");
				const annotation = isTimeout
					? `Command timed out after ${Math.round((options?.timeout ?? 0) / 1000)} seconds`
					: undefined;
				return {
					exitCode: undefined,
					cancelled: true,
					...(await sink.dump(annotation)),
				};
			}

			// NonZeroExitError
			return {
				exitCode: err.exitCode,
				cancelled: false,
				...(await sink.dump()),
			};
		}

		throw err;
	}
}
