import { createHash } from "node:crypto";
import { emptyUsage, type SingleResult } from "./subagent-runtime-types.ts";
import type { GraphTask } from "./workflow-graph.ts";

const PER_TASK_OUTPUT_CAP = 50 * 1024;

export function truncateParallelOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) return output;

	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`;
}

export function failedResult(result: SingleResult): boolean {
	return (
		result.process?.terminationObserved === false ||
		result.exitCode !== 0 ||
		result.stopReason === "error" ||
		result.stopReason === "aborted"
	);
}

type ToolSummary = (name: string, args: Record<string, unknown>) => string;

function partialOutput(result: SingleResult, formatTool: ToolSummary): string {
	if (result.exitCode !== -1 && failedResult(result)) {
		const diagnostic = result.errorMessage || result.stderr;
		if (diagnostic) return diagnostic.slice(-4096);
	}
	if (result.exitCode === -1 && result.progress) return result.progress.text.slice(-4096);
	for (let i = result.messages.length - 1; i >= 0; i--) {
		const message = result.messages[i];
		if (message.role !== "assistant") continue;
		const lines: string[] = [];
		for (let j = message.content.length - 1; j >= 0 && lines.length < 5; j--) {
			const part = message.content[j];
			if (part.type === "text") lines.push(part.text.slice(-4096));
			else if (part.type === "toolCall") lines.push(formatTool(part.name, part.arguments));
		}
		if (lines.length > 0) return lines.reverse().join("\n");
	}
	return result.output?.slice(-4096) || (result.exitCode === -1 ? "(running...)" : "(no output)");
}

/** Display-only projection: preserve sibling state without promoting previews to receipts. */
export function formatPartialResults(results: readonly SingleResult[], formatTool: ToolSummary): string {
	return results
		.map((result) => {
			const icon = result.exitCode === -1 ? "⏳" : failedResult(result) ? "✗" : "✓";
			return `${icon} ${result.nodeId ?? result.agent}\n${partialOutput(result, formatTool)}`;
		})
		.join("\n\n");
}

export function laneResult(
	result: SingleResult,
): void | { status: "failed" } | { status: "unsettled"; settlement: Promise<void> } {
	if (result.process?.terminationObserved === false)
		// A copy without the live Promise cannot prove termination, so the lane keeps its reservation.
		return { status: "unsettled", settlement: result.process.settlement ?? new Promise<void>(() => {}) };
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
