import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunContract, VERIFIED_COMMAND_VERSION } from "omk-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sequence } from "../src/coordination/types.ts";
import { acquireSessionOwnerLeaseSync, type SessionOwnerLease } from "../src/core/session-owner-lease.ts";
import { createAuthorityClock } from "../src/core/verified-run/authority-clock.ts";
import {
	AuthorityStore,
	authorityStorePath,
	type OpenAuthorityStoreOptions,
} from "../src/core/verified-run/authority-store.ts";
import * as broker from "../src/core/verified-run/broker.ts";
import * as candidate from "../src/core/verified-run/candidate.ts";
import { journalPath } from "../src/core/verified-run/journal.ts";
import { digestObject, stateRunPath } from "../src/core/verified-run/storage.ts";
import { admitStartWithoutExecution, type StartAdmissionFixtureContext } from "./verified-run-admission-fixture.ts";

let root: string;
let store: AuthorityStore;
let owner: SessionOwnerLease;
let now: number;
let context: StartAdmissionFixtureContext;
function contractInput() {
	return {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId: "run-1",
		goal: "Dry admission must not execute",
		workspace: { root: join(root, "workspace"), baseDigest: "0".repeat(64) },
		writablePaths: ["marker"],
		writer: [
			process.execPath,
			"-e",
			"require('node:fs').writeFileSync(process.argv[1], 'executed')",
			join(root, "marker"),
		],
		checks: [{ claimId: "marker", argv: [process.execPath, "--version"], stdout: "unused" }],
		budget: { workMs: 1000, verifyMs: 1000, cleanupMs: 1000, maxOutputBytes: 4096, maxFiles: 10, maxBytes: 4096 },
		apply: "artifact-only",
	};
}
function inputs(raw = contractInput()) {
	const contract = parseRunContract(raw);
	const contractDigest = digestObject(contract);
	const command = {
		schemaVersion: VERIFIED_COMMAND_VERSION,
		kind: "start",
		runId: contract.runId,
		commandId: "command-1",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest,
	};
	return { contract, command, approval: { approvedContractDigest: contractDigest } };
}
function admit(overrides: Partial<StartAdmissionFixtureContext> = {}) {
	const { contract, command, approval } = inputs();
	return admitStartWithoutExecution(contract, command, approval, { ...context, ...overrides });
}
function reopen(options: Partial<OpenAuthorityStoreOptions> = {}, reconcile = true) {
	store.release();
	store = AuthorityStore.open(authorityStorePath(context.stateRoot), { capacity: 2, clock: () => now, ...options });
	if (reconcile) store.reconcile();
	const incarnation = store.register("run-1");
	const epoch = store.state.epoch;
	if (epoch === null) throw new Error("fixture epoch missing");
	context = { ...context, authority: { store, sessionId: "run-1", incarnation }, expectedEpoch: epoch };
}
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "h0-admission-"));
	now = 100;
	mkdirSync(join(root, "workspace"));
	const stateRoot = join(root, "fixture-state");
	const runPath = stateRunPath(stateRoot, "run-1");
	mkdirSync(runPath, { recursive: true });
	owner = acquireSessionOwnerLeaseSync(journalPath(runPath));
	store = AuthorityStore.open(authorityStorePath(stateRoot), { capacity: 2, clock: () => now });
	store.reconcile();
	const incarnation = store.register("run-1");
	const epoch = store.state.epoch;
	if (epoch === null) throw new Error("positive control epoch missing");
	context = {
		stateRoot,
		owner,
		authority: { store, sessionId: "run-1", incarnation },
		expectedEpoch: epoch,
		clock: createAuthorityClock(() => now),
		authorizationDeadline: 150,
		claims: [
			{ namespace: "filesystem", instanceId: "h0-fixture", canonicalKey: "work", access: "write", generation: "0" },
		],
	};
	vi.spyOn(broker, "executeSandbox").mockImplementation(() => {
		throw new Error("executor reached");
	});
	vi.spyOn(broker, "probeVerifiedSandbox").mockImplementation(() => {
		throw new Error("sandbox probe reached");
	});
	vi.spyOn(candidate, "captureCandidate").mockImplementation(() => {
		throw new Error("workspace capture reached");
	});
});
afterEach(() => {
	expect(broker.executeSandbox).not.toHaveBeenCalled();
	expect(broker.probeVerifiedSandbox).not.toHaveBeenCalled();
	expect(candidate.captureCandidate).not.toHaveBeenCalled();
	expect(existsSync(join(root, "marker"))).toBe(false);
	owner.release();
	store.release();
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

describe("H0 no-execution admission fixture", () => {
	it("admits only a dry result and durably settles its unused reservation", () => {
		const result = admit();
		expect(result).toMatchObject({
			status: "admitted",
			duplicate: false,
			execute: false,
			executionRequested: false,
			publish: false,
		});
		const inspection = AuthorityStore.inspectJournal(store.path);
		expect([...inspection.state.grants.values()]).toMatchObject([
			{ state: "cancelled", effectLive: false, dispatchId: null, identity: null },
		]);
		expect(inspection.records.map((record) => record.event.kind)).toEqual([
			"authority-epoch-advanced",
			"authority-reconciled",
			"session-registered",
			"grant-reserved",
			"cancel-requested",
			"result-retained",
		]);
		expect(store.lookup("command-1", now)).toMatchObject({ status: "result", resultDigest: result.resultDigest });
		expect(existsSync(journalPath(stateRunPath(context.stateRoot, "run-1")))).toBe(false);
	});
	it("returns one durable disposition on exact retransmission without new writes", () => {
		const first = admit();
		const head = store.head;
		const bytes = readFileSync(store.path);
		now = 149;
		expect(admit()).toEqual({ ...first, duplicate: true });
		expect(store.head).toEqual(head);
		expect(readFileSync(store.path)).toEqual(bytes);
		expect(store.state.grants.size).toBe(1);
	});

	it.each([false, true])("rejects released session ownership (replay=%s)", (replay) => {
		if (replay) admit();
		owner.release();
		const head = store.head;
		expect(() => admit()).toThrow(/stale_owner/);
		expect(store.head).toEqual(head);
	});
	it("rejects a real owner lease for the wrong run path", () => {
		const other = acquireSessionOwnerLeaseSync(join(root, "other-session"));
		try {
			expect(() => admit({ owner: other })).toThrow(/stale_owner/);
		} finally {
			other.release();
		}
	});
	it.each([false, true])("fences a released durable authority (replay=%s)", (replay) => {
		if (replay) admit();
		store.release();
		expect(() => admit()).toThrow(/stale_owner/);
	});
	it.each([false, true])("rejects a wrong epoch (replay=%s)", (replay) => {
		if (replay) admit();
		expect(() => admit({ expectedEpoch: sequence("999") })).toThrow(/stale_epoch/);
	});
	it.each([false, true])("rejects a superseded incarnation (replay=%s)", (replay) => {
		if (replay) admit();
		store.register("run-1");
		expect(() => admit()).toThrow(/stale_incarnation/);
	});
	it("does not accept another session's authority identity", () => {
		const incarnation = store.register("other");
		expect(() => admit({ authority: { store, sessionId: "other", incarnation } })).toThrow(/command_conflict/);
	});
	it.each([150, 151])("rejects authorization at %d, including an exact duplicate", (time) => {
		admit();
		const head = store.head;
		now = time;
		expect(() => admit()).toThrow(/authorization_expired/);
		expect(store.head).toEqual(head);
	});
	it("rejects an already expired initial authorization without a reservation", () => {
		now = 150;
		expect(() => admit()).toThrow(/authorization_expired/);
		expect(store.state.grants.size).toBe(0);
	});
	it("does not renew a deadline by retransmitting the same command id", () => {
		admit();
		expect(() => admit({ authorizationDeadline: 151 })).toThrow(/command_conflict/);
	});
	it.each(["expectedRevision", "expectedGeneration"])("rejects changed %s before acquiring authority", (field) => {
		const { contract, command, approval } = inputs();
		expect(() => admitStartWithoutExecution(contract, { ...command, [field]: 1 }, approval, context)).toThrow(
			/precondition/,
		);
		expect(store.state.grants.size).toBe(0);
	});
	it("rejects changed command digest and untrusted approval", () => {
		const { contract, command, approval } = inputs();
		expect(() =>
			admitStartWithoutExecution(contract, { ...command, contractDigest: "f".repeat(64) }, approval, context),
		).toThrow(/command_conflict/);
		expect(() =>
			admitStartWithoutExecution(contract, command, { approvedContractDigest: "f".repeat(64) }, context),
		).toThrow(/approval/);
	});
	it.each(["goal", "writer"])("rejects changed %s even with a newly matching approval", (field) => {
		admit();
		const changed = field === "goal" ? { goal: "changed meaning" } : { writer: [process.execPath, "--version"] };
		const { contract, command, approval } = inputs({ ...contractInput(), ...changed });
		expect(() => admitStartWithoutExecution(contract, command, approval, context)).toThrow(/command_conflict/);
	});
	it("refuses a second start command id for the same bound fixture run", () => {
		admit();
		const { contract, command, approval } = inputs();
		expect(() =>
			admitStartWithoutExecution(contract, { ...command, commandId: "changed-id" }, approval, context),
		).toThrow(/command_conflict/);
		expect(store.state.grants.size).toBe(1);
	});
	it.each(["claims", "weight"])("rejects changed %s under the same command id", (field) => {
		admit();
		const overrides =
			field === "weight"
				? { weight: 2 }
				: {
						claims: [{ ...context.claims[0], canonicalKey: "different" }],
					};
		expect(() => admit(overrides)).toThrow(/command_conflict/);
	});
	it("rejects revoked approval on the cached-result path", () => {
		admit();
		const { contract, command, approval } = inputs();
		const controller = new AbortController();
		controller.abort();
		expect(() =>
			admitStartWithoutExecution(contract, command, { ...approval, signal: controller.signal }, context),
		).toThrow(/cancelled/);
	});
	it("rejects host-clock rollback without extending authorization", () => {
		admit();
		now = 99;
		expect(() => admit()).toThrow(/clock_anomaly/);
	});
	it("preserves the dry result across reopen but refuses the previous epoch envelope", () => {
		const first = admit();
		store.release();
		store = AuthorityStore.open(authorityStorePath(context.stateRoot), { capacity: 2, clock: () => now });
		store.reconcile();
		const incarnation = store.register("run-1");
		expect(store.lookup("command-1", now)).toMatchObject({ status: "result", resultDigest: first.resultDigest });
		expect(() => admit({ authority: { store, sessionId: "run-1", incarnation } })).toThrow(/stale_epoch/);
		expect(store.state.grants.size).toBe(1);
	});

	it("refuses admission before restart reconciliation", () => {
		reopen({}, false);
		expect(() => admit()).toThrow(/reconcile_pending/);
		expect(store.state.grants.size).toBe(0);
	});
	it.each(["capacity", "claim"])("returns blocked without executing when %s is unavailable", (reason) => {
		const incarnation = store.register("other-run");
		const held = store.acquire({
			sessionId: "other-run",
			incarnation,
			commandId: "other-command",
			intentDigest: "a".repeat(64),
			claims: reason === "claim" ? context.claims : [{ ...context.claims[0], canonicalKey: "other" }],
			now,
			ttl: 50,
			weight: reason === "capacity" ? 2 : 1,
		});
		expect(held.status).toBe("granted");
		const head = store.head;
		expect(admit()).toMatchObject({
			status: "blocked",
			resultDigest: null,
			execute: false,
			executionRequested: false,
		});
		expect(store.head).toEqual(head);
		expect(store.lookup("command-1", now).status).toBe("unknown");
	});
	it.each([1, 2, 3])("does not acknowledge a storage failure in durable step %d", (step) => {
		let armed = false;
		let appends = 0;
		reopen({
			hooks: {
				afterLedgerFsync: () => {
					if (armed && ++appends === step) throw new Error("injected admission persistence failure");
				},
			},
		});
		armed = true;
		expect(() => admit()).toThrow(/injected admission persistence failure/);
		const committed = AuthorityStore.inspect(store.path);
		expect(committed.tombstones.has("command-1")).toBe(false);
		expect([...committed.grants.values()].every((grant) => !grant.effectLive)).toBe(true);
		armed = false;
		expect(admit()).toMatchObject({ status: "admitted", execute: false });
		expect(store.state.grants.size).toBe(1);
	});
	it("rejects a deadline that passes while the dry disposition is persisted", () => {
		let armed = false;
		reopen({
			hooks: {
				afterLedgerFsync: () => {
					if (armed) now = 150;
				},
			},
		});
		armed = true;
		expect(() => admit()).toThrow(/authorization_expired/);
		expect([...store.state.grants.values()].every((grant) => !grant.effectLive)).toBe(true);
	});
	it("does not acknowledge approval revoked during durable admission", () => {
		const controller = new AbortController();
		let armed = false;
		reopen({
			hooks: {
				afterLedgerFsync: () => {
					if (armed) controller.abort();
				},
			},
		});
		armed = true;
		const { contract, command, approval } = inputs();
		expect(() =>
			admitStartWithoutExecution(contract, command, { ...approval, signal: controller.signal }, context),
		).toThrow(/cancelled/);
		expect([...store.state.grants.values()].every((grant) => !grant.effectLive)).toBe(true);
	});
	it("does not acknowledge session ownership released during persistence", () => {
		let armed = false;
		reopen({
			hooks: {
				afterLedgerFsync: () => {
					if (armed) owner.release();
				},
			},
		});
		armed = true;
		expect(() => admit()).toThrow(/stale_owner/);
		expect([...store.state.grants.values()].every((grant) => !grant.effectLive)).toBe(true);
	});
	it("never treats a possibly-live matching reservation as an unused dry grant", () => {
		const { command } = inputs();
		const grant = store.acquire({
			sessionId: "run-1",
			incarnation: context.authority.incarnation,
			commandId: command.commandId,
			intentDigest: digestObject({
				command,
				epoch: context.expectedEpoch,
				authorizationDeadline: context.authorizationDeadline,
			}),
			claims: context.claims,
			now,
			ttl: 50,
		});
		if (grant.status !== "granted") throw new Error("positive control grant missing");
		expect(store.dispatchIntent(grant.token, "unobserved", now)).toBe(true);
		const head = store.head;
		expect(() => admit()).toThrow(/authority/);
		expect(store.head).toEqual(head);
		expect(store.state.grants.get(grant.token.grantSequence)).toMatchObject({ state: "starting", effectLive: true });
		expect(store.state.tombstones.size).toBe(0);
	});
	it.each([1, 2, 3])("rejects authority released during durable append %d", (step) => {
		let armed = false;
		let appends = 0;
		reopen({
			hooks: {
				afterLedgerFsync: () => {
					if (armed && ++appends === step) store.release();
				},
			},
		});
		armed = true;
		expect(() => admit()).toThrow(/stale_owner/);
		expect([...AuthorityStore.inspect(store.path).grants.values()].every((grant) => !grant.effectLive)).toBe(true);
	});
});
