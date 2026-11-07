import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer, Socket } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { controlEndpointPath } from "../src/core/session-control-endpoint.ts";
import {
	authenticateSessionControlPeer,
	getAuthenticatedSessionControlPeer,
} from "../src/core/session-control-peer.ts";
import { MAX_CONTROL_BYTES } from "../src/core/session-control-protocol.ts";
import { AuthorityStore } from "../src/core/verified-run/authority-store.ts";
import * as broker from "../src/core/verified-run/broker.ts";
import * as candidate from "../src/core/verified-run/candidate.ts";
import { bindAuthenticatedWorkbenchControlConnection } from "../src/core/verified-run/workbench-local-peer.ts";
import { localPeerFixture } from "./workbench-local-peer-fixture.ts";

let fixture: Awaited<ReturnType<typeof localPeerFixture>>;
beforeEach(async () => {
	fixture = await localPeerFixture();
	for (const name of ["executeSandbox", "probeVerifiedSandbox"] as const)
		vi.spyOn(broker, name).mockImplementation(() => {
			throw new Error("execution/probe reached");
		});
	vi.spyOn(candidate, "captureCandidate").mockImplementation(() => {
		throw new Error("workspace capture reached");
	});
	vi.spyOn(AuthorityStore.prototype, "acquire").mockImplementation(() => {
		throw new Error("grant issuance reached");
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

describe.skipIf(process.platform === "win32")("local bearer-authenticated workbench validation", () => {
	it("authenticates actual private socket bytes and binds only host-selected actor/run metadata", async () => {
		const before = readFileSync(fixture.store.path);
		const head = readFileSync(`${fixture.store.path}.head`);
		const { peer } = await fixture.authenticate();
		expect(getAuthenticatedSessionControlPeer(peer)).toBe(peer);
		expect(Object.isFrozen(peer)).toBe(true);
		expect(Object.keys(peer).sort()).toEqual(["connectionId", "dispose", "sessionId", "sessionPath", "signal"]);
		expect(peer.connectionId).not.toBe(fixture.credentials().requestId);
		const connection = bindAuthenticatedWorkbenchControlConnection(peer, fixture.options());
		expect(connection.identity.actorId).toBe("local-owner");
		expect(connection.identity.runId).toBe("run-1");
		expect(connection.identity.connectionId).toBe(peer.connectionId);
		expect(Object.isFrozen(connection)).toBe(true);
		expect(connection.validate(fixture.frame(connection))).toMatchObject({
			kind: "validated-no-execution",
			executionRequested: false,
			capabilities: { execute: false, amendGraph: false, publish: false },
		});
		expect(readFileSync(fixture.store.path)).toEqual(before);
		expect(readFileSync(`${fixture.store.path}.head`)).toEqual(head);
		expect(fixture.store.state.grants.size).toBe(0);
	});
	it.each(["token", "sessionId", "action", "role"])(
		"refuses credential/identity substitution in %s",
		async (field) => {
			const pair = await fixture.connect();
			const pending = authenticateSessionControlPeer(pair.socket, {
				sessionPath: fixture.file,
				owner: fixture.controlOwner,
				hostSignal: fixture.host.signal,
			});
			const change =
				field === "token"
					? { token: randomBytes(32).toString("hex") }
					: field === "sessionId"
						? { sessionId: "other" }
						: field === "action"
							? { action: "abort" }
							: { actorId: "local-owner" };
			pair.client.write(`${JSON.stringify({ ...fixture.credentials(), ...change })}\n`);
			await expect(pending).rejects.toThrow("session_control_peer_unauthenticated");
			expect(pair.socket.destroyed).toBe(true);
		},
	);
	it.each(["invalid-utf8", "oversized", "two-frames", "duplicate-key"])("refuses %s auth", async (kind) => {
		const pair = await fixture.connect();
		const pending = authenticateSessionControlPeer(pair.socket, {
			sessionPath: fixture.file,
			owner: fixture.controlOwner,
			hostSignal: fixture.host.signal,
		});
		const text = JSON.stringify(fixture.credentials());
		const bytes =
			kind === "invalid-utf8"
				? Buffer.from([0xc3, 0x28, 10])
				: kind === "oversized"
					? Buffer.alloc(MAX_CONTROL_BYTES + 1, 120)
					: Buffer.from(
							kind === "two-frames"
								? `${text}\n${text}\n`
								: `${text.replace('"requestId"', '"requestId":"other","\\u0072equestId"')}\n`,
						);
		pair.client.write(bytes);
		await expect(pending).rejects.toThrow("session_control_peer_unauthenticated");
	});
	it("does not serialize a secret or a parser error when a descriptor is malformed", async () => {
		const pair = await fixture.connect();
		writeFileSync(controlEndpointPath(fixture.file), `{"token":"${fixture.endpoint.token}"`, { mode: 0o600 });
		const pending = authenticateSessionControlPeer(pair.socket, {
			sessionPath: fixture.file,
			owner: fixture.controlOwner,
			hostSignal: fixture.host.signal,
		});
		pair.client.write(`${JSON.stringify(fixture.credentials())}\n`);
		await expect(pending).rejects.toThrow(/^session_control_peer_unauthenticated$/);
	});
	it("refuses a disconnected Socket rather than authenticating a supplied object", async () => {
		await expect(
			authenticateSessionControlPeer(new Socket(), {
				sessionPath: fixture.file,
				owner: fixture.controlOwner,
				hostSignal: fixture.host.signal,
			}),
		).rejects.toThrow("session_control_peer_unauthenticated");
	});
	it("refuses a real TCP socket even when it presents the valid local bearer token", async () => {
		const server = createServer({ pauseOnConnect: true });
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("fixture TCP port unavailable");
		const accepted = new Promise<Socket>((resolve) => server.once("connection", resolve));
		const client = createConnection(address.port, "127.0.0.1");
		client.on("error", () => {});
		const socket = await accepted;
		socket.on("error", () => {});
		try {
			const pending = authenticateSessionControlPeer(socket, {
				sessionPath: fixture.file,
				owner: fixture.controlOwner,
				hostSignal: fixture.host.signal,
			});
			client.write(`${JSON.stringify(fixture.credentials())}\n`);
			await expect(pending).rejects.toThrow("session_control_peer_unauthenticated");
		} finally {
			client.destroy();
			socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
	it("refuses an incomplete credential frame when the real peer ends the stream", async () => {
		const pair = await fixture.connect();
		const pending = authenticateSessionControlPeer(pair.socket, {
			sessionPath: fixture.file,
			owner: fixture.controlOwner,
			hostSignal: fixture.host.signal,
		});
		pair.client.end("{");
		await expect(pending).rejects.toThrow("session_control_peer_unauthenticated");
	});
	it("refuses a credential handshake after its total deadline without waiting for timer order", async () => {
		const pair = await fixture.connect();
		const clock = vi.spyOn(performance, "now").mockReturnValue(100);
		const pending = authenticateSessionControlPeer(pair.socket, {
			sessionPath: fixture.file,
			owner: fixture.controlOwner,
			hostSignal: fixture.host.signal,
			requestTimeoutMs: 20,
		});
		clock.mockReturnValue(120);
		pair.client.write(`${JSON.stringify(fixture.credentials())}\n`);
		await expect(pending).rejects.toThrow("session_control_peer_unauthenticated");
	});
	it("closes the actual socket if the deadline clock cannot be initialized", async () => {
		const pair = await fixture.connect();
		vi.spyOn(performance, "now").mockReturnValue(Number.NaN);
		await expect(
			authenticateSessionControlPeer(pair.socket, {
				sessionPath: fixture.file,
				owner: fixture.controlOwner,
				hostSignal: fixture.host.signal,
			}),
		).rejects.toThrow(/^session_control_peer_unauthenticated$/);
		expect(pair.socket.destroyed).toBe(true);
	});
	it("does not promote lookalike flags, serialized peers or copies of a valid handle", async () => {
		const { peer } = await fixture.authenticate();
		for (const value of [null, { authenticated: true, ...peer }, { ...peer }, JSON.parse(JSON.stringify(peer))]) {
			expect(getAuthenticatedSessionControlPeer(value)).toBeUndefined();
			expect(() => bindAuthenticatedWorkbenchControlConnection(value, fixture.options())).toThrow(
				/workbench_unauthenticated/,
			);
		}
	});
	it.each(["controlSessionId", "controlSessionPath"])(
		"rejects a valid peer from the wrong host-selected %s",
		async (field) => {
			const { peer } = await fixture.authenticate();
			const value = field === "controlSessionId" ? "other-session" : join(fixture.root, "other-session.jsonl");
			expect(() =>
				bindAuthenticatedWorkbenchControlConnection(peer, { ...fixture.options(), [field]: value }),
			).toThrow(/workbench_identity/);
		},
	);
	it.each(["actorId", "connectionId"])("rejects a forged workbench %s after genuine authentication", async (field) => {
		const { peer } = await fixture.authenticate();
		const connection = bindAuthenticatedWorkbenchControlConnection(peer, fixture.options());
		expect(() => connection.validate(fixture.frame(connection, { [field]: "forged" }))).toThrow(/workbench_identity/);
	});
	it("revokes a bound connection immediately and idempotently on disposal", async () => {
		const { peer, socket } = await fixture.authenticate();
		const connection = bindAuthenticatedWorkbenchControlConnection(peer, fixture.options());
		connection.dispose();
		connection.dispose();
		expect(peer.signal.aborted).toBe(true);
		expect(socket.destroyed).toBe(true);
		expect(getAuthenticatedSessionControlPeer(peer)).toBeUndefined();
		expect(() => connection.validate(fixture.frame(connection))).toThrow(/workbench_unauthenticated/);
		expect(() => bindAuthenticatedWorkbenchControlConnection(peer, fixture.options())).toThrow(
			/workbench_unauthenticated/,
		);
	});
	it.each(["end", "error", "host-abort", "extra-data"])("revokes the actual peer lifetime on %s", async (event) => {
		const { peer, socket, client } = await fixture.authenticate();
		const connection = bindAuthenticatedWorkbenchControlConnection(peer, fixture.options());
		const revoked = new Promise<void>((resolve) =>
			peer.signal.addEventListener("abort", () => resolve(), { once: true }),
		);
		if (event === "end") client.end();
		else if (event === "error") socket.destroy(new Error("fixture transport failure"));
		else if (event === "host-abort") fixture.host.abort();
		else client.write("unexpected bytes");
		await revoked;
		expect(() => connection.validate(fixture.frame(connection))).toThrow(/workbench_unauthenticated/);
	});
	it("refuses validation when the total socket deadline passes even if its timer has not fired", async () => {
		const clock = vi.spyOn(performance, "now").mockReturnValue(100);
		const { peer } = await fixture.authenticate();
		const connection = bindAuthenticatedWorkbenchControlConnection(peer, fixture.options());
		clock.mockReturnValue(10_100);
		expect(() => connection.validate(fixture.frame(connection))).toThrow(/workbench_unauthenticated/);
	});
	it.each(["rotation", "unsafe-permissions", "owner-release", "owner-transfer"])(
		"revokes old authentication after %s",
		async (change) => {
			const { peer } = await fixture.authenticate();
			const connection = bindAuthenticatedWorkbenchControlConnection(peer, fixture.options());
			if (change === "rotation")
				writeFileSync(
					controlEndpointPath(fixture.file),
					JSON.stringify({ ...fixture.endpoint, token: randomBytes(32).toString("hex") }),
				);
			else if (change === "unsafe-permissions") chmodSync(controlEndpointPath(fixture.file), 0o644);
			else if (change === "owner-release") fixture.controlOwner.release();
			else {
				fixture.controlOwner.transfer(join(fixture.root, "other"));
				fixture.controlOwner.transfer(fixture.file);
			}
			expect(() => connection.validate(fixture.frame(connection))).toThrow(/workbench_unauthenticated/);
			expect(getAuthenticatedSessionControlPeer(peer)).toBeUndefined();
		},
	);
	it.each([2, 3])("refuses peer disposal during host clock callback %d", async (at) => {
		const { peer } = await fixture.authenticate();
		let reads = 0;
		const connection = bindAuthenticatedWorkbenchControlConnection(peer, {
			...fixture.options(),
			clock: () => {
				if (++reads === at) peer.dispose();
				return fixture.time.now;
			},
		});
		expect(() => connection.validate(fixture.frame(connection))).toThrow(/workbench_unauthenticated/);
	});
	it("does not renew the host authorization deadline from caller mutation", async () => {
		const { peer } = await fixture.authenticate();
		const input = { ...fixture.options() };
		const connection = bindAuthenticatedWorkbenchControlConnection(peer, input);
		input.authorizationDeadline = 999;
		fixture.time.now = 150;
		expect(() => connection.validate(fixture.frame(connection))).toThrow(/authorization_expired/);
	});
	it("still fences the underlying run owner after genuine peer authentication", async () => {
		const { peer } = await fixture.authenticate();
		const connection = bindAuthenticatedWorkbenchControlConnection(peer, fixture.options());
		fixture.runOwner.release();
		expect(() => connection.validate(fixture.frame(connection))).toThrow(/stale_owner/);
	});
});
