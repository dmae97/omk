import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { VerifiedRunError } from "./storage.ts";

const COMMAND_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const ENV_NAMES = ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "TMPDIR", "TEMP", "TMP"];

export class GitOperationBudget {
	private readonly deadline: number;
	private readonly clock: () => number;
	private readonly signal: AbortSignal | undefined;
	private readonly counts = new Map<string, number>();
	constructor(options: { timeoutMs?: number; signal?: AbortSignal; clock?: () => number } = {}) {
		const timeout = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
		if (!Number.isFinite(timeout) || timeout <= 0) throw new VerifiedRunError("deadline");
		this.clock = options.clock ?? (() => performance.now());
		this.deadline = this.clock() + timeout;
		this.signal = options.signal;
	}
	remaining(): number {
		return Math.min(COMMAND_TIMEOUT_MS, this.remainingWorkMs());
	}
	remainingWorkMs(): number {
		if (this.signal?.aborted) throw new VerifiedRunError("cancelled");
		const remaining = this.deadline - this.clock();
		if (!(remaining > 0)) throw new VerifiedRunError("deadline");
		return Math.max(1, Math.ceil(remaining));
	}
	record(command: string): void {
		this.counts.set(command, (this.counts.get(command) ?? 0) + 1);
	}
	get commandCounts(): Readonly<Record<string, number>> {
		return Object.freeze(Object.fromEntries(this.counts));
	}
}

export function assertPrivateEmptyHooks(path: string): void {
	const stat = lstatSync(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== 0o700 ||
		(process.getuid && stat.uid !== process.getuid()) ||
		readdirSync(path).length !== 0
	)
		throw new VerifiedRunError("git_hooks_boundary");
}

function gitEnvironment(write: boolean): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const name of ENV_NAMES) if (process.env[name] !== undefined) env[name] = process.env[name];
	return {
		...env,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: devNull,
		GIT_CONFIG_COUNT: "0",
		GIT_TERMINAL_PROMPT: "0",
		GIT_NO_REPLACE_OBJECTS: "1",
		GIT_OPTIONAL_LOCKS: write ? "1" : "0",
		LC_ALL: "C",
		GIT_AUTHOR_NAME: "OMK verified-run",
		GIT_AUTHOR_EMAIL: "omk-verified-run@localhost",
		GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
		GIT_COMMITTER_NAME: "OMK verified-run",
		GIT_COMMITTER_EMAIL: "omk-verified-run@localhost",
		GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
	};
}

/** A private hooks directory belongs to this synchronous child, never to a predictable shared path. */
export function runGit(
	root: string,
	args: readonly string[],
	options: { write?: boolean; input?: Buffer; allowedExitCodes?: readonly number[]; budget?: GitOperationBudget } = {},
): { status: number; stdout: Buffer } {
	const budget = options.budget ?? new GitOperationBudget();
	budget.remaining();
	const hooks = mkdtempSync(join(tmpdir(), "omk-verified-git-"));
	try {
		chmodSync(hooks, 0o700);
		assertPrivateEmptyHooks(hooks);
		const isolated = [
			"-c",
			`core.hooksPath=${hooks}`,
			"-c",
			"core.fsmonitor=false",
			"-c",
			"gc.auto=0",
			"-c",
			"maintenance.auto=false",
			"-c",
			"commit.gpgsign=false",
			"-C",
			root,
			...args,
		];
		const timeout = budget.remaining();
		budget.record(args[0] ?? "unknown");
		const result = spawnSync("git", isolated, {
			env: gitEnvironment(options.write === true),
			maxBuffer: MAX_OUTPUT_BYTES,
			timeout,
			killSignal: "SIGKILL",
			stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
			input: options.input,
			windowsHide: true,
		});
		if (result.error !== undefined)
			throw new VerifiedRunError(options.write ? "git_outcome_unknown" : "git_plumbing");
		const allowed = options.allowedExitCodes ?? [0];
		if (result.status === null || !allowed.includes(result.status)) throw new VerifiedRunError("git_plumbing");
		return { status: result.status, stdout: result.stdout };
	} finally {
		// spawnSync has observed the direct child's exit, including SIGKILL on timeout.
		rmSync(hooks, { recursive: true, force: true });
	}
}
