#!/usr/bin/env bun
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
import { run } from "@oclif/core";
import { APP_NAME } from "./config";

// oclif's warn() doesn't unwrap AggregateError — override to surface the real messages
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
const argv = process.argv.slice(2);
const runArgv = argv.length === 0 || argv[0]?.startsWith("-") ? ["index", ...argv] : argv;
run(runArgv, import.meta.url).catch((error: unknown) => {
	const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`${message}\n`);
	process.exit(1);
});
