import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { MAX_WORKBENCH_CONTROL_BYTES, WORKBENCH_CONTROL_VERSION } from "omk-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { controlEndpointPath } from "../src/core/session-control-endpoint.ts";
import {
	getAuthenticatedSessionControlPeer,
	handoffAuthenticatedSessionControlPeer,
} from "../src/core/session-control-peer.ts";
import { AuthorityStore } from "../src/core/verified-run/authority-store.ts";
import * as broker from "../src/core/verified-run/broker.ts";
import * as candidate from "../src/core/verified-run/candidate.ts";
import { attachWorkbenchControlIpc } from "../src/core/verified-run/workbench-ipc.ts";
import {
	type IpcFixture,
	ipcFixture,
	observeSocketWrites,
	readIpcFrames,
	type WriteObservation,
} from "./workbench-ipc-fixture.ts";

let fixture: IpcFixture;
beforeEach(async () => {
	fixture = await ipcFixture();
	for (const name of ["executeSandbox", "probeVerifiedSandbox"] as const)
		vi.spyOn(broker, name).mockImplementation(() => {
			throw new Error("execution/probe reached");
		});
	vi.spyOn(candidate, "captureCandidate").mockImplementation(() => {
		throw new Error("capture reached");
	});
	vi.spyOn(AuthorityStore.prototype, "acquire").mockImplementation(() => {
		throw new Error("grant reached");
	});
});
afterEach(async () => {
	try {
		expect(broker.executeSandbox).not.toHaveBeenCalled();
		expect(broker.probeVerifiedSandbox).not.toHaveBeenCalled();
		expect(candidate.captureCandidate).not.toHaveBeenCalled();
		expect(AuthorityStore.prototype.acquire).not.toHaveBeenCalled();
	} finally {
		await fixture.close();
		rmSync(fixture.root, { recursive: true, force: true });
		vi.restoreAllMocks();
	}
});

