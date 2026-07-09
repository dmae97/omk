/**
 * Capped regenerate repair budget (attempt counting vs env/config budget).
 */

import type { UserVerdict } from "./b2c-verdict.ts";

export interface RepairBudgetState {
	packetKey: string;
	attempts: number;
	lastVerdict: UserVerdict;
}

const DEFAULT_REPAIR_BUDGET = 1;

/**
 * Parse a non-negative repair budget cap. Uses `override` when provided; otherwise reads
 * `OMK_WALL_REPAIR_BUDGET` from the environment (invalid/missing → default 1).
 */
export function parseRepairBudget(override?: number): number {
	if (override !== undefined) {
		if (!Number.isFinite(override) || override < 0) return DEFAULT_REPAIR_BUDGET;
		return Math.floor(override);
	}
	const raw = process.env.OMK_WALL_REPAIR_BUDGET?.trim();
	if (!raw) return DEFAULT_REPAIR_BUDGET;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 0) return DEFAULT_REPAIR_BUDGET;
	return n;
}

/**
 * Whether another capped regenerate/repair offer is allowed for this packet.
 * Offers while `attemptCount` is strictly below `budget` (0-based attempts consumed).
 */
export function shouldOfferRepair(verdict: UserVerdict, attemptCount: number, budget: number): boolean {
	if (verdict !== "BLOCKED") return false;
	const cap = parseRepairBudget(budget);
	if (cap === 0) return false;
	return attemptCount < cap;
}

/**
 * Cap a list of repair hint strings for display (capped regenerate algorithm).
 */
export function capRepairHints(hints: string[], budget: number): string[] {
	const cap = parseRepairBudget(budget);
	if (cap === 0 || hints.length === 0) return [];
	return hints.slice(0, cap);
}
