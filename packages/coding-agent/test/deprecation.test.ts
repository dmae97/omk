import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearDeprecationWarningsForTests, warnDeprecation } from "../src/utils/deprecation";

describe("deprecation warnings", () => {
	beforeEach(() => {
		clearDeprecationWarningsForTests();
		vi.restoreAllMocks();
	});

	it("warns on first call with a message", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		warnDeprecation("test-msg", "Test deprecation message");

		expect(consoleSpy).toHaveBeenCalledTimes(1);
		expect(consoleSpy.mock.calls[0][0]).toContain("test-msg");
	});

	it("does not warn again for the same message", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		warnDeprecation("same-msg", "Repeated message");
		warnDeprecation("same-msg", "Repeated message");

		expect(consoleSpy).toHaveBeenCalledTimes(1);
	});

	it("warns again for a different message", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		warnDeprecation("msg-1", "First message");
		warnDeprecation("msg-2", "Second message");

		expect(consoleSpy).toHaveBeenCalledTimes(2);
	});

	it("warns again after clearing deprecation warnings", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		warnDeprecation("clear-msg", "Clearable message");
		expect(consoleSpy).toHaveBeenCalledTimes(1);

		clearDeprecationWarningsForTests();

		warnDeprecation("clear-msg", "Clearable message");
		expect(consoleSpy).toHaveBeenCalledTimes(2);
	});
});
