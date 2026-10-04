import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
	classifyLayout,
	isRailLayout,
	LAYOUT_BREAKPOINTS,
	type LayoutClass,
	pinnedRailNotice,
	RAIL_MIN_ROWS,
	railFits,
} from "../src/modes/interactive/layout-class.ts";

const RANK: Readonly<Record<LayoutClass, number>> = { xs: 0, sm: 1, md: 2, lg: 3 };

/** Dense integers around every breakpoint plus the whole finite double range. */
const finiteNumber = fc.oneof(fc.integer({ min: -20, max: 260 }), fc.double({ noNaN: true, noDefaultInfinity: true }));
/** Any double, including NaN and ±Infinity (malformed terminal sizes). */
const anyNumber = fc.oneof(fc.integer({ min: -20, max: 260 }), fc.double());

describe("classifyLayout", () => {
	test.each([
		[0, "xs"],
		[79, "xs"],
		[80, "sm"],
		[119, "sm"],
		[119.5, "sm"],
		[120, "md"],
		[159, "md"],
		[160, "lg"],
		[400, "lg"],
	] as const)("%s columns -> %s", (columns, expected) => {
		expect(classifyLayout(columns)).toBe(expected);
	});

	test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
		"malformed width %s fails closed to xs",
		(columns) => {
			expect(classifyLayout(columns)).toBe("xs");
		},
	);

	test("exported breakpoints are the thresholds the classifier uses", () => {
		expect(LAYOUT_BREAKPOINTS).toEqual({ sm: 80, md: 120, lg: 160 });
		expect(classifyLayout(LAYOUT_BREAKPOINTS.sm)).toBe("sm");
		expect(classifyLayout(LAYOUT_BREAKPOINTS.md)).toBe("md");
		expect(classifyLayout(LAYOUT_BREAKPOINTS.lg)).toBe("lg");
	});

	test("class rank is monotone non-decreasing in finite columns", () => {
		fc.assert(
			fc.property(finiteNumber, finiteNumber, (a, b) => {
				const [narrow, wide] = a <= b ? [a, b] : [b, a];
				expect(RANK[classifyLayout(narrow)]).toBeLessThanOrEqual(RANK[classifyLayout(wide)]);
			}),
		);
	});
});

describe("isRailLayout", () => {
	test.each([
		["xs", false],
		["sm", false],
		["md", true],
		["lg", true],
	] as const)("%s -> %s", (layout, expected) => {
		expect(isRailLayout(layout)).toBe(expected);
	});
});

describe("railFits", () => {
	test("rows omitted: the columns-only decision", () => {
		expect(railFits(119)).toBe(false);
		expect(railFits(120)).toBe(true);
	});

	test.each([
		[120, 15, false],
		[120, 16, true],
		[200, Number.NaN, false],
		[200, Number.POSITIVE_INFINITY, false],
	] as const)("railFits(%s, %s) -> %s", (columns, rows, expected) => {
		expect(railFits(columns, rows)).toBe(expected);
	});

	test("RAIL_MIN_ROWS is the row threshold the gate uses", () => {
		expect(RAIL_MIN_ROWS).toBe(16);
		expect(railFits(LAYOUT_BREAKPOINTS.md, RAIL_MIN_ROWS - 1)).toBe(false);
		expect(railFits(LAYOUT_BREAKPOINTS.md, RAIL_MIN_ROWS)).toBe(true);
	});

	test("without rows it matches the spec (finite and at least 120 columns) for any double", () => {
		fc.assert(
			fc.property(anyNumber, (columns) => {
				expect(railFits(columns)).toBe(Number.isFinite(columns) && columns >= 120);
			}),
		);
	});

	test("a row count can veto a rail but never grant one", () => {
		fc.assert(
			fc.property(anyNumber, anyNumber, (columns, rows) => {
				expect(railFits(columns, rows) && !railFits(columns)).toBe(false);
			}),
		);
	});
});

describe("pinnedRailNotice", () => {
	const NOTICE = "Status sidebar pinned; it shows at 120+ columns and 16+ rows.";

	test.each([
		[119, 40, NOTICE],
		[120, 15, NOTICE],
		[120, 16, undefined],
		[Number.NaN, 40, NOTICE],
		[160, Number.NaN, NOTICE],
	] as const)("pinnedRailNotice(%s, %s) -> %s", (columns, rows, expected) => {
		expect(pinnedRailNotice(columns, rows)).toBe(expected);
	});

	test("a notice appears exactly when the rail cannot show, for any doubles", () => {
		fc.assert(
			fc.property(anyNumber, anyNumber, (columns, rows) => {
				const fits = Number.isFinite(columns) && columns >= 120 && Number.isFinite(rows) && rows >= 16;
				expect(pinnedRailNotice(columns, rows)).toBe(fits ? undefined : NOTICE);
			}),
		);
	});
});
