import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compensatedSum } from "../src/core/performance-upgrade/anytime-bounds.ts";
import {
	MeasurementInputError,
	type MeasurementInputErrorCode,
} from "../src/core/performance-upgrade/measurement-trace.ts";
import { type CostBlock, costPerVerifiedCompletion } from "../src/core/performance-upgrade/verified-cost.ts";

// OMK_MATH_f46a8f6 B12 r2: C_verified = (sum_b sum_{a in attempts(b)} C_{b,a}) / (sum_b 1[verified(b)]).
// Every attempt of every block is paid for, verified or not; only independently verified blocks count
// as completions, and none means +Infinity. The literals below are hand calculations, not this module's
// output. Passing verification is not a proof of correctness: the module only does the arithmetic.

const MAX = Number.MAX_VALUE;
const NO_COMPLETION = Number.POSITIVE_INFINITY;

function block(blockId: string, attemptCosts: readonly number[], independentlyVerified: boolean): CostBlock {
	return { blockId, attemptCosts, independentlyVerified };
}

/** A block whose fields may hold values the type forbids, as parsed input can. */
function malformed(fields: Record<string, unknown>): CostBlock {
	return { blockId: "a", attemptCosts: [1], independentlyVerified: false, ...fields } as unknown as CostBlock;
}

