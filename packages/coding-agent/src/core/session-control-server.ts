import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDurableFileIdentity } from "./durable-file-identity.ts";
import {
	publishControlEndpoint,
	removeControlEndpoint,
	type SessionControlEndpoint,
} from "./session-control-endpoint.ts";
import {
	MAX_CONTROL_BYTES,
	parseControlRequest,
	type SessionControlRequest,
	type SessionControlResponse,
} from "./session-control-protocol.ts";
import type { SessionManager } from "./session-manager.ts";

export interface SessionControlServer {
	close(): Promise<void>;
}

/** Explicit opt-in local control. The OS user and in-process extensions remain trusted. */
export async function startSessionControl(session: {
	readonly sessionFile: string | undefined;
	readonly sessionId: string;
	readonly sessionManager: Pick<SessionManager, "getOwnerLease">;
	readonly isStreaming: boolean;
	readonly isRetrying: boolean;
	readonly pendingMessageCount: number;
	prompt(
		text: string,
		options: {
			expandPromptTemplates: boolean;
			source: "rpc";
			streamingBehavior?: "steer" | "followUp";
			preflightResult: (accepted: boolean) => void;
		},
	): Promise<void>;
	abort(): Promise<void>;
	abortBash(): void;
	abortCompaction(): void;
	abortBranchSummary(): void;
}): Promise<SessionControlServer> {
	const file = session.sessionFile;
	if (process.platform === "win32") throw new Error("Local session control requires POSIX socket permissions");
	if (!file || !session.sessionManager.getOwnerLease()?.owns(file))
		throw new Error("Session control requires an owned persisted session");
	const directory = mkdtempSync(join(tmpdir(), "omkc-"));
	chmodSync(directory, 0o700);
	const endpoint: SessionControlEndpoint = {
		version: 1,
		sessionId: session.sessionId,
		sessionPath: resolveDurableFileIdentity(file).canonicalPath,
		socketPath: join(directory, "rpc"),
		token: randomBytes(32).toString("hex"),
	};
	const sockets = new Set<Socket>();
	let closing = false;
	let completion: Promise<void> | undefined;
	let lastOutcome: string | undefined;
	const seen = new Set<string>();

	async function dispatch(request: SessionControlRequest): Promise<SessionControlResponse> {
		const reply = { requestId: request.requestId, sessionId: endpoint.sessionId };
		if (
			closing ||
			request.sessionId !== session.sessionId ||
			request.sessionId !== endpoint.sessionId ||
			request.token !== endpoint.token ||
			!session.sessionManager.getOwnerLease()?.owns(file ?? "")
		)
			return { ...reply, status: "refused", error: "stale or unauthorized session control" };
		if (request.action === "status")
			return {
				...reply,
				status: "ok",
				state: { streaming: session.isStreaming, queued: session.pendingMessageCount, lastOutcome },
			};
		if (seen.has(request.requestId) || seen.size >= 1024)
			return { ...reply, status: "refused", error: "duplicate request or control request limit reached" };
		seen.add(request.requestId);
		if (request.action === "abort") {
			session.abortBash();
			session.abortCompaction();
			session.abortBranchSummary();
			// This acknowledges cancellation only, never physical termination.
			void session.abort().catch(() => {
				lastOutcome = "abort_failed";
			});
			return { ...reply, status: "accepted" };
		}
		if (request.action === "steer" || request.action === "followUp") {
			if (!session.isStreaming && !session.isRetrying)
				return { ...reply, status: "refused", error: "no running prompt to queue into" };
		}
		return new Promise<SessionControlResponse>((resolve) => {
			const operation = session.prompt(request.text ?? "", {
				expandPromptTemplates: false,
				source: "rpc",
				...(request.action === "steer" || request.action === "followUp"
					? { streamingBehavior: request.action }
					: {}),
				preflightResult: (accepted) =>
					resolve({
						...reply,
						status: accepted ? "accepted" : "refused",
						...(accepted ? {} : { error: "session preflight rejected" }),
					}),
			});
			void operation.then(
				() => {
					lastOutcome = "returned";
					resolve({ ...reply, status: "accepted" });
				},
				() => {
					lastOutcome = "failed";
					resolve({ ...reply, status: "refused", error: "session execution rejected" });
				},
			);
		});
	}

	const server = createServer((socket) => {
		if (closing || sockets.size >= 8) {
			socket.destroy();
			return;
		}
		sockets.add(socket);
		socket.on("error", () => {});
		socket.once("close", () => sockets.delete(socket));
		socket.setEncoding("utf8");
		socket.setTimeout(10_000, () => socket.destroy());
		let buffer = "";
		let handled = false;
		socket.on("data", (chunk: string) => {
			if (handled) return;
			buffer += chunk;
			if (Buffer.byteLength(buffer) > MAX_CONTROL_BYTES) {
				handled = true;
				socket.destroy();
				return;
			}
			const end = buffer.indexOf("\n");
			if (end < 0) return;
			handled = true;
			let request: SessionControlRequest;
			try {
				request = parseControlRequest(JSON.parse(buffer.slice(0, end)));
			} catch {
				socket.end(`${JSON.stringify({ status: "refused", error: "invalid control request" })}\n`);
				return;
			}
			void dispatch(request).then(
				(response) => {
					socket.end(`${JSON.stringify(response)}\n`);
				},
				() => {
					socket.end(
						`${JSON.stringify({ requestId: request.requestId, sessionId: endpoint.sessionId, status: "refused", error: "control request failed" })}\n`,
					);
				},
			);
		});
	});
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(endpoint.socketPath, resolve);
		});
		chmodSync(endpoint.socketPath, 0o600);
		publishControlEndpoint(endpoint);
	} catch (error) {
		for (const socket of sockets) socket.destroy();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
	return {
		close: () => {
			if (completion) return completion;
			closing = true;
			completion = new Promise<void>((resolve, reject) => {
				for (const socket of sockets) socket.destroy();
				server.close((error) => {
					try {
						removeControlEndpoint(endpoint);
						rmSync(directory, { recursive: true, force: true });
					} catch (failure) {
						reject(failure);
						return;
					}
					if (error) reject(error);
					else resolve();
				});
			});
			return completion;
		},
	};
}
