import type { ExtensionFactory } from "../types.ts";
import deliverableGuard from "./deliverable-guard.ts";
import finishCheck from "./finish-check.ts";
import goalController from "./goal-controller.ts";
import identicalLoop from "./identical-loop.ts";
import promptPreset from "./prompt-preset.ts";
import toolPairRepair from "./tool-pair-repair.ts";

export interface HarnessFactoryEntry {
	readonly factory: ExtensionFactory;
	readonly path: string;
	/** Environment variable that turns this built-in off when set to a disabling value. */
	readonly envVar: string;
}

/** Built-in harness extensions loaded after user extensions, in this order. */
export const HARNESS_FACTORIES: readonly HarnessFactoryEntry[] = [
	{ factory: identicalLoop, path: "<builtin:identical-loop>", envVar: "OMK_IDENTICAL_LOOP" },
	{ factory: toolPairRepair, path: "<builtin:tool-pair-repair>", envVar: "OMK_TOOL_PAIR_REPAIR" },
	{ factory: promptPreset, path: "<builtin:prompt-preset>", envVar: "OMK_PROMPT_PRESET" },
	{ factory: goalController, path: "<builtin:goal-controller>", envVar: "OMK_GOAL_CONTROLLER" },
	// Before finish-check, so a file restored at settle is in place for the verification turn (spec 034).
	{ factory: (omk) => deliverableGuard(omk), path: "<builtin:deliverable-guard>", envVar: "OMK_DELIVERABLE_GUARD" },
	{ factory: (omk) => finishCheck(omk), path: "<builtin:finish-check>", envVar: "OMK_FINISH_CHECK" },
];
