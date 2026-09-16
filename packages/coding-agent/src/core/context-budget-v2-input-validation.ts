import type { ContextBudgetItemV2 } from "./context-budget-headroom.ts";
import { ALL_TIERS_V2, type QualityDiagnosticV2 } from "./context-budget-v2-types.ts";

/**
 * Input boundary for the planner (audit §13): selection is keyed by `item.id`,
 * so a duplicate id would silently overwrite an earlier selection while its
 * tokens still counted twice in demand; a NaN or negative numeric field
 * poisons every budget sum it touches; an unregistered tier lands in no
 * allocation and corrupts `tierUsed` with NaN. Identity violations drop the
 * item with a diagnostic; invalid numeric fields are dropped and recomputed
 * rather than silently corrected.
 */
const KNOWN_TIERS_V2 = new Set<string>(ALL_TIERS_V2);

export function validateBudgetItems(
	items: readonly ContextBudgetItemV2[],
	diagnostics: QualityDiagnosticV2[],
): ContextBudgetItemV2[] {
	const seen = new Set<string>();
	const out: ContextBudgetItemV2[] = [];
	for (const [position, item] of items.entries()) {
		if (typeof item.id !== "string" || item.id.length === 0) {
			diagnostics.push({
				reason: "invalid_input",
				detail: `items[${position}] has a missing or non-string id and was dropped`,
			});
			continue;
		}
		if (seen.has(item.id)) {
			diagnostics.push({
				reason: "invalid_input",
				itemId: item.id,
				detail: `duplicate item id "${item.id}" dropped — a later entry would overwrite the earlier selection`,
			});
			continue;
		}
		seen.add(item.id);
		if (!KNOWN_TIERS_V2.has(item.tier)) {
			diagnostics.push({
				reason: "invalid_input",
				itemId: item.id,
				detail: `item "${item.id}" has unregistered tier "${String(item.tier)}" and was dropped`,
			});
			continue;
		}
		let sanitized = item;
		if (item.tokenEstimate !== undefined && (!Number.isFinite(item.tokenEstimate) || item.tokenEstimate < 0)) {
			diagnostics.push({
				reason: "invalid_input",
				itemId: item.id,
				detail: `item "${item.id}" tokenEstimate ${item.tokenEstimate} is not a finite non-negative number; recomputed from text`,
			});
			sanitized = { ...sanitized, tokenEstimate: undefined };
		}
		if (item.representations !== undefined) {
			const reps = item.representations.filter((rep) => {
				if (!Number.isFinite(rep.estimatedTokens) || rep.estimatedTokens < 0) {
					diagnostics.push({
						reason: "invalid_input",
						itemId: item.id,
						detail: `item "${item.id}" ${rep.kind} representation cost ${rep.estimatedTokens} is not a finite non-negative number; dropped`,
					});
					return false;
				}
				return true;
			});
			if (reps.length !== item.representations.length) {
				sanitized = { ...sanitized, representations: reps };
			}
		}
		if (
			item.priority !== "hard" &&
			item.priority !== "high" &&
			item.priority !== "medium" &&
			item.priority !== "low"
		) {
			diagnostics.push({
				reason: "invalid_input",
				itemId: item.id,
				detail: `item "${item.id}" has unknown priority "${String(item.priority)}"; scored without a priority weight`,
			});
		}
		out.push(sanitized);
	}
	return out;
}
