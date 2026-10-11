/**
 * Shared run log directory for benchmark diagnostics (spec 042).
 *
 * `OMK_RUN_LOG_DIR=<dir>` turns it on: each feature appends one JSON line per event to
 * `<dir>/<name>.jsonl` through `appendRunLog`. Unset, nothing is written and no file or
 * directory is created. Bench runs use `--no-session --mode json`, where session entries
 * never reach `omk.jsonl`, so this is how a feature leaves evidence for an A/B verdict.
 *
 * PRIVACY RULE: a record carries hashes, paths and numbers only. Never put prompt text,
 * file contents or env values in a record. `appendRunLog` itself adds only `t`,
 * `elapsedFraction`, `pid` and `role`.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readRunBudget } from "./remaining-budget.ts";

export const RUN_LOG_DIR_ENV = "OMK_RUN_LOG_DIR";
/** Set to `worker` in subagent worker processes so a verdict can keep only the lead's lines. */
export const RUN_LOG_ROLE_ENV = "OMK_RUN_LOG_ROLE";

/** A log file name: lowercase letters, digits and dashes only, so nothing is written outside the directory. */
const RUN_LOG_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type RunLogRole = "lead" | "worker";
export type RunLogValue =
	| string
	| number
	| boolean
	| null
	| readonly RunLogValue[]
	| { readonly [key: string]: RunLogValue };
export type RunLogRecord = { readonly [key: string]: RunLogValue };

export interface RunLogOptions {
	readonly env?: NodeJS.ProcessEnv;
	/** Wall clock for `t`; defaults to `Date.now`. */
	readonly now?: () => number;
}

export function runLogRole(env: NodeJS.ProcessEnv = process.env): RunLogRole {
	return env[RUN_LOG_ROLE_ENV]?.trim().toLowerCase() === "worker" ? "worker" : "lead";
}

/**
 * Append one line to `<OMK_RUN_LOG_DIR>/<name>.jsonl`. Synchronous, so it also works on a
 * SIGTERM path. Best effort: returns `false` when logging is off, the name is invalid, or the
 * write fails, and never throws into the run.
 */
export function appendRunLog(name: string, record: RunLogRecord, options: RunLogOptions = {}): boolean {
	const env = options.env ?? process.env;
	const dir = env[RUN_LOG_DIR_ENV]?.trim();
	if (!dir || !RUN_LOG_NAME.test(name)) return false;
	try {
		const line = JSON.stringify({
			...record,
			t: (options.now ?? Date.now)(),
			elapsedFraction: readRunBudget()?.elapsedFraction ?? null,
			pid: process.pid,
			role: runLogRole(env),
		});
		mkdirSync(dir, { recursive: true });
		appendFileSync(join(dir, `${name}.jsonl`), `${line}\n`);
		return true;
	} catch {
		return false;
	}
}
