import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { isEnoent, Snowflake } from "@oh-my-pi/pi-utils";
import { getWorktreeDir } from "@oh-my-pi/pi-utils/dirs";
import { $ } from "bun";

/** Baseline state for a single git repository. */
export interface RepoBaseline {
	repoRoot: string;
	staged: string;
	unstaged: string;
	untracked: string[];
}

/** Baseline state for the project, including any nested git repos. */
export interface WorktreeBaseline {
	root: RepoBaseline;
	/** Nested git repos (path relative to root.repoRoot). */
	nested: Array<{ relativePath: string; baseline: RepoBaseline }>;
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
	const worktreeDir = getWorktreeDir(encodedProject, id);
	await fs.mkdir(path.dirname(worktreeDir), { recursive: true });
	await $`git worktree remove -f ${worktreeDir}`.cwd(repoRoot).quiet().nothrow();
	await fs.rm(worktreeDir, { recursive: true, force: true });
	await $`git worktree add --detach ${worktreeDir} HEAD`.cwd(repoRoot).quiet();
	return worktreeDir;
}

/** Find nested git repositories (non-submodule) under the given root. */
async function discoverNestedRepos(repoRoot: string): Promise<string[]> {
	// Get submodule paths so we can exclude them
	const submoduleRaw = await $`git submodule --quiet foreach --recursive 'echo $sm_path'`
		.cwd(repoRoot)
		.quiet()
		.nothrow()
		.text();
	const submodulePaths = new Set(
		submoduleRaw
			.split("\n")
			.map(l => l.trim())
			.filter(Boolean),
	);

	// Find all .git dirs/files that aren't the root or known submodules
	const result: string[] = [];
	async function walk(dir: string): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			if (!entry.isDirectory()) continue;
			const full = path.join(dir, entry.name);
			const rel = path.relative(repoRoot, full);
			// Check if this directory is itself a git repo
			const gitDir = path.join(full, ".git");
			let hasGit = false;
			try {
				await fs.access(gitDir);
				hasGit = true;
			} catch {}
			if (hasGit && !submodulePaths.has(rel)) {
				result.push(rel);
				// Don't recurse into nested repos — they manage their own tree
				continue;
			}
			await walk(full);
		}
	}
	await walk(repoRoot);
	return result;
}

async function captureRepoBaseline(repoRoot: string): Promise<RepoBaseline> {
	const staged = await $`git diff --cached --binary`.cwd(repoRoot).quiet().text();
	const unstaged = await $`git diff --binary`.cwd(repoRoot).quiet().text();
	const untrackedRaw = await $`git ls-files --others --exclude-standard`.cwd(repoRoot).quiet().text();
	const untracked = untrackedRaw
		.split("\n")
		.map(line => line.trim())
		.filter(line => line.length > 0);
	return { repoRoot, staged, unstaged, untracked };
}

export async function captureBaseline(repoRoot: string): Promise<WorktreeBaseline> {
	const [root, nestedPaths] = await Promise.all([captureRepoBaseline(repoRoot), discoverNestedRepos(repoRoot)]);
	const nested = await Promise.all(
		nestedPaths.map(async relativePath => ({
			relativePath,
			baseline: await captureRepoBaseline(path.join(repoRoot, relativePath)),
		})),
	);
	return { root, nested };
}

async function writeTempPatchFile(patch: string): Promise<string> {
	const tempPath = path.join(os.tmpdir(), `omp-task-patch-${Snowflake.next()}.patch`);
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
		await fs.rm(tempPath, { force: true });
	}
}

async function applyRepoBaseline(worktreeDir: string, rb: RepoBaseline, sourceRoot: string): Promise<void> {
	await applyPatch(worktreeDir, rb.staged, { cached: true });
	await applyPatch(worktreeDir, rb.staged);
	await applyPatch(worktreeDir, rb.unstaged);

	for (const entry of rb.untracked) {
		const source = path.join(sourceRoot, entry);
		const destination = path.join(worktreeDir, entry);
		try {
			await fs.mkdir(path.dirname(destination), { recursive: true });
			await fs.cp(source, destination, { recursive: true });
		} catch (err) {
			if (isEnoent(err)) continue;
			throw err;
		}
	}
}

export async function applyBaseline(worktreeDir: string, baseline: WorktreeBaseline): Promise<void> {
	await applyRepoBaseline(worktreeDir, baseline.root, baseline.root.repoRoot);

	// Restore nested repos into the worktree
	for (const { relativePath, baseline: nb } of baseline.nested) {
		const nestedDir = path.join(worktreeDir, relativePath);
		// Copy the nested repo wholesale (it's not managed by root git)
		const sourceDir = path.join(baseline.root.repoRoot, relativePath);
		try {
			await fs.cp(sourceDir, nestedDir, { recursive: true });
		} catch (err) {
			if (isEnoent(err)) continue;
			throw err;
		}
		// Then apply any uncommitted changes from the nested baseline
		await applyRepoBaseline(nestedDir, nb, nb.repoRoot);
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
		await fs.rm(tempPath, { force: true });
	}
}

