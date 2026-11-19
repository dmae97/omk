import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPatterns, isEnabledByOverrides } from "../src/core/package-resource-patterns.ts";

const home = join(process.cwd(), "fixture-home");
const file = join(home, "skills", "pdf", "SKILL.md");
afterEach(() => vi.unstubAllEnvs());

describe("Pi 1.2 tilde resource overrides", () => {
	it("expands the home directory in exclusion globs", () => {
		vi.stubEnv("HOME", home);
		expect(isEnabledByOverrides(file, ["!~/skills/*"], process.cwd())).toBe(false);
	});
	it("force-includes an exact home-relative skill directory", () => {
		vi.stubEnv("HOME", home);
		expect(isEnabledByOverrides(file, ["!**", "+~/skills/pdf"], process.cwd())).toBe(true);
	});
	it("force-excludes an exact home-relative skill directory", () => {
		vi.stubEnv("HOME", home);
		expect(isEnabledByOverrides(file, ["-~/skills/pdf"], process.cwd())).toBe(false);
	});
	it("applies home-relative plain includes and forced overrides in their original order", () => {
		vi.stubEnv("HOME", home);
		expect([...applyPatterns([file], ["~/skills/*"], process.cwd())]).toEqual([file]);
		expect([...applyPatterns([file], ["!**", "+~/skills/pdf", "-~/skills/pdf"], process.cwd())]).toEqual([]);
	});
});
