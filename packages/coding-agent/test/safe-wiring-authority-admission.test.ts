import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthorityStore, authorityStorePath } from "../src/core/verified-run/authority-store.ts";

let root: string;
let store: AuthorityStore;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "authority-admission-"));
	store = AuthorityStore.open(authorityStorePath(root), { capacity: 2 });
	store.reconcile();
});
afterEach(() => {
	store.release();
	rmSync(root, { recursive: true, force: true });
});

function reserve() {
	const input = {
		sessionId: "fixture",
		incarnation: store.register("fixture"),
		commandId: "command",
		intentDigest: "a".repeat(64),
		claims: [
			{ namespace: "filesystem", instanceId: "fixture", canonicalKey: "work", access: "write", generation: "0" },
		],
		now: 100,
		ttl: 100,
	};
	const result = store.acquire(input);
	if (result.status !== "granted") throw new Error("positive control must reserve");
	return { input, token: result.token };
}

describe("fresh durable authority admission, including cached replies", () => {
	it("does not publish or acknowledge a new reservation after authority release during fsync", () => {
		store.release();
		let armed = false;
		store = AuthorityStore.open(authorityStorePath(root), {
			capacity: 2,
			hooks: {
				afterLedgerFsync: () => {
					if (armed) store.release();
				},
			},
		});
		store.reconcile();
		const { input } = reserve();
		const head = store.head;
		armed = true;
		expect(() =>
			store.acquire({ ...input, commandId: "later", claims: [{ ...input.claims[0], canonicalKey: "other" }] }),
		).toThrow(/stale_owner/);
		expect(store.head).toEqual(head);
		expect([...AuthorityStore.inspect(store.path).grants.values()].map((grant) => grant.commandId)).toEqual([
			"command",
		]);
	});
	it.each([false, true])("rejects a released owner before replay (retained=%s)", (retained) => {
		const { input, token } = reserve();
		if (retained) {
			expect(store.cancel(token)).toBe(true);
			store.retainResult(input.commandId, "b".repeat(64), 100, 100);
		}
		expect(store.acquire(input).status).toBe(retained ? "result" : "granted");
		store.release();
		expect(() => store.acquire(input)).toThrow(/stale_owner/);
	});

	it.each([false, true])("rejects tampered cached bytes before replay (retained=%s)", (retained) => {
		const { input, token } = reserve();
		if (retained) {
			store.cancel(token);
			store.retainResult(input.commandId, "b".repeat(64), 100, 100);
		}
		expect(store.acquire(input).status).toBe(retained ? "result" : "granted");
		const bytes = readFileSync(store.path);
		const index = bytes.indexOf('"fixture"');
		expect(index).toBeGreaterThan(0);
		bytes[index + 1] = "X".charCodeAt(0);
		writeFileSync(store.path, bytes);
		expect(() => store.acquire(input)).toThrow(/corrupt|integrity|tampered/);
	});
});
