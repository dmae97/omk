import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT_BYTES = 16_000_000;

/** The supervisor owns its process group and only it may signal that group while alive. */
export function runCodexTask(binary: string, task: string, supervisorOverride?: string): Promise<number> {
	if (process.versions.bun) {
		process.stderr.write(
			"Codex Ultra supervisor requires the Node.js npm installation; standalone Bun is not supported.\n",
		);
		return Promise.resolve(1);
	}
	return new Promise((resolve) => {
		const source = import.meta.url.endsWith(".ts");
		const file =
			supervisorOverride ??
			fileURLToPath(new URL(`./codex-ultra-supervisor.${source ? "ts" : "js"}`, import.meta.url));
		const child = spawn(process.execPath, [...(source ? ["--experimental-strip-types"] : []), file], {
			stdio: ["ignore", "pipe", "inherit", "ipc"],
			detached: true,
		});
		let done = false;
		let cancelled = 0;
		let result: number | undefined;
		let outcomeUnknown = false;
		let supervisorClosed = false;
		let outputBytes = 0;
		let deadline: ReturnType<typeof setTimeout> | undefined;
		let poll: ReturnType<typeof setTimeout> | undefined;
		const limiter = new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				outputBytes += chunk.length;
				if (outputBytes > MAX_OUTPUT_BYTES) return callback(new Error("Codex output exceeds the 16 MB limit"));
				callback(null, chunk);
			},
		});
		const finish = (code: number) => {
			if (done) return;
			done = true;
			clearTimeout(deadline);
			clearTimeout(poll);
			process.off("SIGINT", interrupt);
			process.off("SIGTERM", terminate);
			process.stdout.off("error", outputError);
			resolve(code);
		};
		const unknown = () => {
			if (done || outcomeUnknown) return;
			outcomeUnknown = true;
			process.stderr.write("Codex process-group outcome is unknown; descendant termination was not verified.\n");
			if (supervisorClosed) return finish(1);
			// Disconnect requests cleanup through the supervisor's IPC disconnect handler.
			if (child.connected) child.disconnect();
			clearTimeout(deadline);
			deadline = setTimeout(() => finish(1), 5_000);
		};
		const stop = (code: number) => {
			if (cancelled || done) return;
			cancelled = code;
			if (child.connected)
				child.send({ type: "cancel" }, (error) => {
					if (error) unknown();
				});
			else return unknown();
			deadline = setTimeout(unknown, 5_000);
		};
		const interrupt = () => stop(130);
		const terminate = () => stop(143);
		const outputError = () => stop(1);
		limiter.on("error", () => {
			process.stderr.write("Codex output exceeds the 16 MB limit.\n");
			stop(1);
		});
		process.on("SIGINT", interrupt);
		process.on("SIGTERM", terminate);
		process.stdout.on("error", outputError);
		if (child.stdout) child.stdout.pipe(limiter).pipe(process.stdout, { end: false });
		else unknown();
		child.on("message", (value: unknown) => {
			if (!value || typeof value !== "object" || !("type" in value)) return;
			if (value.type === "ready" && child.connected && !cancelled) {
				child.send({ type: "start", task, binary }, (error) => {
					if (error) unknown();
				});
			} else if (
				value.type === "result" &&
				"code" in value &&
				Number.isInteger(value.code) &&
				(value.code as number) >= 0 &&
				(value.code as number) <= 255
			) {
				result = value.code as number;
			}
		});
		child.on("error", unknown);
		child.on("close", () => {
			supervisorClosed = true;
			if (outcomeUnknown) return finish(1);
			if (!cancelled && result === undefined) return unknown();
			const start = performance.now();
			const checkGroup = () => {
				try {
					if (!child.pid) return unknown();
					process.kill(-child.pid, 0);
					if (performance.now() - start >= 3_000) return unknown();
					poll = setTimeout(checkGroup, 50);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ESRCH") finish(cancelled || result || 0);
					else unknown();
				}
			};
			checkGroup();
		});
	});
}
