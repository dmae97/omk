import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { factFromGoalAcceptance } from "../src/core/task-result.ts";
import { classifyCheckKind, parseTestCounts } from "../src/core/test-counts.ts";

/**
 * Spec 100 decision 3/6: counts come from the runner's own output text. Every fixture below is
 * real output captured from node 22.20 (node:test), vitest 4.1.11 and jest 29.7.0 run outside this
 * repo; no runner or reporter is a dependency here.
 */
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", "test-counts", name), "utf8");

describe("parseTestCounts on real runner output", () => {
	it.each([
		["node-test-tap-pass-skip.txt", { executed: 2, matched: 3, skipped: 1 }],
		["node-test-spec-pass-skip.txt", { executed: 2, matched: 3, skipped: 1 }],
		["node-test-tap-fail.txt", { executed: 2, matched: 2, skipped: 0 }],
		["node-test-tap-zero.txt", { executed: 0, matched: 0, skipped: 0 }],
		["vitest-pass-skip.txt", { executed: 2, matched: 3, skipped: 1 }],
		["vitest-fail.txt", { executed: 2, matched: 2, skipped: 0 }],
		["vitest-zero.txt", { executed: 0, matched: 3, skipped: 3 }],
		["jest-pass-skip.txt", { executed: 2, matched: 3, skipped: 1 }],
		["jest-fail.txt", { executed: 2, matched: 2, skipped: 0 }],
		["jest-zero.txt", { executed: 0, matched: 3, skipped: 3 }],
	])("%s", (name, expected) => {
		expect(parseTestCounts(fixture(name))).toEqual(expected);
	});

	const NOMATCH = "node --test --test-name-pattern=nomatch calc.test.mjs";
	it.each([
		// The file itself is reported as 1 passing test; only the exact file argument removes it.
		["node-test-tap-file-only.txt", NOMATCH, { executed: 0, matched: 0, skipped: 0 }],
		["node-test-spec-file-only.txt", `${NOMATCH} --test-reporter=spec`, { executed: 0, matched: 0, skipped: 0 }],
		// Without the command nothing is subtracted on looks alone.
		["node-test-tap-file-only.txt", "", { executed: 1, matched: 1, skipped: 0 }],
		["node-test-tap-file-only.txt", "node --test other.test.mjs", { executed: 1, matched: 1, skipped: 0 }],
		// A real test literally named `foo.js` stays an executed test.
		["node-test-tap-named-foo-js.txt", "node --test foo.test.mjs", { executed: 1, matched: 1, skipped: 0 }],
		[
			"node-test-spec-named-foo-js.txt",
			"node --test --test-reporter=spec foo.test.mjs",
			{ executed: 1, matched: 1, skipped: 0 },
		],
		// Even when the file argument is also `foo.js`: TAP shows real tests with no `1..0` file plan.
		["node-test-tap-named-foo-js-same-file.txt", "node --test foo.js", { executed: 1, matched: 1, skipped: 0 }],
	])("%s with `%s`", (name, command, expected) => {
		expect(parseTestCounts(fixture(name), command)).toEqual(expected);
	});

	it("unreadable output gives undefined, never a guessed 0", () => {
		expect(parseTestCounts("")).toBeUndefined();
		expect(parseTestCounts("ok\nall good\n")).toBeUndefined();
		expect(parseTestCounts("# tests 3\n# pass 2\n")).toBeUndefined();
		// Inconsistent totals are refused rather than trusted.
		expect(parseTestCounts("      Tests  2 passed | 1 skipped (9)\n")).toBeUndefined();
		expect(parseTestCounts("Tests:       2 passed, 7 total\n")).toBeUndefined();
	});

	it("ANSI colors do not change the counts", () => {
		expect(
			parseTestCounts("\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m2 passed\u001b[39m\u001b[22m (2)\n"),
		).toEqual({
			executed: 2,
			matched: 2,
			skipped: 0,
		});
	});
});

describe("classifyCheckKind", () => {
	it.each([
		["node --test", "test_runner"],
		["node --test-name-pattern=x a.test.mjs", "test_runner"],
		["npx vitest run", "test_runner"],
		["jest --ci", "test_runner"],
		["npm test", "test_runner"],
		["npm run test -- --run", "test_runner"],
		["npx tsc --noEmit", "typecheck"],
		["tsgo --noEmit", "typecheck"],
		["test -f done.txt", "shell"],
		["node build.mjs", "shell"],
	])("%s -> %s", (command, kind) => {
		expect(classifyCheckKind(command)).toBe(kind);
	});
});

const NOMATCH_COMMAND = "node --test --test-name-pattern=nomatch calc.test.mjs";

describe("node:test file-only pass (spec 100 Tech Lead addition)", () => {
	it("the file counted as 1 passing test is not an executed test: zero_tests, never passed", () => {
		const counts = parseTestCounts(fixture("node-test-tap-file-only.txt"), NOMATCH_COMMAND);
		expect(counts?.executed).toBe(0);
		const fact = factFromGoalAcceptance(
			{ receiptId: "r", status: "passed", passed: true, workspace: { sha256: "w", completeness: "complete" } },
			{
				checkKind: "test_runner",
				currentWorkspaceSha256: "w",
				...(counts
					? { executedTests: counts.executed, matchedTests: counts.matched, skippedTests: counts.skipped }
					: {}),
			},
		);
		expect(fact).toMatchObject({ status: "insufficient", reason: "zero_tests" });
	});
});
