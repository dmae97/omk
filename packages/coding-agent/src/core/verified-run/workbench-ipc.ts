import { MAX_WORKBENCH_CONTROL_BYTES, WORKBENCH_CONTROL_VERSION } from "omk-protocol";
import { getAuthenticatedSessionControlPeer, handoffAuthenticatedSessionControlPeer } from "../session-control-peer.ts";
import { VerifiedRunError } from "./storage.ts";
import type { WorkbenchControlConnection } from "./workbench-connection.ts";
import {
	bindAuthenticatedWorkbenchControlConnection,
	type LocalWorkbenchControlOptions,
} from "./workbench-local-peer.ts";

const MAX_QUEUED_FRAMES = 4;
const MAX_REQUESTS = 64;

export interface WorkbenchControlIpc {
	readonly identity: WorkbenchControlConnection["identity"];
	readonly closed: Promise<void>;
	dispose(): void;
}

/** Inactive per-socket validation route; the caller owns listener admission and authenticated policy. */
export function attachWorkbenchControlIpc(value: unknown, options: LocalWorkbenchControlOptions): WorkbenchControlIpc {
	const authenticated = getAuthenticatedSessionControlPeer(value);
	if (!authenticated) throw new VerifiedRunError("workbench_unauthenticated");
	const peer = authenticated;
	const connection = bindAuthenticatedWorkbenchControlConnection(peer, options);
	const handedOff = handoffAuthenticatedSessionControlPeer(peer);
	if (!handedOff) throw new VerifiedRunError("workbench_unauthenticated");
	const socket = handedOff;
	const queue: Buffer[] = [];
	let partial = Buffer.alloc(0);
	let requests = 0;
	let stopped = false;
	let ready = false;
	let writing = false;
	let clearDrain = () => {};

	function dispose() {
		if (stopped) return;
		stopped = true;
		queue.length = 0;
		partial = Buffer.alloc(0);
		clearDrain();
		socket.off("data", onData);
		peer.signal.removeEventListener("abort", dispose);
		connection.dispose();
	}
	function send(value: unknown, complete: () => void) {
		if (stopped) return;
		try {
			if (getAuthenticatedSessionControlPeer(peer) !== peer) throw new VerifiedRunError("workbench_unauthenticated");
			const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
			if (bytes.byteLength > MAX_WORKBENCH_CONTROL_BYTES + 1) throw new VerifiedRunError("workbench_response_size");
			writing = true;
			let returned = false;
			let written = false;
			let drained = false;
			function advance() {
				if (stopped || !returned || !written || !drained) return;
				clearDrain();
				writing = false;
				complete();
			}
			function onDrain() {
				drained = true;
				advance();
			}
			clearDrain = () => {
				socket.off("drain", onDrain);
			};
			socket.once("drain", onDrain);
			const accepted = socket.write(bytes, (error) => {
				if (error) {
					dispose();
					return;
				}
				written = true;
				advance();
			});
			returned = true;
			if (accepted) drained = true;
			advance();
		} catch {
			dispose();
		}
	}
	function pump() {
		if (stopped || !ready || writing) return;
		const frame = queue.shift();
		if (!frame) return;
		try {
			send(connection.validate(frame), pump);
		} catch {
			dispose();
		}
	}
	function onData(chunk: Buffer) {
		if (stopped) return;
		try {
			if (!ready || !Buffer.isBuffer(chunk)) throw new VerifiedRunError("workbench_frame");
			let start = 0;
			while (start < chunk.byteLength) {
				const newline = chunk.indexOf(10, start);
				const end = newline < 0 ? chunk.byteLength : newline + 1;
				const size = partial.byteLength + end - start;
				if (size > MAX_WORKBENCH_CONTROL_BYTES + (newline < 0 ? 0 : 1))
					throw new VerifiedRunError("workbench_frame_size");
				if (newline >= 0 && (queue.length >= MAX_QUEUED_FRAMES || requests >= MAX_REQUESTS))
					throw new VerifiedRunError("workbench_request_limit");
				partial = Buffer.concat([partial, chunk.subarray(start, end)], size);
				start = end;
				if (newline < 0) break;
				requests++;
				queue.push(partial);
				partial = Buffer.alloc(0);
			}
			pump();
		} catch {
			dispose();
		}
	}

	const closed = new Promise<void>((resolve) => {
		socket.once("close", () => {
			dispose();
			socket.off("end", dispose);
			socket.off("error", dispose);
			resolve();
		});
	});
	socket.on("data", onData);
	socket.on("end", dispose);
	socket.on("error", dispose);
	peer.signal.addEventListener("abort", dispose, { once: true });
	if (socket.readableLength !== 0 || socket.writableLength !== 0) dispose();
	else
		send(
			{
				schemaVersion: WORKBENCH_CONTROL_VERSION,
				kind: "ready-no-execution",
				identity: connection.identity,
				executionRequested: false,
				capabilities: { execute: false, amendGraph: false, publish: false },
				limits: {
					payloadBytes: MAX_WORKBENCH_CONTROL_BYTES,
					queuedFrames: MAX_QUEUED_FRAMES,
					requests: MAX_REQUESTS,
				},
			},
			() => {
				if (socket.readableLength !== 0) {
					dispose();
					return;
				}
				ready = true;
				socket.resume();
				pump();
			},
		);
	return Object.freeze({ identity: connection.identity, closed, dispose });
}
