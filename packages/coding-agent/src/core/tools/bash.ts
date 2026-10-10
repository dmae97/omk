import type { AgentTool } from "omk-agent-core";
import { type Static, Type } from "typebox";
import { getShellEnv } from "../../utils/shell.ts";
import { DEFAULT_BUILTIN_TOOL_TIMEOUTS } from "../agent-tool-settings.ts";
import { classifyShellCommand } from "../command-safety.ts";
import { isCommandSafetyDisabled } from "../extensions/builtin/command-safety-gate.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { assertLoadoutAccess, type LoadoutAccessGuard } from "../loadout-access-policy.ts";
import {
	bashBudgetTimeoutMessage,
	ensureActiveRemainingBudget,
	resolveBashTimeoutForBudget,
} from "../remaining-budget.ts";
import {
	type BashSandboxPreflight,
	createLocalBashOperations,
	type LocalBashOperationsOptions,
} from "./bash-local-operations.ts";
import type { BashOperations } from "./bash-operations.ts";
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

export type { BashOperations };
export { type BashSandboxPreflight, createLocalBashOperations, type LocalBashOperationsOptions };

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

			const { effectiveTimeoutSec, clamp } = resolveBashTimeoutForBudget(
				timeout,
				DEFAULT_BUILTIN_TOOL_TIMEOUTS.bash / 1000,
				ensureActiveRemainingBudget(),
			);

			try {
				let exitCode: number | null;
				try {
					const result = await ops.exec(spawnContext.command, spawnContext.cwd, {
						onData: handleData,
						signal,
						timeout: effectiveTimeoutSec,
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
						// Prefer the executor's reported seconds (timeout:N) so mocks and
						// local spawn agree; decorate only when the budget actually clamped.
						const [, timeoutSecsRaw] = err.message.split(":");
						const timedOutSec = Number(timeoutSecsRaw);
						const secs = Number.isFinite(timedOutSec) && timedOutSec > 0 ? timedOutSec : effectiveTimeoutSec;
						const status =
							clamp?.clamped === true
								? bashBudgetTimeoutMessage({ ...clamp, timeoutSec: secs })
								: `Command timed out after ${secs} seconds`;
						throw new Error(appendStatus(text, status));
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
