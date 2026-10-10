/**
 * `OMK_DELIVERABLE_GUARD_LOG` (spec 034 requirement 6b): one JSON object per line for
 * steers, restore-point verdicts, restores and summaries. Bench runs use
 * `--no-session --mode json`, where session entries are not kept, so the A/B reads
 * this file. Lines carry paths, reasons, sizes and hashes only, never file contents
 * or environment values. Writes are synchronous so the SIGTERM line lands before exit.
 */
import { appendFileSync } from "node:fs";

export type GuardLogRecord = { readonly type: "steer" | "verdict" | "restore" | "summary" } & Record<string, unknown>;
export type GuardLog = (record: GuardLogRecord) => void;

const reportToStderr = (message: string) => {
	process.stderr.write(`${message}\n`);
};

/** A writer for `path`, or a no-op when it is unset. A failed write is dropped; the first one is reported. */
export function createGuardLog(path: string | undefined, report: (message: string) => void = reportToStderr): GuardLog {
	const target = path?.trim();
	if (!target) return () => {};
	let reported = false;
	return (record) => {
		try {
			appendFileSync(target, `${JSON.stringify({ ...record, ts: Date.now() })}\n`);
		} catch (error) {
			if (reported) return;
			reported = true;
			const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "error";
			report(`omk: deliverable guard could not write OMK_DELIVERABLE_GUARD_LOG (${code}); continuing without it`);
		}
	};
}
