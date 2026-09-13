import { describe, expect, it } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

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
