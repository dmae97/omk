import { type RunContract, runDagAncestors } from "omk-protocol";
import { readyDagTasks } from "./dag-projection.ts";
import type { RunTaskProjection } from "./dag-types.ts";
import type { RunProjection } from "./run-types.ts";

export interface DagTaskExplanation {
	readonly taskId: string;
	readonly dependsOn: readonly string[];
	readonly status: RunTaskProjection["status"] | "missing";
	readonly generation: number | null;
	readonly attempt: number;
	readonly ready: boolean;
	readonly inputDigest: string | null;
	readonly outputDigest: string | null;
	readonly blockedBy: readonly {
		readonly taskId: string;
		readonly status: RunTaskProjection["status"] | "missing";
		readonly reason: string;
	}[];
}

/** Dependency explanations, not causal attribution or dispatch permission. */
export function explainDagTasks(
	contract: RunContract,
	state: Pick<RunProjection, "tasks" | "generation">,
): readonly DagTaskExplanation[] {
	if (contract.profile !== "linux-command-dag-v1") return Object.freeze([]);
	const states = new Map(state.tasks.map((task) => [task.taskId, task]));
	const ready = new Set(readyDagTasks(contract.writer, state).map((task) => task.id));
	return Object.freeze(
		contract.writer.tasks.map((definition) => {
			const task = states.get(definition.id);
			const blockedBy = runDagAncestors(contract.writer.tasks, definition.id).flatMap((ancestor) => {
				const dependency = states.get(ancestor.id);
				if (dependency?.status === "succeeded" && dependency.generation === state.generation) return [];
				return [
					Object.freeze({
						taskId: ancestor.id,
						status: dependency?.status ?? "missing",
						reason:
							dependency && dependency.generation !== state.generation
								? "stale_generation"
								: (dependency?.failure ?? "dependency_not_settled"),
					}),
				];
			});
			return Object.freeze({
				taskId: definition.id,
				dependsOn: Object.freeze([...definition.dependsOn]),
				status: task?.status ?? "missing",
				generation: task?.generation ?? null,
				attempt: task?.attempt ?? 0,
				ready: ready.has(definition.id) && task?.generation === state.generation,
				inputDigest: task?.inputDigest ?? null,
				outputDigest: task?.outputDigest ?? null,
				blockedBy: Object.freeze(blockedBy),
			});
		}),
	);
}
