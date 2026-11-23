import { describe, expect, it } from "vitest";
import {
	canonicalizeLexicalPath,
	collapsePathSegments,
	joinPathSegments,
	normalizePathSlashes,
	pathSegmentsOverlap,
} from "../src/path-segments.ts";

describe("normalizePathSlashes", () => {
	it("converts backslashes to forward slashes", () => {
		expect(normalizePathSlashes("a\\b\\c")).toBe("a/b/c");
	});
});

describe("joinPathSegments", () => {
	it("joins cwd and relative with a single slash", () => {
		expect(joinPathSegments("/repo/", "src/a.ts")).toBe("/repo/src/a.ts");
	});

	it("returns the base when relative is empty", () => {
		expect(joinPathSegments("/repo", "")).toBe("/repo");
	});

	it("returns the root when both parts are empty", () => {
		expect(joinPathSegments("", "")).toBe("/");
	});

	it("returns an absolute relative path as-is after slash normalization", () => {
		expect(joinPathSegments("/repo", "/etc/x")).toBe("/etc/x");
		expect(joinPathSegments("/repo", "C:\\x")).toBe("C:/x");
	});
});

describe("collapsePathSegments", () => {
	it("collapses . and .. segments", () => {
		expect(collapsePathSegments(["a", ".", "b", ".."])).toEqual(["a"]);
	});

	it("returns null when .. escapes above the root", () => {
		expect(collapsePathSegments([".."])).toBeNull();
	});
});

describe("canonicalizeLexicalPath", () => {
	it("collapses . and .. in POSIX paths", () => {
		expect(canonicalizeLexicalPath("/a/./b/../c")).toBe("/a/c");
	});

	it("returns null when a relative path escapes above the root", () => {
		expect(canonicalizeLexicalPath("../x")).toBeNull();
	});

	it("clamps drive-root traversal at the drive root", () => {
		expect(canonicalizeLexicalPath("C:\\a\\..\\..\\b")).toBe("C:/b");
	});

	it("returns null for drive-relative and UNC forms", () => {
		expect(canonicalizeLexicalPath("C:foo")).toBeNull();
		expect(canonicalizeLexicalPath("//server/share")).toBeNull();
	});
});

describe("pathSegmentsOverlap", () => {
	it("returns false for sibling paths", () => {
		expect(pathSegmentsOverlap("src/a", "src/b")).toBe(false);
	});

	it("returns true when one path contains the other", () => {
		expect(pathSegmentsOverlap("src", "src/a.ts")).toBe(true);
	});

	it("compares segments case-insensitively", () => {
		expect(pathSegmentsOverlap("src/A.ts", "src/a.ts")).toBe(true);
	});

	it("returns false for different drives", () => {
		expect(pathSegmentsOverlap("C:/a", "D:/a")).toBe(false);
	});

	it("fails closed on root-escaping paths", () => {
		expect(pathSegmentsOverlap("../x", "y")).toBe(true);
	});
});
