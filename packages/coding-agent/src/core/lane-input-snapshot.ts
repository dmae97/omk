import type { ResourceAdmissionDecision } from "./resource-admission.ts";
import type { LaunchSubagentLanesInput } from "./subagent-lane-input.ts";

/** Infinity is an intentional observe-mode authority; NaN and negative values are not. */
export function assertLaneCap(value: number, label: string, allowInfinity = true): void {
	if (allowInfinity && value === Number.POSITIVE_INFINITY) return;
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`lane.invalid_cap:${label}`);
}

/** Snapshot authority data without freezing the caller's object or the shared pool. */
export function snapshotLaneDecision(decision: ResourceAdmissionDecision): ResourceAdmissionDecision {
	const result = { ...decision, reasons: Object.freeze([...decision.reasons]) };
	assertLaneCap(result.maxToolConcurrency, "maxToolConcurrency");
	assertLaneCap(result.maxParallelLanes, "maxParallelLanes");
	assertLaneCap(result.maxHeavyProcesses, "maxHeavyProcesses");
	if (!["allow", "throttle", "defer-heavy"].includes(result.action)) throw new RangeError("lane.invalid_action");
	return Object.freeze(result);
}

/** Freeze only the values the launcher consumes; callbacks, signal and shared permits retain identity. */
export function snapshotLaneLaunchInput(input: LaunchSubagentLanesInput): LaunchSubagentLanesInput {
	if (input.configuredMaxParallelLanes !== undefined) {
		assertLaneCap(input.configuredMaxParallelLanes, "configuredMaxParallelLanes");
	}
	assertLaneCap(input.plan.route.width, "planWidth", false);
	if (input.plan.blockers.length > 0 || input.plan.spawnGate.outcome !== "allowed") {
		throw new RangeError("lane.plan_not_admitted");
	}
	if (!Array.isArray(input.plan.batches)) throw new RangeError("lane.invalid_batch");
	const ids = new Set<string>();
	// Array.from visits holes that map would silently preserve past admission.
	const batches = Array.from(input.plan.batches, (batch) => {
		if (!batch || !Array.isArray(batch.laneIds)) throw new RangeError("lane.invalid_batch");
		const laneIds = Array.from(batch.laneIds, (id) => {
			if (typeof id !== "string" || id.length === 0 || ids.has(id))
				throw new RangeError("lane.invalid_or_duplicate_id");
			ids.add(id);
			return id;
		});
		return Object.freeze({ ...batch, laneIds: Object.freeze(laneIds) });
	});
	const heavyLaneIds = input.heavyLaneIds === undefined ? undefined : new Set(input.heavyLaneIds);
	for (const id of heavyLaneIds ?? []) {
		if (!ids.has(id)) throw new RangeError("lane.unknown_heavy_id");
	}
	return Object.freeze({
		...input,
		decision: snapshotLaneDecision(input.decision),
		plan: Object.freeze({
			...input.plan,
			route: Object.freeze({ ...input.plan.route }),
			batches: Object.freeze(batches),
		}),
		heavyLaneIds,
		// Preserve method receiver compatibility while pinning callback identity.
		launchLane: input.launchLane.bind(input),
	});
}
