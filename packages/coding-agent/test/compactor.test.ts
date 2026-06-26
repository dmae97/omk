import { describe, expect, it } from "vitest";
import { type CompactionTurn, ContextCompactor } from "../src/core/compactor.ts";

function makeTurns(count: number): CompactionTurn[] {
	return Array.from({ length: count }, (_, index) => ({
		index,
		role: "user",
		content: `plain context message ${index}`,
		timestamp: index,
	}));
}

describe("ContextCompactor", () => {
	it("returns a finite compression ratio for empty input", () => {
		const result = new ContextCompactor().compact([]);

		expect(result.originalCount).toBe(0);
		expect(result.finalCount).toBe(0);
		expect(result.preserved).toEqual([]);
		expect(result.summarized).toEqual([]);
		expect(Number.isFinite(result.compressionRatio)).toBe(true);
		expect(result.compressionRatio).toBe(1);
	});

	it("retains more context for gentle than moderate and less for aggressive", () => {
		const turns = makeTurns(20);
		const compactor = new ContextCompactor();

		const gentle = compactor.compact(turns, "gentle");
		const moderate = compactor.compact(turns, "moderate");
		const aggressive = compactor.compact(turns, "aggressive");

		expect(gentle.finalCount).toBeGreaterThan(moderate.finalCount);
		expect(moderate.finalCount).toBeGreaterThan(aggressive.finalCount);
		expect(gentle.summarized).toHaveLength(5);
		expect(moderate.summarized).toHaveLength(10);
		expect(aggressive.summarized).toHaveLength(15);
	});

	it("normalizes undefined and unknown levels to moderate", () => {
		const turns = makeTurns(20);
		const compactor = new ContextCompactor();

		const moderate = compactor.compact(turns, "moderate");
		const defaulted = compactor.compact(turns);
		const unknown = compactor.compact(turns, "unknown");

		expect(defaulted.finalCount).toBe(moderate.finalCount);
		expect(defaulted.summarized.map((turn) => turn.index)).toEqual(moderate.summarized.map((turn) => turn.index));
		expect(unknown.finalCount).toBe(moderate.finalCount);
		expect(unknown.summarized.map((turn) => turn.index)).toEqual(moderate.summarized.map((turn) => turn.index));
	});
});
