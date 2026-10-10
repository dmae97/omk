#!/usr/bin/env node
import { APP_NAME, VERSION } from "../config.ts";

process.title = APP_NAME;
process.emitWarning = (() => {}) as typeof process.emitWarning;

import { restoreSandboxEnv } from "./restore-sandbox-env.ts";

restoreSandboxEnv();

// Same fast path as ../cli.ts: `omk --version` answers before the bundled runtime registers.
const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
	console.log(VERSION);
} else {
	await import("./register-bedrock.ts");
	await import("./register-bundled-coding-agent.ts");
	await import("../cli.ts");
}
