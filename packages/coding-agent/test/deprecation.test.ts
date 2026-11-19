import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDeprecationWarningsForTests, warnDeprecation } from "../src/utils/deprecation.ts";

describe("deprecation warnings", () => {
	beforeEach(() => {
		clearDeprecationWarningsForTests();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("warns on first call with a message", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		warnDeprecation("Test deprecation message");

		expect(consoleSpy).toHaveBeenCalledTimes(1);
		expect(consoleSpy.mock.calls[0]?.[0]).toContain("Deprecation warning: Test deprecation message");
	});

	it("does not warn again for the same message", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		warnDeprecation("Repeated message");
		warnDeprecation("Repeated message");

		expect(consoleSpy).toHaveBeenCalledTimes(1);
	});

	it("warns again for a different message", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		warnDeprecation("First message");
		warnDeprecation("Second message");

		expect(consoleSpy).toHaveBeenCalledTimes(2);
	});

	it("warns again after clearing deprecation warnings", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		warnDeprecation("Clearable message");
		expect(consoleSpy).toHaveBeenCalledTimes(1);

		clearDeprecationWarningsForTests();

		warnDeprecation("Clearable message");
		expect(consoleSpy).toHaveBeenCalledTimes(2);
	});
});
