#!/usr/bin/env bun
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
import { run } from "@oclif/core";
import { APP_NAME } from "./config";

process.title = APP_NAME;
const argv = process.argv.slice(2);
const runArgv = argv.length === 0 ? ["index"] : argv;
run(runArgv, import.meta.url).catch((error: unknown) => {
	const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`${message}\n`);
	process.exit(1);
});
