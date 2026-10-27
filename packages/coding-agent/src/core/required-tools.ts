/**
 * Spec 104 §2.1/§2.2: required-tool contract for per-turn admission.
 *
 * Behind `OMK_REQUIRED_TOOLS` (default off). With the flag off nothing here is
 * consulted: admission keys, fitted tools and notices are unchanged. v1: a
 * contract comes only from the approved acceptance contract; nothing is
 * inferred from prompt text.
 *
 * Real sessions read the contract through `setRequiredToolSource`
 * (agent-session-turn-admission-host.ts); no producer sets one yet.
 */
import type { TaskCheckFact } from "./task-result.ts";

export const REQUIRED_TOOLS_ENV = "OMK_REQUIRED_TOOLS";

export interface RequiredToolContract {
	readonly taskSegmentId: string;
	readonly tools: ReadonlySet<string>;
	/** v1 (Tech Lead ruling 2026-10-21): the approved acceptance contract only. */
	readonly source: "acceptance";
}

/**
 * Field the approved acceptance contract will carry (phase 2 plumbing). Type only:
 * no producer or consumer reads it yet.
 */
export interface AcceptanceRequiredToolsField {
	/** Exact tool names (e.g. `browser__verify`) the approved check needs. */
	readonly requiredTools?: readonly string[];
}

export function isRequiredToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return /^(?:1|on|true|yes)$/i.test(env[REQUIRED_TOOLS_ENV]?.trim() ?? "");
}

/** The turn cannot carry every required tool: absent (server down, permission revoked) or over the ceiling. */
export class RequiredCapabilityUnavailable extends Error {
	readonly missing: readonly string[];
	readonly taskSegmentId: string;
	readonly kind: "absent" | "over_ceiling";

	constructor(taskSegmentId: string, missing: readonly string[], cause: "absent" | "over_ceiling") {
		super(`required tools unavailable (${cause}): ${missing.join(", ")}`);
		this.name = "RequiredCapabilityUnavailable";
		this.taskSegmentId = taskSegmentId;
		this.missing = [...missing].sort();
		this.kind = cause;
	}
}

/** Sorted required names, for the admission key: a contract change alone re-fits. */
export function requiredToolsKey(contract: RequiredToolContract | undefined): readonly string[] | undefined {
	return contract ? [contract.taskSegmentId, contract.source, ...[...contract.tools].sort()] : undefined;
}

/** Required names the current tool set does not contain at all. */
export function absentRequiredTools(contract: RequiredToolContract, toolNames: readonly string[]): string[] {
	const present = new Set(toolNames);
	return [...contract.tools].filter((name) => !present.has(name)).sort();
}

/** task_result fact `insufficient/required_capability_missing` (spec 100 projection, new reason). */
export function factFromRequiredCapabilityUnavailable(error: RequiredCapabilityUnavailable): TaskCheckFact {
	return {
		id: `required-capability:${error.taskSegmentId}`,
		source: "host_receipt",
		status: "insufficient",
		required: true,
		reason: "required_capability_missing",
		detail: `missing: ${error.missing.join(", ")}`.slice(0, 200),
	};
}
