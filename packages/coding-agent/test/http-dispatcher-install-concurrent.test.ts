import { describe, expect, it, vi } from "vitest";

// Prove overlapping ensure callers share one install promise and wait until
// configure finishes (Tech Lead #78 ask).
const state = vi.hoisted(() => ({
	importStarted: 0,
	configures: 0,
}));

vi.mock("../src/core/http-dispatcher.ts", async () => {
	state.importStarted++;
	await new Promise((resolve) => setTimeout(resolve, 40));
	return {
		adoptGlobalFetch: () => {},
		configureHttpDispatcher: () => {
			state.configures++;
		},
		dispatcherFetch: globalThis.fetch,
	};
});

describe("http-dispatcher-install concurrency", () => {
	it("runs configure once when two ensures overlap, and both wait", async () => {
		const { ensureHttpDispatcherInstalled } = await import("../src/core/http-dispatcher-install.ts");

		let resolved = 0;
		const first = ensureHttpDispatcherInstalled().then(() => {
			resolved++;
		});
		const second = ensureHttpDispatcherInstalled().then(() => {
			resolved++;
		});

		// Let the shared install async start, but not finish (40ms mock delay).
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(state.importStarted).toBe(1);
		expect(state.configures).toBe(0);
		expect(resolved).toBe(0);

		await Promise.all([first, second]);

		expect(resolved).toBe(2);
		expect(state.importStarted).toBe(1);
		expect(state.configures).toBe(1);

		await ensureHttpDispatcherInstalled();
		expect(state.importStarted).toBe(1);
		expect(state.configures).toBe(1);
	});
});
