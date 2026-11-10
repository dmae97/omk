import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	parseAuthorityEvent,
	projectAuthority,
	snapshotFromProjection,
} from "../src/core/verified-run/authority-events.ts";
import { parseCommitted } from "../src/core/verified-run/authority-journal.ts";
import { AuthorityStore, authorityStorePath } from "../src/core/verified-run/authority-store.ts";
import { digestObject } from "../src/core/verified-run/storage.ts";

let root: string;
let store: AuthorityStore;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "authority-provenance-"));
	store = AuthorityStore.open(authorityStorePath(root), { capacity: 4, clock: () => 100 });
	store.reconcile();
	store.register("session");
});
afterEach(() => {
	store.release();
	rmSync(root, { recursive: true, force: true });
});

function reserve(commandId: string) {
	const claims = [
		{
			namespace: "filesystem",
			instanceId: "shared",
			canonicalKey: commandId,
			access: "write" as const,
			generation: "0",
		},
	];
	const result = store.acquire({
		sessionId: "session",
		incarnation: "1",
		commandId,
		intentDigest: digestObject(commandId),
		claims,
		now: 100,
		ttl: 1000,
	});
	if (result.status !== "granted") throw new Error("reservation blocked");
	return { token: result.token, claims };
}

function compact() {
	const disposable = reserve(`disposable-${store.state.grantCounter}`);
	expect(store.cancel(disposable.token)).toBe(true);
	expect(store.compact(200).dropped).toBe(1);
	const journal = AuthorityStore.inspectJournal(store.path);
	expect(journal.records).toHaveLength(1);
	expect(journal.records[0]?.event.kind).toBe("authority-snapshot");
	return journal;
}

describe("authority start provenance", () => {
	it.each(["none", "cancel", "expire"] as const)(
		"preserves %s start/revocation provenance through repeated compaction and restart",
		(action) => {
			const { token, claims } = reserve("execution");
			expect(store.effectStarted(token, claims)).toBe(true);
			if (action === "cancel") expect(store.cancel(token)).toBe(true);
			if (action === "expire") store.expire(token.authorizationDeadline);
			const before = store.state.grants.get(token.grantSequence)!;
			const expected = action === "none" ? "started" : "revoked";
			for (let i = 0; i < 2; i++) {
				const journal = compact();
				expect(journal.state.grants.get(token.grantSequence)).toMatchObject({
					...before,
					startProvenance: expected,
				});
			}
			store.release();
			store = AuthorityStore.open(authorityStorePath(root), { capacity: 4, clock: () => 100 });
			store.reconcile(() => "unknown");
			expect(store.state.grants.get(token.grantSequence)).toMatchObject({
				token,
				state: "quarantined",
				effectLive: true,
				startProvenance: expected,
			});
			expect(store.effectStarted(token, claims)).toBe(false);
		},
	);

	it("carries later revocation and termination through a snapshot without reviving the grant", () => {
		const { token, claims } = reserve("execution");
		expect(store.effectStarted(token, claims)).toBe(true);
		compact();
		expect(store.cancel(token)).toBe(true);
		expect(store.confirmTerminated(token)).toBe(true);
		store.retainResult("execution", digestObject("result"), 100, 1000);
		expect(compact().state.grants.get(token.grantSequence)).toMatchObject({
			state: "terminated",
			effectLive: false,
			startProvenance: "revoked",
		});
	});

	it("replays original event bytes without adding provenance to reserved grant records", () => {
		const { token, claims } = reserve("execution");
		expect(store.effectStarted(token, claims)).toBe(true);
		const journal = AuthorityStore.inspectJournal(store.path);
		const lines = journal.records.map((record) => `${JSON.stringify(record)}\n`).join("");
		const replay = parseCommitted(Buffer.from(lines));
		expect(replay.state.grants.get(token.grantSequence)).toMatchObject({ startProvenance: "started" });
		const reserved = journal.records.find(({ event }) => event.kind === "grant-reserved")?.event;
		if (reserved?.kind !== "grant-reserved") throw new Error("missing reservation");
		expect(reserved.grant).not.toHaveProperty("startProvenance");
	});

	it("does not infer missing start provenance from a legacy snapshot's running state", () => {
		const { token, claims } = reserve("execution");
		expect(store.effectStarted(token, claims)).toBe(true);
		const state = JSON.parse(JSON.stringify(snapshotFromProjection(store.state)));
		delete state.grants[0].startProvenance;
		const event = parseAuthorityEvent({
			kind: "authority-snapshot",
			archivedThroughSequence: 10,
			continuesHash: "a".repeat(64),
			state,
		});
		if (event.kind !== "authority-snapshot") throw new Error("expected snapshot");
		expect(event.state.grants[0]).not.toHaveProperty("startProvenance");
		const revoked = projectAuthority(
			[
				{
					kind: "cancel-requested",
					grantSequence: token.grantSequence,
					authorityEpoch: token.authorityEpoch,
					outcome: "quarantined",
				},
			],
			event.state,
		);
		expect(revoked.grants.get(token.grantSequence)).not.toHaveProperty("startProvenance");
	});

	it.each([
		{ state: "reserved" },
		{ state: "starting" },
		{ state: "cancelled", effectLive: false },
		{ actualClaims: null },
	])("rejects contradictory start provenance %j", (patch) => {
		const { token, claims } = reserve("execution");
		expect(store.effectStarted(token, claims)).toBe(true);
		const state = snapshotFromProjection(store.state);
		expect(() =>
			parseAuthorityEvent({
				kind: "authority-snapshot",
				archivedThroughSequence: 10,
				continuesHash: "a".repeat(64),
				state: { ...state, grants: state.grants.map((grant) => ({ ...grant, ...patch })) },
			}),
		).toThrow(/integrity/);
	});

	it.each([null, true, "running", "", 1])("rejects malformed snapshot provenance %s", (value) => {
		const { token, claims } = reserve("execution");
		expect(store.effectStarted(token, claims)).toBe(true);
		const state = JSON.parse(JSON.stringify(snapshotFromProjection(store.state)));
		state.grants[0].startProvenance = value;
		expect(() =>
			parseAuthorityEvent({
				kind: "authority-snapshot",
				archivedThroughSequence: 10,
				continuesHash: "a".repeat(64),
				state,
			}),
		).toThrow(/integrity/);
	});
});
