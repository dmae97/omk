import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunStartCommand, VERIFIED_COMMAND_VERSION, WORKBENCH_CONTROL_VERSION } from "omk-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireSessionOwnerLeaseSync, type SessionOwnerLease } from "../src/core/session-owner-lease.ts";
import type { RunAuthority } from "../src/core/verified-run/authority-runtime.ts";
import { AuthorityStore, authorityStorePath } from "../src/core/verified-run/authority-store.ts";
import * as broker from "../src/core/verified-run/broker.ts";
import * as candidate from "../src/core/verified-run/candidate.ts";
import { journalPath } from "../src/core/verified-run/journal.ts";
import { stateRunPath } from "../src/core/verified-run/storage.ts";
import { createWorkbenchControlConnection } from "../src/core/verified-run/workbench-connection.ts";

let root: string;
let stateRoot: string;
let runJournal: string;
let owner: SessionOwnerLease;
let store: AuthorityStore;
let authority: RunAuthority;
let host: AbortController;
let peer: AbortController;
let now: number;
const command = () =>
	parseRunStartCommand({
		schemaVersion: VERIFIED_COMMAND_VERSION,
		kind: "start",
		runId: "run-1",
		commandId: "command-1",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: "a".repeat(64),
	});
function options() {
	return {
		stateRoot,
		owner,
		authority,
		hostId: "host-1",
		hostSignal: host.signal,
		peer: { actorId: "operator-1", connectionId: "connection-1", signal: peer.signal, authorizationDeadline: 150 },
		expectedCommand: command(),
		clock: () => now,
	};
}
function frame(connection: ReturnType<typeof createWorkbenchControlConnection>, change: Record<string, unknown> = {}) {
	return new TextEncoder().encode(
		`${JSON.stringify({
			schemaVersion: WORKBENCH_CONTROL_VERSION,
			kind: "validate-start",
			requestId: "request-1",
			hostId: connection.identity.hostId,
			hostEpoch: connection.identity.hostEpoch,
			actorId: connection.identity.actorId,
			connectionId: connection.identity.connectionId,
			graphRevision: 0,
			expectedState: "absent",
			nodeId: null,
			attempt: null,
			grantDigest: null,
			command: command(),
			...change,
		})}\n`,
	);
}
function reopen(reconcile = true) {
	store.release();
	store = AuthorityStore.open(authorityStorePath(stateRoot), { capacity: 2, clock: () => now });
	if (reconcile) store.reconcile();
	authority = { store, sessionId: "run-1", incarnation: store.register("run-1") };
}
function tamper() {
	const bytes = readFileSync(store.path);
	const index = bytes.indexOf('"run-1"');
	if (index < 0) throw new Error("real registered session missing");
	bytes[index + 1] = "X".charCodeAt(0);
	writeFileSync(store.path, bytes);
}
beforeEach(() => {
	now = 100;
	root = mkdtempSync(join(tmpdir(), "workbench-owned-"));
	stateRoot = join(root, "state");
	const runPath = stateRunPath(stateRoot, "run-1");
	mkdirSync(runPath, { recursive: true });
	runJournal = journalPath(runPath);
	owner = acquireSessionOwnerLeaseSync(runJournal);
	store = AuthorityStore.open(authorityStorePath(stateRoot), { capacity: 2, clock: () => now });
	store.reconcile();
	authority = { store, sessionId: "run-1", incarnation: store.register("run-1") };
	host = new AbortController();
	peer = new AbortController();
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
afterEach(() => {
	expect(broker.executeSandbox).not.toHaveBeenCalled();
	expect(broker.probeVerifiedSandbox).not.toHaveBeenCalled();
	expect(candidate.captureCandidate).not.toHaveBeenCalled();
	expect(AuthorityStore.prototype.acquire).not.toHaveBeenCalled();
	owner.release();
	store.release();
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

describe("real ownership-bound no-execution workbench connection", () => {
	it("exposes a live lifecycle flag, not a cached-state ownership claim", () => {
		expect(store.isReleased).toBe(false);
		const epoch = store.state.epoch;
		store.release();
		expect(store.isReleased).toBe(true);
		expect(store.state.epoch).toBe(epoch);
	});
	it("derives the reconciled durable epoch and validates without any durable writes", () => {
		const before = readFileSync(store.path);
		const head = readFileSync(`${store.path}.head`);
		const connection = createWorkbenchControlConnection(options());
		expect(connection.identity).toEqual({
			hostId: "host-1",
			hostEpoch: "1",
			actorId: "operator-1",
			connectionId: "connection-1",
			runId: "run-1",
			commandId: "command-1",
		});
		expect(Object.isFrozen(connection)).toBe(true);
		expect(Object.isFrozen(connection.identity)).toBe(true);
		const first = connection.validate(frame(connection));
		expect(first).toMatchObject({
			kind: "validated-no-execution",
			executionRequested: false,
			capabilities: { execute: false, amendGraph: false, publish: false },
		});
		expect(connection.validate(frame(connection))).toEqual(first);
		expect(readFileSync(store.path)).toEqual(before);
		expect(readFileSync(`${store.path}.head`)).toEqual(head);
		expect(store.state.grants.size).toBe(0);
		expect(existsSync(runJournal)).toBe(false);
	});
	it.each(["session", "authority"])("refuses released %s ownership even when cached state survives", (which) => {
		const connection = createWorkbenchControlConnection(options());
		if (which === "session") owner.release();
		else store.release();
		expect(() => connection.validate(frame(connection))).toThrow(/stale_owner/);
	});
	it("does not reauthorize an old connection when the run lease is reacquired", () => {
		const old = createWorkbenchControlConnection(options());
		owner.release();
		owner = acquireSessionOwnerLeaseSync(runJournal);
		expect(() => old.validate(frame(old))).toThrow(/stale_owner/);
		const fresh = createWorkbenchControlConnection(options());
		expect(fresh.validate(frame(fresh)).executionRequested).toBe(false);
	});
	it("pins the real owner lease identity across transfer away and back", () => {
		const old = createWorkbenchControlConnection(options());
		owner.transfer(join(root, "other-run"));
		owner.transfer(runJournal);
		expect(owner.owns(runJournal)).toBe(true);
		expect(() => old.validate(frame(old))).toThrow(/stale_owner/);
		const fresh = createWorkbenchControlConnection(options());
		expect(fresh.validate(frame(fresh)).executionRequested).toBe(false);
	});
	it("pins a durable epoch across real reopen and rejects old and retagged requests on the old connection", () => {
		const old = createWorkbenchControlConnection(options());
		const oldFrame = frame(old);
		reopen();
		const fresh = createWorkbenchControlConnection(options());
		expect(fresh.identity.hostEpoch).toBe("2");
		expect(() => old.validate(oldFrame)).toThrow(/stale_owner/);
		expect(() => old.validate(frame(fresh))).toThrow(/stale_owner/);
		expect(() => fresh.validate(oldFrame)).toThrow(/stale_epoch/);
		expect(fresh.validate(frame(fresh)).executionRequested).toBe(false);
	});
	it("refuses a superseded session incarnation without silently adopting it", () => {
		const connection = createWorkbenchControlConnection(options());
		store.register("run-1");
		expect(() => connection.validate(frame(connection))).toThrow(/stale_incarnation/);
	});
	it("allows an unrelated committed registration without pinning an obsolete head", () => {
		const connection = createWorkbenchControlConnection(options());
		store.register("other");
		const before = readFileSync(store.path);
		expect(connection.validate(frame(connection)).executionRequested).toBe(false);
		expect(readFileSync(store.path)).toEqual(before);
	});
	it("does not reconcile a reopened authority on the connection's behalf", () => {
		reopen(false);
		const before = readFileSync(store.path);
		expect(() => createWorkbenchControlConnection(options())).toThrow(/reconcile_pending/);
		expect(readFileSync(store.path)).toEqual(before);
	});
	it("rejects the wrong authority root/session and a real lease for another run", () => {
		const otherRoot = join(root, "other-state");
		expect(() => createWorkbenchControlConnection({ ...options(), stateRoot: otherRoot })).toThrow(
			/command_conflict/,
		);
		expect(existsSync(otherRoot)).toBe(false);
		expect(() =>
			createWorkbenchControlConnection({ ...options(), authority: { ...authority, sessionId: "other" } }),
		).toThrow(/command_conflict/);
		const other = acquireSessionOwnerLeaseSync(join(root, "other-run"));
		try {
			expect(() => createWorkbenchControlConnection({ ...options(), owner: other })).toThrow(/stale_owner/);
		} finally {
			other.release();
		}
	});
	it("checks actual run-journal absence on creation and every validation", () => {
		const connection = createWorkbenchControlConnection(options());
		writeFileSync(runJournal, "not an absent run");
		expect(() => createWorkbenchControlConnection(options())).toThrow(/precondition/);
		expect(() => connection.validate(frame(connection))).toThrow(/precondition/);
	});
	it("refuses same-length committed byte tampering instead of trusting the store cache", () => {
		const connection = createWorkbenchControlConnection(options());
		tamper();
		const bad = readFileSync(store.path);
		expect(() => connection.validate(frame(connection))).toThrow(/corrupt|integrity|tampered/);
		expect(readFileSync(store.path)).toEqual(bad);
	});
	it("refuses a byte-identical inode replacement without repairing it", () => {
		const connection = createWorkbenchControlConnection(options());
		const replacement = join(root, "replacement");
		writeFileSync(replacement, readFileSync(store.path));
		renameSync(replacement, store.path);
		expect(() => connection.validate(frame(connection))).toThrow(/tampered/);
	});
	it("reads only the committed epoch and leaves an uncommitted suffix untouched", () => {
		const connection = createWorkbenchControlConnection(options());
		appendFileSync(store.path, "uncommitted-tail");
		const before = readFileSync(store.path);
		const names = readdirSync(stateRoot).sort();
		expect(connection.validate(frame(connection)).executionRequested).toBe(false);
		expect(readFileSync(store.path)).toEqual(before);
		expect(readdirSync(stateRoot).sort()).toEqual(names);
		expect(store.state.grants.size).toBe(0);
	});
	it("captures the peer deadline rather than allowing caller mutation to renew it", () => {
		const input = options();
		const connection = createWorkbenchControlConnection(input);
		input.peer.authorizationDeadline = 999;
		now = 150;
		expect(() => connection.validate(frame(connection))).toThrow(/authorization_expired/);
	});
	it("still requires a peer and refuses wire actor impersonation with valid owner handles", () => {
		expect(() => createWorkbenchControlConnection({ ...options(), peer: null })).toThrow(/workbench_unauthenticated/);
		const connection = createWorkbenchControlConnection(options());
		expect(() => connection.validate(frame(connection, { actorId: "other" }))).toThrow(/workbench_identity/);
	});
	it.each([2, 3])("rechecks session ownership after host clock callback %d", (read) => {
		let reads = 0;
		const connection = createWorkbenchControlConnection({
			...options(),
			clock: () => {
				if (++reads === read) owner.release();
				return now;
			},
		});
		expect(() => connection.validate(frame(connection))).toThrow(/stale_owner/);
	});
	it.each([2, 3])("rechecks authority ownership after host clock callback %d", (read) => {
		let reads = 0;
		const connection = createWorkbenchControlConnection({
			...options(),
			clock: () => {
				if (++reads === read) store.release();
				return now;
			},
		});
		expect(() => connection.validate(frame(connection))).toThrow(/stale_owner/);
	});
	it("refuses the old connection when an actual epoch replacement occurs during validation", () => {
		let reads = 0;
		const old = createWorkbenchControlConnection({
			...options(),
			clock: () => {
				if (++reads === 2) reopen();
				return now;
			},
		});
		expect(() => old.validate(frame(old))).toThrow(/stale_owner/);
		expect(store.state.epoch).toBe("2");
		const fresh = createWorkbenchControlConnection(options());
		expect(fresh.validate(frame(fresh)).executionRequested).toBe(false);
	});
	it("rechecks durable bytes after a host callback tampers with them", () => {
		let reads = 0;
		const connection = createWorkbenchControlConnection({
			...options(),
			clock: () => {
				if (++reads === 2) tamper();
				return now;
			},
		});
		expect(() => connection.validate(frame(connection))).toThrow(/corrupt|integrity|tampered/);
	});
	it("rechecks run absence after a host callback creates a journal", () => {
		let reads = 0;
		const connection = createWorkbenchControlConnection({
			...options(),
			clock: () => {
				if (++reads === 2) writeFileSync(runJournal, "present");
				return now;
			},
		});
		expect(() => connection.validate(frame(connection))).toThrow(/precondition/);
	});
	it("owns a rollback-detecting clock instead of trusting repeat caller samples", () => {
		const connection = createWorkbenchControlConnection(options());
		now = 99;
		expect(() => connection.validate(frame(connection))).toThrow(/clock_anomaly/);
	});
});
