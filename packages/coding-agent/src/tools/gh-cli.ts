import { ToolAbortError, ToolError, throwIfAborted } from "./tool-errors";

export interface GhCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface GhCommandOptions {
	repoProvided?: boolean;
	trimOutput?: boolean;
}

export function isGhAvailable(): boolean {
	return Boolean(Bun.which("gh"));
}

function formatGhFailure(args: string[], stdout: string, stderr: string, options?: GhCommandOptions): string {
	const output = stderr || stdout;
	const message = output.trim();

	if (message.includes("gh auth login") || message.includes("not logged into any GitHub hosts")) {
		return "GitHub CLI is not authenticated. Run `gh auth login`.";
	}

	if (
		!options?.repoProvided &&
		(message.includes("not a git repository") ||
			message.includes("no git remotes found") ||
			message.includes("unable to determine current repository"))
	) {
		return "GitHub repository context is unavailable. Pass `repo` explicitly or run the tool inside a GitHub checkout.";
	}

	if (message.length > 0) {
		return message;
	}

	return `GitHub CLI command failed: gh ${args.join(" ")}`;
}

export async function runGhCommand(
	cwd: string,
	args: string[],
	signal?: AbortSignal,
	options?: GhCommandOptions,
): Promise<GhCommandResult> {
	throwIfAborted(signal);

	if (!isGhAvailable()) {
		throw new ToolError("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/.");
	}

	try {
		const child = Bun.spawn(["gh", ...args], {
			cwd,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			windowsHide: true,
			signal,
		});

		if (!child.stdout || !child.stderr) {
			throw new ToolError("Failed to capture GitHub CLI output.");
		}

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);

		throwIfAborted(signal);

		return {
			exitCode: exitCode ?? 0,
			stdout: options?.trimOutput === false ? stdout : stdout.trim(),
			stderr: options?.trimOutput === false ? stderr : stderr.trim(),
		};
	} catch (error) {
		if (signal?.aborted) {
			throw new ToolAbortError();
		}
		throw error;
	}
}

export async function runGhJson<T>(
	cwd: string,
	args: string[],
	signal?: AbortSignal,
	options?: GhCommandOptions,
): Promise<T> {
	const result = await runGhCommand(cwd, args, signal, options);

	if (result.exitCode !== 0) {
		throw new ToolError(formatGhFailure(args, result.stdout, result.stderr, options));
	}

	if (!result.stdout) {
		throw new ToolError("GitHub CLI returned empty output.");
	}

	try {
		return JSON.parse(result.stdout) as T;
	} catch {
		throw new ToolError("GitHub CLI returned invalid JSON output.");
	}
}

export async function runGhText(
	cwd: string,
	args: string[],
	signal?: AbortSignal,
	options?: GhCommandOptions,
): Promise<string> {
	const result = await runGhCommand(cwd, args, signal, options);

	if (result.exitCode !== 0) {
		throw new ToolError(formatGhFailure(args, result.stdout, result.stderr, options));
	}

	return result.stdout;
}
