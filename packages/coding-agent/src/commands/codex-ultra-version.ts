import { spawn } from "node:child_process";
import { CodexDiscoveryInterrupted } from "./codex-ultra-catalog.ts";

/** Read only the version; kill and reap an unresponsive executable before returning. */
export function readCodexVersion(binary: string, timeoutMs = 10_000): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, ["--version"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
		let output = "";
		let failure: Error | undefined;
		let forceTimer: ReturnType<typeof setTimeout> | undefined;
		let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
		let settled = false;
		const settle = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			clearTimeout(forceTimer);
			clearTimeout(deadlineTimer);
			process.off("SIGINT", interrupt);
			process.off("SIGTERM", terminate);
			if (error ?? failure) reject(error ?? failure);
			else resolve(output);
		};
		const stop = (error: Error) => {
			if (failure) return;
			failure = error;
			child.kill("SIGTERM");
			forceTimer = setTimeout(() => child.kill("SIGKILL"), 250);
			deadlineTimer = setTimeout(() => settle(new Error("Codex version process could not be stopped")), 2_000);
		};
		const interrupt = () => stop(new CodexDiscoveryInterrupted(130));
		const terminate = () => stop(new CodexDiscoveryInterrupted(143));
		process.on("SIGINT", interrupt);
		process.on("SIGTERM", terminate);
		const timer = setTimeout(() => stop(new Error("Codex version check timed out")), timeoutMs);
		child.on("error", () => stop(new Error("Codex CLI is unavailable")));
		child.stdout.on("data", (chunk: Buffer) => {
			if (failure) return;
			output += chunk.toString("utf8");
			if (output.length > 64_000) stop(new Error("Codex version response is too large"));
		});
		child.on("close", (code) => {
			if (code !== 0 && !failure) failure = new Error("Codex version check failed");
			settle();
		});
	});
}
