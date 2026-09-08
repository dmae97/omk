import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir, getExamplesPath } from "../config.ts";

const DOCUMENTS = ["AGENTS.md", "INTERNET.md", "CLAUDE.md"] as const;
const USAGE = "Usage: omk init --global [--dry-run] [--offline]";
const FLAGS = new Set(["--global", "--dry-run", "--offline", "--help", "-h"]);

type InitOptions = {
	readonly agentDir?: string;
	readonly templatesDir?: string;
	readonly writeLine?: (line: string) => void;
};

/** Explicit, offline initialization. Existing context entry points are never replaced or shadowed. */
export function runInitCli(
	args: readonly string[],
	options: InitOptions = {},
): { readonly handled: boolean; readonly exitCode: number } {
	if (args[0] !== "init") return { handled: false, exitCode: 0 };
	const writeLine = options.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
	const flags = args.slice(1);
	if (flags.some((flag) => !FLAGS.has(flag))) {
		writeLine(`Unsupported init argument. ${USAGE}`);
		return { handled: true, exitCode: 2 };
	}
	if (flags.includes("--help") || flags.includes("-h")) {
		writeLine(`${USAGE}\nCreate portable context documents only when missing. Existing instructions are preserved.`);
		return { handled: true, exitCode: 0 };
	}
	if (!flags.includes("--global")) {
		writeLine(USAGE);
		return { handled: true, exitCode: 2 };
	}

	try {
		const agentDir = resolve(options.agentDir ?? getAgentDir());
		const directory = lstatSync(agentDir, { throwIfNoEntry: false });
		if (directory && !directory.isDirectory()) {
			writeLine("Cannot initialize context: the agent directory must be a real directory, not a file or symlink.");
			return { handled: true, exitCode: 1 };
		}
		const existing = directory ? readdirSync(agentDir) : [];
		const hasEntryPoint = existing.some((name) => /^(?:agents|claude)\.md$/i.test(name));
		const templatesDir = options.templatesDir ?? join(getExamplesPath(), "context");
		const plan = DOCUMENTS.map((name) => {
			const preserved =
				existing.some((entry) => entry.toLowerCase() === name.toLowerCase()) ||
				(hasEntryPoint && name !== "INTERNET.md");
			return {
				path: join(agentDir, name),
				// Read all required templates before creating anything, including in dry-run mode.
				content: preserved ? undefined : readFileSync(join(templatesDir, name), "utf8"),
			};
		});
		const dryRun = flags.includes("--dry-run");
		for (const document of plan) {
			if (document.content === undefined) {
				writeLine(`Preserved context: ${JSON.stringify(document.path)} (existing file or entry point)`);
				continue;
			}
			if (dryRun) {
				writeLine(`Would create: ${JSON.stringify(document.path)}`);
				continue;
			}
			mkdirSync(agentDir, { recursive: true, mode: 0o700 });
			try {
				writeFileSync(document.path, document.content, { flag: "wx", mode: 0o600 });
				writeLine(`Created: ${JSON.stringify(document.path)}`);
			} catch (error) {
				if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
				writeLine(`Preserved concurrent file: ${JSON.stringify(document.path)}`);
			}
		}
		writeLine(
			dryRun
				? "Dry run: no files written."
				: "Context setup complete. Existing files were not changed. Restart OMK or run /reload to reload context.",
		);
		return { handled: true, exitCode: 0 };
	} catch (error) {
		const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "unknown";
		writeLine(`Context setup failed (${code}). Check the agent directory and bundled examples/context files.`);
		return { handled: true, exitCode: 1 };
	}
}
