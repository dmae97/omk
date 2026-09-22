import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorityStore, authorityStorePath } from "../src/core/verified-run/authority-store.ts";
import { assertPublishEffectStart } from "../src/core/verified-run/publish-start.ts";

let root: string;
let store: AuthorityStore;
const claims = [
	{ namespace: "git-ref", instanceId: "test", canonicalKey: "accepted", access: "write", generation: "0" },
];
beforeEach(() => {
	vi.spyOn(Date, "now").mockReturnValue(100);
	root = mkdtempSync(join(tmpdir(), "authority-boundaries-"));
	store = AuthorityStore.open(authorityStorePath(root), { capacity: 2 });
	store.reconcile();
	store.register("s");
});
afterEach(() => {
	store.release();
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});
function reserve() {
	const admission = store.acquire({
		sessionId: "s",
		incarnation: "1",
		commandId: "publish",
		intentDigest: "a".repeat(64),
		claims,
		now: 100,
		ttl: 50,
	});
	if (admission.status !== "granted") throw new Error("fixture admission failed");
	return admission.token;
}

describe("strict authority start boundary", () => {
	it("refuses a rolled-back trusted clock without releasing the owner", () => {
		const token = reserve();
		vi.mocked(Date.now).mockReturnValue(99);
		expect(() => store.dispatchIntent(token, "dispatch")).toThrow(/clock_anomaly/);
		expect(store.state.grants.get(token.grantSequence)?.state).toBe("reserved");
	});

	it("requires fresh running authority at a later effect boundary", () => {
		const token = reserve();
		store.effectStarted(token, claims);
		expect(store.effectAuthorized(token, claims)).toBe(true);
		vi.mocked(Date.now).mockReturnValue(150);
		expect(store.effectAuthorized(token, claims)).toBe(false);
		expect(store.state.grants.get(token.grantSequence)).toMatchObject({ state: "quarantined", effectLive: true });
		expect(store.confirmTerminated(token)).toBe(true);
	});

	it.each([150, 151])("rejects omitted-clock dispatch at %d without a separate expire call", (now) => {
		const token = reserve();
		vi.mocked(Date.now).mockReturnValue(now);
		expect(store.dispatchIntent(token, "dispatch")).toBe(false);
		expect(store.state.grants.get(token.grantSequence)?.state).toBe("cancelled");
	});
	it("keeps a possibly-live start owned when the default clock expires", () => {
		const token = reserve();
		expect(store.dispatchIntent(token, "dispatch")).toBe(true);
		vi.mocked(Date.now).mockReturnValue(150);
		expect(store.effectStarted(token, claims)).toBe(false);
		expect(store.state.grants.get(token.grantSequence)).toMatchObject({ state: "quarantined", effectLive: true });
		expect(store.confirmTerminated(token)).toBe(true);
	});
	it.each(["running", "quarantined", "terminated", "cancelled"] as const)(
		"does not turn lookup pending in state %s into permission",
		(state) => {
			const token = reserve();
			if (state === "cancelled") store.cancel(token);
			else {
				store.effectStarted(token, claims, undefined, 100);
				if (state === "quarantined") store.cancel(token);
				if (state === "terminated") store.confirmTerminated(token);
			}
			const before = store.head;
			expect(() => assertPublishEffectStart(store, token, claims, true, 100)).toThrow(/authority/);
			expect(store.head).toEqual(before);
		},
	);
});
