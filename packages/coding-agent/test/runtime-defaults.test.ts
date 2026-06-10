import { describe, expect, test } from "vitest";
import {
	resolveAmbientResourceFlags,
	shouldIncludeProjectDeprecationWarnings,
	shouldUseOmkAmbientIsolation,
} from "../src/core/runtime-defaults.ts";

describe("runtime defaults", () => {
	test("omk enables global ambient resources by default without project deprecation warnings", () => {
		expect(shouldUseOmkAmbientIsolation("omk")).toBe(false);
		expect(resolveAmbientResourceFlags("omk", {})).toEqual({
			noSkills: false,
			noPromptTemplates: false,
			noContextFiles: false,
		});
		expect(shouldIncludeProjectDeprecationWarnings("omk")).toBe(false);
	});

	test("pi keeps ambient resource discovery by default", () => {
		expect(shouldUseOmkAmbientIsolation("pi")).toBe(false);
		expect(resolveAmbientResourceFlags("pi", {})).toEqual({
			noSkills: false,
			noPromptTemplates: false,
			noContextFiles: false,
		});
		expect(shouldIncludeProjectDeprecationWarnings("pi")).toBe(true);
	});

	test("explicit flags override omk isolation defaults", () => {
		expect(
			resolveAmbientResourceFlags("omk", {
				noSkills: false,
				noPromptTemplates: false,
				noContextFiles: false,
			}),
		).toEqual({
			noSkills: false,
			noPromptTemplates: false,
			noContextFiles: false,
		});
	});
});
