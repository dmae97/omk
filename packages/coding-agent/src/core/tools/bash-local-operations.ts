import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { waitForChildProcess } from "../../utils/child-process.ts";
import {
	getShellConfig,
	getShellEnv,
	killProcessTree,
	trackDetachedChildPid,
	untrackDetachedChildPid,
} from "../../utils/shell.ts";
import { detectSandboxBackend } from "../sandbox/backend.ts";
import type { SandboxBackendStatus, SandboxPathResolver, SandboxPolicy } from "../sandbox/policy.ts";
import { buildSandboxedSpawnRequest, type SandboxedSpawnRequest } from "../sandbox/spawn.ts";
import type { BashOperations } from "./bash-operations.ts";

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
