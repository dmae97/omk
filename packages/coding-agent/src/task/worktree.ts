import { randomUUID } from "node:crypto";
import { cp, mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { $ } from "bun";

export interface WorktreeBaseline {
	repoRoot: string;
	staged: string;
	unstaged: string;
	untracked: string[];
}

export function getEncodedProjectName(cwd: string): string {
	return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export async function getRepoRoot(cwd: string): Promise<string> {
	const result = await $`git rev-parse --show-toplevel`.cwd(cwd).quiet().nothrow();
	if (result.exitCode !== 0) {
		throw new Error("Git repository not found for isolated task execution.");
	}
	const repoRoot = result.text().trim();
	if (!repoRoot) {
		throw new Error("Git repository root could not be resolved for isolated task execution.");
	}
	return repoRoot;
}

export async function ensureWorktree(baseCwd: string, id: string): Promise<string> {
	const repoRoot = await getRepoRoot(baseCwd);
	const encodedProject = getEncodedProjectName(repoRoot);
	const worktreeDir = path.join(homedir(), ".omp", "wt", encodedProject, id);
	await mkdir(path.dirname(worktreeDir), { recursive: true });
	await $`git worktree remove -f ${worktreeDir}`.cwd(repoRoot).quiet().nothrow();
	await rm(worktreeDir, { recursive: true, force: true });
	await $`git worktree add --detach ${worktreeDir} HEAD`.cwd(repoRoot).quiet();
	return worktreeDir;
}

export async function captureBaseline(repoRoot: string): Promise<WorktreeBaseline> {
	const staged = await $`git diff --cached --binary`.cwd(repoRoot).quiet().text();
	const unstaged = await $`git diff --binary`.cwd(repoRoot).quiet().text();
	const untrackedRaw = await $`git ls-files --others --exclude-standard`.cwd(repoRoot).quiet().text();
	const untracked = untrackedRaw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	return {
		repoRoot,
		staged,
		unstaged,
		untracked,
	};
}

async function writeTempPatchFile(patch: string): Promise<string> {
	const tempPath = path.join(tmpdir(), `omp-task-patch-${randomUUID()}.patch`);
	await Bun.write(tempPath, patch);
	return tempPath;
}

async function applyPatch(
	cwd: string,
	patch: string,
	options?: { cached?: boolean; env?: Record<string, string> },
): Promise<void> {
	if (!patch.trim()) return;
	const tempPath = await writeTempPatchFile(patch);
	try {
		const command = options?.cached ? $`git apply --cached --binary ${tempPath}` : $`git apply --binary ${tempPath}`;
		let runner = command.cwd(cwd).quiet();
		if (options?.env) {
			runner = runner.env(options.env);
		}
		await runner;
	} finally {
		await rm(tempPath, { force: true });
	}
}

export async function applyBaseline(worktreeDir: string, baseline: WorktreeBaseline): Promise<void> {
	await applyPatch(worktreeDir, baseline.staged, { cached: true });
	await applyPatch(worktreeDir, baseline.staged);
	await applyPatch(worktreeDir, baseline.unstaged);

	for (const entry of baseline.untracked) {
		const source = path.join(baseline.repoRoot, entry);
		const destination = path.join(worktreeDir, entry);
		const exists = await Bun.file(source).exists();
		if (!exists) continue;
		await mkdir(path.dirname(destination), { recursive: true });
		await cp(source, destination, { recursive: true });
	}
}

async function applyPatchToIndex(cwd: string, patch: string, indexFile: string): Promise<void> {
	if (!patch.trim()) return;
	const tempPath = await writeTempPatchFile(patch);
	try {
		await $`git apply --cached --binary ${tempPath}`
			.cwd(cwd)
			.env({
				GIT_INDEX_FILE: indexFile,
			})
			.quiet();
	} finally {
		await rm(tempPath, { force: true });
	}
}

async function listUntracked(cwd: string): Promise<string[]> {
	const raw = await $`git ls-files --others --exclude-standard`.cwd(cwd).quiet().text();
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export async function captureDeltaPatch(worktreeDir: string, baseline: WorktreeBaseline): Promise<string> {
	const tempIndex = path.join(tmpdir(), `omp-task-index-${randomUUID()}`);
	try {
		await $`git read-tree HEAD`.cwd(worktreeDir).env({
			GIT_INDEX_FILE: tempIndex,
		});
		await applyPatchToIndex(worktreeDir, baseline.staged, tempIndex);
		await applyPatchToIndex(worktreeDir, baseline.unstaged, tempIndex);
		const diff = await $`git diff --binary`
			.cwd(worktreeDir)
			.env({
				GIT_INDEX_FILE: tempIndex,
			})
			.quiet()
			.text();

		const currentUntracked = await listUntracked(worktreeDir);
		const baselineUntracked = new Set(baseline.untracked);
		const newUntracked = currentUntracked.filter((entry) => !baselineUntracked.has(entry));

		if (newUntracked.length === 0) return diff;

		const untrackedDiffs = await Promise.all(
			newUntracked.map((entry) =>
				$`git diff --binary --no-index /dev/null ${entry}`.cwd(worktreeDir).quiet().nothrow().text(),
			),
		);
		return `${diff}${diff && !diff.endsWith("\n") ? "\n" : ""}${untrackedDiffs.join("\n")}`;
	} finally {
		await rm(tempIndex, { force: true });
	}
}

export async function cleanupWorktree(dir: string): Promise<void> {
	try {
		const commonDirRaw = await $`git rev-parse --git-common-dir`.cwd(dir).quiet().nothrow().text();
		const commonDir = commonDirRaw.trim();
		if (commonDir) {
			const resolvedCommon = path.resolve(dir, commonDir);
			const repoRoot = path.dirname(resolvedCommon);
			await $`git worktree remove -f ${dir}`.cwd(repoRoot).quiet().nothrow();
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
