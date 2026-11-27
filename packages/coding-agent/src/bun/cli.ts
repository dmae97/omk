#!/usr/bin/env node
import { ensureStandaloneSingleFileAssets } from "./embedded-bundle.ts";
import { restoreSandboxEnv } from "./restore-sandbox-env.ts";

restoreSandboxEnv();
ensureStandaloneSingleFileAssets();

const { APP_NAME, VERSION } = await import("../config.ts");
const { OPENTUI_STATUS_WORKER_ARG } = await import("../modes/interactive/opentui-status-worker-protocol.ts");

process.title = APP_NAME;
process.emitWarning = (() => {}) as typeof process.emitWarning;

// Same fast path as ../cli.ts: `omk --version` answers before the bundled runtime registers.
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === OPENTUI_STATUS_WORKER_ARG && process.connected) {
	await import("../modes/interactive/opentui-status-worker.ts");
} else if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
	console.log(VERSION);
} else {
	await import("./register-bedrock.ts");
	await import("./register-bundled-coding-agent.ts");
	await import("../cli.ts");
}
