import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Sequence, sequence } from "../src/coordination/types.ts";
import { AuthorityStore, authorityStorePath } from "../src/core/verified-run/authority-store.ts";

let root: string;
let store: AuthorityStore;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "authority-replay-"));
	store = AuthorityStore.open(authorityStorePath(root), { capacity: 2 });
	store.reconcile();
});
afterEach(() => {
	store.release();
	rmSync(root, { recursive: true, force: true });
});

describe("byte-verified incremental authority replay", () => {
	it("keeps its validated cache detached from a caller's mutable projection", () => {
		store.register("counter");
		const exposed = store.state.incarnations as Map<string, Sequence>;
		exposed.set("counter", sequence("999"));
		expect(store.register("counter")).toBe("2");
		expect(AuthorityStore.inspect(store.path).incarnations.get("counter")).toBe("2");
	});

	it("replays only the appended record and agrees with an independent full disk replay", () => {
		for (let n = 0; n < 20; n++) {
			const before = store.head.lastSeq;
			store.register("counter");
			expect(store).toHaveProperty("lastReplay", { parsedRecords: 1, reusedPrefixRecords: before });
			expect(store.state).toEqual(AuthorityStore.inspect(store.path));
		}
	});
	it("detects same-length in-place prefix corruption despite unchanged inode and head", () => {
		store.register("counter");
		const head = store.head;
		const bytes = readFileSync(store.path);
		const index = bytes.indexOf('"counter"');
		if (index < 0) throw new Error("fixture counter missing");
		bytes[index + 1] = "X".charCodeAt(0);
		writeFileSync(store.path, bytes);
		expect(() => store.register("next")).toThrow(/corrupt|integrity|tampered/);
		expect(store.head).toEqual(head);
		expect(store.state.incarnations.has("next")).toBe(false);
	});
	it("does not bless byte-identical inode replacement as the cached journal", () => {
		store.register("counter");
		const replacement = join(root, "replacement");
		writeFileSync(replacement, readFileSync(store.path));
		renameSync(replacement, store.path);
		expect(() => store.register("next")).toThrow(/tampered/);
	});
	it("invalidates cached state across compact and restart without losing a live owner", () => {
		const incarnation = store.register("counter");
		const input = {
			sessionId: "counter",
			incarnation,
			commandId: "retained",
			intentDigest: "a".repeat(64),
			claims: [{ namespace: "filesystem", instanceId: "test", canonicalKey: "x", access: "write", generation: "0" }],
			now: Date.now(),
			ttl: 60_000,
		};
		const live = store.acquire(input);
		if (live.status !== "granted") throw new Error("fixture grant missing");
		store.effectStarted(live.token, input.claims);
		store.register("other");
		store.compact(Date.now());
		store.release();
		store = AuthorityStore.open(authorityStorePath(root), { capacity: 2 });
		store.reconcile();
		expect(store.state.grants.get(live.token.grantSequence)).toMatchObject({
			state: "quarantined",
			effectLive: true,
		});
		expect(store.state).toEqual(AuthorityStore.inspect(store.path));
	});
});
