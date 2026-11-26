import { execFile } from "node:child_process";
import path from "node:path";
import {
	type BranchBackend,
	parseBranchListPorcelain,
	parseHerdrPaneId,
	parseWorktreePorcelain,
	type RepoBranchSnapshot,
	slugifyWorktreeDir,
	validateBranchName,
} from "./git-branch-parsers.ts";

export {
	type BranchBackend,
	type BranchCommandAction,
	formatBranchBadge,
	formatBranchSnapshotSummary,
	type GitBranchEntry,
	type GitWorktreeEntry,
	parseBranchCommandArgs,
	parseBranchListPorcelain,
	parseHerdrPaneId,
	parseWorktreePorcelain,
	type RepoBranchSnapshot,
	slugifyWorktreeDir,
	validateBranchName,
} from "./git-branch-parsers.ts";

export interface CommandResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export type CommandRunner = (file: string, args: readonly string[], cwd: string) => Promise<CommandResult>;

export type BranchOpResult =
	| {
			readonly ok: true;
			readonly message: string;
			readonly backend: BranchBackend;
			readonly branch?: string;
			readonly worktreePath?: string;
			readonly paneId?: string;
	  }
	| { readonly ok: false; readonly error: string; readonly backend: BranchBackend };

export const defaultCommandRunner: CommandRunner = (file, args, cwd) =>
	new Promise((resolve) => {
		execFile(file, [...args], { cwd, encoding: "utf8", timeout: 10_000 }, (error, stdout, stderr) => {
			if (error) {
				const code = typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1;
				resolve({ exitCode: code, stdout: stdout ?? "", stderr: stderr || error.message });
				return;
			}
			resolve({ exitCode: 0, stdout: stdout ?? "", stderr: stderr ?? "" });
		});
	});

export async function readRepoBranchSnapshot(
	cwd: string,
	opts: { readonly runner?: CommandRunner; readonly herdrActive?: boolean } = {},
): Promise<RepoBranchSnapshot> {
	const runner = opts.runner ?? defaultCommandRunner;
	const backend: BranchBackend = opts.herdrActive ? "herdr" : "git";
	const rootRes = await runner("git", ["rev-parse", "--show-toplevel"], cwd);
	if (rootRes.exitCode !== 0 || !rootRes.stdout.trim()) {
		return { inRepo: false, currentBranch: null, dirtyCount: 0, branches: [], worktrees: [], backend };
	}
	const repoRoot = rootRes.stdout.trim();
	const [headRes, statusRes, branchRes, wtRes] = await Promise.all([
		runner("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], repoRoot),
		runner("git", ["status", "--porcelain"], repoRoot),
		runner(
			"git",
			["for-each-ref", "--format=%(HEAD)\t%(refname:short)\t%(upstream:short)\t%(upstream:track)", "refs/heads"],
			repoRoot,
		),
		runner("git", ["worktree", "list", "--porcelain"], repoRoot),
	]);
	const dirtyCount = statusRes.exitCode === 0 ? statusRes.stdout.split("\n").filter((l) => l.trim()).length : 0;
	return {
		inRepo: true,
		repoRoot,
		currentBranch: headRes.exitCode === 0 && headRes.stdout.trim() ? headRes.stdout.trim() : "detached",
		dirtyCount,
		branches: branchRes.exitCode === 0 ? parseBranchListPorcelain(branchRes.stdout) : [],
		worktrees: wtRes.exitCode === 0 ? parseWorktreePorcelain(wtRes.stdout) : [],
		backend,
	};
}

export async function switchGitBranch(
	cwd: string,
	name: string,
	opts: { readonly runner?: CommandRunner; readonly allowDirty?: boolean } = {},
): Promise<BranchOpResult> {
	const err = validateBranchName(name);
	if (err) return { ok: false, error: err, backend: "git" };
	const runner = opts.runner ?? defaultCommandRunner;
	if (!opts.allowDirty) {
		const status = await runner("git", ["status", "--porcelain"], cwd);
		const dirty = status.stdout.split("\n").filter((l) => l.trim()).length;
		if (status.exitCode === 0 && dirty > 0) {
			return {
				ok: false,
				error: `Working tree is dirty (${dirty} file(s)). Commit, stash, or use /branch worktree ${name}.`,
				backend: "git",
			};
		}
	}
	const res = await runner("git", ["switch", name], cwd);
	if (res.exitCode !== 0)
		return { ok: false, error: res.stderr.trim() || `git switch ${name} failed`, backend: "git" };
	return { ok: true, message: `Switched to branch ${name}.`, backend: "git", branch: name };
}

export async function createGitBranch(
	cwd: string,
	name: string,
	base?: string,
	opts: { readonly runner?: CommandRunner } = {},
): Promise<BranchOpResult> {
	const err = validateBranchName(name);
	if (err) return { ok: false, error: err, backend: "git" };
	const runner = opts.runner ?? defaultCommandRunner;
	const args = base ? ["switch", "-c", name, base] : ["switch", "-c", name];
	const res = await runner("git", args, cwd);
	if (res.exitCode !== 0)
		return { ok: false, error: res.stderr.trim() || `git switch -c ${name} failed`, backend: "git" };
	return { ok: true, message: `Created and switched to branch ${name}.`, backend: "git", branch: name };
}

export async function createBranchWorktree(
	cwd: string,
	name: string,
	opts: {
		readonly base?: string;
		readonly openPane?: boolean;
		readonly runner?: CommandRunner;
		readonly herdrActive?: boolean;
	} = {},
): Promise<BranchOpResult> {
	const err = validateBranchName(name);
	if (err) return { ok: false, error: err, backend: opts.herdrActive ? "herdr" : "git" };
	const runner = opts.runner ?? defaultCommandRunner;
	const rootRes = await runner("git", ["rev-parse", "--show-toplevel"], cwd);
	if (rootRes.exitCode !== 0 || !rootRes.stdout.trim())
		return { ok: false, error: "Not inside a git repository.", backend: "git" };
	const repoRoot = rootRes.stdout.trim();
	const wtPath = path.join(repoRoot, ".worktrees", slugifyWorktreeDir(name));
	const existsRes = await runner("git", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], repoRoot);
	const addArgs =
		existsRes.exitCode === 0
			? ["worktree", "add", wtPath, name]
			: opts.base
				? ["worktree", "add", "-b", name, wtPath, opts.base]
				: ["worktree", "add", "-b", name, wtPath];
	const addRes = await runner("git", addArgs, repoRoot);
	if (addRes.exitCode !== 0)
		return { ok: false, error: addRes.stderr.trim() || "git worktree add failed", backend: "git" };
	if (opts.herdrActive && opts.openPane) {
		const split = await runner(
			"herdr",
			["pane", "split", "--current", "--direction", "right", "--cwd", wtPath, "--no-focus"],
			wtPath,
		);
		const paneId = split.exitCode === 0 ? parseHerdrPaneId(split.stdout) : undefined;
		if (paneId) {
			await runner("herdr", ["pane", "run", paneId, "omk"], wtPath);
			return {
				ok: true,
				message: `Worktree ${name} ready at ${wtPath} (Herdr pane ${paneId}).`,
				backend: "herdr",
				branch: name,
				worktreePath: wtPath,
				paneId,
			};
		}
		return {
			ok: true,
			message: `Worktree ${name} ready at ${wtPath} (Herdr pane split skipped: ${split.stderr.trim() || "herdr unavailable"}).`,
			backend: "git",
			branch: name,
			worktreePath: wtPath,
		};
	}
	return {
		ok: true,
		message: `Worktree ${name} ready at ${wtPath}.`,
		backend: "git",
		branch: name,
		worktreePath: wtPath,
	};
}

