#!/usr/bin/env bun
/**
 * CLI entry point — registers all commands explicitly and delegates to the
 * lightweight CLI runner from pi-utils.
 */
import { type CommandEntry, run } from "@oh-my-pi/pi-utils/cli";
import { APP_NAME, VERSION } from "./config";

// Unwrap AggregateError in console.warn to surface real messages
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
	for (const arg of args) {
		if (arg instanceof AggregateError) {
			for (const err of arg.errors) {
				originalWarn(err instanceof Error ? (err.stack ?? err.message) : String(err));
			}
			return;
		}
	}
	originalWarn(...args);
};

process.title = APP_NAME;

const commands: CommandEntry[] = [
	{ name: "launch", load: () => import("./commands/launch").then(m => m.default) },
	{ name: "commit", load: () => import("./commands/commit").then(m => m.default) },
	{ name: "config", load: () => import("./commands/config").then(m => m.default) },
	{ name: "grep", load: () => import("./commands/grep").then(m => m.default) },
	{ name: "jupyter", load: () => import("./commands/jupyter").then(m => m.default) },
	{ name: "plugin", load: () => import("./commands/plugin").then(m => m.default) },
	{ name: "setup", load: () => import("./commands/setup").then(m => m.default) },
	{ name: "shell", load: () => import("./commands/shell").then(m => m.default) },
	{ name: "stats", load: () => import("./commands/stats").then(m => m.default) },
	{ name: "update", load: () => import("./commands/update").then(m => m.default) },
	{ name: "search", load: () => import("./commands/web-search").then(m => m.default), aliases: ["q"] },
];

async function showHelp(config: import("@oh-my-pi/pi-utils/cli").CliConfig): Promise<void> {
	const { renderRootHelp } = await import("@oh-my-pi/pi-utils/cli");
	const { getExtraHelpText } = await import("./cli/args");
	renderRootHelp(config);
	const extra = getExtraHelpText();
	if (extra.trim().length > 0) {
		process.stdout.write(`\n${extra}\n`);
	}
}

/** Run the CLI with the given argv (no `process.argv` prefix). */
export function runCli(argv: string[]): Promise<void> {
	const runArgv = argv.length === 0 || argv[0]?.startsWith("-") ? ["launch", ...argv] : argv;
	return run({ bin: APP_NAME, version: VERSION, argv: runArgv, commands, help: showHelp });
}

runCli(process.argv.slice(2)).catch((error: unknown) => {
	const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`${message}\n`);
	process.exit(1);
});
