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

	it("loads undici when configureHttpDispatcher runs", async () => {
		const { configureHttpDispatcher } = await import("../src/core/http-dispatcher.ts");
		// Importing the module evaluates the static undici import.
		expect(loads.undici).toBe(1);
		configureHttpDispatcher(0);
		expect(loads.undici).toBe(1);
	});
});
