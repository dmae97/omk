import { describe, expect, it } from "vitest";
import { isDeepSeekHarnessModel } from "../src/core/deepseek-harness.ts";
import {
	createCatalogRegistry,
	FLAG_OFF_VARIANTS,
	GOLDEN_BASE_SHA,
	goldenOrUpdate,
	sha256,
	variantLabel,
	withFlag,
} from "./omk-provider-golden-lib.ts";

interface HarnessGolden {
	baseSha: string;
	total: number;
	trueCount: number;
	/** `provider/id` of every catalog model the harness claims, sorted. */
	trueIds: string[];
	/** Digest of the full sorted `provider/id=0|1` table, so a flip in either direction is caught. */
	sha256: string;
}

function classifyCatalog(flag: string | undefined): HarnessGolden {
	return withFlag(flag, () => {
		const rows = createCatalogRegistry()
			.getAll()
			.map((m) => ({
				ref: `${m.provider}/${m.id}`,
				hit: isDeepSeekHarnessModel({ provider: m.provider, id: m.id }),
			}))
			.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
		const trueIds = rows.filter((r) => r.hit).map((r) => r.ref);
		return {
			baseSha: GOLDEN_BASE_SHA,
			total: rows.length,
			trueCount: trueIds.length,
			trueIds,
			sha256: sha256(rows.map((r) => `${r.ref}=${r.hit ? 1 : 0}`).join("\n")),
		};
	});
}

describe("OMK provider flags-off: isDeepSeekHarnessModel over the whole catalog", () => {
	const golden = goldenOrUpdate("harness.golden.json", classifyCatalog(undefined));

	it("claims every native deepseek model and no OMK model", () => {
		expect(golden.baseSha).toBe(GOLDEN_BASE_SHA);
		for (const id of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"]) {
			expect(golden.trueIds).toContain(`deepseek/${id}`);
		}
		expect(golden.trueIds.filter((ref) => ref.startsWith("OMK/"))).toEqual([]);
		expect(golden.trueCount).toBeGreaterThan(3);
	});

	it.each(FLAG_OFF_VARIANTS.map((value) => [variantLabel(value), value] as const))(
		"OMK_PROVIDER_OMK=%s classifies every catalog model as main does",
		(_label, value) => {
			const current = classifyCatalog(value);
			expect(current.trueIds).toEqual(golden.trueIds);
			expect(current.total).toBe(golden.total);
			expect(current.sha256).toBe(golden.sha256);
		},
	);

	it.each(FLAG_OFF_VARIANTS.map((value) => [variantLabel(value), value] as const))(
		"OMK_PROVIDER_OMK=%s: neutral OMK ids are not harness models while the flag is off",
		(_label, value) => {
			withFlag(value, () => {
				expect(isDeepSeekHarnessModel({ provider: "OMK", id: "coder" })).toBe(false);
				expect(isDeepSeekHarnessModel({ provider: "OMK", id: "reasoner" })).toBe(false);
				// Identity checks that must never change: provider match and id-pattern match stay as on main.
				expect(isDeepSeekHarnessModel({ provider: "deepseek", id: "anything" })).toBe(true);
				expect(isDeepSeekHarnessModel({ provider: "deepseek-proxy", id: "gpt-5.5" })).toBe(false);
			});
		},
	);
});
