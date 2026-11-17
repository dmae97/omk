import { describe, expect, it } from "vitest";
import { computeCoverageGap } from "../src/core/context-budget-v2-coverage.ts";

describe("computeCoverageGap", () => {
	describe("empty / blank queries", () => {
		it("returns no gap for undefined query", () => {
			expect(computeCoverageGap(undefined, [])).toEqual({ gap: false, missing: [] });
		});

		it("returns no gap for empty string query", () => {
			expect(computeCoverageGap("", [])).toEqual({ gap: false, missing: [] });
		});

		it("returns no gap for whitespace-only query", () => {
			expect(computeCoverageGap("   ", [])).toEqual({ gap: false, missing: [] });
		});
	});

	describe("stop words and short ASCII tokens", () => {
		it("returns no gap when query is only stop words", () => {
			// 'how', 'to', 'do' — 'do' is 2-char ASCII so filtered; 'how', 'to' are stop words
			expect(computeCoverageGap("how to do it", [])).toEqual({ gap: false, missing: [] });
		});

		it("returns no gap when query produces no tokens after filtering", () => {
			// All 1–2 letter ASCII tokens and stop words
			expect(computeCoverageGap("a an in on or is", [])).toEqual({ gap: false, missing: [] });
		});
	});

	describe("gap detection", () => {
		it("reports missing tokens not covered by any selected text", () => {
			const result = computeCoverageGap("fix flaky parser test", ["The parser is flaky"]);
			expect(result.gap).toBe(true);
			// 'fix' and 'test' are not in the selected text
			expect(result.missing).toContain("fix");
			expect(result.missing).toContain("test");
			// 'parser' and 'flaky' are covered
			expect(result.missing).not.toContain("parser");
			expect(result.missing).not.toContain("flaky");
		});

		it("returns no gap when all query tokens are covered", () => {
			const result = computeCoverageGap("parser flaky", ["The parser is flaky"]);
			expect(result).toEqual({ gap: false, missing: [] });
		});
	});

	describe("case insensitivity", () => {
		it("matches tokens case-insensitively", () => {
			// 'Parser' in query should match 'parser' in text
			const result = computeCoverageGap("Parser", ["parser is broken"]);
			expect(result).toEqual({ gap: false, missing: [] });
		});

		it("matches upper-case text tokens against lower-case query tokens", () => {
			const result = computeCoverageGap("flaky parser", ["FLAKY PARSER"]);
			expect(result).toEqual({ gap: false, missing: [] });
		});
	});

	describe("duplicate query tokens", () => {
		it("reports each missing token once even if repeated in the query", () => {
			const result = computeCoverageGap("parser parser", []);
			expect(result.gap).toBe(true);
			expect(result.missing).toEqual(["parser"]);
		});
	});

	describe("punctuation / hyphenated tokens", () => {
		it("splits hyphenated query tokens and matches them separately in text", () => {
			// 'auth-token' tokenizes to 'auth' and 'token'; both are in the selected text
			const result = computeCoverageGap("auth-token", ["auth token verification"]);
			expect(result).toEqual({ gap: false, missing: [] });
		});

		it("reports gap when only one part of a hyphenated token is covered", () => {
			const result = computeCoverageGap("auth-token", ["auth only here"]);
			// 'auth' is covered, 'token' is not — but 'token' is 5 chars so not filtered
			expect(result.gap).toBe(true);
			expect(result.missing).toContain("token");
			expect(result.missing).not.toContain("auth");
		});
	});

	describe("non-ASCII / Unicode tokens", () => {
		it("keeps short non-ASCII tokens (they bypass the short-ASCII filter)", () => {
			// '버그' is 2 chars but non-ASCII — should NOT be filtered
			const result = computeCoverageGap("버그", []);
			expect(result.gap).toBe(true);
			expect(result.missing).toContain("버그");
		});

		it("matches non-ASCII tokens across query and text", () => {
			const result = computeCoverageGap("버그", ["버그 수정"]);
			expect(result).toEqual({ gap: false, missing: [] });
		});
	});

	describe("multiple selected texts", () => {
		it("unions tokens across all selected texts", () => {
			const result = computeCoverageGap("parser flaky test", ["The parser", "is flaky", "run the test suite"]);
			expect(result).toEqual({ gap: false, missing: [] });
		});

		it("reports missing token not found in any selected text", () => {
			const result = computeCoverageGap("parser benchmark flaky", ["parser analysis", "flaky results"]);
			expect(result.gap).toBe(true);
			expect(result.missing).toContain("benchmark");
		});
	});
});
