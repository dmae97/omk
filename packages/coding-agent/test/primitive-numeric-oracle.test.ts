import { expect, test } from "vitest";
import { clopperPearsonUpperBound } from "../src/metacognition/risk.ts";
import oracle from "./fixtures/primitive-numeric-oracle.json";

// Fixed SciPy beta.isf values: no Python dependency or network call during tests.
for (const { k, n, alpha, upper } of oracle.cases) {
	test(`independent CP oracle: k=${k}, n=${n}, alpha=${alpha}`, () => {
		const actual = clopperPearsonUpperBound(k, n, alpha);
		expect(Number.isFinite(actual)).toBe(true);
		expect(actual).toBeGreaterThanOrEqual(0);
		expect(actual).toBeLessThanOrEqual(1);
		expect(Math.abs(actual - upper)).toBeLessThanOrEqual(
			oracle.absoluteTolerance + oracle.relativeTolerance * Math.abs(upper),
		);
	});
}
