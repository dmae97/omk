import { describe, expect, it } from "vitest";
import { compactToolOutput } from "../src/core/tools/tool-output-compactor.ts";

describe("P1-3: compactToolOutput", () => {
	it("strips ANSI escapes, resolves carriage-return progress frames, and folds repeated boilerplate lines while preserving errors", () => {
		const raw = [
			"\x1b[32mCompiling\x1b[0m 10%\r\x1b[32mCompiling\x1b[0m 50%\r\x1b[32mCompiled\x1b[0m 100%",
			"downloading chunk",
			"downloading chunk",
			"downloading chunk",
			"downloading chunk",
			"downloading chunk",
			"",
			"",
			"",
			"",
			"\x1b[31mFAIL\x1b[0m src/core/auth.ts:42 - expected 200, got 401",
		].join("\n");

		const result = compactToolOutput(raw);
		expect(result.applied).toBe(true);
		expect(result.savedBytes).toBeGreaterThan(0);
		expect(result.collapsedDuplicateLines).toBe(4);
		expect(result.collapsedBlankLines).toBe(3);
		expect(result.text).toContain("Compiled 100%");
		expect(result.text).not.toContain("Compiling 10%");
		expect(result.text).not.toContain("\x1b[");
		expect(result.text).toContain("[... repeated 4 more times]");
		expect(result.text).toContain("FAIL src/core/auth.ts:42 - expected 200, got 401");
	});

	it("leaves short clean diagnostic output byte-identical", () => {
		const raw = "PASS test/a.test.ts (3 tests)\nDone in 0.4s";
		const result = compactToolOutput(raw);
		expect(result.applied).toBe(false);
		expect(result.savedBytes).toBe(0);
		expect(result.text).toBe(raw);
	});
});
