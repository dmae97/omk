import { createHash } from "node:crypto";
import { findEscapingLanePaths, lanePathsIntersect } from "./lane-path-scope.ts";
import type { SubagentOrchestrationRole } from "./subagent-lane-contract.ts";

export type MultiAgentExecutionKind = "tool-dag" | "subagent-lane" | "provider-harness";

export interface UnifiedAgentUnit {
	readonly id: string;
	readonly kind: MultiAgentExecutionKind;
	readonly role: SubagentOrchestrationRole;
	readonly writes: readonly string[];
	readonly reads: readonly string[];
	readonly dependsOn: readonly string[];
	readonly heavy?: boolean;
}

export interface UnifiedMultiAgentDispatchInput {
	readonly runId: string;
	readonly maxParallel: number;
	readonly fleetCpuSlots?: number;
	readonly units: readonly UnifiedAgentUnit[];
}

export interface UnifiedDispatchStage {
	readonly index: number;
	readonly unitIds: readonly string[];
	readonly kinds: readonly MultiAgentExecutionKind[];
	readonly serializedByWriteConflict: boolean;
}

export type UnifiedMultiAgentPlan =
	| {
			readonly status: "ready";
			readonly runId: string;
			readonly effectiveConcurrency: number;
			readonly stages: readonly UnifiedDispatchStage[];
			readonly dispatchDigest: string;
	  }
	| {
			readonly status: "rejected";
			readonly runId: string;
			readonly blockers: readonly string[];
	  };

function scopesOverlap(left: readonly string[], right: readonly string[]): boolean {
	return left.some((a) => right.some((b) => lanePathsIntersect(a, b)));
}

function unitsConflict(a: UnifiedAgentUnit, b: UnifiedAgentUnit): boolean {
	if (a.writes.length === 0 && b.writes.length === 0) return false;
	if (a.writes.length > 0 && b.writes.length > 0 && scopesOverlap(a.writes, b.writes)) return true;
	if (a.writes.length > 0 && b.reads.length > 0 && scopesOverlap(a.writes, b.reads)) return true;
	if (b.writes.length > 0 && a.reads.length > 0 && scopesOverlap(b.writes, a.reads)) return true;
	return false;
}

function validateUnits(units: readonly UnifiedAgentUnit[]): string[] {
	const blockers: string[] = [];
	const seen = new Set<string>();
	for (const unit of units) {
		if (!unit.id.trim()) blockers.push("unit id must not be empty");
		if (seen.has(unit.id)) blockers.push(`duplicate unit id: ${unit.id}`);
		seen.add(unit.id);
		const escaping = findEscapingLanePaths([...unit.writes, ...unit.reads]);
		if (escaping.length > 0) {
			blockers.push(`unit ${unit.id} has workspace-escape path(s): ${escaping.join(", ")}`);
		}
	}
	for (const unit of units) {
		for (const dep of unit.dependsOn) {
			if (!seen.has(dep)) blockers.push(`unit ${unit.id} depends on unknown unit: ${dep}`);
			if (dep === unit.id) blockers.push(`unit ${unit.id} cannot depend on itself (cycle)`);
		}
	}
	return blockers;
}

/**
 * Unify tool-dag, subagent-lane, and provider-harness units onto one shared planner:
 * identical write-scope conflict serialization, workspace escape blocking, fleet CPU cap,
 * and deterministic SHA-256 dispatch digest.
 */
export function planUnifiedMultiAgentDispatch(input: UnifiedMultiAgentDispatchInput): UnifiedMultiAgentPlan {
	const blockers = validateUnits(input.units);
	if (blockers.length > 0) {
		return { status: "rejected", runId: input.runId, blockers };
	}

	const baseCap = Math.max(1, Math.floor(input.maxParallel));
	const effectiveConcurrency =
		input.fleetCpuSlots !== undefined ? Math.max(1, Math.min(baseCap, Math.floor(input.fleetCpuSlots))) : baseCap;

	const remaining = new Map(input.units.map((u) => [u.id, u]));
	const completed = new Set<string>();
	const stages: UnifiedDispatchStage[] = [];

	while (remaining.size > 0) {
		const ready = [...remaining.values()]
			.filter((u) => u.dependsOn.every((dep) => completed.has(dep)))
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

		if (ready.length === 0) {
			return {
				status: "rejected",
				runId: input.runId,
				blockers: [`dependency cycle detected among units: ${[...remaining.keys()].sort().join(", ")}`],
			};
		}

		const picked: UnifiedAgentUnit[] = [];
		let serializedByWriteConflict = false;
		for (const candidate of ready) {
			if (picked.length >= effectiveConcurrency) break;
			if (picked.some((existing) => unitsConflict(existing, candidate))) {
				serializedByWriteConflict = true;
				continue;
			}
			picked.push(candidate);
		}

		for (const unit of picked) {
			remaining.delete(unit.id);
			completed.add(unit.id);
		}
		stages.push({
			index: stages.length,
			unitIds: picked.map((u) => u.id),
			kinds: [...new Set(picked.map((u) => u.kind))],
			serializedByWriteConflict,
		});
	}

	const dispatchDigest = createHash("sha256")
		.update(JSON.stringify({ runId: input.runId, effectiveConcurrency, stages }))
		.digest("hex");

	return { status: "ready", runId: input.runId, effectiveConcurrency, stages, dispatchDigest };
}
