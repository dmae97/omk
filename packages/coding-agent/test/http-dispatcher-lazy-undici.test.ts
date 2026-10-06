import { describe, expect, it, vi } from "vitest";

// settings-manager only needs idle-timeout helpers. A static undici import in
// http-dispatcher used to pull ~9 MB RSS into every AgentSession import.
const loads = vi.hoisted(() => ({ undici: 0 }));

vi.mock("undici", async (importOriginal) => {
	loads.undici++;
	return importOriginal();
});

describe("http-dispatcher undici loading", () => {
	it("does not load undici when settings-manager is imported", async () => {
		await import("../src/core/settings-manager.ts");
		expect(loads.undici).toBe(0);
	});

	it("does not load undici when only the fetch hook is installed", async () => {
		const { installHttpDispatcherFetchHook } = await import("../src/core/http-dispatcher-install.ts");
		installHttpDispatcherFetchHook();
		expect(loads.undici).toBe(0);
	});

	it("loads undici on the first fetch through the hook", async () => {
		const before = loads.undici;
		const { installHttpDispatcherFetchHook } = await import("../src/core/http-dispatcher-install.ts");
		installHttpDispatcherFetchHook();
		expect(loads.undici).toBe(before);

		// data: URLs never hit the network but still go through global fetch,
		// which is enough to trigger the lazy install.
		const response = await fetch("data:text/plain,ok");
		expect(response.ok).toBe(true);
		expect(loads.undici).toBe(before + 1);
	});
});
