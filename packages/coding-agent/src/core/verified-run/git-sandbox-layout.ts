import { lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { VerifiedRunError } from "./storage.ts";

/** The initial owned publisher supports a real .git directory, not external worktree aliases. */
export function ownedGitDirectory(workspace: string): string {
	const path = join(realpathSync(workspace), ".git");
	try {
		const stat = lstatSync(path);
		if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path))
			throw new VerifiedRunError("unsupported_git_layout");
		return path;
	} catch (error) {
		if (error instanceof VerifiedRunError) throw error;
		throw new VerifiedRunError("unsupported_git_layout");
	}
}

export function ownedGitMounts(workspace: string): readonly string[] {
	return [
		"--bind",
		ownedGitDirectory(workspace),
		"/workspace/.git",
		"--ro-bind",
		realpathSync(process.execPath),
		"/omk-node",
	];
}
