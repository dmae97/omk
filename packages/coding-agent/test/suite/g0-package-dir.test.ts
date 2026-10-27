import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createG0PackageDir } from "./g0-package-dir.ts";

describe("G0 package dir realpath assert", () => {
	const dirs: string[] = [];
	const makeDir = () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-g0-test-"));
		dirs.push(dir);
		return dir;
	};
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("passes when the symlink resolves to the checkout and cleanup removes the temp dir", () => {
		const root = makeDir();
		const pkg = createG0PackageDir(root);
		expect(realpathSync(pkg.packageDir)).toBe(realpathSync(root));
		expect(pkg.linkDir).toMatch(/omk-g0-[A-Za-z0-9]{6}$/);
		pkg.cleanup();
		expect(existsSync(pkg.linkDir)).toBe(false);
	});

	it("throws and removes the temp dir when the symlink points at another checkout", () => {
		const root = makeDir();
		const other = makeDir();
		const before = new Set(readdirSync(tmpdir()) as string[]);
		expect(() => createG0PackageDir(root, other)).toThrow(/does not resolve to this checkout/);
		const leaked = (readdirSync(tmpdir()) as string[]).filter(
			(name) => !before.has(name) && /^omk-g0-[A-Za-z0-9]{6}$/.test(name),
		);
		expect(leaked).toEqual([]);
	});
});
