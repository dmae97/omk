import { createHash } from "node:crypto";
import { emptyUsage, type SingleResult } from "./subagent-runtime-types.ts";
import type { GraphTask } from "./workflow-graph.ts";

export function failedResult(result: SingleResult): boolean {
	return (
		result.process?.terminationObserved === false ||
		result.exitCode !== 0 ||
		result.stopReason === "error" ||
		result.stopReason === "aborted"
	);
}

export function laneResult(
	result: SingleResult,
): void | { status: "failed" } | { status: "unsettled"; settlement: Promise<void> } {
	if (result.process?.terminationObserved === false)
		return { status: "unsettled", settlement: result.process.settlement };
	if (failedResult(result)) return { status: "failed" };
}

export function blockedResult(task: GraphTask, reason = "blocked-dependency"): SingleResult {
	return {
		nodeId: task.id,
		agent: task.agent,
		agentSource: "unknown",
		task: task.task,
		exitCode: 1,
		messages: [],
		stderr: reason,
		stopReason: reason,
		usage: emptyUsage(),
	};
}

export function dependencyDigests(
	task: GraphTask,
	outputs: ReadonlyMap<string, string>,
): Readonly<Record<string, string>> {
	return Object.fromEntries(
		(task.dependsOn ?? []).map((id) => [
			id,
			createHash("sha256")
				.update(outputs.get(id) ?? "")
				.digest("hex"),
		]),
	);
}
