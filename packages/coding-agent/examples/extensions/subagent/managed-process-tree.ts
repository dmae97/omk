import { type ChildProcess, spawn } from "node:child_process";

/** EPERM and other observation errors cannot prove that a group is gone. */
export function processGroupState(pid: number): "alive" | "gone" | "unknown" {
	if (process.platform === "win32" || pid < 1) return "gone";
	try {
		process.kill(-pid, 0);
		return "alive";
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH" ? "gone" : "unknown";
	}
}

/** Requests termination, never confirms it. Only signal the child owned by this invocation. */
export function signalProcessTree(child: ChildProcess, signal: "SIGTERM" | "SIGKILL", processGroup: boolean): void {
	const pid = child.pid;
	if (pid === undefined) return;
	if (process.platform === "win32" && signal === "SIGKILL") {
		try {
			const killer = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			});
			killer.on("error", () => {});
			killer.unref();
			return;
		} catch {
			// Fall back to the owned direct child, without claiming descendant containment.
		}
	}
	try {
		if (process.platform === "win32") child.kill(signal);
		else process.kill(processGroup ? -pid : pid, signal);
	} catch {
		try {
			child.kill(signal);
		} catch {
			/* Termination remains unconfirmed. */
		}
	}
}
