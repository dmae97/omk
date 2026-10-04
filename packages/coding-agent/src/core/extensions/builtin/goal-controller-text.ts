import type { DurableGoalSnapshot } from "../../durable-goal.ts";
import { formatDurableGoalCheckpoint } from "../../durable-goal-checkpoint.ts";
import { GOAL_ACCEPTANCE_TIMEOUT_MS, type GoalAcceptanceResult } from "../../goal-verification.ts";
import { redactSensitiveTextForced } from "../../redaction.ts";

export function renderGoal(goal: DurableGoalSnapshot, ...extra: readonly string[]): string {
	return [
		`goal ${goal.ref.id} r${goal.ref.revision} ${goal.status} ${goal.completedRounds}/${goal.maxRounds}`,
		formatDurableGoalCheckpoint(goal),
		...extra,
	]
		.filter((line) => line.length > 0)
		.join("\n");
}

export function checkpointPayload(text: string): string | null {
	if (text === "checkpoint") return "";
	return text.startsWith("checkpoint ") ? text.slice("checkpoint ".length).trim() : null;
}

export function unavailableWorkspaceCode(error: unknown): "ENODEV" | "ESTALE" | "ENOTCONN" | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	const code = error.code;
	return code === "ENODEV" || code === "ESTALE" || code === "ENOTCONN" ? code : undefined;
}

export function continuationSeam(goal: DurableGoalSnapshot, trustedDigests: ReadonlySet<string>): string {
	const checkpoint = goal.checkpoint;
	if (!checkpoint) return "";
	if (trustedDigests.has(checkpoint.digest)) {
		return `\n\nSeam checkpoint (explicit user continuity context, not current-round proof):\n${formatDurableGoalCheckpoint(goal)}`;
	}
	return `\n\nAn untrusted workspace checkpoint exists at digest ${checkpoint.digest}; its prose was not loaded as user authority.`;
}

/** One redacted line, safe to show the operator or quote to the model as the command the user approved. */
export function displayCommand(command: string): string {
	return redactSensitiveTextForced(command).replace(/\s+/g, " ").slice(0, 200);
}

export function displayError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return redactSensitiveTextForced(message).replace(/\s+/g, " ").slice(0, 240);
}

export function receiptLabel(result: GoalAcceptanceResult): string {
	return `receipt ${result.receiptId.slice(0, 8)}`;
}

/** Why a check that ran did not pass, without its output. */
export function failureText(result: GoalAcceptanceResult): string {
	if (result.status === "failed") return `failed with exit code ${result.exitCode}`;
	if (result.status === "timeout") return `timed out after ${GOAL_ACCEPTANCE_TIMEOUT_MS / 1000} s`;
	return `passed but its receipt failed the evidence gate: ${result.gateReason}`;
}
