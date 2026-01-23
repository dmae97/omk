import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { $ } from "bun";
import { SettingsManager } from "$c/config/settings-manager";

export interface ShellConfig {
	shell: string;
	args: string[];
	env: Record<string, string | undefined>;
	prefix: string | undefined;
}

let cachedShellConfig: ShellConfig | null = null;

/**
 * Check if a shell binary is executable.
 */
async function isExecutable(path: string): Promise<boolean> {
	try {
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Build the spawn environment (cached).
 */
function buildSpawnEnv(shell: string): Record<string, string | undefined> {
	const noCI = process.env.OMP_BASH_NO_CI || process.env.CLAUDE_BASH_NO_CI;
	return {
		...process.env,
		SHELL: shell,
		GIT_EDITOR: "true",
		GPG_TTY: "not a tty",
		OMPCODE: "1",
		CLAUDECODE: "1",
		...(noCI ? {} : { CI: "true" }),
	};
}

/**
 * Get shell args, optionally including login shell flag.
 * Supports OMP_BASH_NO_LOGIN and CLAUDE_BASH_NO_LOGIN to skip -l.
 */
function getShellArgs(): string[] {
	const noLogin = process.env.OMP_BASH_NO_LOGIN || process.env.CLAUDE_BASH_NO_LOGIN;
	return noLogin ? ["-c"] : ["-l", "-c"];
}

/**
 * Get shell prefix for wrapping commands (profilers, strace, etc.).
 */
function getShellPrefix(): string | undefined {
	return process.env.OMP_SHELL_PREFIX || process.env.CLAUDE_CODE_SHELL_PREFIX;
}

/**
 * Find bash executable on PATH (Windows)
 */
function findBashOnPath(): string | null {
	try {
		return Bun.which("bash.exe");
	} catch {
		// Ignore errors
	}
	return null;
}

/**
 * Build full shell config from a shell path.
 */
function buildConfig(shell: string): ShellConfig {
	return {
		shell,
		args: getShellArgs(),
		env: buildSpawnEnv(shell),
		prefix: getShellPrefix(),
	};
}

/**
 * Get shell configuration based on platform.
 * Resolution order:
 * 1. User-specified shellPath in settings.json
 * 2. On Windows: Git Bash in known locations, then bash on PATH
 * 3. On Unix: $SHELL if bash/zsh, then fallback paths
 * 4. Fallback: sh
 */
export async function getShellConfig(): Promise<ShellConfig> {
	if (cachedShellConfig) {
		return cachedShellConfig;
	}

	const settings = await SettingsManager.create();
	const customShellPath = settings.getShellPath();

	// 1. Check user-specified shell path
	if (customShellPath) {
		if (await Bun.file(customShellPath).exists()) {
			cachedShellConfig = buildConfig(customShellPath);
			return cachedShellConfig;
		}
		throw new Error(
			`Custom shell path not found: ${customShellPath}\nPlease update shellPath in ~/.omp/agent/settings.json`,
		);
	}

	if (process.platform === "win32") {
		// 2. Try Git Bash in known locations
		const paths: string[] = [];
		const programFiles = process.env.ProgramFiles;
		if (programFiles) {
			paths.push(`${programFiles}\\Git\\bin\\bash.exe`);
		}
		const programFilesX86 = process.env["ProgramFiles(x86)"];
		if (programFilesX86) {
			paths.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
		}

		for (const path of paths) {
			if (await Bun.file(path).exists()) {
				cachedShellConfig = buildConfig(path);
				return cachedShellConfig;
			}
		}

		// 3. Fallback: search bash.exe on PATH (Cygwin, MSYS2, WSL, etc.)
		const bashOnPath = findBashOnPath();
		if (bashOnPath) {
			cachedShellConfig = buildConfig(bashOnPath);
			return cachedShellConfig;
		}

		throw new Error(
			`No bash shell found. Options:\n` +
				`  1. Install Git for Windows: https://git-scm.com/download/win\n` +
				`  2. Add your bash to PATH (Cygwin, MSYS2, etc.)\n` +
				`  3. Set shellPath in ~/.omp/agent/settings.json\n\n` +
				`Searched Git Bash in:\n${paths.map((p) => `  ${p}`).join("\n")}`,
		);
	}

	// Unix: prefer user's shell from $SHELL if it's bash/zsh and executable
	const userShell = process.env.SHELL;
	const isValidShell = userShell && (userShell.includes("bash") || userShell.includes("zsh"));
	if (isValidShell && (await isExecutable(userShell))) {
		cachedShellConfig = buildConfig(userShell);
		return cachedShellConfig;
	}

	// Fallback paths (Claude's approach: check known locations)
	const fallbackPaths = ["/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"];
	const preferZsh = !userShell?.includes("bash");
	const shellOrder = preferZsh ? ["zsh", "bash"] : ["bash", "zsh"];

	for (const shellName of shellOrder) {
		for (const dir of fallbackPaths) {
			const shellPath = `${dir}/${shellName}`;
			if (await isExecutable(shellPath)) {
				cachedShellConfig = buildConfig(shellPath);
				return cachedShellConfig;
			}
		}
	}

	// Last resort: use Bun.which
	const bashPath = Bun.which("bash");
	if (bashPath) {
		cachedShellConfig = buildConfig(bashPath);
		return cachedShellConfig;
	}

	const shPath = Bun.which("sh");
	cachedShellConfig = buildConfig(shPath || "sh");
	return cachedShellConfig;
}

let pgrepAvailable: string | null | undefined;

/**
 * Check if pgrep is available on this system (cached).
 */
function hasPgrep(): string | null {
	if (pgrepAvailable === undefined) {
		try {
			pgrepAvailable = Bun.which("pgrep") ?? null;
		} catch {
			pgrepAvailable = null;
		}
	}
	return pgrepAvailable;
}

/**
 * Get direct children of a PID using pgrep.
 */
async function getChildrenViaPgrep(pid: number): Promise<number[]> {
	const result = await $`pgrep -P ${pid}`.quiet().nothrow();
	if (result.exitCode !== 0) return [];
	const output = result.stdout.toString().trim();
	if (!output) return [];

	const children: number[] = [];
	for (const line of output.split("\n")) {
		const childPid = parseInt(line, 10);
		if (!Number.isNaN(childPid)) children.push(childPid);
	}
	return children;
}

/**
 * Get direct children of a PID using /proc (Linux only).
 */
async function getChildrenViaProc(pid: number): Promise<number[]> {
	try {
		const script = `for p in /proc/[0-9]*/stat; do cat "$p" 2>/dev/null; done | awk -v ppid=${pid} '$4 == ppid { print $1 }'`;
		const result = await $`sh -c ${script}`.quiet().nothrow();
		if (result.exitCode !== 0) return [];
		const output = result.stdout.toString().trim();
		if (!output) return [];

		const children: number[] = [];
		for (const line of output.split("\n")) {
			const childPid = parseInt(line, 10);
			if (!Number.isNaN(childPid)) children.push(childPid);
		}
		return children;
	} catch {
		return [];
	}
}

/**
 * Collect all descendant PIDs breadth-first.
 * Returns deepest descendants first (reverse BFS order) for proper kill ordering.
 */
async function getDescendantPids(pid: number): Promise<number[]> {
	const getChildren = hasPgrep() ? getChildrenViaPgrep : getChildrenViaProc;
	const descendants: number[] = [];
	const queue = [pid];

	while (queue.length > 0) {
		const current = queue.shift()!;
		const children = await getChildren(current);
		for (const child of children) {
			descendants.push(child);
			queue.push(child);
		}
	}

	// Reverse so deepest children are killed first
	return descendants.reverse();
}

function tryKill(pid: number, signal: NodeJS.Signals): boolean {
	try {
		process.kill(pid, signal);
		return true;
	} catch {
		return false;
	}
}

/**
 * Kill a process and all its descendants.
 * @param gracePeriodMs - Time to wait after SIGTERM before SIGKILL (0 = immediate SIGKILL)
 */
export async function killProcessTree(pid: number, gracePeriodMs = 0): Promise<void> {
	if (process.platform === "win32") {
		await $`taskkill /F /T /PID ${pid}`.quiet().nothrow();
		return;
	}

	const signal = gracePeriodMs > 0 ? "SIGTERM" : "SIGKILL";

	// Fast path: process group kill (works if pid is group leader)
	try {
		process.kill(-pid, signal);
		if (gracePeriodMs > 0) {
			await Bun.sleep(gracePeriodMs);
			try {
				process.kill(-pid, "SIGKILL");
			} catch {
				// Already dead
			}
		}
		return;
	} catch {
		// Not a process group leader, fall through
	}

	// Collect descendants BEFORE killing to minimize race window
	const allPids = [...(await getDescendantPids(pid)), pid];

	if (gracePeriodMs > 0) {
		for (const p of allPids) tryKill(p, "SIGTERM");
		await Bun.sleep(gracePeriodMs);
	}

	for (const p of allPids) tryKill(p, "SIGKILL");
}
