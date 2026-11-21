import { describe, expect, it } from "vitest";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { getAutocompleteSourceTag } from "../src/modes/interactive/resource-description.ts";

const prefix = Reflect.get(InteractiveMode.prototype, "prefixAutocompleteDescription");
if (typeof prefix !== "function") throw new Error("missing autocomplete description adapter");
const context = (sourceTag?: string) => ({ getAutocompleteSourceTag: () => sourceTag });

describe("imported resource descriptions in OMK autocomplete", () => {
	it.each(["OMX", "OMO"])("omits decorative %s branding from the OMK completion description", (tag) => {
		const description = `[${tag}] Planning workflow`;
		const result: unknown = prefix.call(context("t"), description);
		expect(result).toBe("[t] Planning workflow");
	});
	it("omits the imported marker when no source-scope prefix is available", () => {
		const result: unknown = prefix.call(context(), "[OMX] Planning workflow");
		expect(result).toBe("Planning workflow");
	});
	it.each(["Native OMK workflow", "[preview] Experimental feature", "Mention OMX in ordinary prose"])(
		"preserves unrelated description %s",
		(description) => {
			const result: unknown = prefix.call(context("u"), description);
			expect(result).toBe(`[u] ${description}`);
		},
	);
	it("uses OMK for a marker-only description", () => {
		expect(prefix.call(context("u"), "[OMX]")).toBe("[u] OMK resource");
	});
	it("preserves absent descriptions and scope-only entries", () => {
		expect(prefix.call(context(), undefined)).toBeUndefined();
		expect(prefix.call(context("p"), undefined)).toBe("[p]");
	});
});

describe("autocomplete source tags", () => {
	it("keeps missing metadata unlabelled", () => {
		expect(getAutocompleteSourceTag()).toBeUndefined();
	});

	it.each([
		["user", "auto", "u"],
		["project", "local", "p"],
		["temporary", "cli", "t"],
		["user", " npm:@example/tool@1.0.0 ", "u:npm:@example/tool@1.0.0"],
		["project", "https://github.com/example/repo.git", "p:git:github.com/example/repo"],
		["temporary", "git:github.com/example/repo@main", "t:git:github.com/example/repo@main"],
		["project", "file:/tmp/custom", "p"],
		["user", "", "u"],
	] as const)("preserves the %s source tag for %s", (scope, source, expected) => {
		const info = createSyntheticSourceInfo("/tmp/resource", { scope, source });
		expect(getAutocompleteSourceTag(info)).toBe(expected);
	});

	it("keeps the interactive description adapter wired to the source tag formatter", () => {
		const sourceTag = Reflect.get(InteractiveMode.prototype, "getAutocompleteSourceTag");
		const info = createSyntheticSourceInfo("/tmp/resource", { scope: "project", source: "npm:example" });
		expect(prefix.call({ getAutocompleteSourceTag: sourceTag }, "[OMX] Planning workflow", info)).toBe(
			"[p:npm:example] Planning workflow",
		);
	});
});
