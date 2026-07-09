/**
 * Structured capped-regenerate packet (hints only — no LLM runner in Wave 3).
 */

import type { UserVerdict } from "./b2c-verdict.ts";
import { capRepairHints, parseRepairBudget, shouldOfferRepair } from "./repair-budget.ts";
import type { RepairHintInput } from "./repair-loop.ts";
import { deriveRepairHints } from "./repair-loop.ts";

export interface RegeneratePacket {
	enabled: boolean;
	verdict: UserVerdict;
	attemptCount: number;
	budget: number;
	budgetRemaining: number;
	hints: string[];
	message: string;
}

export interface BuildRegeneratePacketInput extends RepairHintInput {
	attemptCount: number;
	budgetOverride?: number;
	autoRegenerateEnabled: boolean;
}

/**
 * When auto-regenerate is enabled and verdict is BLOCKED with budget headroom,
 * returns capped hints for operator or downstream agent — does not apply patches.
 */
export function buildRegeneratePacket(input: BuildRegeneratePacketInput): RegeneratePacket {
	const budget = parseRepairBudget(input.budgetOverride);
	const rawHints = deriveRepairHints(input);
	const hints = capRepairHints(rawHints, budget);
	const offer = shouldOfferRepair(input.userVerdict, input.attemptCount, budget);
	const enabled = input.autoRegenerateEnabled && offer && hints.length > 0;
	const budgetRemaining = Math.max(0, budget - input.attemptCount);

	return {
		enabled,
		verdict: input.userVerdict,
		attemptCount: input.attemptCount,
		budget,
		budgetRemaining,
		hints: enabled ? hints : [],
		message: enabled
			? "Capped regenerate packet ready (hints only; re-run wall after editing)."
			: "Auto-regenerate not offered (disabled, non-BLOCKED verdict, or repair budget exhausted).",
	};
}
