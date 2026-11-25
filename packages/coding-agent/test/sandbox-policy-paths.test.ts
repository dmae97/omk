import { describe, expect, it } from "vitest";
import {
	isInsideSandboxPath,
	matchesSandboxPath,
	normalizeSandboxPath,
} from "../src/core/sandbox/policy-paths.ts";

// These helpers use POSIX paths (path.resolve on win32 would backslash-normalize
// differently), so the suite is skipped on Windows.
describe.skipIf(process.platform === "win32")("sandbox policy-paths helpers", () => {
	describe("normalizeSandboxPath", () => {
		it("strips a trailing slash", () => {
			expect(normalizeSandboxPath("/tmp/a/")).toBe("/tmp/a");
		});

		it("keeps the filesystem root as '/'", () => {
			expect(normalizeSandboxPath("/")).toBe("/");
		});

		it("resolves '..' segments", () => {
			expect(normalizeSandboxPath("/tmp/a/../b")).toBe("/tmp/b");
		});
	});

	describe("isInsideSandboxPath", () => {
		it("treats an identical path as inside", () => {
			expect(isInsideSandboxPath("/tmp/a", "/tmp/a")).toBe(true);
		});

		it("treats a nested descendant as inside", () => {
			expect(isInsideSandboxPath("/tmp/a", "/tmp/a/b/c")).toBe(true);
		});

		it("rejects a sibling that shares a string prefix (/tmp/ab vs /tmp/a)", () => {
			expect(isInsideSandboxPath("/tmp/a", "/tmp/ab")).toBe(false);
		});

		it("treats everything as inside the filesystem root", () => {
			expect(isInsideSandboxPath("/", "/etc")).toBe(true);
		});
	});

	describe("matchesSandboxPath", () => {
		it("matches descendants for a '/**' pattern", () => {
			expect(matchesSandboxPath("/tmp/a/**", "/tmp/a/x/y")).toBe(true);
		});

		it("treats a '/*' pattern as a prefix match too", () => {
			expect(matchesSandboxPath("/tmp/a/*", "/tmp/a/x/y")).toBe(true);
		});

		it("does not match a sibling that shares a string prefix", () => {
			expect(matchesSandboxPath("/tmp/a", "/tmp/ab")).toBe(false);
		});
	});
});