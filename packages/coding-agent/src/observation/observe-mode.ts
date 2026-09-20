/**
 * Observation-mode recorder — U1 shadow evaluation.
 *
 * Records what the coverage-gated deterministic view would have chosen and the
 * upper-bound token saving, without changing what the model actually receives.
 * A projected saving is an estimate, never an achieved saving — promotion out
 * of observation mode requires a real comparison on the same budget.
 */

import { ensure, integer, text } from "../metacognition/validation.ts";
import type { ObservationView } from "./types.ts";

export interface ObservationChoiceRecord {
	readonly observationId: string;
	readonly observedTokens: number;
	readonly chosenTokens: number;
	readonly chosenViewKind: string;
	readonly savedTokensUpperBound: number;
	readonly coverageStatus: string;
	readonly infeasible: boolean;
}

export interface ObservationModeSummary {
	readonly observations: number;
	readonly observedTokens: number;
	readonly chosenTokens: number;
	readonly savedTokensUpperBound: number;
	readonly infeasible: number;
	readonly coverageComplete: number;
	readonly coveragePartial: number;
	readonly coverageUnknown: number;
}

export interface ObservationModeRecorder {
	record(choice: {
		readonly observationId: string;
		readonly observedTokens: number;
		readonly chosenView: ObservationView | null;
		readonly requiredFactIds?: readonly string[];
	}): ObservationChoiceRecord;
	readonly records: readonly ObservationChoiceRecord[];
	summary(): ObservationModeSummary;
}

/**
 * Pure recorder: given what the model actually saw (`observedTokens`) and what
 * the gated selector would have chosen, emit one decision record. A null
 * `chosenView` means the candidate set was infeasible under the required
 * coverage — recorded as such, never converted into an implicit success.
 */
export function createObservationModeRecorder(): ObservationModeRecorder {
	const records: ObservationChoiceRecord[] = [];
	return {
		record(choice) {
			text(choice.observationId, "observationId", 128);
			integer(choice.observedTokens, "observedTokens");
			const chosen = choice.chosenView;
			const record: ObservationChoiceRecord =
				chosen === null
					? Object.freeze({
							observationId: choice.observationId,
							observedTokens: choice.observedTokens,
							chosenTokens: choice.observedTokens,
							chosenViewKind: "infeasible",
							savedTokensUpperBound: 0,
							coverageStatus: "unknown",
							infeasible: true,
						})
					: Object.freeze({
							observationId: choice.observationId,
							observedTokens: choice.observedTokens,
							chosenTokens: chosen.estimatedTokens,
							chosenViewKind: chosen.viewKind,
							savedTokensUpperBound: Math.max(0, choice.observedTokens - chosen.estimatedTokens),
							coverageStatus: chosen.coverageStatus,
							infeasible: false,
						});
			ensure(Number.isFinite(record.savedTokensUpperBound), "savedTokensUpperBound must be finite");
			records.push(record);
			return record;
		},
		get records() {
			return records;
		},
		summary() {
			let observedTokens = 0;
			let chosenTokens = 0;
			let savedTokensUpperBound = 0;
			let infeasible = 0;
			let coverageComplete = 0;
			let coveragePartial = 0;
			let coverageUnknown = 0;
			for (const r of records) {
				observedTokens += r.observedTokens;
				chosenTokens += r.chosenTokens;
				savedTokensUpperBound += r.savedTokensUpperBound;
				if (r.infeasible) infeasible += 1;
				if (r.coverageStatus === "complete") coverageComplete += 1;
				else if (r.coverageStatus === "partial") coveragePartial += 1;
				else coverageUnknown += 1;
			}
			return {
				observations: records.length,
				observedTokens,
				chosenTokens,
				savedTokensUpperBound,
				infeasible,
				coverageComplete,
				coveragePartial,
				coverageUnknown,
			};
		},
	};
}