export async function pruneSafeWorktrees(
	cwd: string,
	apply: boolean,
	opts: { readonly runner?: CommandRunner } = {},
): Promise<BranchOpResult> {
	const runner = opts.runner ?? defaultCommandRunner;
	const res = await runner("git", apply ? ["worktree", "prune", "-v"] : ["worktree", "prune", "--dry-run", "-v"], cwd);
	if (res.exitCode !== 0)
		return { ok: false, error: res.stderr.trim() || "git worktree prune failed", backend: "git" };
	const out = res.stdout.trim() || "No stale worktree metadata to prune.";
	return {
		ok: true,
		message: apply ? `Pruned worktrees:\n${out}` : `Prune dry-run (add --apply to run):\n${out}`,
		backend: "git",
	};
}

export async function openHerdrPlanPane(
	cwd: string,
	goal: string | undefined,
	opts: { readonly runner?: CommandRunner; readonly herdrActive?: boolean } = {},
): Promise<BranchOpResult> {
	if (!opts.herdrActive) {
		return { ok: false, error: "Not running inside Herdr (HERDR_ENV=1 required for sibling pane).", backend: "git" };
	}
	const runner = opts.runner ?? defaultCommandRunner;
	const split = await runner(
		"herdr",
		["pane", "split", "--current", "--direction", "right", "--cwd", cwd, "--no-focus"],
		cwd,
	);
	const paneId = split.exitCode === 0 ? parseHerdrPaneId(split.stdout) : undefined;
	if (!paneId) return { ok: false, error: split.stderr.trim() || "herdr pane split failed.", backend: "herdr" };
	await runner("herdr", ["pane", "run", paneId, "omk"], cwd);
	return {
		ok: true,
		message: `Opened Herdr sibling pane ${paneId} in ${cwd}${goal ? ` for "${goal}"` : ""}.`,
		backend: "herdr",
		paneId,
	};
}

export async function executeBranchAction(
	cwd: string,
	action: {
		readonly kind: "switch" | "create" | "worktree" | "prune";
		readonly name?: string;
		readonly base?: string;
		readonly openPane?: boolean;
		readonly apply?: boolean;
	},
	opts: { readonly runner?: CommandRunner; readonly herdrActive?: boolean } = {},
): Promise<BranchOpResult> {
	if (action.kind === "switch") return switchGitBranch(cwd, action.name ?? "", { runner: opts.runner });
	if (action.kind === "create") return createGitBranch(cwd, action.name ?? "", action.base, { runner: opts.runner });
	if (action.kind === "worktree") {
		return createBranchWorktree(cwd, action.name ?? "", {
			base: action.base,
			openPane: Boolean(action.openPane || opts.herdrActive),
			runner: opts.runner,
			herdrActive: opts.herdrActive,
		});
	}
	return pruneSafeWorktrees(cwd, Boolean(action.apply), { runner: opts.runner });
}
