import type { Socket } from "node:net";
import { vi } from "vitest";
import {
	type AuthenticatedSessionControlPeer,
	authenticateSessionControlPeer,
} from "../src/core/session-control-peer.ts";
import { isRecord } from "../src/core/session-control-protocol.ts";
import { attachWorkbenchControlIpc, type WorkbenchControlIpc } from "../src/core/verified-run/workbench-ipc.ts";
import type { LocalWorkbenchControlOptions } from "../src/core/verified-run/workbench-local-peer.ts";
import { type LocalPeerFixture, localPeerFixture } from "./workbench-local-peer-fixture.ts";

export interface IpcReader {
	readonly messages: Record<string, unknown>[];
	readonly closed: Promise<void>;
	next(): Promise<Record<string, unknown>>;
}

export function readIpcFrames(socket: Socket): IpcReader {
	const messages: Record<string, unknown>[] = [];
	let consumed = 0;
	let tail = "";
	const waiters: { resolve(value: Record<string, unknown>): void; reject(error: Error): void }[] = [];
	let ended = false;
	const closed = new Promise<void>((resolve) => {
		socket.once("close", () => {
			ended = true;
			for (const waiter of waiters.splice(0)) waiter.reject(new Error("fixture socket closed"));
			resolve();
		});
	});
	socket.on("data", (chunk: Buffer) => {
		tail += chunk.toString("utf8");
		let end = tail.indexOf("\n");
		while (end >= 0) {
			const value: unknown = JSON.parse(tail.slice(0, end));
			if (!isRecord(value)) throw new Error("fixture response is not an object");
			messages.push(value);
			const waiter = waiters.shift();
			if (waiter) {
				consumed++;
				waiter.resolve(value);
			}
			tail = tail.slice(end + 1);
			end = tail.indexOf("\n");
		}
	});
	return {
		messages,
		closed,
		next() {
			const message = messages[consumed];
			if (message) {
				consumed++;
				return Promise.resolve(message);
			}
			if (ended) return Promise.reject(new Error("fixture socket closed"));
			return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
		},
	};
}

export interface IpcChannel {
	readonly client: Socket;
	readonly socket: Socket;
	readonly peer: AuthenticatedSessionControlPeer;
	readonly handler: WorkbenchControlIpc;
	readonly reader: IpcReader;
	send(bytes: Uint8Array): Promise<void>;
}
export interface IpcFixture extends LocalPeerFixture {
	open(
		options?: Partial<LocalWorkbenchControlOptions>,
		requestTimeoutMs?: number,
		beforeAttach?: (socket: Socket, peer: AuthenticatedSessionControlPeer) => void,
	): Promise<IpcChannel>;
}

export async function ipcFixture(highWaterMark = 1): Promise<IpcFixture> {
	const fixture = await localPeerFixture(highWaterMark);
	return {
		...fixture,
		async open(options = {}, requestTimeoutMs, beforeAttach) {
			const pair = await fixture.connect();
			const reader = readIpcFrames(pair.client);
			const pending = authenticateSessionControlPeer(pair.socket, {
				sessionPath: fixture.file,
				owner: fixture.controlOwner,
				hostSignal: fixture.host.signal,
				requestTimeoutMs,
			});
			pair.client.write(`${JSON.stringify(fixture.credentials())}\n`);
			const peer = await pending;
			try {
				beforeAttach?.(pair.socket, peer);
				const handler = attachWorkbenchControlIpc(peer, { ...fixture.options(), ...options });
				return {
					...pair,
					peer,
					handler,
					reader,
					send(bytes) {
						return new Promise<void>((resolve, reject) => {
							let seen = 0;
							function onClose() {
								pair.socket.off("data", onData);
								reject(new Error("fixture closed before input observation"));
							}
							function onData(chunk: Buffer) {
								seen += chunk.byteLength;
								if (seen < bytes.byteLength) return;
								pair.socket.off("data", onData);
								pair.socket.off("close", onClose);
								resolve();
							}
							pair.socket.on("data", onData);
							pair.socket.once("close", onClose);
							pair.client.write(bytes);
						});
					},
				};
			} catch (error) {
				peer.dispose();
				throw error;
			}
		},
	};
}

export interface WriteObservation {
	readonly writes: { backpressure: boolean; callback: boolean }[];
	readonly callback: Promise<void>;
	readonly drain: Promise<void>;
	release(): void;
}

export function observeSocketWrites(socket: Socket, hold?: "callback" | "drain"): WriteObservation {
	const writes: WriteObservation["writes"] = [];
	const held: (() => void)[] = [];
	let callbackSeen = () => {};
	let drainSeen = () => {};
	const callback = new Promise<void>((resolve) => {
		callbackSeen = resolve;
	});
	const drain = new Promise<void>((resolve) => {
		drainSeen = resolve;
	});
	const realWrite = socket.write.bind(socket);
	const realEmit = socket.emit.bind(socket);
	const emitter = vi.spyOn(socket, "emit").mockImplementation((event: string | symbol, ...args: unknown[]) => {
		if (event === "drain") {
			drainSeen();
			if (hold === "drain") {
				held.push(() => realEmit("drain"));
				return true;
			}
		}
		return realEmit(event, ...args);
	});
	const writer = vi
		.spyOn(socket, "write")
		.mockImplementation(
			(
				bytes: Uint8Array | string,
				encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
				done?: (error?: Error | null) => void,
			) => {
				const entry = { backpressure: false, callback: false };
				writes.push(entry);
				const notify = typeof encodingOrCallback === "function" ? encodingOrCallback : done;
				const finished = (error?: Error | null) => {
					entry.callback = true;
					callbackSeen();
					if (hold === "callback") held.push(() => notify?.(error));
					else notify?.(error);
				};
				const accepted =
					typeof encodingOrCallback === "string"
						? realWrite(bytes, encodingOrCallback, finished)
						: realWrite(bytes, finished);
				entry.backpressure = !accepted;
				return accepted;
			},
		);
	return {
		writes,
		callback,
		drain,
		release() {
			writer.mockRestore();
			emitter.mockRestore();
			for (const notify of held.splice(0)) notify();
		},
	};
}
