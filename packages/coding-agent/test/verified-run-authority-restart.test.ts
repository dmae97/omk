/**
 * WP03 durable authority — restart epoch fencing and quarantine semantics.
 *
 * Unresolved effects at crash stay owned (quarantined), never silently
 * released; settlement moves only on an observed termination witness; a
 * restart that bumped the epoch but never reconciled is resumed without a
 * second epoch bump; a committed dispatch intent whose spawn was never
 * witnessed is treated as possibly-live, not un-run.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sequence } from "../src/coordination/types.ts";
import type { AuthorityGrantRecord } from "../src/core/verified-run/authority-events.ts";
import { runAuthorityProbe } from "../src/core/verified-run/authority-runtime.ts";
import { AuthorityStore, authorityStorePath } from "../src/core/verified-run/authority-store.ts";

let root: string;
let storePath: string;
beforeEach(async () => {
	vi.spyOn(Date, "now").mockReturnValue(100);
	root = await mkdtemp(join(tmpdir(), "omk-authority-restart-"));
	storePath = authorityStorePath(root);
});
afterEach(async () => {
	vi.restoreAllMocks();
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

function grantOf(store: AuthorityStore, commandId: string): AuthorityGrantRecord {
	const grant = [...store.state.grants.values()].find((entry) => entry.commandId === commandId);
	if (!grant) throw new Error(`grant ${commandId} missing`);
	return grant;
}

describe("authority restart quarantine", () => {
	it("keeps unresolved effects owned across restart and settles only on a termination witness", async () => {
		const first = AuthorityStore.open(storePath, { capacity: 4 });
		first.reconcile();
		first.register("s1");
		const live = first.acquire(input("cmd-live", 100));
		if (live.status !== "granted") throw new Error("unreachable");
		expect(first.effectStarted(live.token, [claim("src/x")])).toBe(true);
		const reserved = first.acquire(input("cmd-reserved", 100, { claims: [claim("src/r")] }));
		if (reserved.status !== "granted") throw new Error("unreachable");
		first.release();

		// Restart: epoch 2 commits durably; the possibly-live effect is
		// quarantined (still holding claims), the never-live one is cancelled.
		const second = AuthorityStore.open(storePath, { capacity: 4 });
		expect(second.state.epoch).toBe("2");
		expect(second.pendingReconcile).toBe(true);
		expect(grantOf(second, "cmd-live").state).toBe("quarantined");
		expect(grantOf(second, "cmd-live").effectLive).toBe(true);
		expect(grantOf(second, "cmd-reserved").state).toBe("cancelled");
		// New admission is refused until the reconciled scope is established.
		expect(() => second.acquire(input("cmd-new", 100, { claims: [claim("src/n")] }))).toThrow(/reconcile_pending/);

		// Probe reports "unknown": the grant stays quarantined and keeps its claims…
		second.reconcile(() => "unknown");
		expect(second.pendingReconcile).toBe(false);
		expect(grantOf(second, "cmd-live").state).toBe("quarantined");
		expect(second.acquire(input("cmd-conflict", 100)).status).toBe("blocked");
		expect(second.acquire(input("cmd-ok", 100, { claims: [claim("src/free")] })).status).toBe("granted");

		// …until a later witness reports termination — only then the claims release.
		expect(second.confirmTerminated(live.token)).toBe(true);
		expect(grantOf(second, "cmd-live").state).toBe("terminated");
		expect(second.acquire(input("cmd-conflict-2", 100)).status).toBe("granted");
		second.release();
	});

	it("quarantines a committed dispatch intent that was never witnessed as spawned (I01/I02)", async () => {
		const first = AuthorityStore.open(storePath, { capacity: 4 });
		first.reconcile();
		first.register("s1");
		const granted = first.acquire(input("cmd-intent", 100));
		if (granted.status !== "granted") throw new Error("unreachable");
		expect(first.dispatchIntent(granted.token, "dispatch-1")).toBe(true);
		first.release();

		// The intent committed but no process_ready/exited exists: on restart it
		// must be treated as possibly-live — quarantined, never silently released.
		const second = AuthorityStore.open(storePath, { capacity: 4 });
		expect(grantOf(second, "cmd-intent").state).toBe("quarantined");
		expect(grantOf(second, "cmd-intent").effectLive).toBe(true);
		second.reconcile(() => "terminated");
		expect(grantOf(second, "cmd-intent").state).toBe("terminated");
		second.release();
	});

	it("resumes an unfinished reconcile without bumping the epoch again", async () => {
		const first = AuthorityStore.open(storePath, { capacity: 4 });
		first.reconcile();
		first.register("s1");
		const granted = first.acquire(input("cmd-mid", 100));
		if (granted.status !== "granted") throw new Error("unreachable");
		expect(first.effectStarted(granted.token, [claim("src/x")])).toBe(true);
		first.release();

		// Crash window: epoch advanced but reconcile never ran. The next open
		// must adopt epoch 2 — not mint epoch 3 — and finish the same reconcile.
		const crashed = AuthorityStore.open(storePath, { capacity: 4 });
		expect(crashed.state.epoch).toBe("2");
		expect(crashed.pendingReconcile).toBe(true);
		crashed.release();

		const resumed = AuthorityStore.open(storePath, { capacity: 4 });
		expect(resumed.state.epoch).toBe("2");
		expect(resumed.pendingReconcile).toBe(true);
		resumed.reconcile(() => "terminated");
		expect(resumed.pendingReconcile).toBe(false);
		expect(grantOf(resumed, "cmd-mid").state).toBe("terminated");
		resumed.release();

		// Only then does a later restart advance to epoch 3.
		const third = AuthorityStore.open(storePath, { capacity: 4 });
		expect(third.state.epoch).toBe("3");
		third.release();
	});

	it("keeps a cancelled live effect quarantined until witnessed — cancel is not termination", async () => {
		const first = AuthorityStore.open(storePath, { capacity: 4 });
		first.reconcile();
		first.register("s1");
		const granted = first.acquire(input("cmd-cancel", 100));
		if (granted.status !== "granted") throw new Error("unreachable");
		expect(first.effectStarted(granted.token, [claim("src/x")])).toBe(true);
		expect(first.cancel(granted.token)).toBe(true);
		// Requested cancellation quarantines the live effect; claims stay held.
		expect(grantOf(first, "cmd-cancel").state).toBe("quarantined");
		expect(first.acquire(input("cmd-other", 100)).status).toBe("blocked");
		// Re-requesting cancel on a quarantined effect is a no-op (broker
		// parity), never a second release of the claims.
		expect(first.cancel(granted.token)).toBe(true);
		expect(grantOf(first, "cmd-cancel").state).toBe("quarantined");
		expect(first.confirmTerminated(granted.token)).toBe(true);
		expect(first.acquire(input("cmd-other", 100)).status).toBe("granted");
		first.release();
	});

	it("does not treat a git-ref grant without a process witness as terminated (F07)", () => {
		const grant = {
			token: {
				authorityEpoch: sequence("1"),
				grantSequence: sequence("1"),
				sessionId: "s1",
				sessionIncarnation: sequence("1"),
				authorizationDeadline: 1,
			},
			commandId: "publish-1",
			intentDigest: DIGEST,
			claims: [
				{
					namespace: "git-ref" as const,
					instanceId: "verified-run",
					canonicalKey: "omk-accepted-ref/abc",
					access: "write" as const,
					generation: sequence("0"),
				},
			],
			weight: 1,
			state: "starting",
			effectLive: true,
			dispatchId: "publish-1",
			actualClaims: null,
			identity: null,
		} satisfies AuthorityGrantRecord;
		expect(runAuthorityProbe(grant)).toBe("unknown");
	});

	it("survives a full epoch cycle on durable state — incarnation counters never regress (S2)", async () => {
		const first = AuthorityStore.open(storePath, { capacity: 4 });
		first.reconcile();
		expect(first.register("s1")).toBe("1");
		first.release();

		const second = AuthorityStore.open(storePath, { capacity: 4 });
		second.reconcile();
		expect(second.register("s1")).toBe("2");
		// A stale incarnation is fenced: the in-memory restart cannot re-mint "1".
		expect(() => second.acquire(input("cmd-stale", 100, { incarnation: "1" }))).toThrow(/stale_incarnation/);
		expect(second.acquire(input("cmd-fresh", 100, { incarnation: "2" })).status).toBe("granted");
		second.release();
	});
});
