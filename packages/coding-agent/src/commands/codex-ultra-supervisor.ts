/**
 * Isolated child process: this process is its session and process-group leader. Only this live
 * leader signals its own group, so a parent cannot signal a recycled group id after it exits.
 */
import { spawn } from "node:child_process";

let started = false;
let stopping = false;

function stopGroup() {
	if (stopping) return;
	stopping = true;
	try {
		process.kill(-process.pid, "SIGTERM");
	} catch {
		process.exitCode = 1;
	}
	setTimeout(() => {
		try {
			process.kill(-process.pid, "SIGKILL");
		} catch {
			process.exit(1);
		}
	}, 1_000);
}

process.on("SIGTERM", stopGroup);
process.on("SIGINT", stopGroup);
process.on("disconnect", stopGroup);
process.on("message", (message: unknown) => {
	if (!message || typeof message !== "object" || !("type" in message)) return;
	if (message.type === "cancel") return stopGroup();
	if (
		message.type !== "start" ||
		started ||
		!("task" in message) ||
		typeof message.task !== "string" ||
		!("binary" in message) ||
		typeof message.binary !== "string"
	)
		return;
	started = true;
	const child = spawn(
		message.binary,
		["exec", "--json", "--model", "gpt-6.1-terra", "--config", 'model_reasoning_effort="ultra"', "-"],
		{ stdio: ["pipe", "pipe", "inherit"] },
	);
	let childFailed = false;
	child.on("error", () => {
		childFailed = true;
	});
	child.stdin.on("error", () => {
		childFailed = true;
		stopGroup();
	});
	child.stdout.pipe(process.stdout, { end: false });
	child.stdin.end(message.task);
	child.on("close", (code, signal) => {
		if (stopping) return;
		// Flush already received JSONL before reporting completion and tearing down the group.
		process.stdout.write("", () => {
			process.send?.({ type: "result", code: childFailed ? 1 : (code ?? (signal ? 1 : 0)) }, () => stopGroup());
		});
	});
});
process.send?.({ type: "ready" });
