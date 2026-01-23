import { logger } from "@oh-my-pi/pi-utils";
import { parseDiffHunks, parseFileDiffs, parseNumstat } from "$c/commit/git/diff";
import { GitError } from "$c/commit/git/errors";
import { commit, push, resetStaging, runGitCommand, stageFiles } from "$c/commit/git/operations";
import type { FileDiff, FileHunks, NumstatEntry } from "$c/commit/types";

export class ControlledGit {
	constructor(private readonly cwd: string) {}

	async getDiff(staged: boolean): Promise<string> {
		const args = staged ? ["diff", "--cached"] : ["diff"];
		const result = await runGitCommand(this.cwd, args);
		this.ensureSuccess(result, "git diff");
		return result.stdout;
	}

	async getDiffForFiles(files: string[], staged = true): Promise<string> {
		const args = staged ? ["diff", "--cached", "--", ...files] : ["diff", "--", ...files];
		const result = await runGitCommand(this.cwd, args);
		this.ensureSuccess(result, "git diff (files)");
		return result.stdout;
	}

	async getChangedFiles(staged: boolean): Promise<string[]> {
		const args = staged ? ["diff", "--cached", "--name-only"] : ["diff", "--name-only"];
		const result = await runGitCommand(this.cwd, args);
		this.ensureSuccess(result, "git diff --name-only");
		return result.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	}

	async getStat(staged: boolean): Promise<string> {
		const args = staged ? ["diff", "--cached", "--stat"] : ["diff", "--stat"];
		const result = await runGitCommand(this.cwd, args);
		this.ensureSuccess(result, "git diff --stat");
		return result.stdout;
	}

	async getStatForFiles(files: string[], staged = true): Promise<string> {
		const args = staged ? ["diff", "--cached", "--stat", "--", ...files] : ["diff", "--stat", "--", ...files];
		const result = await runGitCommand(this.cwd, args);
		this.ensureSuccess(result, "git diff --stat (files)");
		return result.stdout;
	}

	async getNumstat(staged: boolean): Promise<NumstatEntry[]> {
		const args = staged ? ["diff", "--cached", "--numstat"] : ["diff", "--numstat"];
		const result = await runGitCommand(this.cwd, args);
		this.ensureSuccess(result, "git diff --numstat");
		return parseNumstat(result.stdout);
	}

	async getRecentCommits(count: number): Promise<string[]> {
		const result = await runGitCommand(this.cwd, ["log", `-n${count}`, "--pretty=format:%s"]);
		this.ensureSuccess(result, "git log");
		return result.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	}

	async getStagedFiles(): Promise<string[]> {
		const result = await runGitCommand(this.cwd, ["diff", "--cached", "--name-only"]);
		this.ensureSuccess(result, "git diff --cached --name-only");
		return result.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	}

	async getUntrackedFiles(): Promise<string[]> {
		const result = await runGitCommand(this.cwd, ["ls-files", "--others", "--exclude-standard"]);
		this.ensureSuccess(result, "git ls-files --others --exclude-standard");
		return result.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	}

	async stageAll(): Promise<void> {
		const result = await stageFiles(this.cwd, []);
		this.ensureSuccess(result, "git add -A");
	}

	async stageFiles(files: string[]): Promise<void> {
		const result = await stageFiles(this.cwd, files);
		this.ensureSuccess(result, "git add");
	}

	async resetStaging(files: string[] = []): Promise<void> {
		const result = await resetStaging(this.cwd, files);
		this.ensureSuccess(result, "git reset");
	}

	async commit(message: string): Promise<void> {
		const result = await commit(this.cwd, message);
		this.ensureSuccess(result, "git commit");
	}

	async push(): Promise<void> {
		const result = await push(this.cwd);
		this.ensureSuccess(result, "git push");
	}

	parseDiffFiles(diff: string): FileDiff[] {
		return parseFileDiffs(diff);
	}

	parseDiffHunks(diff: string): FileHunks[] {
		return parseDiffHunks(diff);
	}

	async getHunks(files: string[], staged = true): Promise<FileHunks[]> {
		const diff = await this.getDiffForFiles(files, staged);
		return this.parseDiffHunks(diff);
	}

	private ensureSuccess(result: { exitCode: number; stderr: string }, label: string): void {
		if (result.exitCode !== 0) {
			logger.error("commit git command failed", { label, stderr: result.stderr });
			throw new GitError(label, result.stderr);
		}
	}
}
