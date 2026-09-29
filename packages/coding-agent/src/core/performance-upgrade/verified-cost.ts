import { compensatedSum } from "./anytime-bounds.ts";
import { MeasurementInputError } from "./measurement-trace.ts";

/**
 * B12 cost per independently verified completion (OMK_MATH_f46a8f6 r2):
 *   C_verified = (sum_b sum_{a in attempts(b)} C_{b,a}) / (sum_b 1[independentlyVerified(b)]).
 * The numerator pays for every attempt of every block, so unverified blocks and failed or retried
 * attempts raise the cost; the denominator counts blocks, not attempts. With no verified block there
 * is no completion to divide by and the cost is +Infinity, never NaN. Costs are in the caller's unit.
 *
 * This is arithmetic only: a block that passed independent verification is not thereby correct, and
 * nothing here judges what verified means. A total that overflows is refused, because +Infinity is
 * this module's "no completion". Each block field is read once; attemptCosts is read only through its
 * length and each index, once each, and none of its methods is called. A getter, a proxy or an own
 * `slice` therefore cannot change a validated value, and a sparse array is refused at its first hole.
 */
export interface CostBlock {
	readonly blockId: string;
	/** Cost of every attempt, failed and retried ones included, in the caller's unit. */
	readonly attemptCosts: readonly number[];
	/** Passed an independent verification, not the candidate's own claim of completion. */
	readonly independentlyVerified: boolean;
}

export interface VerifiedCost {
	readonly blocks: number;
	readonly verifiedBlocks: number;
	readonly totalCost: number;
	/** totalCost / verifiedBlocks, or +Infinity when verifiedBlocks is 0. */
	readonly costPerVerified: number;
}

export function costPerVerifiedCompletion(blocks: readonly CostBlock[]): VerifiedCost {
	const seen = new Set<string>();
	const costs: number[] = [];
	let verifiedBlocks = 0;
	for (const block of blocks) {
		const { blockId, attemptCosts, independentlyVerified }: Readonly<Record<keyof CostBlock, unknown>> = block;
		if (typeof blockId !== "string") throw new MeasurementInputError("invalid_id", "blockId");
		if (seen.has(blockId)) throw new MeasurementInputError("duplicate_id", "blockId");
		seen.add(blockId);
		if (typeof independentlyVerified !== "boolean") {
			throw new MeasurementInputError("invalid_flag", "independentlyVerified");
		}
		if (!Array.isArray(attemptCosts)) throw new MeasurementInputError("invalid_number", "attemptCosts");
		// length once, then each index once: no copy, iterator or species lookup runs caller code, and a
		// hole stops the loop. Only a proxy can report a length that is not a count, and NaN would slip
		// past the count === 0 check below.
		const attempts: readonly unknown[] = attemptCosts;
		const count = attempts.length;
		if (!(Number.isSafeInteger(count) && count >= 0)) {
			throw new MeasurementInputError("invalid_number", "attemptCosts");
		}
		for (let index = 0; index < count; index++) {
			const cost = attempts[index];
			if (typeof cost !== "number" || !(cost >= 0 && Number.isFinite(cost))) {
				throw new MeasurementInputError("invalid_number", "attemptCosts");
			}
			costs.push(cost);
		}
		if (independentlyVerified) {
			if (count === 0) throw new MeasurementInputError("contradictory_record", "attemptCosts");
			verifiedBlocks++;
		}
	}
	const totalCost = compensatedSum(costs);
	// An overflow comes out of the compensated sum as NaN or as +Infinity, so test finiteness.
	if (!Number.isFinite(totalCost)) throw new MeasurementInputError("invalid_number", "totalCost");
	return {
		blocks: seen.size,
		verifiedBlocks,
		totalCost,
		costPerVerified: verifiedBlocks === 0 ? Number.POSITIVE_INFINITY : totalCost / verifiedBlocks,
	};
}
