#!/usr/bin/env node
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
import { homedir } from "node:os";
import { runNeoCli } from "./commands/neo-cli.ts";
import { APP_NAME, getPackageDir } from "./config.ts";
import { installHttpDispatcherFetchHook } from "./core/http-dispatcher-install.ts";
import { main } from "./main.ts";

process.title = APP_NAME;
process.env.OMK_CODING_AGENT = "true";
process.emitWarning = (() => {}) as typeof process.emitWarning;

// Install a fetch hook that configures undici's global dispatcher on the first
// network request. Runtime timeout is scheduled once SettingsManager loads.
installHttpDispatcherFetchHook();

if (process.argv[2] === "neo") {
	process.exitCode = runNeoCli(process.argv.slice(3), {
		packageDir: getPackageDir(),
		cwd: process.cwd(),
		home: homedir(),
		output: (text) => process.stdout.write(`${text}\n`),
	});
} else {
	main(process.argv.slice(2));
}