describe.skipIf(process.platform === "win32")("inactive authenticated workbench IPC", () => {
	it("hands off only the actual registered socket, paused and once", async () => {
		const { peer, socket } = await fixture.authenticate();
		for (const fake of [null, { ...peer }, { authenticated: true, ...peer }])
			expect(handoffAuthenticatedSessionControlPeer(fake)).toBeUndefined();
		expect(handoffAuthenticatedSessionControlPeer(peer)).toBe(socket);
		expect(socket.isPaused()).toBe(true);
		expect(getAuthenticatedSessionControlPeer(peer)).toBe(peer);
		expect(handoffAuthenticatedSessionControlPeer(peer)).toBeUndefined();
	});
	it("announces ready and routes a fragmented frame without execution or journal writes", async () => {
		const before = readFileSync(fixture.store.path);
		const head = readFileSync(`${fixture.store.path}.head`);
		const channel = await fixture.open();
		expect(await channel.reader.next()).toEqual({
			schemaVersion: WORKBENCH_CONTROL_VERSION,
			kind: "ready-no-execution",
			identity: channel.handler.identity,
			executionRequested: false,
			capabilities: { execute: false, amendGraph: false, publish: false },
			limits: { payloadBytes: 4096, queuedFrames: 4, requests: 64 },
		});
		const bytes = fixture.frame(channel.handler);
		await channel.send(bytes.subarray(0, 13));
		expect(channel.reader.messages).toHaveLength(1);
		await channel.send(bytes.subarray(13));
		expect(await channel.reader.next()).toMatchObject({
			kind: "validated-no-execution",
			requestId: "validate-1",
			executionRequested: false,
			capabilities: { execute: false, amendGraph: false, publish: false },
		});
		for (const message of channel.reader.messages)
			expect(Buffer.byteLength(`${JSON.stringify(message)}\n`)).toBeLessThanOrEqual(4097);
		expect(readFileSync(fixture.store.path)).toEqual(before);
		expect(readFileSync(`${fixture.store.path}.head`)).toEqual(head);
		expect(fixture.store.state.grants.size).toBe(0);
		expect(Object.isFrozen(channel.handler)).toBe(true);
	});
	it("rejects a second handler without disrupting the first socket owner", async () => {
		const channel = await fixture.open();
		await channel.reader.next();
		expect(() => attachWorkbenchControlIpc(channel.peer, fixture.options())).toThrow(/workbench_unauthenticated/);
		await channel.send(fixture.frame(channel.handler));
		expect(await channel.reader.next()).toMatchObject({ kind: "validated-no-execution" });
	});
	it("refuses cloned peer handles without consuming the genuine handoff", async () => {
		const { peer, client } = await fixture.authenticate();
		for (const fake of [null, { ...peer }, { authenticated: true, ...peer }])
			expect(() => attachWorkbenchControlIpc(fake, fixture.options())).toThrow(/workbench_unauthenticated/);
		const reader = readIpcFrames(client);
		const handler = attachWorkbenchControlIpc(peer, fixture.options());
		expect(await reader.next()).toMatchObject({ kind: "ready-no-execution" });
		client.write(fixture.frame(handler));
		expect(await reader.next()).toMatchObject({ kind: "validated-no-execution" });
	});
	it("rejects input already buffered before handoff without sending ready", async () => {
		const { peer, socket, client } = await fixture.authenticate();
		socket.pause();
		const reader = readIpcFrames(client);
		let observed = () => {};
		const buffered = new Promise<void>((resolve) => {
			observed = resolve;
		});
		socket.on("readable", observed);
		client.write("premature\n");
		await buffered;
		expect(socket.readableLength).toBeGreaterThan(0);
		const handler = attachWorkbenchControlIpc(peer, fixture.options());
		socket.off("readable", observed);
		await handler.closed;
		await reader.closed;
		expect(reader.messages).toHaveLength(0);
	});
	it("rejects control bytes buffered before ready write completion", async () => {
		let writes: WriteObservation | undefined;
		const channel = await fixture.open({}, undefined, (socket) => {
			socket.cork();
			writes = observeSocketWrites(socket, "callback");
		});
		if (!writes) throw new Error("fixture write observation missing");
		expect(writes.writes[0]?.backpressure).toBe(true);
		expect(channel.socket.isPaused()).toBe(true);
		channel.socket.uncork();
		await channel.reader.next();
		await writes.callback;
		let observed = () => {};
		const buffered = new Promise<void>((resolve) => {
			observed = resolve;
		});
		channel.socket.on("readable", observed);
		channel.client.write(fixture.frame(channel.handler));
		await buffered;
		writes.release();
		await channel.reader.closed;
		channel.socket.off("readable", observed);
		expect(channel.reader.messages).toHaveLength(1);
	});
	it("never writes oversized ready metadata", async () => {
		const channel = await fixture.open({ hostId: "h".repeat(5000) });
		await channel.handler.closed;
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(0);
	});
	it.each(["callback", "drain"] as const)("waits for real write completion and %s", async (hold) => {
		const channel = await fixture.open();
		await channel.reader.next();
		const writes = observeSocketWrites(channel.socket, hold);
		channel.socket.cork();
		await channel.send(
			Buffer.concat([1, 2].map((n) => Buffer.from(fixture.frame(channel.handler, { requestId: `req-${n}` })))),
		);
		expect(writes.writes[0]?.backpressure).toBe(true);
		channel.socket.uncork();
		expect(await channel.reader.next()).toMatchObject({ requestId: "req-1" });
		await writes.callback;
		expect(writes.writes[0]?.backpressure).toBe(true);
		await writes.drain;
		expect(writes.writes).toEqual([{ backpressure: true, callback: true }]);
		expect(channel.reader.messages).toHaveLength(2);
		writes.release();
		expect(await channel.reader.next()).toMatchObject({ requestId: "req-2" });
	});
	it("allows four waiting frames in order behind one real write", async () => {
		const channel = await fixture.open();
		await channel.reader.next();
		const writes = observeSocketWrites(channel.socket, "callback");
		await channel.send(fixture.frame(channel.handler, { requestId: "req-0" }));
		await channel.reader.next();
		await writes.callback;
		await channel.send(
			Buffer.concat([1, 2, 3, 4].map((n) => Buffer.from(fixture.frame(channel.handler, { requestId: `req-${n}` })))),
		);
		expect(writes.writes).toHaveLength(1);
		writes.release();
		for (let n = 1; n <= 4; n++) expect(await channel.reader.next()).toMatchObject({ requestId: `req-${n}` });
	});
	it("closes on a fifth waiting frame instead of growing the queue", async () => {
		const channel = await fixture.open();
		await channel.reader.next();
		const writes = observeSocketWrites(channel.socket, "callback");
		await channel.send(fixture.frame(channel.handler));
		await channel.reader.next();
		await writes.callback;
		channel.client.write(
			Buffer.concat(
				[1, 2, 3, 4, 5].map((n) => Buffer.from(fixture.frame(channel.handler, { requestId: `req-${n}` }))),
			),
		);
		await channel.handler.closed;
		await channel.reader.closed;
		writes.release();
		expect(channel.reader.messages).toHaveLength(2);
		expect(getAuthenticatedSessionControlPeer(channel.peer)).toBeUndefined();
	});
	it("drops queued frames and settles actual closure on repeated disposal", async () => {
		const channel = await fixture.open();
		await channel.reader.next();
		const writes = observeSocketWrites(channel.socket, "callback");
		await channel.send(fixture.frame(channel.handler));
		await channel.reader.next();
		await writes.callback;
		await channel.send(fixture.frame(channel.handler, { requestId: "queued" }));
		channel.handler.dispose();
		channel.handler.dispose();
		await channel.handler.closed;
		expect(channel.socket.closed).toBe(true);
		writes.release();
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(2);
		expect(channel.socket.listenerCount("data")).toBe(0);
		expect(channel.peer.signal.aborted).toBe(true);
		expect(fixture.runOwner.released).toBe(false);
		expect(fixture.store.isReleased).toBe(false);
	});
	it("rechecks the host deadline before dequeuing the next frame", async () => {
		const channel = await fixture.open();
		await channel.reader.next();
		const writes = observeSocketWrites(channel.socket, "callback");
		await channel.send(fixture.frame(channel.handler));
		await channel.reader.next();
		await writes.callback;
		await channel.send(fixture.frame(channel.handler, { requestId: "expired" }));
		fixture.time.now = 150;
		writes.release();
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(2);
	});
	it.each(["owner", "store"])("rechecks %s before sending a queued response", async (change) => {
		const channel = await fixture.open();
		await channel.reader.next();
		const writes = observeSocketWrites(channel.socket, "callback");
		await channel.send(fixture.frame(channel.handler));
		await channel.reader.next();
		await writes.callback;
		await channel.send(fixture.frame(channel.handler, { requestId: "revoked" }));
		if (change === "owner") fixture.runOwner.release();
		else fixture.store.release();
		writes.release();
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(2);
	});
	it.each([2, 3])("sends no validation after clock-time host abort %d", async (at) => {
		let reads = 0;
		const channel = await fixture.open({
			clock: () => {
				if (++reads === at) fixture.host.abort();
				return fixture.time.now;
			},
		});
		await channel.reader.next();
		channel.client.write(fixture.frame(channel.handler));
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(1);
	});
	it.each(["throw", "callback"])("closes on an injected write %s failure", async (failure) => {
		const channel = await fixture.open();
		await channel.reader.next();
		vi.spyOn(channel.socket, "write").mockImplementation(
			(
				_bytes: Uint8Array | string,
				encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
				done?: (error?: Error | null) => void,
			) => {
				const error = new Error("fixture write failure");
				if (failure === "throw") throw error;
				const notify = typeof encodingOrCallback === "function" ? encodingOrCallback : done;
				notify?.(error);
				return false;
			},
		);
		channel.client.write(fixture.frame(channel.handler));
		await channel.handler.closed;
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(1);
	});
	it("keeps the original total auth deadline across handoff", async () => {
		const clock = vi.spyOn(performance, "now").mockReturnValue(100);
		const channel = await fixture.open();
		await channel.reader.next();
		clock.mockReturnValue(10_100);
		channel.client.write(fixture.frame(channel.handler));
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(1);
	});
	it.each(["hostId", "hostEpoch", "actorId", "connectionId"])("closes on forged %s", async (field) => {
		const channel = await fixture.open();
		await channel.reader.next();
		channel.client.write(fixture.frame(channel.handler, { [field]: field === "hostEpoch" ? "999" : "forged" }));
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(1);
	});
	it.each(["utf8", "crlf", "duplicate", "unknown"])("rejects %s on the real control route", async (kind) => {
		const channel = await fixture.open();
		await channel.reader.next();
		const frame = Buffer.from(fixture.frame(channel.handler)).toString("utf8");
		const bytes =
			kind === "utf8"
				? Buffer.from([0xc3, 0x28, 10])
				: Buffer.from(
						kind === "crlf"
							? frame.replace(/\n$/, "\r\n")
							: kind === "duplicate"
								? frame.replace('"requestId"', '"requestId":"other","\\u0072equestId"')
								: frame.replace('"validate-start"', '"execute"'),
					);
		channel.client.write(bytes);
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(1);
	});
	it("bounds an incomplete frame at 4096 payload bytes", async () => {
		const channel = await fixture.open();
		await channel.reader.next();
		await channel.send(Buffer.alloc(MAX_WORKBENCH_CONTROL_BYTES, 120));
		expect(channel.socket.destroyed).toBe(false);
		channel.client.write("x");
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(1);
	});
	it("rejects an oversized LF-terminated frame", async () => {
		const channel = await fixture.open();
		await channel.reader.next();
		channel.client.write(Buffer.concat([Buffer.alloc(MAX_WORKBENCH_CONTROL_BYTES + 1, 120), Buffer.from("\n")]));
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(1);
	});
	it("accepts at most 64 requests without replenishing the counter", async () => {
		const channel = await fixture.open();
		await channel.reader.next();
		for (let n = 1; n <= 64; n++) {
			channel.client.write(fixture.frame(channel.handler, { requestId: `req-${n}` }));
			expect(await channel.reader.next()).toMatchObject({ requestId: `req-${n}` });
		}
		channel.client.write(fixture.frame(channel.handler, { requestId: "req-65" }));
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(65);
	});
	it.each(["owner", "descriptor", "host", "end", "error"])("closes on %s revocation", async (change) => {
		const channel = await fixture.open();
		await channel.reader.next();
		if (change === "owner") fixture.runOwner.release();
		else if (change === "descriptor")
			writeFileSync(
				controlEndpointPath(fixture.file),
				JSON.stringify({ ...fixture.endpoint, token: randomBytes(32).toString("hex") }),
			);
		else if (change === "host") fixture.host.abort();
		else if (change === "end") channel.client.end();
		else channel.socket.destroy(new Error("fixture transport failure"));
		if (change === "owner" || change === "descriptor") channel.client.write(fixture.frame(channel.handler));
		await channel.handler.closed;
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(1);
	});
	it("honors the actual fixed timer while waiting for a partial frame", async () => {
		const channel = await fixture.open({}, 100);
		await channel.reader.next();
		channel.client.write("{");
		await channel.handler.closed;
		expect(channel.peer.signal.aborted).toBe(true);
		await channel.reader.closed;
		expect(channel.reader.messages).toHaveLength(1);
	});
});
