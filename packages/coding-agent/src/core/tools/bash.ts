import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import type { AgentTool } from "omk-agent-core";
import { type Static, Type } from "typebox";
import { waitForChildProcess } from "../../utils/child-process.ts";
import {
	getShellConfig,
	getShellEnv,
	killProcessTree,
	trackDetachedChildPid,
	untrackDetachedChildPid,
} from "../../utils/shell.ts";
import { DEFAULT_BUILTIN_TOOL_TIMEOUTS } from "../agent-tool-settings.ts";
import { classifyShellCommand } from "../command-safety.ts";
import { isCommandSafetyDisabled } from "../extensions/builtin/command-safety-gate.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { assertLoadoutAccess, type LoadoutAccessGuard } from "../loadout-access-policy.ts";
import { detectSandboxBackend } from "../sandbox/backend.ts";
import type { SandboxBackendStatus, SandboxPathResolver, SandboxPolicy } from "../sandbox/policy.ts";
import { buildSandboxedSpawnRequest, type SandboxedSpawnRequest } from "../sandbox/spawn.ts";
import { formatBashOutput } from "./bash-output.ts";
import { OutputAccumulator, type OutputSnapshot } from "./output-accumulator.ts";
import { filterRtkOutput, shouldFilterRtkOutput } from "./rtk-output.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type TruncationResult } from "./truncate.ts";

const BASH_TIMEOUT_DESCRIPTION = `Timeout in seconds. Defaults to ${DEFAULT_BUILTIN_TOOL_TIMEOUTS.bash / 1000}s and the command is terminated at that bound, so raise it for long work such as large downloads, builds, or training runs.`;

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	// The stated default must track the runtime one; see bash-timeout-disclosure.test.ts.
	timeout: Type.Optional(Type.Number({ description: BASH_TIMEOUT_DESCRIPTION })),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
	outputFilter?: OutputSnapshot["outputFilter"];
}

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (for example SSH).
 */
export interface BashOperations {
	/**
	 * Execute a command and stream output.
	 * @param command The command to execute
	 * @param cwd Working directory
	 * @param options Execution options
	 * @returns Promise resolving to exit code (null if killed)
	 */
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: NodeJS.ProcessEnv;
		},
	) => Promise<{ exitCode: number | null }>;
}

/**
 * Create bash operations using OMK's built-in local shell execution backend.
 *
 * This is useful for extensions that intercept user_bash and still want OMK's
 * standard local shell behavior while wrapping, sandboxing, or rewriting commands.
 */
export interface LocalBashOperationsOptions {
	readonly shellPath?: string;
	readonly sandboxPolicy?: BashSandboxPreflight;
	/** Override backend probing for embedders and deterministic tests. */
	readonly detectSandboxBackend?: () => SandboxBackendStatus;
}

export function createLocalBashOperations(options?: LocalBashOperationsOptions): BashOperations {
	const sandbox = options?.sandboxPolicy;
	let detectedBackend: SandboxBackendStatus | undefined;
	const resolveBackend = (): SandboxBackendStatus => {
		if (sandbox?.backend) return sandbox.backend;
		detectedBackend ??= (options?.detectSandboxBackend ?? defaultBashSandboxBackend)();
		return detectedBackend;
	};
	return {
		exec: async (command, cwd, { onData, signal, timeout, env }) => {
			const { shell, args } = getShellConfig(options?.shellPath);
			let spawnCommand = shell;
			let spawnArgs = [...args, command];
			let spawnCwd = cwd;
			let spawnEnv: NodeJS.ProcessEnv = env ?? getShellEnv();
			if (sandbox) {
				const backend = resolveBackend();
				const request = buildSandboxedSpawnRequest({
					argv: [shell, ...args, command],
					cwd,
					env: spawnEnv,
					policy: sandbox.policy,
					backend,
					resolver: sandbox.resolver,
				});
				sandbox.onSpawnDecision?.(request);
				if (!request.allowed) {
					throw new Error(`sandbox: shell denied\n[${request.rule}] ${request.reason}`);
				}
				spawnCommand = request.argv[0];
				spawnArgs = [...request.argv.slice(1)];
				spawnCwd = request.cwd;
				spawnEnv = request.env;
			}
			try {
				await fsAccess(spawnCwd, constants.F_OK);
			} catch {
				throw new Error(`Working directory does not exist: ${spawnCwd}\nCannot execute bash commands.`);
			}
			if (signal?.aborted) {
				throw new Error("aborted");
			}

			// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- argv-array spawn; sandbox policy is applied above and shell mode is not used.
			const child = spawn(spawnCommand, spawnArgs, {
				cwd: spawnCwd,
				detached: process.platform !== "win32",
				env: spawnEnv,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			if (child.pid) trackDetachedChildPid(child.pid);
			let timedOut = false;
			let timeoutHandle: NodeJS.Timeout | undefined;
			const onAbort = () => {
				if (child.pid) killProcessTree(child.pid);
			};

			try {
				// Set timeout if provided.
				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, timeout * 1000);
				}
				// Stream stdout and stderr.
				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);
				// Handle abort signal by killing the entire process tree.
				if (signal) {
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}
				// Handle shell spawn errors and wait for the process to terminate without hanging
				// on inherited stdio handles held by detached descendants.
				const exitCode = await waitForChildProcess(child);
				if (signal?.aborted) {
					throw new Error("aborted");
				}
				if (timedOut) {
					throw new Error(`timeout:${timeout}`);
				}
				return { exitCode };
			} finally {
				if (child.pid) untrackDetachedChildPid(child.pid);
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
		},
	};
}

