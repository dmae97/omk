import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dedupeGalleryEntries, normalizeRepoIdentity, trialIdentity } from "../src/core/package-gallery-identity.ts";

describe("normalizeRepoIdentity", () => {
	it("trims whitespace and drops a trailing .git", () => {
		expect(normalizeRepoIdentity("  https://github.com/a/b.git ")).toBe("https://github.com/a/b");
	});

	it("matches .git case-insensitively", () => {
		expect(normalizeRepoIdentity("a/b.GIT")).toBe("a/b");
	});

	it("removes only one trailing .git", () => {
		expect(normalizeRepoIdentity("a/b.git.git")).toBe("a/b.git");
	});

	it("leaves a repo without .git unchanged", () => {
		expect(normalizeRepoIdentity("a/b")).toBe("a/b");
	});

	it("does not strip .git that is not at the end", () => {
		expect(normalizeRepoIdentity("a/b.github")).toBe("a/b.github");
	});
});

describe("trialIdentity", () => {
	it("prefixes npm packages with npm: and ignores version", () => {
		expect(trialIdentity({ kind: "npm", name: "@scope/pkg", version: "1.2.3" })).toBe("npm:@scope/pkg");
	});

	it("prefixes git packages with git: and normalizes the repo", () => {
		expect(trialIdentity({ kind: "git", repo: " https://github.com/a/b.git ", ref: "main" })).toBe(
			"git:https://github.com/a/b",
		);
	});

	it("resolves a relative local path against process.cwd()", () => {
		expect(trialIdentity({ kind: "local", path: "pkgs/demo" })).toBe(`local:${resolve(process.cwd(), "pkgs/demo")}`);
	});

	it("keeps an absolute local path", () => {
		const abs = resolve("/tmp/demo-pkg");
		expect(trialIdentity({ kind: "local", path: abs })).toBe(`local:${abs}`);
	});
});

describe("dedupeGalleryEntries", () => {
	it("keeps the first entry when git repos collide after normalization", () => {
		const first = { id: 1, identity: { kind: "git", repo: "a/b" } as const };
		const second = { id: 2, identity: { kind: "git", repo: "a/b.git" } as const };
		expect(dedupeGalleryEntries([first, second])).toEqual([first]);
	});

	it("keeps entries whose kind prefix differs", () => {
		const git = { id: 1, identity: { kind: "git", repo: "a/b" } as const };
		const npm = { id: 2, identity: { kind: "npm", name: "a/b" } as const };
		expect(dedupeGalleryEntries([git, npm])).toEqual([git, npm]);
	});
});
