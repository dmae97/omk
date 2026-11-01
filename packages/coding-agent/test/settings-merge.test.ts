import { describe, expect, it } from "vitest";
import { deepMergeSettings, mergeLayeredSettings } from "../src/core/settings-merge.ts";

describe("deepMergeSettings", () => {
	it("lets override primitives win", () => {
		expect(deepMergeSettings<Record<string, unknown>>({ k: 1 }, { k: 2 })).toEqual({ k: 2 });
	});

	it("keeps base keys the override does not mention and adds new ones", () => {
		expect(deepMergeSettings<Record<string, unknown>>({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
	});

	it("skips undefined overrides so the base value stays", () => {
		expect(deepMergeSettings<Record<string, unknown>>({ k: 1 }, { k: undefined })).toEqual({ k: 1 });
	});

	it("replaces the base value with a null override", () => {
		expect(deepMergeSettings<Record<string, unknown>>({ k: 1 }, { k: null })).toEqual({ k: null });
	});

	it("replaces arrays instead of concatenating them", () => {
		expect(deepMergeSettings<Record<string, unknown>>({ arr: [1, 2] }, { arr: [3] })).toEqual({ arr: [3] });
	});

	it("lets an array override replace an object base, and the reverse", () => {
		expect(deepMergeSettings<Record<string, unknown>>({ k: { x: 1 } }, { k: [1] })).toEqual({ k: [1] });
		expect(deepMergeSettings<Record<string, unknown>>({ k: [1] }, { k: { x: 1 } })).toEqual({ k: { x: 1 } });
	});

	it("merges nested objects one level deep", () => {
		const result = deepMergeSettings<Record<string, unknown>>({ n: { x: 1 } }, { n: { y: 2 } });
		expect(result).toEqual({ n: { x: 1, y: 2 } });
	});

	it("lets nested override values win over nested base values", () => {
		const result = deepMergeSettings<Record<string, unknown>>({ n: { x: 1, y: 1 } }, { n: { y: 2 } });
		expect(result).toEqual({ n: { x: 1, y: 2 } });
	});

	// Pins today's behavior: the merge is shallow below the first level, even though the
	// doc comment on deepMergeSettings says "merge recursively".
	it("replaces objects nested more than one level deep instead of merging them", () => {
		const result = deepMergeSettings<Record<string, unknown>>({ n: { y: { deep: 1 } } }, { n: { y: { other: 2 } } });
		expect(result).toEqual({ n: { y: { other: 2 } } });
	});

	it("does not mutate its inputs", () => {
		const base = { a: 1, n: { x: 1 }, arr: [1] };
		const overrides = { a: 2, n: { y: 2 }, arr: [2] };
		const baseCopy = structuredClone(base);
		const overridesCopy = structuredClone(overrides);

		const result = deepMergeSettings<Record<string, unknown>>(base, overrides);

		expect(base).toEqual(baseCopy);
		expect(overrides).toEqual(overridesCopy);
		expect(result).not.toBe(base);
		expect(result.n).not.toBe(base.n);
	});
});

describe("mergeLayeredSettings", () => {
	const global = { packages: ["npm:global-pkg"], theme: "dark", shellPath: "/bin/zsh" };
	const project = { packages: ["npm:project-pkg"], theme: "light", extensions: ["./ext.ts"] };

	it("keeps the global code-loading keys and applies the project's other keys while the trust gate is closed", () => {
		const result = mergeLayeredSettings<Record<string, unknown>>(global, project, true);

		expect(result.packages).toEqual(["npm:global-pkg"]);
		expect(result.shellPath).toBe("/bin/zsh");
		expect(result.extensions).toBeUndefined();
		expect(result.theme).toBe("light");
	});

	it("lets the project's code-loading keys win once the trust gate is open", () => {
		const result = mergeLayeredSettings<Record<string, unknown>>(global, project, false);

		expect(result.packages).toEqual(["npm:project-pkg"]);
		expect(result.extensions).toEqual(["./ext.ts"]);
		expect(result.shellPath).toBe("/bin/zsh");
		expect(result.theme).toBe("light");
	});

	it("does not mutate the project settings when withholding code", () => {
		const projectCopy = structuredClone(project);

		mergeLayeredSettings<Record<string, unknown>>(global, project, true);

		expect(project).toEqual(projectCopy);
	});
});
