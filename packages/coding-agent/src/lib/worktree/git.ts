import * as path from "node:path";
import { ptree } from "@oh-my-pi/pi-utils";
import { execCommand } from "../../core/exec";
import { WorktreeError, WorktreeErrorCode } from "./errors";

export interface GitResult {
	code: number;
	stdout: string;
	stderr: string;
}

/**
 * Execute a git command.
 * @param args - Command arguments (excluding 'git')
 * @param cwd - Working directory (optional)
 * @returns Promise<GitResult>
 */
export async function git(args: string[], cwd?: string): Promise<GitResult> {
	const result = await execCommand("git", args, cwd ?? process.cwd());
	return { code: result.code, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Execute git command with stdin input.
 * Used for piping diffs to `git apply`.
 */
export async function gitWithInput(args: string[], stdin: string, cwd?: string): Promise<GitResult> {
	const proc = ptree.cspawn(["git", ...args], {
		cwd: cwd ?? process.cwd(),
		stdin: Buffer.from(stdin),
	});

	const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);

	return { code: proc.exitCode ?? 0, stdout, stderr };
}

/**
 * Get repository root directory.
 * @throws Error if not in a git repository
 */
export async function getRepoRoot(cwd?: string): Promise<string> {
	const result = await git(["rev-parse", "--show-toplevel"], cwd ?? process.cwd());
	if (result.code !== 0) {
		throw new WorktreeError("Not a git repository", WorktreeErrorCode.NOT_GIT_REPO);
	}
	const root = result.stdout.trim();
	if (!root) {
		throw new WorktreeError("Not a git repository", WorktreeErrorCode.NOT_GIT_REPO);
	}
	return path.resolve(root);
}

/**
 * Get repository name (directory basename of repo root).
 */
export async function getRepoName(cwd?: string): Promise<string> {
	const root = await getRepoRoot(cwd);
	return path.basename(root);
}
