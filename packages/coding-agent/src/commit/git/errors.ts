export class GitError extends Error {
	readonly command: string;
	readonly stderr: string;

	constructor(command: string, stderr: string) {
		super(`${command} failed: ${stderr || "unknown error"}`);
		this.command = command;
		this.stderr = stderr;
		this.name = "GitError";
	}
}
