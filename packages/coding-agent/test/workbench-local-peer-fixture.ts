import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunStartCommand, VERIFIED_COMMAND_VERSION, WORKBENCH_CONTROL_VERSION } from "omk-protocol";
import { resolveDurableFileIdentity } from "../src/core/durable-file-identity.ts";
import { publishControlEndpoint, type SessionControlEndpoint } from "../src/core/session-control-endpoint.ts";
import {
	type AuthenticatedSessionControlPeer,
	authenticateSessionControlPeer,
} from "../src/core/session-control-peer.ts";
import type { SessionControlRequest } from "../src/core/session-control-protocol.ts";
import { acquireSessionOwnerLeaseSync, type SessionOwnerLease } from "../src/core/session-owner-lease.ts";
import { AuthorityStore, authorityStorePath } from "../src/core/verified-run/authority-store.ts";
import { journalPath } from "../src/core/verified-run/journal.ts";
import { stateRunPath } from "../src/core/verified-run/storage.ts";
import type {
	LocalWorkbenchControlConnection,
	LocalWorkbenchControlOptions,
} from "../src/core/verified-run/workbench-local-peer.ts";

export interface LocalPeerFixture {
	readonly root: string;
	readonly file: string;
	readonly endpoint: SessionControlEndpoint;
	readonly controlOwner: SessionOwnerLease;
	readonly runOwner: SessionOwnerLease;
	readonly stateRoot: string;
	readonly store: AuthorityStore;
	readonly host: AbortController;
	readonly time: { now: number };
	options(): LocalWorkbenchControlOptions;
	credentials(): SessionControlRequest;
	connect(): Promise<{ client: Socket; socket: Socket }>;
	authenticate(): Promise<{ client: Socket; socket: Socket; peer: AuthenticatedSessionControlPeer }>;
	frame(connection: Pick<LocalWorkbenchControlConnection, "identity">, change?: Record<string, unknown>): Uint8Array;
	close(): Promise<void>;
}

export async function localPeerFixture(highWaterMark?: number): Promise<LocalPeerFixture> {
	const root = mkdtempSync(join(tmpdir(), "wb-peer-"));
	chmodSync(root, 0o700);
	const file = join(root, "session.jsonl");
	writeFileSync(file, "", { mode: 0o600 });
	const controlOwner = acquireSessionOwnerLeaseSync(file);
	const sockets = new Set<Socket>();
	const server = createServer({ pauseOnConnect: true, highWaterMark }, (socket) => {
		sockets.add(socket);
		socket.on("error", () => {});
	});
	const socketPath = join(root, "rpc");
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolve);
	});
	chmodSync(socketPath, 0o600);
	const endpoint: SessionControlEndpoint = {
		version: 1,
		sessionId: "interactive-1",
		sessionPath: resolveDurableFileIdentity(file).canonicalPath,
		socketPath,
		token: randomBytes(32).toString("hex"),
	};
	publishControlEndpoint(endpoint);
	const stateRoot = join(root, "state");
	const runPath = stateRunPath(stateRoot, "run-1");
	mkdirSync(runPath, { recursive: true });
	const runOwner = acquireSessionOwnerLeaseSync(journalPath(runPath));
	const time = { now: 100 };
	const store = AuthorityStore.open(authorityStorePath(stateRoot), { capacity: 2, clock: () => time.now });
	store.reconcile();
	const authority = { store, sessionId: "run-1", incarnation: store.register("run-1") };
	const host = new AbortController();
	const expectedCommand = parseRunStartCommand({
		schemaVersion: VERIFIED_COMMAND_VERSION,
		kind: "start",
		runId: "run-1",
		commandId: "command-1",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: "a".repeat(64),
	});
	const options = () => ({
		stateRoot,
		owner: runOwner,
		authority,
		hostId: "host-1",
		hostSignal: host.signal,
		expectedCommand,
		clock: () => time.now,
		controlSessionId: endpoint.sessionId,
		controlSessionPath: file,
		actorId: "local-owner",
		authorizationDeadline: 150,
	});
	const credentials = (): SessionControlRequest => ({
		version: 1,
		sessionId: endpoint.sessionId,
		token: endpoint.token,
		requestId: "auth-1",
		action: "status",
	});
	async function connect() {
		const accepted = new Promise<Socket>((resolve) => server.once("connection", resolve));
		const client = createConnection(socketPath);
		sockets.add(client);
		client.on("error", () => {});
		await new Promise<void>((resolve, reject) => {
			client.once("connect", resolve);
			client.once("error", reject);
		});
		return { client, socket: await accepted };
	}
	async function authenticate() {
		const pair = await connect();
		const pending = authenticateSessionControlPeer(pair.socket, {
			sessionPath: file,
			owner: controlOwner,
			hostSignal: host.signal,
		});
		pair.client.write(`${JSON.stringify(credentials())}\n`);
		return { ...pair, peer: await pending };
	}
	const frame = (
		connection: Pick<LocalWorkbenchControlConnection, "identity">,
		change: Record<string, unknown> = {},
	) =>
		new TextEncoder().encode(
			`${JSON.stringify({
				schemaVersion: WORKBENCH_CONTROL_VERSION,
				kind: "validate-start",
				requestId: "validate-1",
				hostId: connection.identity.hostId,
				hostEpoch: connection.identity.hostEpoch,
				actorId: connection.identity.actorId,
				connectionId: connection.identity.connectionId,
				graphRevision: 0,
				expectedState: "absent",
				nodeId: null,
				attempt: null,
				grantDigest: null,
				command: expectedCommand,
				...change,
			})}\n`,
		);
	return {
		root,
		file,
		endpoint,
		controlOwner,
		runOwner,
		stateRoot,
		store,
		host,
		time,
		options,
		credentials,
		connect,
		authenticate,
		frame,
		async close() {
			host.abort();
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			controlOwner.release();
			runOwner.release();
			store.release();
		},
	};
}
