import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
	type OMKSessionBinding,
	SessionBindingStore,
} from "../examples/extensions/aside-computer-use/session-binding.ts";

function binding(id: string, account: string, profile: string): OMKSessionBinding {
	return {
		omkSessionId: id,
		accountId: account,
		browserProfileId: profile,
		activeTabIds: [],
		permissionMode: "guard",
		allowedOrigins: ["localhost:*"],
		evidenceDirectory: "/tmp/ev",
		createdAt: Date.now(),
		lastActivityAt: Date.now(),
	};
}

describe("SessionBindingStore", () => {
	it("binds, gets, and updates bindings", () => {
		const store = new SessionBindingStore();
		store.bind(binding("s1", "work", "default"));
		expect(store.get("s1")?.accountId).toBe("work");
		const updated = store.update("s1", { lastActivityAt: 999 });
		expect(updated?.lastActivityAt).toBe(999);
		expect(updated?.createdAt).toBe(store.get("s1")?.createdAt);
		expect(store.get("missing")).toBeUndefined();
	});

	it("serializes mutation locks per profile (one at a time)", async () => {
		const store = new SessionBindingStore();
		const order: string[] = [];
		const release1 = await store.acquireMutationLock("work", "default");
		const p2 = store.acquireMutationLock("work", "default").then(async (release2) => {
			order.push("second");
			release2();
		});
		// ensure p2 has not run while the lock is held
		await Promise.resolve();
		expect(order).toEqual([]);
		order.push("first");
		release1();
		await p2;
		expect(order).toEqual(["first", "second"]);
	});

	it("allows independent profiles to lock concurrently", async () => {
		const store = new SessionBindingStore();
		const r1 = await store.acquireMutationLock("work", "a");
		const r2 = await store.acquireMutationLock("work", "b");
		expect(r1).toBeTypeOf("function");
		expect(r2).toBeTypeOf("function");
		r1();
		r2();
	});

	it("grants mutation locks FIFO per account/profile", async () => {
		const store = new SessionBindingStore();
		const order: string[] = [];
		const release1 = await store.acquireMutationLock("work", "default");
		const p2 = store.acquireMutationLock("work", "default").then((release2) => {
			order.push("second");
			return release2;
		});
		const p3 = store.acquireMutationLock("work", "default").then((release3) => {
			order.push("third");
			return release3;
		});
		await delay(5);
		expect(order).toEqual([]);
		release1();
		const release2 = await p2;
		expect(order).toEqual(["second"]);
		await delay(5);
		expect(order).toEqual(["second"]);
		release2();
		const release3 = await p3;
		expect(order).toEqual(["second", "third"]);
		release3();
	});

	it("supports aborting and timing out pending mutation lock waits", async () => {
		const store = new SessionBindingStore();
		const release = await store.acquireMutationLock("work", "default");
		const controller = new AbortController();
		const aborted = store.acquireMutationLock("work", "default", { signal: controller.signal });
		controller.abort();
		await expect(aborted).rejects.toThrow(/aborted/);
		await expect(store.acquireMutationLock("work", "default", { waitTimeoutMs: 5 })).rejects.toThrow(/timed out/);
		release();
	});

	it("clear() removes bindings, rejects pending waiters, and late releases do not resurrect locks", async () => {
		const store = new SessionBindingStore();
		store.bind(binding("s1", "work", "default"));
		const release = await store.acquireMutationLock("work", "default");
		const pending = store.acquireMutationLock("work", "default");
		await delay(5);
		store.clear();
		expect(store.get("s1")).toBeUndefined();
		await expect(pending).rejects.toThrow(/cleared/);
		release();
		const releaseAfterClear = await store.acquireMutationLock("work", "default");
		releaseAfterClear();
	});

	it("release functions are safe to call more than once", async () => {
		const store = new SessionBindingStore();
		const release1 = await store.acquireMutationLock("work", "default");
		let grantCount = 0;
		const p2 = store.acquireMutationLock("work", "default").then((release2) => {
			grantCount += 1;
			return release2;
		});
		release1();
		release1();
		const release2 = await p2;
		expect(grantCount).toBe(1);
		release2();
		release2();
	});
});
