#!/usr/bin/env node
import { APP_NAME } from "../config.ts";

process.title = APP_NAME;
process.env.OMK_CODING_AGENT = "true";
process.emitWarning = (() => {}) as typeof process.emitWarning;

import { restoreSandboxEnv } from "./restore-sandbox-env.ts";

restoreSandboxEnv();

await import("./register-bedrock.ts");
await import("../cli.ts");
