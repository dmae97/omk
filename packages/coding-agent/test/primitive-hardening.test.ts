import { test } from "vitest";
import { checkTransitionCoverage, hardeningCases } from "./fixtures/primitive-hardening-cases.ts";

for (const item of hardeningCases) test(`${item.id}: ${item.purpose}`, item.run);
test("transition coverage and independently computed conflict invariants", () => {
	checkTransitionCoverage();
});