/**
 * Sandbox preflight inputs for local bash operations. When provided to
 * {@link createLocalBashOperations}, every spawn is gated by the sandbox spawn
 * builder: shell is denied when an OS sandbox backend is missing under enforce
 * mode, the environment is filtered, and available backends wrap the spawned
 * command. When omitted, local bash behavior is unchanged.
 */
export interface BashSandboxPreflight {
	/** Policy that decides whether this spawn may proceed. */
	policy: SandboxPolicy;
	/**
	 * Availability of an OS-level sandbox backend. Local operations auto-detect
	 * macOS sandbox-exec or Linux bubblewrap when this is omitted.
	 */
	backend?: SandboxBackendStatus;
	/** Optional resolver used to canonicalize the working directory before the root check. */
	resolver?: SandboxPathResolver;
	/** Observer for each sandbox spawn decision (audit/enforce ledger recording). */
	onSpawnDecision?: (decision: SandboxedSpawnRequest) => void;
}

function defaultBashSandboxBackend(): SandboxBackendStatus {
	return detectSandboxBackend();
}

export interface BashSpawnContext {
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

const SESSION_ENV_KEYS = ["PI_SESSION_ID", "PI_SESSION_FILE", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL"] as const;

function resolveSpawnContext(
	command: string,
	cwd: string,
	spawnHook: BashSpawnHook | undefined,
	exposeSessionEnvironment: boolean,
	ctx: ExtensionContext | undefined,
): BashSpawnContext {
	const env = { ...getShellEnv() };
	// Anti-spoof: never inherit PI_* session metadata from the parent environment.
	for (const key of SESSION_ENV_KEYS) delete env[key];
	if (exposeSessionEnvironment && ctx?.sessionManager) {
		const model = ctx.model;
		env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (sessionFile) env.PI_SESSION_FILE = sessionFile;
		if (model) {
			env.PI_PROVIDER = model.provider;
			env.PI_MODEL = model.id;
		}
		if (ctx.thinkingLevel) env.PI_REASONING_LEVEL = ctx.thinkingLevel;
	}
	const baseContext: BashSpawnContext = { command, cwd, env };
	return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
	/** Custom operations for command execution. Default: local shell */
	operations?: BashOperations;
	/** Command prefix prepended to every command (for example shell setup commands) */
	commandPrefix?: string;
	/** Optional explicit shell path from settings */
	shellPath?: string;
	/** Expose current session metadata as PI_* environment variables. Default: true */
	exposeSessionEnvironment?: boolean;
	/** Trusted sandbox policy for local shell execution */
	sandboxPolicy?: BashSandboxPreflight;
	loadoutAccessGuard?: LoadoutAccessGuard;
	/** Hook to adjust command, cwd, or env before execution */
	spawnHook?: BashSpawnHook;
}

const BASH_UPDATE_THROTTLE_MS = 100;

type BashRenderState = {
	startedAt: number | undefined;
	endedAt: number | undefined;
	interval: NodeJS.Timeout | undefined;
};

export function createBashToolDefinition(
	cwd: string,
	options?: BashToolOptions,
): ToolDefinition<typeof bashSchema, BashToolDetails | undefined, BashRenderState> {
	const ops =
		options?.operations ??
		createLocalBashOperations({ shellPath: options?.shellPath, sandboxPolicy: options?.sandboxPolicy });
	const commandPrefix = options?.commandPrefix;
	const exposeSessionEnvironment = options?.exposeSessionEnvironment ?? true;
	const spawnHook = options?.spawnHook;
	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds. OMK_RTK_OUTPUT=1 enables bounded RTK filtering for recognized successful Vitest/TypeScript checks, with raw output retained.`,
		promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
		promptGuidelines: exposeSessionEnvironment
			? ["Inspect PI_* environment variables for current model and session details."]
			: undefined,
		parameters: bashSchema,
		async execute(
			_toolCallId,
			{ command, timeout }: { command: string; timeout?: number },
			signal?: AbortSignal,
			onUpdate?,
			ctx?,
		) {
			const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
			const spawnContext = resolveSpawnContext(resolvedCommand, cwd, spawnHook, exposeSessionEnvironment, ctx);
			assertLoadoutAccess(options?.loadoutAccessGuard, {
				operation: "execute",
				toolName: "bash",
				command: spawnContext.command,
			});

			// Safety floor: re-classify the EFFECTIVE command after commandPrefix/spawnHook.
			// Skipped entirely in YOLO mode (env contract in isCommandSafetyDisabled).
			if (!isCommandSafetyDisabled()) {
				const effectiveVerdict = classifyShellCommand(spawnContext.command);
				if (effectiveVerdict.risk === "block") {
					throw new Error(`command-safety: blocked\n[${effectiveVerdict.rule}] ${effectiveVerdict.reason}`);
				}
			}

			const output = new OutputAccumulator({ tempFilePrefix: "omk-bash" });
			let updateTimer: NodeJS.Timeout | undefined;
			let updateDirty = false;
			let lastUpdateAt = 0;

			const emitOutputUpdate = () => {
				if (!onUpdate || !updateDirty) return;
				updateDirty = false;
				lastUpdateAt = Date.now();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				onUpdate({
					content: [{ type: "text", text: snapshot.content || "" }],
					details: {
						truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
						fullOutputPath: snapshot.fullOutputPath,
					},
				});
			};

			const clearUpdateTimer = () => {
				if (updateTimer) {
					clearTimeout(updateTimer);
					updateTimer = undefined;
				}
			};

			const scheduleOutputUpdate = () => {
				if (!onUpdate) return;
				updateDirty = true;
				const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
				if (delay <= 0) {
					clearUpdateTimer();
					emitOutputUpdate();
					return;
				}
				updateTimer ??= setTimeout(() => {
					updateTimer = undefined;
					emitOutputUpdate();
				}, delay);
			};

			if (onUpdate) {
				onUpdate({ content: [], details: undefined });
			}

			const handleData = (data: Buffer) => {
				output.append(data);
				scheduleOutputUpdate();
			};

			const finishOutput = async (exitCode?: number | null) => {
				output.finish();
				clearUpdateTimer();
				emitOutputUpdate();
				let snapshot = output.snapshot({ persistIfTruncated: true });
				const filter = exitCode !== undefined && shouldFilterRtkOutput(spawnContext.command, snapshot, exitCode);
				if (filter) snapshot = output.snapshot({ persist: true });
				await output.closeTempFile();
				return filter ? filterRtkOutput(spawnContext.command, snapshot, signal) : snapshot;
			};

			const formatOutput = (snapshot: Awaited<ReturnType<typeof finishOutput>>, emptyText = "(no output)") =>
				formatBashOutput(snapshot, output.getLastLineBytes(), emptyText);

			const appendStatus = (text: string, status: string) => `${text ? `${text}\n\n` : ""}${status}`;

			try {
				let exitCode: number | null;
				try {
					const result = await ops.exec(spawnContext.command, spawnContext.cwd, {
						onData: handleData,
						signal,
						timeout,
						env: spawnContext.env,
					});
					exitCode = result.exitCode;
				} catch (err) {
					const snapshot = await finishOutput();
					const { text } = formatOutput(snapshot, "");
					if (err instanceof Error && err.message === "aborted") {
						throw new Error(appendStatus(text, "Command aborted"));
					}
					if (err instanceof Error && err.message.startsWith("timeout:")) {
						const [, timeoutSecs] = err.message.split(":");
						throw new Error(appendStatus(text, `Command timed out after ${timeoutSecs} seconds`));
					}
					throw err;
				}

				const snapshot = await finishOutput(exitCode);
				const { text: outputText, details } = formatOutput(snapshot);
				if (exitCode !== 0 && exitCode !== null) {
					throw new Error(appendStatus(outputText, `Command exited with code ${exitCode}`));
				}
				return { content: [{ type: "text", text: outputText }], details };
			} finally {
				clearUpdateTimer();
			}
		},
	};
}

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
	return wrapToolDefinition(createBashToolDefinition(cwd, options));
}
