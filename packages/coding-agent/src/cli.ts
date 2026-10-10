#!/usr/bin/env node
/**
 * CLI entry point for the coding agent.
 *
 * Deliberately limited to node built-ins and config.ts so `omk --version` answers without
 * importing the agent runtime (about 1,500 modules). The runtime import below is the single
 * dynamic import at the process boundary, the same pattern bun/cli.ts uses.
 *
 * V8's on-disk compile cache is not enabled here. Measured on Node 22.22 with a warm cache it cut
 * `omk doctor` from 689 ms to 563 ms and the TUI's first paint from 1.15 s to 1.04 s, made the
 * first two cold starts slower (1.30 s), and kept about 14 MiB more resident for the whole
 * interactive session, even after flushCompileCache(). Users who prefer the trade-off can opt in
 * with NODE_COMPILE_CACHE=<dir>; the standalone binary built with --bytecode starts faster still.
 *
 * Test with: npx tsx src/cli.ts [args...]
 */
import { homedir } from "node:os";
import { APP_NAME, getPackageDir, VERSION } from "./config.ts";

process.title = APP_NAME;
process.env.OMK_CODING_AGENT = "true";
process.emitWarning = (() => {}) as typeof process.emitWarning;

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
	console.log(VERSION);
} else {
	const [{ runNeoCli }, { installHttpDispatcherFetchHook }, { main }] = await Promise.all([
		import("./commands/neo-cli.ts"),
		import("./core/http-dispatcher-install.ts"),
		import("./main.ts"),
	]);
	// Install a fetch hook that configures undici's global dispatcher on the first
	// network request. Runtime timeout is scheduled once SettingsManager loads.
	installHttpDispatcherFetchHook();
	if (args[0] === "neo") {
		process.exitCode = runNeoCli(args.slice(1), {
			packageDir: getPackageDir(),
			cwd: process.cwd(),
			home: homedir(),
			output: (text) => process.stdout.write(`${text}\n`),
		});
	} else {
		main(args);
	}
}
