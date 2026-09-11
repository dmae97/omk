import { RunContractError, runArgv, runArray, runId, runObject, runRelativePath } from "./run-parsing.ts";

export const MAX_RUN_DAG_TASKS = 16;
export const MAX_RUN_TASK_ATTEMPTS = 2;

export interface RunDagTask {
	readonly id: string;
	readonly dependsOn: readonly string[];
	readonly writablePaths: readonly string[];
	readonly attempts: readonly (readonly string[])[];
}
export interface RunDagWriter {
	readonly kind: "command-dag";
	readonly tasks: readonly RunDagTask[];
}

/** Deterministic FIFO Kahn ordering. This orders artifacts, not tool resource-conflict claims. */
export function orderRunDag(tasks: readonly RunDagTask[]): readonly RunDagTask[] {
	const pending = new Map(tasks.map((task) => [task.id, task.dependsOn.length]));
	const ready = tasks.filter((task) => task.dependsOn.length === 0);
	const ordered: RunDagTask[] = [];
	for (let index = 0; index < ready.length; index++) {
		const next = ready[index];
		ordered.push(next);
		for (const task of tasks) {
			if (!task.dependsOn.includes(next.id)) continue;
			const count = pending.get(task.id);
			if (count === undefined) throw new RunContractError("dependency");
			pending.set(task.id, count - 1);
			if (count === 1) ready.push(task);
		}
	}
	if (ordered.length !== tasks.length) throw new RunContractError("cyclic dependency");
	return Object.freeze(ordered);
}

/** Every ancestor material is an input; unrelated successful branches are deliberately excluded. */
export function runDagAncestors(tasks: readonly RunDagTask[], taskId: string): readonly RunDagTask[] {
	if (!tasks.some((task) => task.id === taskId)) throw new RunContractError("taskId");
	const order = orderRunDag(tasks);
	const included = new Set([taskId]);
	for (const task of [...order].reverse()) {
		if (included.has(task.id)) for (const id of task.dependsOn) included.add(id);
	}
	return Object.freeze(order.filter((task) => task.id !== taskId && included.has(task.id)));
}

export function parseRunDagWriter(value: unknown, writable: readonly string[]): RunDagWriter {
	const raw = runObject(value, ["kind", "tasks"]);
	if (raw.kind !== "command-dag") throw new RunContractError("writer.kind");
	const tasks = runArray(
		raw.tasks,
		(value): RunDagTask => {
			const task = runObject(value, ["id", "dependsOn", "writablePaths", "attempts"]);
			const dependsOn =
				Array.isArray(task.dependsOn) && task.dependsOn.length === 0
					? Object.freeze([])
					: runArray(task.dependsOn, runId, MAX_RUN_DAG_TASKS);
			if (new Set(dependsOn).size !== dependsOn.length) throw new RunContractError("duplicate dependency");
			return Object.freeze({
				id: runId(task.id),
				dependsOn,
				writablePaths: runArray(task.writablePaths, runRelativePath, 128),
				attempts: runArray(task.attempts, runArgv, MAX_RUN_TASK_ATTEMPTS),
			});
		},
		MAX_RUN_DAG_TASKS,
	);
	const ids = new Set(tasks.map((task) => task.id));
	if (ids.size !== tasks.length) throw new RunContractError("duplicate task");
	const scopes: string[] = [];
	for (const task of tasks) {
		if (task.dependsOn.some((id) => id === task.id || !ids.has(id))) throw new RunContractError("dependency");
		for (const path of task.writablePaths) {
			if (!writable.some((scope) => path === scope || path.startsWith(`${scope}/`)))
				throw new RunContractError("task scope");
			if (scopes.some((scope) => path === scope || path.startsWith(`${scope}/`) || scope.startsWith(`${path}/`)))
				throw new RunContractError("overlapping task scope");
			scopes.push(path);
		}
	}
	orderRunDag(tasks);
	return Object.freeze({ kind: "command-dag", tasks });
}
