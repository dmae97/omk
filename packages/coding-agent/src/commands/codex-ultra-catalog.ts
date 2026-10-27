import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const MODEL = "gpt-6.1-terra";
const MAX_LINES = 2_000;
const MAX_BYTES = 2_000_000;
const MAX_PAGES = 20;

type RecordValue = Record<string, unknown>;

export class CodexDiscoveryInterrupted extends Error {
	readonly exitCode: number;
	constructor(exitCode: number) {
		super("Codex model discovery interrupted");
		this.exitCode = exitCode;
	}
}

function record(value: unknown): value is RecordValue {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Ask the installed Codex app-server; never disclose credentials or server output. */
export function codexUltraAvailable(binary = "codex", timeoutMs = 15_000): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, ["app-server"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
		const input = createInterface({ input: child.stdout });
		let finishing = false;
		let settled = false;
		let pendingError: Error | undefined;
		let pendingAvailable = false;
		let forceTimer: ReturnType<typeof setTimeout> | undefined;
		let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
		let pages = 0;
		let lines = 0;
		let bytes = 0;
		let requestId = 1;
		const cursors = new Set<string>();
		const settle = (cleanupError?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(forceTimer);
			clearTimeout(deadlineTimer);
			process.off("SIGINT", interrupt);
			process.off("SIGTERM", terminate);
			const error = cleanupError ?? pendingError;
			if (error) reject(error);
			else resolve(pendingAvailable);
		};
		const finish = (error?: Error, available?: boolean) => {
			if (finishing) return;
			finishing = true;
			pendingError = error;
			pendingAvailable = available === true;
			clearTimeout(timer);
			input.close();
			child.stdin.destroy();
			if (child.exitCode !== null || child.signalCode !== null) return settle();
			child.kill("SIGTERM");
			forceTimer = setTimeout(() => child.kill("SIGKILL"), 250);
			deadlineTimer = setTimeout(() => settle(new Error("Codex app-server could not be stopped")), 2_000);
		};
		const interrupt = () => finish(new CodexDiscoveryInterrupted(130));
		const terminate = () => finish(new CodexDiscoveryInterrupted(143));
		process.on("SIGINT", interrupt);
		process.on("SIGTERM", terminate);
		const timer = setTimeout(() => finish(new Error("Codex model discovery timed out")), timeoutMs);
		const send = (value: RecordValue) => child.stdin.write(`${JSON.stringify(value)}\n`);
		const list = (cursor?: string) => {
			if (++pages > MAX_PAGES) return finish(new Error("Codex model discovery exceeded the page limit"));
			requestId += 1;
			send({
				id: requestId,
				method: "model/list",
				params: { limit: 100, includeHidden: false, cursor: cursor ?? null },
			});
		};
		child.on("error", () => finish(new Error("Unable to start the Codex app-server")));
		child.on("close", () => {
			if (finishing) settle();
			else finish(new Error("Codex app-server stopped before model discovery completed"));
		});
		child.stdin.on("error", () => finish(new Error("Codex app-server communication failed")));
		child.stdout.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > MAX_BYTES) finish(new Error("Codex model discovery response is too large"));
		});
		input.on("line", (line) => {
			if (finishing) return;
			if (++lines > MAX_LINES) return finish(new Error("Codex model discovery response is too large"));
			let data: unknown;
			try {
				data = JSON.parse(line);
			} catch {
				return finish(new Error("Codex app-server returned invalid JSON"));
			}
			if (!record(data) || data.id !== requestId) return;
			if (data.error !== undefined || !record(data.result))
				return finish(new Error("Codex model discovery failed; check login and configuration"));
			if (requestId === 1) {
				send({ method: "initialized", params: {} });
				list();
				return;
			}
			if (!Array.isArray(data.result.data))
				return finish(new Error("Codex model discovery returned an invalid model list"));
			const model = data.result.data.find(
				(entry: unknown) => record(entry) && (entry.model === MODEL || entry.id === MODEL),
			);
			if (record(model)) {
				const efforts = model.supportedReasoningEfforts;
				return finish(
					undefined,
					model.multiAgentVersion === "v2" &&
						Array.isArray(efforts) &&
						efforts.some((effort: unknown) => record(effort) && effort.reasoningEffort === "ultra"),
				);
			}
			const next = data.result.nextCursor;
			if (next === null || next === undefined) return finish(undefined, false);
			if (typeof next !== "string" || !next || cursors.has(next))
				return finish(new Error("Codex model discovery returned an invalid cursor"));
			cursors.add(next);
			list(next);
		});
		send({ id: 1, method: "initialize", params: { clientInfo: { name: "omk", title: "OMK", version: "1.0.0" } } });
	});
}
