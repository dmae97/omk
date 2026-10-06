/**
 * Owner process for the terminal-signal test: launches one sandbox, reports its
 * namespace identity on stdout, then waits to be signalled.
 *
 * argv: <workspace> <mode> <sleepArg>
 *   mode "default" installs no handlers (the owner dies on the signal);
 *   mode "cancel" turns SIGINT/SIGTERM into an abort like the CLI's withRunSignal.
 */
import { executeSandbox } from "../../src/core/verified-run/broker.ts";

const [workspace, mode, sleepArg] = process.argv.slice(2);
const controller = new AbortController();
if (mode === "cancel") {
	for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => controller.abort());
}
const execution = executeSandbox({
	workspace,
	writable: true,
	timeoutMs: 60000,
	cleanupMs: 15000,
	maxOutputBytes: 4096,
	argv: ["/bin/sh", "-c", `setsid sleep ${sleepArg} & sleep ${sleepArg}`],
	signal: controller.signal,
	onReady: (identity) => {
		process.stdout.write(`READY ${JSON.stringify(identity)}\n`);
	},
});
execution.then(
	(outcome) => {
		process.stdout.write(`OUTCOME ${outcome.failure}\n`);
		process.exit(0);
	},
	(error: unknown) => {
		process.stdout.write(`ERROR ${String(error)}\n`);
		process.exit(1);
	},
);
