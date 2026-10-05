import { describe, expect, it } from "vitest";
import { findEscapingLanePaths, lanePathsIntersect, normalizeLanePath } from "../src/core/lane-path-scope.ts";

describe("normalizeLanePath", () => {
	it("folds separators, dot segments, and trailing slashes into one repository-relative form", () => {
		expect(normalizeLanePath("./src/core/").path).toBe("src/core");
		expect(normalizeLanePath("src\\core\\x.ts").path).toBe("src/core/x.ts");
		expect(normalizeLanePath("src//core/./x.ts").path).toBe("src/core/x.ts");
		expect(normalizeLanePath("src/a/../core").path).toBe("src/core");
		expect(normalizeLanePath(".").path).toBe("");
		expect(normalizeLanePath("./").path).toBe("");
	});

	it("flags absolute, drive-letter, and parent-climbing paths as escaping", () => {
		for (const path of ["/etc/passwd", "C:\\repo\\x", "c:/repo", "..", "../x", "src/../../x", "\\\\server\\share"]) {
			expect(normalizeLanePath(path).escapes, path).toBe(true);
		}
		for (const path of ["file:/tmp/x", "file:///etc/passwd", "https://example.com/a", "~/notes", "~"]) {
			expect(normalizeLanePath(path).escapes, path).toBe(true);
		}
		expect(normalizeLanePath("src/..").escapes).toBe(false);
		expect(normalizeLanePath("src/a:b.ts").escapes).toBe(false);
		expect(normalizeLanePath("~backup/x").escapes).toBe(false);
		expect(normalizeLanePath("C:\\Repo").path).toBe("c:/Repo");
	});
});

describe("lanePathsIntersect", () => {
	it("matches equal and ancestor paths after normalization, on segment boundaries", () => {
		expect(lanePathsIntersect("./docs/plan.md", "docs/plan.md")).toBe(true);
		expect(lanePathsIntersect("docs", "docs/plan.md")).toBe(true);
		expect(lanePathsIntersect("src\\core", "src/core/x.ts")).toBe(true);
		expect(lanePathsIntersect("src", "srcx/a.ts")).toBe(false);
		expect(lanePathsIntersect("docs/a.md", "docs/b.md")).toBe(false);
		expect(lanePathsIntersect("Docs/plan.md", "docs/PLAN.md")).toBe(true);
		expect(lanePathsIntersect("Docs/**", "docs/plan.md")).toBe(true);
	});

	it("treats a glob as reaching everything below its literal prefix", () => {
		expect(lanePathsIntersect("docs/**", "docs/plan.md")).toBe(true);
		expect(lanePathsIntersect("src/*.ts", "src/core/x.ts")).toBe(true);
		expect(lanePathsIntersect("packages/*/src", "packages/tui/src/a.ts")).toBe(true);
		expect(lanePathsIntersect("**/*.md", "src/a.ts")).toBe(true);
		expect(lanePathsIntersect("docs/**", "src/a.ts")).toBe(false);
		expect(lanePathsIntersect("src/{a,b}.ts", "test/a.ts")).toBe(false);
	});

	it("treats the repository root and escaping paths as overlapping everything", () => {
		expect(lanePathsIntersect(".", "src/a.ts")).toBe(true);
		expect(lanePathsIntersect("../outside", "src/a.ts")).toBe(true);
		expect(lanePathsIntersect("/abs", "src/a.ts")).toBe(true);
		expect(lanePathsIntersect("file:/tmp/x", "src/a.ts")).toBe(true);
	});
});

describe("findEscapingLanePaths", () => {
	it("returns only the escaping entries and ignores blanks", () => {
		expect(findEscapingLanePaths(["src/a.ts", "../x", "", "/etc"])).toEqual(["../x", "/etc"]);
		expect(findEscapingLanePaths(undefined)).toEqual([]);
	});
});
