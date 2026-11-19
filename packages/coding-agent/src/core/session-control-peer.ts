import { randomUUID, timingSafeEqual } from "node:crypto";
import { lstatSync } from "node:fs";
import { Socket } from "node:net";
import { dirname } from "node:path";
import { controlDeadline, controlTimeoutMs } from "./control-deadline.ts";
import { readControlEndpoint } from "./session-control-endpoint.ts";
import { MAX_CONTROL_BYTES, parseControlRequest } from "./session-control-protocol.ts";
import type { SessionOwnerLease } from "./session-owner-lease.ts";

export interface AuthenticatedSessionControlPeer {
	readonly sessionId: string;
	readonly sessionPath: string;
	readonly connectionId: string;
	readonly signal: AbortSignal;
	dispose(): void;
}
export interface SessionControlPeerOptions {
	readonly sessionPath: string;
	readonly owner: SessionOwnerLease;
	readonly hostSignal: AbortSignal;
	readonly requestTimeoutMs?: number;
}

const authenticatedPeers = new WeakMap<
	object,
	{
		readonly peer: AuthenticatedSessionControlPeer;
		readonly current: () => boolean;
		readonly handoff: () => Socket | undefined;
	}
>();

/** Consumes one credential frame on a caller-accepted POSIX socket, then retains its lifetime only. */
export async function authenticateSessionControlPeer(
	socket: Socket,
	options: SessionControlPeerOptions,
): Promise<AuthenticatedSessionControlPeer> {
	const fail = () => new Error("session_control_peer_unauthenticated");
	const { sessionPath, owner, hostSignal } = options;
	if (
		process.platform === "win32" ||
		!(socket instanceof Socket) ||
		socket.pending ||
		socket.connecting ||
		socket.destroyed ||
		socket.readableEnded ||
		socket.remoteAddress !== undefined ||
		socket.localAddress !== undefined ||
		!socket.readable ||
		!socket.writable ||
		!(hostSignal instanceof AbortSignal) ||
		hostSignal.aborted
	) {
		if (socket instanceof Socket) socket.destroy();
		throw fail();
	}
	let endpoint: ReturnType<typeof readControlEndpoint>;
	let duration: number;
	const ownerIdentity = owner.identity;
	try {
		duration = controlTimeoutMs(options.requestTimeoutMs);
		if (!owner.owns(sessionPath)) throw fail();
		endpoint = readControlEndpoint(sessionPath);
	} catch {
		socket.destroy();
		throw fail();
	}
	return new Promise<AuthenticatedSessionControlPeer>((resolve, reject) => {
		const lifetime = new AbortController();
		let authenticated = false;
		let handedOff = false;
		let stopped = false;
		let bytes = 0;
		let chunks: Buffer[] = [];
		const deadline = controlDeadline(duration, dispose);
		function dispose() {
			if (stopped) return;
			stopped = true;
			deadline.cancel();
			lifetime.abort();
			chunks = [];
			socket.off("data", onData);
			socket.off("end", dispose);
			socket.off("close", dispose);
			socket.off("error", dispose);
			hostSignal.removeEventListener("abort", dispose);
			socket.destroy();
			if (!authenticated) reject(fail());
		}
		function current(): boolean {
			try {
				if (
					stopped ||
					hostSignal.aborted ||
					deadline.expired() ||
					socket.pending ||
					socket.destroyed ||
					socket.readableEnded ||
					!socket.writable ||
					owner.identity !== ownerIdentity ||
					!owner.owns(sessionPath)
				)
					throw fail();
				const fresh = readControlEndpoint(sessionPath);
				if (
					fresh.sessionId !== endpoint.sessionId ||
					fresh.sessionPath !== endpoint.sessionPath ||
					fresh.socketPath !== endpoint.socketPath ||
					!timingSafeEqual(Buffer.from(fresh.token, "hex"), Buffer.from(endpoint.token, "hex"))
				)
					throw fail();
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
						throw fail();
				}
				return true;
			} catch {
				dispose();
				return false;
			}
		}
		function onData(chunk: Buffer) {
			if (authenticated || !Buffer.isBuffer(chunk) || chunk.byteLength > MAX_CONTROL_BYTES - bytes || !current()) {
				dispose();
				return;
			}
			bytes += chunk.byteLength;
			chunks.push(chunk);
			const end = chunk.indexOf(10);
			if (end < 0) return;
			try {
				if (end !== chunk.byteLength - 1) throw fail();
				const payload = Buffer.concat(chunks, bytes).subarray(0, -1);
				const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload);
				const value: unknown = JSON.parse(text);
				if (JSON.stringify(value) !== text) throw fail();
				const request = parseControlRequest(value);
				if (
					request.action !== "status" ||
					request.sessionId !== endpoint.sessionId ||
					!timingSafeEqual(Buffer.from(request.token, "hex"), Buffer.from(endpoint.token, "hex")) ||
					!current()
				)
					throw fail();
				const peer: AuthenticatedSessionControlPeer = Object.freeze({
					sessionId: endpoint.sessionId,
					sessionPath: endpoint.sessionPath,
					connectionId: randomUUID(),
					signal: lifetime.signal,
					dispose,
				});
				authenticatedPeers.set(peer, {
					peer,
					current,
					handoff() {
						if (handedOff || !current()) return undefined;
						handedOff = true;
						socket.pause();
						socket.off("data", onData);
						return socket;
					},
				});
				authenticated = true;
				chunks = [];
				resolve(peer);
			} catch {
				dispose();
			}
		}
		socket.on("data", onData);
		socket.once("end", dispose);
		socket.once("close", dispose);
		socket.once("error", dispose);
		hostSignal.addEventListener("abort", dispose, { once: true });
		if (current()) socket.resume();
	}).catch(() => {
		socket.destroy();
		throw fail();
	});
}

/** Only handles registered by the actual socket authentication path are accepted. */
export function getAuthenticatedSessionControlPeer(value: unknown): AuthenticatedSessionControlPeer | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const binding = authenticatedPeers.get(value);
	return binding?.current() ? binding.peer : undefined;
}

/** Claims the actual socket once, paused; authentication and lifetime checks remain active. */
export function handoffAuthenticatedSessionControlPeer(value: unknown): Socket | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	return authenticatedPeers.get(value)?.handoff();
}
