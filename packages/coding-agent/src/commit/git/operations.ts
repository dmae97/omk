import { $ } from "bun";

interface GitResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export async function runGitCommand(cwd: string, args: string[]): Promise<GitResult> {
	const result = await $`git ${args}`.cwd(cwd).quiet().nothrow();
	const stdout = result.text();
	const stderr = result.stderr?.toString() ?? "";
	return {
		exitCode: result.exitCode ?? 0,
		stdout,
		stderr,
	};
}

export async function stageFiles(cwd: string, files: string[]): Promise<GitResult> {
	const args = files.length === 0 ? ["add", "-A"] : ["add", "--", ...files];
	return runGitCommand(cwd, args);
}

export async function resetStaging(cwd: string, files: string[]): Promise<GitResult> {
	const args = files.length === 0 ? ["reset"] : ["reset", "--", ...files];
	return runGitCommand(cwd, args);
}

export async function push(cwd: string): Promise<GitResult> {
	return runGitCommand(cwd, ["push"]);
}

export async function commit(cwd: string, message: string): Promise<GitResult> {
	const child = Bun.spawn(["git", "commit", "-F", "-"], {
		cwd,
		stdin: Buffer.from(message),
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);

	return {
		exitCode: exitCode ?? 0,
		stdout: stdout.trim(),
		stderr: stderr.trim(),
	};
}
