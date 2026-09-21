/**
 * WP03 durable authority store — commit boundary and fault injection.
 *
 * Every scenario here is a file/process-level injection, never a bare in-memory
 * `restart()` call (docs/04): bytes fsynced but head unpublished, head published
 * past file identity, storage throwing inside the critical section, a dead
 * owner's lease, journal truncation, GC's rewrite/head-publish crash window.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, constants as fsConstants, fsyncSync, openSync, writeSync } from "node:fs";
import { mkdtemp, readFile, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	AuthorityLeaseHeldError,
	AuthorityStore,
	AuthorityStoreError,
	authorityStorePath,
} from "../src/core/verified-run/authority-store.ts";

let root: string;
let storePath: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "omk-authority-store-"));
	storePath = authorityStorePath(root);
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const DIGEST = "a".repeat(64);
const claim = (key: string, access: "read" | "write" = "write") => ({
	namespace: "filesystem",
	instanceId: "shared",
	canonicalKey: key,
	access,
	generation: "0",
});

function input(commandId: string, now: number, overrides: Record<string, unknown> = {}) {
	return {
		sessionId: "s1",
		incarnation: "1",
		commandId,
		intentDigest: DIGEST,
		claims: [claim("src/x")],
		now,
		ttl: 1000,
		...overrides,
	};
}

/** The store's own durable append, reproduced so persistRecord can gate faults. */
function appendDurably(path: string, bytes: Uint8Array): void {
	const fd = openSync(path, fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_WRONLY, 0o600);
	try {
		let offset = 0;
		while (offset < bytes.byteLength) offset += writeSync(fd, bytes, offset, bytes.byteLength - offset);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

async function openReconciled(options: Parameters<typeof AuthorityStore.open>[1] = { capacity: 4 }) {
	const store = AuthorityStore.open(storePath, options);
	store.reconcile();
	return store;
}

describe("authority store commit boundary", () => {
	it("durably advances the epoch on open and fences the previous epoch's tokens", async () => {
		const first = await openReconciled();
		expect(first.state.epoch).toBe("1");
		const incarnation = first.register("s1");
		expect(incarnation).toBe("1");
		const granted = first.acquire(input("cmd-1", 100));
		expect(granted.status).toBe("granted");
		if (granted.status !== "granted") throw new Error("unreachable");
		const token = granted.token;
		expect(token.authorityEpoch).toBe("1");
		// Make the effect possibly-live so the restart quarantines rather than cancels.
		expect(first.effectStarted(token, [claim("src/x")])).toBe(true);
		first.release();

		// A restart is a real file reload: epoch 2 commits before anything else.
		const second = await openReconciled();
		expect(second.state.epoch).toBe("2");
		// The old epoch cannot authorize new work after the restart.
		expect(second.effectStarted(token, [claim("src/x")])).toBe(false);
		expect(second.dispatchIntent(token, "d-1")).toBe(false);
		// Settlement is still accepted across superseded epochs.
		expect(second.confirmTerminated(token)).toBe(true);
		second.release();
	});

	it("returns a recorded result for a duplicate command and never re-executes (I08)", async () => {
		const store = await openReconciled();
		store.register("s1");
		const granted = store.acquire(input("cmd-dup", 100));
		if (granted.status !== "granted") throw new Error("expected granted");
		expect(store.effectStarted(granted.token, [claim("src/x")])).toBe(true);
		expect(store.confirmTerminated(granted.token)).toBe(true);
		const result = "b".repeat(64);
		store.retainResult("cmd-dup", result, 200, 60_000);

		const replayed = store.acquire(input("cmd-dup", 300));
		expect(replayed.status).toBe("result");
		if (replayed.status !== "result") throw new Error("unreachable");
		expect(replayed.resultDigest).toBe(result);
		// No second grant was minted for the replayed command.
		expect([...store.state.grants.values()].filter((g) => g.commandId === "cmd-dup")).toHaveLength(1);
		expect(store.lookup("cmd-dup", 300).status).toBe("result");
		expect(store.lookup("cmd-dup", 200 + 60_001).status).toBe("result-expired");
		store.release();
	});

	it("rejects a commandId collision carrying a different intent (I09/I20)", async () => {
		const store = await openReconciled();
		store.register("s1");
		const granted = store.acquire(input("cmd-id", 100));
		expect(granted.status).toBe("granted");
		expect(() => store.acquire(input("cmd-id", 100, { intentDigest: "c".repeat(64) }))).toThrow(AuthorityStoreError);
		expect(() => store.acquire(input("cmd-id", 100, { intentDigest: "c".repeat(64) }))).toThrow(/command_conflict/);
		// The same command with a disjoint claim set is also a collision.
		expect(() => store.acquire(input("cmd-id", 100, { claims: [claim("src/y")] }))).toThrow(/command_conflict/);
		store.release();
	});

	it("rejects a completed commandId whose stored meaning differs (F03)", async () => {
		const store = await openReconciled();
		store.register("s1");
		const granted = store.acquire(input("cmd-done", 100));
		if (granted.status !== "granted") throw new Error("expected granted");
		expect(store.confirmTerminated(granted.token)).toBe(true);
		store.retainResult("cmd-done", "d".repeat(64), 200, 60_000);

		expect(() => store.acquire(input("cmd-done", 300, { intentDigest: "c".repeat(64) }))).toThrow(/command_conflict/);
		expect(() => store.acquire(input("cmd-done", 300, { claims: [claim("src/y")] }))).toThrow(/command_conflict/);
		expect(() => store.acquire(input("cmd-done", 300, { weight: 2 }))).toThrow(/command_conflict/);
		// Same meaning still replays; expiry of that meaning is not a fresh admission.
		expect(store.acquire(input("cmd-done", 300)).status).toBe("result");
		expect(store.acquire(input("cmd-done", 200 + 60_001)).status).toBe("result-expired");
		expect(() => store.acquire(input("cmd-done", 200 + 60_001, { intentDigest: "c".repeat(64) }))).toThrow(
			/command_conflict/,
		);
		store.release();
	});

	it("refuses a new effect after the authorization deadline without releasing a live claim (F04)", async () => {
		const store = await openReconciled();
		store.register("s1");
		const granted = store.acquire(input("cmd-ttl", 100, { ttl: 50 }));
		if (granted.status !== "granted") throw new Error("expected granted");
		const token = granted.token;
		expect(store.dispatchIntent(token, "dispatch-ttl", 149)).toBe(true);
		expect(store.dispatchIntent(token, "dispatch-late", 150)).toBe(false);
		expect(store.effectStarted(token, [claim("src/x")], undefined, 150)).toBe(false);
		// Deadline is not a termination witness: the possibly-live claim stays owned.
		const owned = [...store.state.grants.values()].find((grant) => grant.commandId === "cmd-ttl");
		expect(owned?.state).toBe("quarantined");
		expect(owned?.effectLive).toBe(true);
		expect(store.confirmTerminated(token)).toBe(true);
		store.release();
	});

	it("quarantines an uncommitted suffix when the head never published (I12/I17)", async () => {
		let crashOnAppend = false;
		const store = AuthorityStore.open(storePath, {
			capacity: 4,
			hooks: {
				afterLedgerFsync: () => {
					if (crashOnAppend) throw new Error("crash between ledger fsync and head publish");
				},
			},
		});
		store.reconcile();
		store.register("s1");
		crashOnAppend = true;
		expect(() => store.acquire(input("cmd-partial", 100))).toThrow(/crash between/);
		store.release();

		// The uncommitted bytes are quarantined, the head is unchanged, and the
		// grant is absent — the same command can be retried without duplication.
		const files = await readFile(storePath).catch(() => Buffer.alloc(0));
		expect(files.byteLength).toBeGreaterThan(0);
		const reopened = AuthorityStore.open(storePath, { capacity: 4 });
		reopened.reconcile();
		expect([...reopened.state.grants.values()].some((g) => g.commandId === "cmd-partial")).toBe(false);
		expect(reopened.acquire(input("cmd-partial", 100)).status).toBe("granted");
		reopened.release();
		const dir = await import("node:fs/promises").then((fs) => fs.readdir(root));
		expect(dir.some((name) => name.includes(".quarantine-"))).toBe(true);
	});

	it("refuses new admission after a storage failure — no memory-only grants (I12)", async () => {
		let failPersistence = false;
		const store = AuthorityStore.open(storePath, {
			capacity: 4,
			hooks: {
				persistRecord: (path, bytes) => {
					if (failPersistence) throw new Error("injected disk failure");
					appendDurably(path, bytes);
				},
			},
		});
		store.reconcile();
		store.register("s1");
		failPersistence = true;
		expect(() => store.acquire(input("cmd-nogrant", 100))).toThrow(/injected disk failure/);
		expect([...store.state.grants.values()].some((g) => g.commandId === "cmd-nogrant")).toBe(false);
		failPersistence = false;
		expect(store.acquire(input("cmd-nogrant", 100)).status).toBe("granted");
		store.release();
	});

	it("fails closed on a head published past the file (journal truncation)", async () => {
		const store = await openReconciled();
		store.register("s1");
		expect(store.acquire(input("cmd-t", 100)).status).toBe("granted");
		store.release();
		await truncate(storePath, 16);
		// head.size > file size: committed state was destroyed — refuse, never guess.
		expect(() => AuthorityStore.inspect(storePath)).toThrow(/tampered/);
		expect(() => AuthorityStore.open(storePath, { capacity: 4 })).toThrow(/tampered/);
	});

	it("excludes a second live writer and reclaims a dead owner's lease", async () => {
		const store = await openReconciled();
		expect(() => AuthorityStore.open(storePath, { capacity: 4 })).toThrow(AuthorityLeaseHeldError);
		store.release();

		const moduleUrl = pathToFileURL(
			fileURLToPath(new URL("../src/core/verified-run/authority-store.ts", import.meta.url)),
		).href;
		const holder = spawn(
			process.execPath,
			[
				"--experimental-strip-types",
				"--input-type=module",
				"-e",
				`import { AuthorityStore } from ${JSON.stringify(moduleUrl)};
const store = AuthorityStore.open(process.argv[1], { capacity: 4 });
process.stdout.write("held\\n");
setInterval(() => {}, 1000);`,
				storePath,
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		let diagnostic = "";
		holder.stderr?.on("data", (chunk: Buffer) => {
			diagnostic = (diagnostic + chunk.toString()).slice(-2048);
		});
		await Promise.race([
			once(holder.stdout, "data"),
			once(holder, "close").then(() => {
				throw new Error(`authority holder exited before holding: ${diagnostic}`);
			}),
		]);
		holder.kill("SIGKILL");
		await once(holder, "close");

		// The dead owner's lock is reclaimed through the existing protocol; the
		// reopened store continues the same durable epoch chain.
		const reopened = AuthorityStore.open(storePath, { capacity: 4 });
		expect(reopened.state.epoch).toBe("2");
		reopened.release();
	});
});

describe("authority store GC", () => {
	it("folds settled state into a snapshot, keeps counters and unexpired tombstones (§7)", async () => {
		const store = await openReconciled();
		store.register("s1");
		store.register("s1");
		const settled = store.acquire(input("cmd-old", 100, { incarnation: "2" }));
		if (settled.status !== "granted") throw new Error("unreachable");
		expect(store.confirmTerminated(settled.token)).toBe(true);
		const live = store.acquire(input("cmd-live", 100, { incarnation: "2" }));
		if (live.status !== "granted") throw new Error("unreachable");
		expect(store.confirmTerminated(live.token)).toBe(true);
		store.retainResult("cmd-live", "d".repeat(64), 200, 60_000);
		const result = store.compact(300);
		expect(result.dropped).toBe(1); // settled grant without a tombstone
		// I31: sequences and incarnations never regress across GC.
		expect(store.state.grantCounter).toBe("2");
		expect(store.state.incarnations.get("s1")).toBe("2");
		expect(store.lookup("cmd-live", 300).status).toBe("result");
		store.release();

		const reopened = AuthorityStore.open(storePath, { capacity: 4 });
		reopened.reconcile();
		expect(reopened.state.grantCounter).toBe("2");
		expect(reopened.state.epoch).toBe("2");
		reopened.register("s1");
		const next = reopened.acquire(input("cmd-next", 300, { claims: [claim("src/x")], incarnation: "3" }));
		expect(next.status).toBe("granted");
		if (next.status !== "granted") throw new Error("unreachable");
		expect(next.token.grantSequence).toBe("3");
		reopened.release();
	});

	it("self-heals a GC crash between the atomic rewrite and the head publish (§8)", async () => {
		let crashAfterRewrite = false;
		const store = AuthorityStore.open(storePath, {
			capacity: 4,
			hooks: {
				afterAtomicRewrite: () => {
					if (crashAfterRewrite) throw new Error("crash after GC rewrite, before head publish");
				},
			},
		});
		store.reconcile();
		store.register("s1");
		const granted = store.acquire(input("cmd-gc", 100));
		if (granted.status !== "granted") throw new Error("unreachable");
		expect(store.confirmTerminated(granted.token)).toBe(true);
		crashAfterRewrite = true;
		expect(() => store.compact(300)).toThrow(/crash after GC rewrite/);
		store.release();

		// The rewritten file holds only the snapshot continuation of the old head;
		// reopening republishes the head and continues — no tamper, no re-run.
		const reopened = AuthorityStore.open(storePath, { capacity: 4 });
		reopened.reconcile();
		expect(reopened.state.grantCounter).toBe("1");
		expect([...reopened.state.grants.values()]).toHaveLength(0);
		reopened.release();
	});

	it("keeps expired tombstone references honest: expired results never re-execute", async () => {
		const store = await openReconciled();
		store.register("s1");
		const granted = store.acquire(input("cmd-exp", 100));
		if (granted.status !== "granted") throw new Error("unreachable");
		expect(store.confirmTerminated(granted.token)).toBe(true);
		store.retainResult("cmd-exp", "e".repeat(64), 100, 100);
		expect(store.acquire(input("cmd-exp", 250)).status).toBe("result-expired");
		expect(store.lookup("cmd-exp", 250).status).toBe("result-expired");
		// GC may drop the expired pair together; it must not strand a tombstone.
		expect(store.compact(250).dropped).toBe(2);
		expect(store.lookup("cmd-exp", 250).status).toBe("unknown");
		store.release();
	});
});