async function listUntracked(cwd: string): Promise<string[]> {
	const raw = await $`git ls-files --others --exclude-standard`.cwd(cwd).quiet().text();
	return raw
		.split("\n")
		.map(line => line.trim())
		.filter(line => line.length > 0);
}

async function captureRepoDeltaPatch(repoDir: string, rb: RepoBaseline): Promise<string> {
	const tempIndex = path.join(os.tmpdir(), `omp-task-index-${Snowflake.next()}`);
	try {
		await $`git read-tree HEAD`.cwd(repoDir).env({ GIT_INDEX_FILE: tempIndex });
		await applyPatchToIndex(repoDir, rb.staged, tempIndex);
		await applyPatchToIndex(repoDir, rb.unstaged, tempIndex);
		const diff = await $`git diff --binary`.cwd(repoDir).env({ GIT_INDEX_FILE: tempIndex }).quiet().text();

		const currentUntracked = await listUntracked(repoDir);
		const baselineUntracked = new Set(rb.untracked);
		const newUntracked = currentUntracked.filter(entry => !baselineUntracked.has(entry));

		if (newUntracked.length === 0) return diff;

		const untrackedDiffs = await Promise.all(
			newUntracked.map(entry =>
				$`git diff --binary --no-index /dev/null ${entry}`.cwd(repoDir).quiet().nothrow().text(),
			),
		);
		return `${diff}${diff && !diff.endsWith("\n") ? "\n" : ""}${untrackedDiffs.join("\n")}`;
	} finally {
		await fs.rm(tempIndex, { force: true });
	}
}

