import { MAX_RUN_DAG_TASKS } from "./run-dag.ts";
import { RunContractError, runArray, runId, runObject } from "./run-parsing.ts";
import { parseRunWriterRestartCommand, type RunWriterRestartCommand } from "./run-writer-restart.ts";

/** Select failed/interrupted task attempts; an empty selection only continues pending work. */
export interface RunTaskRetryCommand extends Omit<RunWriterRestartCommand, "kind"> {
	readonly kind: "retry_tasks";
	readonly taskIds: readonly string[];
}
export function parseRunTaskRetryCommand(value: unknown): RunTaskRetryCommand {
	const input = runObject(value, [
		"schemaVersion",
		"kind",
		"runId",
		"commandId",
		"expectedRevision",
		"expectedGeneration",
		"contractDigest",
		"baseDigest",
		"taskIds",
	]);
	if (input.kind !== "retry_tasks") throw new RunContractError("task retry kind");
	const { taskIds: rawIds, ...fields } = input;
	const taskIds =
		Array.isArray(rawIds) && rawIds.length === 0 ? Object.freeze([]) : runArray(rawIds, runId, MAX_RUN_DAG_TASKS);
	if (new Set(taskIds).size !== taskIds.length) throw new RunContractError("duplicate task");
	const base = parseRunWriterRestartCommand({ ...fields, kind: "restart_writer" });
	return Object.freeze({ ...base, kind: "retry_tasks", taskIds });
}