/** Runs once, so a stateful input (a trap log, a counting getter) records a single call. */
function expectInputError(blocks: readonly CostBlock[], code: MeasurementInputErrorCode, field: string): void {
	let caught: unknown;
	try {
		costPerVerifiedCompletion(blocks);
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(MeasurementInputError);
	expect(caught).toMatchObject({ code, field });
}

/**
 * A proxy of target that logs every read trap it sees. Past 16 traps it throws, so an implementation
 * that copies or scans a huge array fails fast instead of hanging the run.
 */
function traced<T extends object>(target: T): { readonly proxy: T; readonly log: string[] } {
	const log: string[] = [];
	const note = (entry: string): void => {
		log.push(entry);
		if (log.length > 16) throw new Error(`trap budget exceeded: ${log.slice(0, 8).join(", ")}, ...`);
	};
	const proxy = new Proxy(target, {
		get(base, key, receiver) {
			note(`get ${String(key)}`);
			return Reflect.get(base, key, receiver);
		},
		has(base, key) {
			note(`has ${String(key)}`);
			return Reflect.has(base, key);
		},
		getOwnPropertyDescriptor(base, key) {
			note(`getOwnPropertyDescriptor ${String(key)}`);
			return Reflect.getOwnPropertyDescriptor(base, key);
		},
		ownKeys(base) {
			note("ownKeys");
			return Reflect.ownKeys(base);
		},
	});
	return { proxy, log };
}

describe("costPerVerifiedCompletion", () => {
	// b1 was retried (10, then 5) and verified, b2 was abandoned unverified, b3 was verified.
	const b1 = block("b1", [10, 5], true);
	const b2 = block("b2", [7], false);
	const b3 = block("b3", [3], true);

	it("pays for every attempt of every block and divides by the verified blocks", () => {
		// (10 + 5 + 7 + 3) / 2 = 12.5
		expect(costPerVerifiedCompletion([b1, b2, b3])).toEqual({
			blocks: 3,
			verifiedBlocks: 2,
			totalCost: 25,
			costPerVerified: 12.5,
		});
	});

	it("charges one more unverified block to the same verified completions", () => {
		// (25 + 5) / 2 = 15
		expect(costPerVerifiedCompletion([b1, b2, b3, block("b4", [5], false)])).toEqual({
			blocks: 4,
			verifiedBlocks: 2,
			totalCost: 30,
			costPerVerified: 15,
		});
	});

	it("is +Infinity, never NaN, when no block is independently verified", () => {
		expect(costPerVerifiedCompletion([b2, block("b5", [4, 1], false)])).toEqual({
			blocks: 2,
			verifiedBlocks: 0,
			totalCost: 12,
			costPerVerified: NO_COMPLETION,
		});
		// 0 / 0 must not leak out as NaN.
		const free = costPerVerifiedCompletion([block("free", [0], false), block("none", [], false)]);
		expect(free).toEqual({ blocks: 2, verifiedBlocks: 0, totalCost: 0, costPerVerified: NO_COMPLETION });
	});

	it("treats no blocks as no completion, not as an error", () => {
		expect(costPerVerifiedCompletion([])).toEqual({
			blocks: 0,
			verifiedBlocks: 0,
			totalCost: 0,
			costPerVerified: NO_COMPLETION,
		});
	});

	it("is exactly 0 when the verified work cost nothing", () => {
		expect(costPerVerifiedCompletion([block("z", [0], true)]).costPerVerified).toBe(0);
		// -0 is a valid cost (-0 >= 0); it must not leak a negative zero into the total.
		expect(costPerVerifiedCompletion([block("z", [0, -0], true), block("e", [], false)]).costPerVerified).toBe(0);
	});

	it("sums with Neumaier compensation, so small attempt costs survive a huge one", () => {
		const ones = Array.from({ length: 10 }, () => 1);
		// Premise: a plain running sum drops every 1 next to 1e16 (spacing 2), so this test can fail.
		expect([1e16, ...ones].reduce((sum, cost) => sum + cost, 0)).toBe(1e16);
		expect(costPerVerifiedCompletion([block("one", [1e16, ...ones], true)]).totalCost).toBe(10000000000000010);
		// The same total when the terms are spread over blocks.
		const spread = [block("big", [1e16], true), ...ones.map((cost, index) => block(`s${index}`, [cost], false))];
		expect(costPerVerifiedCompletion(spread).totalCost).toBe(10000000000000010);
	});

	it.each<[string, CostBlock[], MeasurementInputErrorCode, string]>([
		["a negative cost", [malformed({ attemptCosts: [1, -0.5] })], "invalid_number", "attemptCosts"],
		["a NaN cost", [malformed({ attemptCosts: [Number.NaN] })], "invalid_number", "attemptCosts"],
		["a +Infinity cost", [malformed({ attemptCosts: [NO_COMPLETION] })], "invalid_number", "attemptCosts"],
		["a -Infinity cost", [malformed({ attemptCosts: [-NO_COMPLETION] })], "invalid_number", "attemptCosts"],
		["a string cost", [malformed({ attemptCosts: ["5"] })], "invalid_number", "attemptCosts"],
		["a null cost", [malformed({ attemptCosts: [1, null] })], "invalid_number", "attemptCosts"],
		["an undefined cost", [malformed({ attemptCosts: [undefined] })], "invalid_number", "attemptCosts"],
		["a hole in attemptCosts", [malformed({ attemptCosts: new Array(2) })], "invalid_number", "attemptCosts"],
		["a bigint cost", [malformed({ attemptCosts: [5n] })], "invalid_number", "attemptCosts"],
		["attemptCosts that is a number", [malformed({ attemptCosts: 5 })], "invalid_number", "attemptCosts"],
		["attemptCosts that is a string", [malformed({ attemptCosts: "12" })], "invalid_number", "attemptCosts"],
		[
			"attemptCosts that is array-like",
			[malformed({ attemptCosts: { 0: 1, length: 1 } })],
			"invalid_number",
			"attemptCosts",
		],
		["attemptCosts that is null", [malformed({ attemptCosts: null })], "invalid_number", "attemptCosts"],
		["attemptCosts that is missing", [malformed({ attemptCosts: undefined })], "invalid_number", "attemptCosts"],
		["a numeric blockId", [malformed({ blockId: 7 })], "invalid_id", "blockId"],
		["a missing blockId", [malformed({ blockId: undefined })], "invalid_id", "blockId"],
		["a repeated blockId", [malformed({ blockId: "x" }), malformed({ blockId: "x" })], "duplicate_id", "blockId"],
		["the flag 'true'", [malformed({ independentlyVerified: "true" })], "invalid_flag", "independentlyVerified"],
		["the flag 1", [malformed({ independentlyVerified: 1 })], "invalid_flag", "independentlyVerified"],
		["a missing flag", [malformed({ independentlyVerified: undefined })], "invalid_flag", "independentlyVerified"],
		["a verified block with no attempts", [block("v", [], true)], "contradictory_record", "attemptCosts"],
		["a total that overflows", [block("big", [MAX, MAX], true)], "invalid_number", "totalCost"],
		[
			"a total that overflows across blocks",
			[block("x", [MAX], true), block("y", [MAX], false)],
			"invalid_number",
			"totalCost",
		],
	])("rejects %s", (_label, blocks, code, field) => {
		expectInputError(blocks, code, field);
	});

	it.each<[string, CostBlock[], MeasurementInputErrorCode, string]>([
		[
			"the id before the flag and the costs",
			[malformed({ blockId: 1, independentlyVerified: "x", attemptCosts: [-1] })],
			"invalid_id",
			"blockId",
		],
		[
			"a repeated id before a bad flag",
			[malformed({ blockId: "x" }), malformed({ blockId: "x", independentlyVerified: "x" })],
			"duplicate_id",
			"blockId",
		],
		[
			"the flag before the costs",
			[malformed({ independentlyVerified: "x", attemptCosts: [-1] })],
			"invalid_flag",
			"independentlyVerified",
		],
	])("checks %s inside one block", (_label, blocks, code, field) => {
		expectInputError(blocks, code, field);
	});

	it("throws for the first bad block in input order and decides overflow only after every block", () => {
		const badFlag = malformed({ blockId: "f", independentlyVerified: "yes" });
		const badId = malformed({ blockId: 7 });
		expectInputError([block("ok", [1], true), badFlag, badId], "invalid_flag", "independentlyVerified");
		expectInputError([block("ok", [1], true), badId, badFlag], "invalid_id", "blockId");
		// The total is a property of the whole input, so a bad block after the overflow is reported first.
		expectInputError([block("big", [MAX, MAX], true), badId], "invalid_id", "blockId");
	});

	it("reads each block field and each attempt cost once, so a getter cannot change a validated value", () => {
		const reads = new Map<string, number>();
		const shifting = (name: string, first: unknown, later: unknown) => () => {
			reads.set(name, (reads.get(name) ?? 0) + 1);
			return reads.get(name) === 1 ? first : later;
		};
		const costs = [0, 0, 3];
		Object.defineProperty(costs, 0, { get: shifting("cost0", 10, -1), enumerable: true });
		Object.defineProperty(costs, 1, { get: shifting("cost1", 5, Number.NaN), enumerable: true });
		const watched = Object.defineProperties({} as CostBlock, {
			blockId: { get: shifting("blockId", "watched", 7), enumerable: true },
			attemptCosts: { get: shifting("attemptCosts", costs, "not an array"), enumerable: true },
			independentlyVerified: { get: shifting("independentlyVerified", true, "yes"), enumerable: true },
		});
		// (10 + 5 + 3 + 2) / 1: the first reads decide, whatever a later read would say.
		expect(costPerVerifiedCompletion([watched, block("plain", [2], false)])).toEqual({
			blocks: 2,
			verifiedBlocks: 1,
			totalCost: 20,
			costPerVerified: 20,
		});
		expect(Object.fromEntries(reads)).toEqual({
			blockId: 1,
			attemptCosts: 1,
			independentlyVerified: 1,
			cost0: 1,
			cost1: 1,
		});
	});

	it("refuses a total that rounds up to +Infinity, not only one that overflows to NaN", () => {
		const roundsUp = [MAX, 2 ** 969, 2 ** 969];
		// Premise: MAX + MAX overflows the running sum and comes out NaN, but 2^969 is under half an ulp
		// of MAX, so the running sum stays MAX and only the final correction rounds MAX + 2^970 up to
		// +Infinity. Let through, that +Infinity would read as "no completion" for a verified block.
		expect(compensatedSum([MAX, MAX])).toBeNaN();
		expect(compensatedSum(roundsUp)).toBe(NO_COMPLETION);
		expectInputError([block("up", roundsUp, true)], "invalid_number", "totalCost");
	});

	it("never calls an own slice of attemptCosts, which could hide or add attempts", () => {
		let sliceCalls = 0;
		const costs = [5];
		Object.defineProperty(costs, "slice", {
			value: () => {
				sliceCalls++;
				return [];
			},
		});
		expect(costPerVerifiedCompletion([block("own", costs, true)])).toEqual({
			blocks: 1,
			verifiedBlocks: 1,
			totalCost: 5,
			costPerVerified: 5,
		});
		expect(sliceCalls).toBe(0);
	});

	it("reads a proxied attemptCosts only through length and each index, once each", () => {
		const { proxy, log } = traced([1, 2]);
		expect(Array.isArray(proxy)).toBe(true);
		expect(costPerVerifiedCompletion([block("p", proxy, true)])).toEqual({
			blocks: 1,
			verifiedBlocks: 1,
			totalCost: 3,
			costPerVerified: 3,
		});
		expect(log).toEqual(["get length", "get 0", "get 1"]);
	});

	it("refuses a huge sparse array at its first hole without copying or scanning it", () => {
		const { proxy, log } = traced(new Array<number>(1e8));
		expectInputError([block("huge", proxy, false)], "invalid_number", "attemptCosts");
		expect(log).toEqual(["get length", "get 0"]);
	});

	// Only a proxy can report such a length. Left unchecked, NaN would slip past the "verified with no
	// attempt" check; slice coerces each of these to a count instead of refusing it.
	it.each([Number.NaN, -1, 0.5, "1"])("refuses a proxied attemptCosts whose length is %o", (length) => {
		const lying = new Proxy([5], {
			get: (base, key, receiver) => (key === "length" ? length : Reflect.get(base, key, receiver)),
		});
		expectInputError([block("lying", lying, true)], "invalid_number", "attemptCosts");
	});

	it("checks a cost's type before comparing it, so a symbol or a valueOf object is refused unread", () => {
		let calls = 0;
		const boxed = {
			valueOf() {
				calls++;
				return 5;
			},
		};
		expectInputError([malformed({ attemptCosts: [Symbol("cost")] })], "invalid_number", "attemptCosts");
		expectInputError([malformed({ attemptCosts: [boxed] })], "invalid_number", "attemptCosts");
		expect(calls).toBe(0);
	});
});

interface Draft {
	readonly attemptCosts: readonly number[];
	readonly independentlyVerified: boolean;
}

// A cost is 0 or a normal double. Doubling is exact only away from underflow and overflow, so the
// range keeps 2 * cost and any sum of a few of them normal.
const costArb = fc.oneof(
	{ weight: 1, arbitrary: fc.constant(0) },
	{ weight: 4, arbitrary: fc.double({ min: 1e-100, max: 1e100, noNaN: true }) },
);
// A verified block has at least one attempt, so no property needs an assumption to stay valid.
const verifiedArb: fc.Arbitrary<Draft> = fc
	.array(costArb, { minLength: 1, maxLength: 5 })
	.map((attemptCosts) => ({ attemptCosts, independentlyVerified: true }));
const unverifiedArb: fc.Arbitrary<Draft> = fc
	.array(costArb, { maxLength: 5 })
	.map((attemptCosts) => ({ attemptCosts, independentlyVerified: false }));
const draftArb = fc.oneof(verifiedArb, unverifiedArb);

function withIds(drafts: readonly Draft[]): CostBlock[] {
	return drafts.map((draft, index) => ({ blockId: `b${index}`, ...draft }));
}

/** Equal, or both finite and within a relative 1e-12. Infinity equals only itself. */
function within(actual: number, expected: number): boolean {
	if (actual === expected) return true;
	const scale = Math.max(Math.abs(actual), Math.abs(expected));
	return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 1e-12 * scale;
}

describe("costPerVerifiedCompletion properties", () => {
	it("doubles exactly when every cost doubles", () => {
		fc.assert(
			fc.property(verifiedArb, fc.array(draftArb, { maxLength: 8 }), (first, rest) => {
				const blocks = withIds([first, ...rest]);
				const doubled = blocks.map((entry) => ({
					...entry,
					attemptCosts: entry.attemptCosts.map((cost) => 2 * cost),
				}));
				const base = costPerVerifiedCompletion(blocks);
				expect(base.verifiedBlocks).toBeGreaterThan(0);
				expect(Number.isFinite(base.costPerVerified)).toBe(true);
				expect(costPerVerifiedCompletion(doubled).costPerVerified).toBe(2 * base.costPerVerified);
			}),
			{ numRuns: 500, seed: 20260929 },
		);
	});

	it("is +Infinity exactly when no block is verified, and never NaN", () => {
		const seen = { infinite: 0, finite: 0 };
		fc.assert(
			fc.property(fc.array(draftArb, { maxLength: 8 }), (drafts) => {
				const result = costPerVerifiedCompletion(withIds(drafts));
				const infinite = result.costPerVerified === NO_COMPLETION;
				expect(infinite).toBe(result.verifiedBlocks === 0);
				expect(result.blocks).toBe(drafts.length);
				expect(result.verifiedBlocks).toBe(drafts.filter((draft) => draft.independentlyVerified).length);
				expect(Number.isNaN(result.costPerVerified)).toBe(false);
				seen[infinite ? "infinite" : "finite"]++;
			}),
			{ numRuns: 500, seed: 20260930 },
		);
		// Both sides of the equivalence were exercised.
		expect(seen.infinite).toBeGreaterThan(0);
		expect(seen.finite).toBeGreaterThan(0);
	});

	it("does not depend on block order beyond rounding", () => {
		fc.assert(
			fc.property(fc.array(fc.tuple(draftArb, fc.integer()), { maxLength: 8 }), (keyed) => {
				const entries = keyed.map(([draft, key], index) => ({ key, entry: { blockId: `b${index}`, ...draft } }));
				const shuffled = [...entries].sort((x, y) => x.key - y.key);
				const before = costPerVerifiedCompletion(entries.map(({ entry }) => entry));
				const after = costPerVerifiedCompletion(shuffled.map(({ entry }) => entry));
				expect(after.blocks).toBe(before.blocks);
				expect(after.verifiedBlocks).toBe(before.verifiedBlocks);
				expect(within(after.totalCost, before.totalCost)).toBe(true);
				expect(within(after.costPerVerified, before.costPerVerified)).toBe(true);
			}),
			{ numRuns: 500, seed: 20260931 },
		);
	});

	it("never lowers the cost when an unverified block is added", () => {
		fc.assert(
			fc.property(fc.array(draftArb, { maxLength: 8 }), unverifiedArb, (drafts, extra) => {
				const before = costPerVerifiedCompletion(withIds(drafts));
				const after = costPerVerifiedCompletion(withIds([...drafts, extra]));
				expect(after.verifiedBlocks).toBe(before.verifiedBlocks);
				// Within a relative 1e-12; before may be +Infinity, which only +Infinity reaches.
				expect(after.costPerVerified).toBeGreaterThanOrEqual(before.costPerVerified * (1 - 1e-12));
			}),
			{ numRuns: 500, seed: 20260932 },
		);
	});
});
