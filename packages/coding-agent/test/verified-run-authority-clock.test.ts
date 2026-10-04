import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthorityClock } from "../src/core/verified-run/authority-clock.ts";

afterEach(() => vi.restoreAllMocks());

describe("authority clock", () => {
	it("keeps the default clock running when the host wall clock steps back", () => {
		let wall = 1_700_000_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => wall);
		const clock = createAuthorityClock();
		const before = clock();
		// WSL2 and NTP step corrections move wall time backwards mid-run.
		wall -= 5_000;
		const after = clock();
		expect(after).toBeGreaterThanOrEqual(before);
		expect(Number.isSafeInteger(after)).toBe(true);
	});

	it("anchors the default clock to wall time and advances it only with the monotonic clock", () => {
		let monotonic = 1_000.4;
		vi.spyOn(performance, "now").mockImplementation(() => monotonic);
		vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
		const clock = createAuthorityClock();
		expect(clock()).toBe(1_700_000_000_000);
		monotonic += 250.9;
		vi.mocked(Date.now).mockReturnValue(1_600_000_000_000);
		expect(clock()).toBe(1_700_000_000_250);
	});

	it("still refuses an explicit source that moves backwards, so rollback never extends a grant", () => {
		const values = [100, 150, 149];
		const clock = createAuthorityClock(() => values.shift() ?? 0);
		expect(clock()).toBe(150);
		expect(() => clock()).toThrow(/clock_anomaly/);
	});
});
