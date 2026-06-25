import { describe, expect, it } from "vitest";

import { createObservationSnapshot } from "../examples/extensions/aside-computer-use/observation-snapshot.ts";
import type { Observation } from "../examples/extensions/aside-computer-use/types.ts";

const baseObservation: Observation = {
	url: "https://example.com/dashboard",
	title: "Dashboard",
	text: "Welcome back. Revenue is up.",
	dom: [
		{ selector: "#revenue", value: "$100" },
		{ selector: "#status", value: "Ready" },
	],
};

describe("aside observation snapshots", () => {
	it("creates deterministic ids and fingerprints from equivalent observations", () => {
		const reorderedObservation: Observation = {
			...baseObservation,
			dom: [...(baseObservation.dom ?? [])].reverse(),
		};

		const first = createObservationSnapshot(baseObservation);
		const second = createObservationSnapshot(reorderedObservation);

		expect(first.id).toBe(second.id);
		expect(first.fingerprint).toBe(second.fingerprint);
		expect(first.elements.map((element) => element.selector)).toEqual(["#revenue", "#status"]);
	});

	it("changes the fingerprint when observable evidence changes", () => {
		const first = createObservationSnapshot(baseObservation);
		const second = createObservationSnapshot({
			...baseObservation,
			text: "Welcome back. Revenue is down.",
		});

		expect(first.fingerprint).not.toBe(second.fingerprint);
		expect(first.id).not.toBe(second.id);
	});

	it("computes bounded quality fields and freshness from a previous snapshot", () => {
		const first = createObservationSnapshot(baseObservation);
		const unchanged = createObservationSnapshot(baseObservation, first);
		const changed = createObservationSnapshot(
			{
				...baseObservation,
				title: "Updated dashboard",
			},
			first,
		);

		for (const quality of [first.quality, unchanged.quality, changed.quality]) {
			expect(quality.parse).toBeGreaterThanOrEqual(0);
			expect(quality.parse).toBeLessThanOrEqual(1);
			expect(quality.freshness).toBeGreaterThanOrEqual(0);
			expect(quality.freshness).toBeLessThanOrEqual(1);
			expect(quality.elementCoverage).toBeGreaterThanOrEqual(0);
			expect(quality.elementCoverage).toBeLessThanOrEqual(1);
			expect(quality.evidenceCoverage).toBeGreaterThanOrEqual(0);
			expect(quality.evidenceCoverage).toBeLessThanOrEqual(1);
		}
		expect(first.quality.parse).toBe(1);
		expect(unchanged.quality.freshness).toBe(0);
		expect(changed.quality.freshness).toBe(1);
		expect(first.quality.elementCoverage).toBeGreaterThan(0);
		expect(first.quality.evidenceCoverage).toBe(1);
	});

	it("summarizes elements with stable per-element fingerprints", () => {
		const snapshot = createObservationSnapshot(baseObservation);
		const repeated = createObservationSnapshot(baseObservation);

		expect(snapshot.elements).toEqual(repeated.elements);
		expect(snapshot.elements[0]).toMatchObject({
			selector: "#revenue",
			value: "$100",
		});
		expect(snapshot.elements[0]?.fingerprint).toMatch(/^el_[a-f0-9]{16}$/u);
		expect(snapshot.textLength).toBe(baseObservation.text?.length);
	});
});
