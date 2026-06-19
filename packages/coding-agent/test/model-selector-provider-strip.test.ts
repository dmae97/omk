import { describe, expect, it } from "vitest";
import {
	fitProviderStrip,
	type ProviderStripLayout,
} from "../src/modes/interactive/components/model-selector-state.ts";
import { checkProperty, type Rng } from "./helpers/property.ts";

const SEP = 3; // " | "
const ELL = 1; // "…"

// Independent mirror of the rendered strip width (kept out of the production
// module so the property check is not a tautology).
// Segment model: tabs and ellipses are all segments joined by SEP, so each
// ellipsis costs ELL plus a separator. Mirrors providerStripWidth().
function renderedWidth(layout: ProviderStripLayout, widths: readonly number[]): number {
	const tabs = layout.indices.length;
	if (tabs === 0) return 0;
	let tabsTotal = 0;
	for (const i of layout.indices) tabsTotal += widths[i ?? 0] ?? 0;
	const ellipses = (layout.ellipsisAfterFirst ? 1 : 0) + (layout.trailingEllipsis ? 1 : 0);
	const segments = tabs + ellipses;
	return tabsTotal + ELL * ellipses + SEP * (segments - 1);
}

function mandatoryWidth(widths: readonly number[], active: number): number {
	if (active === 0) {
		const trailing = widths.length - 1 > 0 ? 1 : 0;
		const segments = 1 + trailing;
		return (widths[0] ?? 0) + ELL * trailing + SEP * (segments - 1);
	}
	const gap = active > 1 ? 1 : 0;
	const trailing = active < widths.length - 1 ? 1 : 0;
	const ellipses = gap + trailing;
	const segments = 2 + ellipses;
	return (widths[0] ?? 0) + (widths[active] ?? 0) + ELL * ellipses + SEP * (segments - 1);
}

describe("fitProviderStrip", () => {
	it("shows every tab when the full strip fits", () => {
		const widths = [3, 9, 6, 4]; // all, anthropic, openai, kimi (visible widths)
		const layout = fitProviderStrip(widths, 2, 100, SEP, ELL);
		expect(layout.indices).toEqual([0, 1, 2, 3]);
		expect(layout.ellipsisAfterFirst).toBe(false);
		expect(layout.trailingEllipsis).toBe(false);
	});

	it("always keeps the all anchor and the active tab when space is tight", () => {
		const widths = [3, 9, 6, 7, 8, 5];
		const layout = fitProviderStrip(widths, 4, 22, SEP, ELL);
		expect(layout.indices[0]).toBe(0); // "all" anchor
		expect(layout.indices).toContain(4); // active
		expect(renderedWidth(layout, widths)).toBeLessThanOrEqual(22);
	});

	it("marks a hidden middle with a leading ellipsis", () => {
		const widths = [3, 9, 9, 9, 9, 9];
		const layout = fitProviderStrip(widths, 5, 20, SEP, ELL);
		expect(layout.indices[0]).toBe(0);
		expect(layout.indices).toContain(5);
		// There is a gap between index 0 and the active window.
		expect(layout.ellipsisAfterFirst).toBe(true);
		expect(renderedWidth(layout, widths)).toBeLessThanOrEqual(20);
	});

	it("grows a contiguous window from the active=all anchor", () => {
		const widths = [3, 9, 6, 7, 8, 5];
		const layout = fitProviderStrip(widths, 0, 18, SEP, ELL);
		expect(layout.indices[0]).toBe(0);
		// Active is 0 so the window is contiguous from the start (no leading gap).
		expect(layout.ellipsisAfterFirst).toBe(false);
		expect(layout.trailingEllipsis).toBe(true);
		expect(renderedWidth(layout, widths)).toBeLessThanOrEqual(18);
	});

	it("returns nothing for an empty strip", () => {
		expect(fitProviderStrip([], 0, 50, SEP, ELL)).toEqual({
			indices: [],
			ellipsisAfterFirst: false,
			trailingEllipsis: false,
		});
	});

	it("holds invariants across random strips (seeded property)", () => {
		interface Case {
			widths: number[];
			active: number;
			budget: number;
		}
		const generate = (rng: Rng): Case => {
			const n = 1 + rng.nextInt(14);
			const widths = Array.from({ length: n }, () => 1 + rng.nextInt(20));
			const active = rng.nextInt(n);
			const full = widths.reduce((a, w) => a + w, 0) + SEP * (n - 1);
			const min = mandatoryWidth(widths, active);
			// Pick a budget at or above the mandatory tabs so the fit invariant applies.
			const budget = min + rng.nextInt(Math.max(1, full - min + 6));
			return { widths, active, budget };
		};
		checkProperty<Case>({
			seeds: [3, 14, 159, 2653, 58979],
			numRuns: 40,
			generate,
			predicate: ({ widths, active, budget }) => {
				const layout = fitProviderStrip(widths, active, budget, SEP, ELL);
				// fits budget
				expect(renderedWidth(layout, widths)).toBeLessThanOrEqual(budget);
				// mandatory tabs visible
				expect(layout.indices[0]).toBe(0);
				expect(layout.indices).toContain(active);
				// sorted + unique
				const sorted = [...layout.indices].sort((a, b) => a - b);
				expect(layout.indices).toEqual(sorted);
				expect(new Set(layout.indices).size).toBe(layout.indices.length);
				// ellipsis flags consistent with the chosen window
				const last = layout.indices[layout.indices.length - 1] ?? 0;
				expect(layout.trailingEllipsis).toBe(last < widths.length - 1);
			},
			shrink: (value) => {
				// Shrink by dropping trailing tabs (keeping active in range) to find
				// a minimal failing strip.
				const out: Case[] = [];
				if (value.widths.length > 1) {
					const widths = value.widths.slice(0, -1);
					out.push({ widths, active: Math.min(value.active, widths.length - 1), budget: value.budget });
				}
				if (value.budget > 1) out.push({ ...value, budget: value.budget - 1 });
				return out;
			},
			format: (c) => `widths=[${c.widths.join(",")}] active=${c.active} budget=${c.budget}`,
		});
	});
});
