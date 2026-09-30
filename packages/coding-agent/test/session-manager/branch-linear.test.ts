import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";

describe("SessionManager deep branch traversal", () => {
	it("preserves root-to-leaf order without quadratic front insertion", () => {
		const session = SessionManager.inMemory();
		const ids = Array.from({ length: 2048 }, (_, index) => session.appendCustomEntry("perf", { index }));
		const original = Array.prototype.unshift;
		let copiedReferences = 0;
		const spy = vi.spyOn(Array.prototype, "unshift").mockImplementation(function (
			this: unknown[],
			...items: unknown[]
		) {
			copiedReferences += this.length;
			return original.apply(this, items);
		});
		let branch: ReturnType<SessionManager["getBranch"]>;
		try {
			branch = session.getBranch();
		} finally {
			spy.mockRestore();
		}
		expect(branch.map((entry) => entry.id)).toEqual(ids);
		expect(copiedReferences).toBeLessThanOrEqual(2 * ids.length);
		branch.pop();
		expect(session.getBranch()).toHaveLength(ids.length);
	});

	it("returns only the selected ancestry after a fork", () => {
		const session = SessionManager.inMemory();
		const root = session.appendCustomEntry("perf", 0);
		const common = session.appendCustomEntry("perf", 1);
		const oldLeaf = session.appendCustomEntry("perf", 2);
		session.branch(common);
		const newLeaf = session.appendCustomEntry("perf", 3);
		expect(session.getBranch().map((entry) => entry.id)).toEqual([root, common, newLeaf]);
		expect(session.getBranch(oldLeaf).map((entry) => entry.id)).toEqual([root, common, oldLeaf]);
		expect(session.getBranch("missing")).toEqual([]);
	});
});