/** Rewrite a/b paths in a unified diff to be prefixed with a subdirectory. */
function prefixPatchPaths(patch: string, prefix: string): string {
	if (!patch.trim()) return patch;
	return patch.replace(/^(---|	\+\+\+) (a|b)\//gm, (_, marker, ab) => `${marker} ${ab}/${prefix}/`);
}

export async function captureDeltaPatch(isolationDir: string, baseline: WorktreeBaseline): Promise<string> {
	const rootPatch = await captureRepoDeltaPatch(isolationDir, baseline.root);
	const parts = [rootPatch];

	for (const { relativePath, baseline: nb } of baseline.nested) {
		const nestedDir = path.join(isolationDir, relativePath);
		try {
			await fs.access(path.join(nestedDir, ".git"));
		} catch {
			continue; // nested repo doesn't exist in isolation dir
		}
		const nestedPatch = await captureRepoDeltaPatch(nestedDir, nb);
		if (nestedPatch.trim()) {
			parts.push(prefixPatchPaths(nestedPatch, relativePath));
		}
	}

	return parts.filter(p => p.trim()).join("\n");
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
		await fs.rm(dir, { recursive: true, force: true });
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Fuse-overlay isolation
// ═══════════════════════════════════════════════════════════════════════════

export async function ensureFuseOverlay(baseCwd: string, id: string): Promise<string> {
	const repoRoot = await getRepoRoot(baseCwd);
	const encodedProject = getEncodedProjectName(repoRoot);
	const baseDir = getWorktreeDir(encodedProject, id);
	const upperDir = path.join(baseDir, "upper");
	const workDir = path.join(baseDir, "work");
	const mergedDir = path.join(baseDir, "merged");

	// Clean up any stale mount at this path
	const fusermount = Bun.which("fusermount3") ?? Bun.which("fusermount");
	if (fusermount) {
		await $`${fusermount} -u ${mergedDir}`.quiet().nothrow();
	}
	await fs.rm(baseDir, { recursive: true, force: true });

	await fs.mkdir(upperDir, { recursive: true });
	await fs.mkdir(workDir, { recursive: true });
	await fs.mkdir(mergedDir, { recursive: true });

	const binary = Bun.which("fuse-overlayfs");
	if (!binary) {
		await fs.rm(baseDir, { recursive: true, force: true });
		throw new Error(
			"fuse-overlayfs not found. Install it (e.g. `apt install fuse-overlayfs` or `pacman -S fuse-overlayfs`) to use fuse-overlay isolation.",
		);
	}

	const result = await $`${binary} -o lowerdir=${repoRoot},upperdir=${upperDir},workdir=${workDir} ${mergedDir}`
		.quiet()
		.nothrow();
	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString().trim();
		await fs.rm(baseDir, { recursive: true, force: true });
		throw new Error(`fuse-overlayfs mount failed (exit ${result.exitCode}): ${stderr}`);
	}

	return mergedDir;
}

export async function cleanupFuseOverlay(mergedDir: string): Promise<void> {
	try {
		const fusermount = Bun.which("fusermount3") ?? Bun.which("fusermount");
		if (fusermount) {
			await $`${fusermount} -u ${mergedDir}`.quiet().nothrow();
		}
	} finally {
		// baseDir is the parent of the merged directory
		const baseDir = path.dirname(mergedDir);
		await fs.rm(baseDir, { recursive: true, force: true });
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Branch-mode isolation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Commit task-only changes to a new branch.
 * Uses captureDeltaPatch to isolate the task's changes from the baseline,
 * then applies that patch on a clean branch from HEAD.
 * Returns the branch name, or null if no changes to commit.
 */
export async function commitToBranch(
	isolationDir: string,
	baseline: WorktreeBaseline,
	taskId: string,
	description: string | undefined,
): Promise<string | null> {
	// Capture root patch and nested patches separately
	const rootPatch = await captureRepoDeltaPatch(isolationDir, baseline.root);
	const nestedChanges: Array<{ relativePath: string; patch: string }> = [];
	for (const { relativePath, baseline: nb } of baseline.nested) {
		const nestedDir = path.join(isolationDir, relativePath);
		try {
			await fs.access(path.join(nestedDir, ".git"));
		} catch {
			continue;
		}
		const np = await captureRepoDeltaPatch(nestedDir, nb);
		if (np.trim()) nestedChanges.push({ relativePath, patch: np });
	}

	const hasChanges = rootPatch.trim() || nestedChanges.length > 0;
	if (!hasChanges) return null;

	const repoRoot = baseline.root.repoRoot;
	const branchName = `omp/task/${taskId}`;
	const commitMessage = description || taskId;

	await $`git branch ${branchName} HEAD`.cwd(repoRoot).quiet();

	const tmpDir = path.join(os.tmpdir(), `omp-branch-${Snowflake.next()}`);
	try {
		await $`git worktree add ${tmpDir} ${branchName}`.cwd(repoRoot).quiet();

		// Apply root repo patch via git apply
		if (rootPatch.trim()) {
			const patchPath = path.join(os.tmpdir(), `omp-branch-patch-${Snowflake.next()}.patch`);
			try {
				await Bun.write(patchPath, rootPatch);
				await $`git apply --binary ${patchPath}`.cwd(tmpDir).quiet();
			} finally {
				await fs.rm(patchPath, { force: true });
			}
		}

		// Copy nested repo changes directly (they aren't tracked by root git)
		for (const { relativePath } of nestedChanges) {
			const nestedSrc = path.join(isolationDir, relativePath);
			const nestedDst = path.join(tmpDir, relativePath);
			await fs.cp(nestedSrc, nestedDst, { recursive: true });
		}

		await $`git add -A`.cwd(tmpDir).quiet();
		await $`git -c user.name=omp -c user.email=omp@task commit -m ${commitMessage}`.cwd(tmpDir).quiet();
	} finally {
		await $`git worktree remove -f ${tmpDir}`.cwd(repoRoot).quiet().nothrow();
		await fs.rm(tmpDir, { recursive: true, force: true });
	}

	return branchName;
}

export interface MergeBranchResult {
	merged: string[];
	failed: string[];
	conflict?: string;
}

/**
 * Merge task branches sequentially into the working tree.
 * Each branch gets a --no-ff merge commit preserving the task identity.
 * Stops on first conflict and reports which branches succeeded.
 */
export async function mergeTaskBranches(
	repoRoot: string,
	branches: Array<{ branchName: string; taskId: string; description?: string }>,
): Promise<MergeBranchResult> {
	const merged: string[] = [];
	const failed: string[] = [];

	for (const { branchName, taskId, description } of branches) {
		const mergeMessage = description || taskId;

		const result = await $`git merge --no-ff -m ${mergeMessage} ${branchName}`.cwd(repoRoot).quiet().nothrow();

		if (result.exitCode !== 0) {
			// Abort the failed merge to restore clean state
			await $`git merge --abort`.cwd(repoRoot).quiet().nothrow();
			const stderr = result.stderr.toString().trim();
			failed.push(branchName);
			return {
				merged,
				failed: [...failed, ...branches.slice(merged.length + failed.length).map(b => b.branchName)],
				conflict: `${branchName}: ${stderr}`,
			};
		}

		merged.push(branchName);
	}

	return { merged, failed };
}

/** Clean up temporary task branches. */
export async function cleanupTaskBranches(repoRoot: string, branches: string[]): Promise<void> {
	for (const branch of branches) {
		await $`git branch -D ${branch}`.cwd(repoRoot).quiet().nothrow();
	}
}
