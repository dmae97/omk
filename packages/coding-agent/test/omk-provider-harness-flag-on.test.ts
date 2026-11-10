import { describe, expect, it } from "vitest";
import { isDeepSeekHarnessModel } from "../src/core/deepseek-harness.ts";
import { isOmkHarnessModel } from "../src/core/omk-provider/harness-marker.ts";
import { ref, registryWithOmk } from "./omk-provider-flag-on-lib.ts";
import { readGolden, withFlag } from "./omk-provider-golden-lib.ts";

const golden = readGolden<{ total: number; trueIds: string[] }>("harness.golden.json");

describe("deepseek harness with OMK_PROVIDER_OMK=1", () => {
	it("is on for OMK/coder and OMK/reasoner through the per-model marker", () => {
		withFlag("1", () => {
			expect(isDeepSeekHarnessModel({ provider: "OMK", id: "coder" })).toBe(true);
			expect(isDeepSeekHarnessModel({ provider: "OMK", id: "reasoner" })).toBe(true);
		});
	});

	it("is the marker, not the id regex, that turns it on (no OMK id looks like a deepseek id)", () => {
		withFlag("1", () => {
			expect(isOmkHarnessModel({ provider: "OMK", id: "coder" })).toBe(true);
			// Same id under another provider, other OMK ids, and a case-variant provider: no marker, no harness.
			for (const model of [
				{ provider: "other", id: "coder" },
				{ provider: "omk", id: "coder" },
				{ provider: "OMK", id: "unlisted" },
			]) {
				expect(isOmkHarnessModel(model)).toBe(false);
				expect(isDeepSeekHarnessModel(model)).toBe(false);
			}
		});
	});

	it("is off for the OMK models when the flag is not exactly 1", () => {
		for (const flag of [undefined, "0", "true", " 1 "]) {
			withFlag(flag, () => {
				expect(isDeepSeekHarnessModel({ provider: "OMK", id: "coder" })).toBe(false);
				expect(isDeepSeekHarnessModel({ provider: "OMK", id: "reasoner" })).toBe(false);
			});
		}
	});

	it("gives every other catalog model, including deepseek/*, the golden result from main", () => {
		withFlag("1", () => {
			const all = registryWithOmk().getAll();
			const rest = all.filter((m) => m.provider !== "OMK");
			expect(rest).toHaveLength(golden.total);
			const hits = rest.filter((m) => isDeepSeekHarnessModel({ provider: m.provider, id: m.id })).map(ref);
			expect(hits.sort()).toEqual(golden.trueIds);
			expect(hits).toContain("deepseek/deepseek-flash");
			const omkHits = all.filter((m) => m.provider === "OMK" && isDeepSeekHarnessModel(m)).map(ref);
			expect(omkHits).toEqual(["OMK/coder", "OMK/reasoner"]);
		});
	});
});
