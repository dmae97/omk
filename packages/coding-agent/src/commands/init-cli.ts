import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir, getExamplesPath, getPackageDir } from "../config.ts";
import { PROJECT_CONTEXT_DOCUMENTS } from "../core/project-context-files.ts";
import { installProjectPstack, PstackConflictError, preflightProjectPstack } from "./pstack-install.ts";

const GLOBAL_DOCUMENTS = ["AGENTS.md", "INTERNET.md", "CLAUDE.md"] as const;
const PROJECT_DOCUMENTS = ["AGENTS.md", "CLAUDE.md", ...PROJECT_CONTEXT_DOCUMENTS] as const;
const USAGE = "Usage: omk init --global|--project [--dry-run] [--offline]";
const FLAGS = new Set(["--global", "--project", "--dry-run", "--offline", "--help", "-h"]);
const BOOTSTRAP_DISABLED_VALUES = new Set(["0", "false", "off"]);

type InitOptions = {
	readonly agentDir?: string;
	readonly cwd?: string;
	readonly templatesDir?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly writeLine?: (line: string) => void;
};

/** Initialize only a truly empty Git repository on a bare interactive launch. */
export function bootstrapEmptyProjectContext(
	args: readonly string[],
	options: InitOptions = {},
): { readonly ran: boolean; readonly exitCode: number } {
	const env = options.env ?? process.env;
	if (args.length !== 0 && env.OMK_BARE_INTERACTIVE !== "1") return { ran: false, exitCode: 0 };
	const override = env.OMK_PROJECT_CONTEXT_BOOTSTRAP?.trim().toLowerCase();
	if (override && BOOTSTRAP_DISABLED_VALUES.has(override)) return { ran: false, exitCode: 0 };

	const cwd = realpathSync(resolve(options.cwd ?? process.cwd()));
	const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (git.status !== 0 || realpathSync(git.stdout.trim()) !== cwd) return { ran: false, exitCode: 0 };
	if (readdirSync(cwd).some((name) => name !== ".git")) return { ran: false, exitCode: 0 };

	const writeLine = options.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
	writeLine("Empty Git repository detected. Creating missing project context documents.");
	const outcome = runInitCli(["init", "--project"], { ...options, cwd, writeLine });
	if (outcome.pstackFailed) {
		writeLine(
			"Automatic project setup failed. Continuing normal launch; resolve the issue and run omk init --project to retry.",
		);
		return { ran: true, exitCode: 0 };
	}
	return { ran: true, exitCode: outcome.exitCode };
}

/** Initialize explicit scopes and bare empty repositories without replacing existing entry points. */
export function runInitCli(
	args: readonly string[],
	options: InitOptions = {},
): { readonly handled: boolean; readonly exitCode: number; readonly pstackFailed?: boolean } {
	if (args[0] !== "init") {
		const bootstrap = bootstrapEmptyProjectContext(args, options);
		return { handled: bootstrap.ran && bootstrap.exitCode !== 0, exitCode: bootstrap.exitCode };
	}
	const writeLine = options.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
	const flags = args.slice(1);
	if (flags.some((flag) => !FLAGS.has(flag))) {
		writeLine(`Unsupported init argument. ${USAGE}`);
		return { handled: true, exitCode: 2 };
	}
	if (flags.includes("--help") || flags.includes("-h")) {
		writeLine(
			`${USAGE}\nCreate portable context documents only when missing. Project setup also installs bundled pstack resources without replacing existing files.`,
		);
		return { handled: true, exitCode: 0 };
	}
	const project = flags.includes("--project");
	const global = flags.includes("--global");
	if ((!project && !global) || (project && global)) {
		writeLine(USAGE);
		return { handled: true, exitCode: 2 };
	}

	let inPstack = false;
	try {
		const targetDir = project ? resolve(options.cwd ?? process.cwd()) : resolve(options.agentDir ?? getAgentDir());
		const pstackDir = join(getPackageDir(), "resources", "pstack");
		if (project) {
			inPstack = true;
			preflightProjectPstack(targetDir, pstackDir, options.agentDir ?? getAgentDir());
			inPstack = false;
		}
		const directory = lstatSync(targetDir, { throwIfNoEntry: false });
		if (directory && !directory.isDirectory()) {
			writeLine("Cannot initialize context: the target directory must be a real directory, not a file or symlink.");
			return { handled: true, exitCode: 1 };
		}
		const existing = directory ? readdirSync(targetDir) : [];
		const hasEntryPoint = existing.some((name) => /^(?:agents|claude)\.md$/i.test(name));
		const documents = project ? PROJECT_DOCUMENTS : GLOBAL_DOCUMENTS;
		const templatesDir = options.templatesDir ?? join(getExamplesPath(), project ? "project-context" : "context");
		const plan = documents.map((name) => {
			const preserved =
				existing.some((entry) => entry.toLowerCase() === name.toLowerCase()) ||
				(hasEntryPoint && (name === "AGENTS.md" || name === "CLAUDE.md"));
			return {
				path: join(targetDir, name),
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
			mkdirSync(targetDir, { recursive: true, mode: 0o700 });
			try {
				writeFileSync(document.path, document.content, { flag: "wx", mode: project ? 0o644 : 0o600 });
				writeLine(`Created: ${JSON.stringify(document.path)}`);
			} catch (error) {
				if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
				writeLine(`Preserved concurrent file: ${JSON.stringify(document.path)}`);
			}
		}
		if (project) {
			inPstack = true;
			installProjectPstack(targetDir, pstackDir, dryRun, writeLine, undefined, options.agentDir ?? getAgentDir());
			inPstack = false;
		}
		writeLine(
			dryRun
				? "Dry run: no files written."
				: "Context setup complete. Existing files were not changed. Restart OMK or run /reload to reload context.",
		);
		return { handled: true, exitCode: 0 };
	} catch (error) {
		if (error instanceof PstackConflictError) writeLine(error.message);
		const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "unknown";
		writeLine(`Context setup failed (${code}). Check the target directory and bundled context templates.`);
		if (inPstack)
			writeLine(
				"Existing documents remain. Resolve any incomplete pstack installation, then rerun omk init --project.",
			);
		return inPstack ? { handled: true, exitCode: 1, pstackFailed: true } : { handled: true, exitCode: 1 };
	}
}
