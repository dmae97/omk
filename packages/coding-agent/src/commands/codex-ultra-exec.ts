import { spawn } from "node:child_process";
import { Transform } from "node:stream";

const MAX_OUTPUT_BYTES = 16_000_000;

/** Codex executes in its own process group so Ctrl-C reaches it exactly once. */
export function runCodexTask(binary: string, task: string): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn(
			binary,
			["exec", "--json", "--model", "gpt-6.1-terra", "--config", 'model_reasoning_effort="ultra"', "-"],
			{ stdio: ["pipe", "pipe", "inherit"], detached: true },
		);
		let done = false;
		let interrupted = 0;
		let forceTimer: ReturnType<typeof setTimeout> | undefined;
		let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
		let outputBytes = 0;
		const limiter = new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				outputBytes += chunk.length;
				if (outputBytes > MAX_OUTPUT_BYTES) return callback(new Error("Codex output exceeds the 16 MB limit"));
				callback(null, chunk);
			},
		});
		const signalGroup = (signal: NodeJS.Signals) => {
			try {
				if (child.pid) process.kill(-child.pid, signal);
			} catch {
				child.kill(signal);
			}
		};
		const finish = (code: number) => {
			if (done) return;
			done = true;
			clearTimeout(forceTimer);
			clearTimeout(deadlineTimer);
			process.off("SIGINT", interrupt);
			process.off("SIGTERM", terminate);
			process.stdout.off("error", outputError);
			resolve(code);
		};
		const stop = (code: number, signal: NodeJS.Signals) => {
			if (interrupted) return;
			interrupted = code;
			if (child.exitCode !== null || child.signalCode !== null) return;
			signalGroup(signal);
			forceTimer = setTimeout(() => signalGroup("SIGKILL"), 1_000);
			deadlineTimer = setTimeout(() => {
				process.stderr.write("Codex process group could not be confirmed stopped.\n");
				finish(1);
			}, 4_000);
		};
		const interrupt = () => stop(130, "SIGINT");
		const terminate = () => stop(143, "SIGTERM");
		const outputError = () => stop(1, "SIGTERM");
		limiter.on("error", () => {
			process.stderr.write("Codex output exceeds the 16 MB limit.\n");
			stop(1, "SIGTERM");
		});
		process.on("SIGINT", interrupt);
		process.on("SIGTERM", terminate);
		process.stdout.on("error", outputError);
		child.on("error", () => {
			process.stderr.write("Unable to start Codex CLI.\n");
			finish(1);
		});
		child.stdin.on("error", () => stop(1, "SIGTERM"));
		child.stdout.pipe(limiter).pipe(process.stdout, { end: false });
		child.stdin.end(task);
		child.on("exit", () => {
			if (interrupted) clearTimeout(forceTimer);
		});
		child.on("close", (code, signal) => {
			if (interrupted) {
				process.stderr.write("Codex cancellation requested; descendant process outcome is unknown.\n");
				return finish(1);
			}
			finish(code ?? (signal ? 1 : 0));
		});
	});
}
