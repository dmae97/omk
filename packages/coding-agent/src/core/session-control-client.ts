import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname } from "node:path";
import { controlDeadline } from "./control-deadline.ts";
import { readControlEndpoint } from "./session-control-endpoint.ts";
import {
	isRecord,
	MAX_CONTROL_BYTES,
	parseControlRequest,
	type SessionControlAction,
	type SessionControlResponse,
} from "./session-control-protocol.ts";

export interface SessionControlRequestOptions {
	/** Exact prompt generation an abort targets. Omit to use the bounded outstanding-prompt rule. */
	readonly generation?: number;
}

export async function requestSessionControl(
	sessionPath: string,
	sessionId: string,
	action: SessionControlAction,
	text?: string,
	options: SessionControlRequestOptions = {},
): Promise<SessionControlResponse> {
	const endpoint = readControlEndpoint(sessionPath);
	if (endpoint.sessionId !== sessionId) throw new Error("live session identity mismatch");
	for (const [path, directory] of [
		[dirname(endpoint.socketPath), true],
		[endpoint.socketPath, false],
	] as const) {
		const stat = lstatSync(path);
		if (
			(directory ? !stat.isDirectory() : !stat.isSocket()) ||
			(stat.mode & 0o077) !== 0 ||
			(process.getuid && stat.uid !== process.getuid())
		)
			throw new Error("unsafe live control socket");
	}
	const request = parseControlRequest({
		version: 1,
		requestId: randomUUID(),
		sessionId,
		token: endpoint.token,
		action,
		...(text === undefined ? {} : { text }),
		...(options.generation === undefined ? {} : { generation: options.generation }),
	});
	const payload = `${JSON.stringify(request)}\n`;
	if (Buffer.byteLength(payload) > MAX_CONTROL_BYTES) throw new Error("live request exceeds size limit");
	return new Promise<SessionControlResponse>((resolve, reject) => {
		const socket = createConnection(endpoint.socketPath);
		let buffer = "";
		let done = false;
		const finish = (response?: SessionControlResponse) => {
			if (done) return;
			done = true;
			deadline.cancel();
			socket.destroy();
			if (response) resolve(response);
			else reject(new Error("live endpoint unavailable or outcome unknown; do not automatically retry"));
		};
		const deadline = controlDeadline(10_000, () => finish());
		socket.setEncoding("utf8");
		socket.once("connect", () => {
			if (deadline.expired()) finish();
			else socket.write(payload);
		});
		socket.once("error", () => finish());
		socket.once("close", () => finish());
		socket.on("data", (chunk: string) => {
			if (done || deadline.expired()) {
				finish();
				return;
			}
			buffer += chunk;
			if (Buffer.byteLength(buffer) > MAX_CONTROL_BYTES) {
				finish();
				return;
			}
			const end = buffer.indexOf("\n");
			if (end < 0) return;
			try {
				const value: unknown = JSON.parse(buffer.slice(0, end));
				if (
					!isRecord(value) ||
					value.requestId !== request.requestId ||
					value.sessionId !== sessionId ||
					(value.status !== "accepted" && value.status !== "ok" && value.status !== "refused")
				) {
					finish();
					return;
				}
				// Recheck after parsing; an expired reply is an unknown outcome, not permission to retry.
				if (deadline.expired()) {
					finish();
					return;
				}
				// Never forward unbounded error text or arbitrary fields from a local peer.
				finish({
					requestId: request.requestId,
					sessionId,
					status: value.status,
					...(value.status === "refused" ? { error: "live request refused" } : {}),
					...(isRecord(value.state) &&
					typeof value.state.streaming === "boolean" &&
					typeof value.state.queued === "number" &&
					Number.isSafeInteger(value.state.queued) &&
					value.state.queued >= 0
						? {
								state: {
									streaming: value.state.streaming,
									queued: value.state.queued,
									...(value.state.lastOutcome === "returned" ||
									value.state.lastOutcome === "failed" ||
									value.state.lastOutcome === "abort_failed"
										? { lastOutcome: value.state.lastOutcome }
										: {}),
									...(typeof value.state.generation === "number" &&
									Number.isSafeInteger(value.state.generation) &&
									value.state.generation >= 0
										? { generation: value.state.generation }
										: {}),
								},
							}
						: {}),
				});
			} catch {
				finish();
			}
		});
	});
}
