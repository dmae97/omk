import { expect, it } from "vitest";
import { controlDeadline, controlTimeoutMs } from "../src/core/control-deadline.ts";

it("observes a total monotonic deadline without waiting for the timer", () => {
	let now = 0;
	const deadline = controlDeadline(
		1000,
		() => {
			throw new Error("unexpected timer");
		},
		() => now,
	);
	try {
		expect(deadline.expired()).toBe(false);
		now = 1000;
		expect(deadline.expired()).toBe(true);
		now = -1;
		expect(deadline.expired()).toBe(true);
	} finally {
		deadline.cancel();
	}
});
it.each([0, -1, NaN, Infinity, 0.5, 2_147_483_648])("rejects invalid duration %s", (value) => {
	expect(() => controlTimeoutMs(value)).toThrow();
});
