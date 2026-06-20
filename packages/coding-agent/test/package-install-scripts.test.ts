import { describe, expect, it } from "vitest";
import {
	buildGitDependencyInstallArgs,
	buildNpmInstallArgs,
	isGitInstallAllowed,
	isNpmInstallAllowed,
} from "../src/core/package-manager.ts";

describe("managed package install script suppression", () => {
	it("adds --ignore-scripts to npm installs while preserving existing flags", () => {
		const args = buildNpmInstallArgs("npm", ["pkg"], "/root");

		expect(args).toContain("install");
		expect(args).toContain("pkg");
		expect(args).toContain("--prefix");
		expect(args).toContain("/root");
		expect(args).toContain("--legacy-peer-deps");
		expect(args).toContain("--ignore-scripts");
	});

	it("adds --ignore-scripts to pnpm installs while preserving existing config flags", () => {
		const args = buildNpmInstallArgs("pnpm", ["pkg"], "/root");

		expect(args).toContain("install");
		expect(args).toContain("pkg");
		expect(args).toContain("--prefix");
		expect(args).toContain("/root");
		expect(args).toContain("--config.auto-install-peers=false");
		expect(args).toContain("--config.strict-peer-dependencies=false");
		expect(args).toContain("--config.strict-dep-builds=false");
		expect(args).toContain("--ignore-scripts");
	});

	it("adds --ignore-scripts to bun installs while preserving existing flags", () => {
		const args = buildNpmInstallArgs("bun", ["pkg"], "/root");

		expect(args).toContain("install");
		expect(args).toContain("pkg");
		expect(args).toContain("--cwd");
		expect(args).toContain("/root");
		expect(args).toContain("--omit=peer");
		expect(args).toContain("--ignore-scripts");
	});

	it("adds --ignore-scripts to git dependency installs", () => {
		expect(buildGitDependencyInstallArgs(true)).toEqual(["install", "--ignore-scripts"]);
		expect(buildGitDependencyInstallArgs(false)).toEqual(["install", "--omit=dev", "--ignore-scripts"]);
	});
});

describe("opt-in allowScripts builders", () => {
	it("keeps byte-identical default args when allowScripts is omitted or false", () => {
		expect(buildNpmInstallArgs("npm", ["pkg"], "/root", false)).toEqual(buildNpmInstallArgs("npm", ["pkg"], "/root"));
		expect(buildNpmInstallArgs("pnpm", ["pkg"], "/root", false)).toEqual(
			buildNpmInstallArgs("pnpm", ["pkg"], "/root"),
		);
		expect(buildNpmInstallArgs("bun", ["pkg"], "/root", false)).toEqual(buildNpmInstallArgs("bun", ["pkg"], "/root"));
		expect(buildGitDependencyInstallArgs(true, false)).toEqual(buildGitDependencyInstallArgs(true));
		expect(buildGitDependencyInstallArgs(false, false)).toEqual(buildGitDependencyInstallArgs(false));
	});

	it("omits --ignore-scripts for npm when allowScripts is true while keeping other flags", () => {
		const args = buildNpmInstallArgs("npm", ["pkg"], "/root", true);

		expect(args).not.toContain("--ignore-scripts");
		expect(args).toContain("install");
		expect(args).toContain("pkg");
		expect(args).toContain("--prefix");
		expect(args).toContain("/root");
		expect(args).toContain("--legacy-peer-deps");
	});

	it("omits --ignore-scripts for pnpm when allowScripts is true while keeping config flags", () => {
		const args = buildNpmInstallArgs("pnpm", ["pkg"], "/root", true);

		expect(args).not.toContain("--ignore-scripts");
		expect(args).toContain("--config.auto-install-peers=false");
		expect(args).toContain("--config.strict-peer-dependencies=false");
		expect(args).toContain("--config.strict-dep-builds=false");
	});

	it("omits --ignore-scripts for bun when allowScripts is true while keeping other flags", () => {
		const args = buildNpmInstallArgs("bun", ["pkg"], "/root", true);

		expect(args).not.toContain("--ignore-scripts");
		expect(args).toContain("--cwd");
		expect(args).toContain("--omit=peer");
	});

	it("omits --ignore-scripts for git dependency installs when allowScripts is true", () => {
		expect(buildGitDependencyInstallArgs(true, true)).toEqual(["install"]);
		expect(buildGitDependencyInstallArgs(false, true)).toEqual(["install", "--omit=dev"]);
	});
});

describe("exact-match install allowlist membership", () => {
	it("returns false for empty specs regardless of allowlist", () => {
		expect(isNpmInstallAllowed([], ["npm:pkg"])).toBe(false);
	});

	it("returns false when the allowlist is empty (fail-closed default)", () => {
		expect(isNpmInstallAllowed(["pkg"], [])).toBe(false);
	});

	it("allows a single spec listed by identity", () => {
		expect(isNpmInstallAllowed(["pkg"], ["npm:pkg"])).toBe(true);
		expect(isNpmInstallAllowed(["@scope/pkg"], ["npm:@scope/pkg"])).toBe(true);
	});

	it("allows a pinned spec listed by full spec or by identity", () => {
		expect(isNpmInstallAllowed(["pkg@1.2.3"], ["npm:pkg@1.2.3"])).toBe(true);
		expect(isNpmInstallAllowed(["pkg@1.2.3"], ["npm:pkg"])).toBe(true);
	});

	it("requires every spec to be listed (mixed install stays blocked)", () => {
		expect(isNpmInstallAllowed(["a", "b"], ["npm:a", "npm:b"])).toBe(true);
		expect(isNpmInstallAllowed(["a", "b"], ["npm:a"])).toBe(false);
	});

	it("never treats glob-like or override-prefixed entries as wildcards", () => {
		expect(isNpmInstallAllowed(["pkg"], ["npm:*"])).toBe(false);
		expect(isNpmInstallAllowed(["pkg"], ["*"])).toBe(false);
		expect(isNpmInstallAllowed(["pkg"], ["!npm:pkg"])).toBe(false);
	});

	it("matches git sources by identity and by pinned spec", () => {
		expect(isGitInstallAllowed({ host: "github.com", path: "org/repo" }, ["git:github.com/org/repo"])).toBe(true);
		expect(
			isGitInstallAllowed({ host: "github.com", path: "org/repo", ref: "v1" }, ["git:github.com/org/repo"]),
		).toBe(true);
		expect(
			isGitInstallAllowed({ host: "github.com", path: "org/repo", ref: "v1" }, ["git:github.com/org/repo@v1"]),
		).toBe(true);
		expect(isGitInstallAllowed({ host: "github.com", path: "org/repo" }, [])).toBe(false);
		expect(isGitInstallAllowed({ host: "github.com", path: "org/repo" }, ["git:github.com/org/other"])).toBe(false);
	});
});
