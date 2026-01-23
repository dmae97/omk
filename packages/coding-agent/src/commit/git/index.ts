import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { parseDiffHunks, parseFileDiffs, parseFileHunks, parseNumstat } from "$c/commit/git/diff";
import { GitError } from "$c/commit/git/errors";
import { commit, push, resetStaging, runGitCommand, stageFiles } from "$c/commit/git/operations";
import type { FileDiff, FileHunks, NumstatEntry } from "$c/commit/types";

export type HunkSelection =
	| { path: string; hunks: { type: "all" } }
	| { path: string; hunks: { type: "indices"; indices: number[] } }
	| { path: string; hunks: { type: "lines"; start: number; end: number } };

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

	async stageHunks(selections: HunkSelection[]): Promise<void> {
		if (selections.length === 0) return;
		const diff = await this.getDiff(false);
		const fileDiffs = parseFileDiffs(diff);
		const fileDiffMap = new Map(fileDiffs.map((entry) => [entry.filename, entry]));
		const patchParts: string[] = [];
		for (const selection of selections) {
			const fileDiff = fileDiffMap.get(selection.path);
			if (!fileDiff) {
				throw new GitError("git apply --cached", `No diff found for ${selection.path}`);
			}
			if (fileDiff.isBinary) {
				if (selection.hunks.type !== "all") {
					throw new GitError(
						"git apply --cached",
						`Cannot select hunks for binary file ${selection.path}`,
					);
				}
				patchParts.push(fileDiff.content);
				continue;
			}

			if (selection.hunks.type === "all") {
				patchParts.push(fileDiff.content);
				continue;
			}

			const fileHunks = parseFileHunks(fileDiff);
			const selectedHunks = selectHunks(fileHunks, selection.hunks);
			if (selectedHunks.length === 0) {
				throw new GitError("git apply --cached", `No hunks selected for ${selection.path}`);
			}
			const header = extractFileHeader(fileDiff.content);
			const filePatch = [header, ...selectedHunks.map((hunk) => hunk.content)].join("\n");
			patchParts.push(filePatch);
		}

		const patch = joinPatch(patchParts);
		if (!patch.trim()) return;
		const tempPath = join(tmpdir(), `omp-hunks-${randomUUID()}.patch`);
		try {
			await Bun.write(tempPath, patch);
			const result = await runGitCommand(this.cwd, ["apply", "--cached", "--binary", tempPath]);
			this.ensureSuccess(result, "git apply --cached");
		} finally {
			await rm(tempPath, { force: true });
		}
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

function extractFileHeader(diff: string): string {
	const lines = diff.split("\n");
	const headerLines: string[] = [];
	for (const line of lines) {
		if (line.startsWith("@@")) break;
		headerLines.push(line);
	}
	return headerLines.join("\n");
}

function joinPatch(parts: string[]): string {
	return parts
		.map((part) => (part.endsWith("\n") ? part : `${part}\n`))
		.join("\n")
		.trimEnd()
		.concat("\n");
}

function selectHunks(file: FileHunks, selector: HunkSelection["hunks"]): FileHunks["hunks"] {
	if (selector.type === "indices") {
		const wanted = new Set(selector.indices.map((value) => Math.max(1, Math.floor(value))));
		return file.hunks.filter((hunk) => wanted.has(hunk.index + 1));
	}
	if (selector.type === "lines") {
		const start = Math.floor(selector.start);
		const end = Math.floor(selector.end);
		return file.hunks.filter((hunk) => hunk.newStart <= end && hunk.newStart + hunk.newLines - 1 >= start);
	}
	return file.hunks;
}
