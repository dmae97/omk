import { nanoid } from "nanoid";
import { WorktreeError, WorktreeErrorCode } from "./errors";
import { git, gitWithInput } from "./git";
import { find, remove, type Worktree } from "./operations";

export type CollapseStrategy = "simple" | "merge-base" | "rebase";

export interface CollapseOptions {
	strategy?: CollapseStrategy;
	keepSource?: boolean;
}

export interface CollapseResult {
	filesChanged: number;
	insertions: number;
	deletions: number;
}

function diffStats(diff: string): CollapseResult {
	let filesChanged = 0;
	let insertions = 0;
	let deletions = 0;

	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) {
			filesChanged += 1;
			continue;
		}
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) {
			insertions += 1;
			continue;
		}
		if (line.startsWith("-")) {
			deletions += 1;
		}
	}

	return { filesChanged, insertions, deletions };
}

async function requireGitSuccess(result: { code: number; stderr: string }, message: string): Promise<void> {
	if (result.code !== 0) {
		throw new WorktreeError(
			message + (result.stderr ? `\n${result.stderr.trim()}` : ""),
			WorktreeErrorCode.COLLAPSE_FAILED,
		);
	}
}

async function ensureHasChanges(result: { stdout: string }): Promise<string> {
	const diff = result.stdout;
	if (!diff.trim()) {
		throw new WorktreeError("No changes to collapse", WorktreeErrorCode.NO_CHANGES);
	}
	return diff;
}

async function collapseSimple(src: Worktree): Promise<string> {
	await requireGitSuccess(await git(["add", "-A"], src.path), "Failed to stage changes");
	return ensureHasChanges(await git(["diff", "HEAD"], src.path));
}

async function collapseMergeBase(src: Worktree, dst: Worktree): Promise<string> {
	await requireGitSuccess(await git(["add", "-A"], src.path), "Failed to stage changes");

	const baseResult = await git(["merge-base", "HEAD", dst.branch ?? "HEAD"], src.path);
	if (baseResult.code !== 0) {
		throw new WorktreeError("Could not find merge base", WorktreeErrorCode.COLLAPSE_FAILED);
	}

	const base = baseResult.stdout.trim();
	if (!base) {
		throw new WorktreeError("Could not find merge base", WorktreeErrorCode.COLLAPSE_FAILED);
	}

	return ensureHasChanges(await git(["diff", base], src.path));
}

async function collapseRebase(src: Worktree, dst: Worktree): Promise<string> {
	await requireGitSuccess(await git(["add", "-A"], src.path), "Failed to stage changes");

	const stagedResult = await git(["diff", "--cached", "--name-only"], src.path);
	if (!stagedResult.stdout.trim()) {
		throw new WorktreeError("No changes to collapse", WorktreeErrorCode.NO_CHANGES);
	}

	const headResult = await git(["rev-parse", "HEAD"], src.path);
	if (headResult.code !== 0) {
		throw new WorktreeError("Failed to resolve HEAD", WorktreeErrorCode.COLLAPSE_FAILED);
	}
	const originalHead = headResult.stdout.trim();
	const tempBranch = `wt-collapse-${nanoid()}`;

	await requireGitSuccess(await git(["checkout", "-b", tempBranch], src.path), "Failed to create temp branch");

	const commitResult = await git(["commit", "--allow-empty-message", "-m", ""], src.path);
	if (commitResult.code !== 0) {
		await git(["checkout", originalHead], src.path);
		await git(["branch", "-D", tempBranch], src.path);
		throw new WorktreeError("Failed to commit changes", WorktreeErrorCode.COLLAPSE_FAILED);
	}

	const rebaseResult = await git(["rebase", dst.branch ?? "HEAD"], src.path);
	if (rebaseResult.code !== 0) {
		await git(["rebase", "--abort"], src.path);
		await git(["checkout", originalHead], src.path);
		await git(["branch", "-D", tempBranch], src.path);
		throw new WorktreeError(
			`Rebase conflicts:${rebaseResult.stderr ? `\n${rebaseResult.stderr.trim()}` : ""}`,
			WorktreeErrorCode.REBASE_CONFLICTS,
		);
	}

	const diffResult = await git(["diff", `${dst.branch ?? "HEAD"}..HEAD`], src.path);

	await git(["checkout", originalHead], src.path);
	await git(["branch", "-D", tempBranch], src.path);

	return ensureHasChanges(diffResult);
}

async function applyDiff(diff: string, targetPath: string): Promise<void> {
	let result = await gitWithInput(["apply"], diff, targetPath);
	if (result.code === 0) return;

	result = await gitWithInput(["apply", "--3way"], diff, targetPath);
	if (result.code === 0) return;

	throw new WorktreeError(
		`Failed to apply diff:${result.stderr ? `\n${result.stderr.trim()}` : ""}`,
		WorktreeErrorCode.APPLY_FAILED,
	);
}

/**
 * Collapse changes from source worktree into destination.
 */
export async function collapse(
	source: string,
	destination: string,
	options?: CollapseOptions,
): Promise<CollapseResult> {
	const src = await find(source);
	const dst = await find(destination);

	if (src.path === dst.path) {
		throw new WorktreeError("Source and destination are the same", WorktreeErrorCode.COLLAPSE_FAILED);
	}

	if (!options?.keepSource && src.isMain) {
		throw new WorktreeError("Cannot remove main worktree", WorktreeErrorCode.CANNOT_MODIFY_MAIN);
	}

	const strategy = options?.strategy ?? "rebase";
	let diff: string;

	switch (strategy) {
		case "simple":
			diff = await collapseSimple(src);
			break;
		case "merge-base":
			diff = await collapseMergeBase(src, dst);
			break;
		case "rebase":
			diff = await collapseRebase(src, dst);
			break;
		default:
			throw new WorktreeError(`Unknown strategy: ${strategy}`, WorktreeErrorCode.COLLAPSE_FAILED);
	}

	const stats = diffStats(diff);
	await applyDiff(diff, dst.path);

	if (!options?.keepSource) {
		await remove(src.path, { force: true });
	}

	return stats;
}
