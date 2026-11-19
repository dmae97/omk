import { describe, expect, it } from "vitest";
import { dialects, inventory, preservationHarness, runSelected } from "./fixtures/native-extension-harness.ts";

describe.each(dialects)("repository extension contract (%s)", (dialect) => {
	const harness = preservationHarness();
	const rows = inventory.entries.filter((row) => row.scope === "repository");
	for (const row of rows) {
		it(`${row.id} exact reviewed registry (not feature acceptance)`, async () => {
			await harness.load(row, dialect);
		});
		if (row.selected)
			it(`${row.id} selected deterministic behavior`, async () => {
				await runSelected(row, await harness.load(row, dialect), harness);
			});
	}
	it("retains every unexercised repository feature as explicitly UNVERIFIED", () => {
		expect(rows).toHaveLength(10);
		for (const row of rows)
			expect(row.unverified.every((item) => item.status === "UNVERIFIED" && item.reason.length > 0)).toBe(true);
	});
});
