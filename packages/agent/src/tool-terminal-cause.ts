/**
 * Spec 119 AU4: in-memory terminal cause of a tool call that the tool itself
 * ended by timeout or abort. Never serialized: not in the result, `details.omk`,
 * events or the session file. The disposition envelope is unchanged.
 */
export type ToolTerminalCause = "timeout" | "aborted";

/** Thrown by a tool that ended on its own timeout or on its abort signal. The message is the model-visible text. */
export class ToolTerminalError extends Error {
	readonly terminalCause: ToolTerminalCause;
	constructor(terminalCause: ToolTerminalCause, message: string) {
		super(message);
		this.terminalCause = terminalCause;
	}
}

export function toolTerminalCauseOf(error: unknown): ToolTerminalCause | undefined {
	return error instanceof ToolTerminalError ? error.terminalCause : undefined;
}

/** Mirrors coding-agent `goalAutonomyEnabled()` (default on; `0`/`false`/`off` opt out); the agent package cannot import it. */
export function toolTerminalCauseRecordingEnabled(): boolean {
	const value = process.env.OMK_GOAL_AUTONOMY?.trim().toLowerCase();
	return value !== "0" && value !== "false" && value !== "off";
}

const MAX_CAUSES = 1024;
const causes = new Map<string, ToolTerminalCause>();

/** Boundary-only: attach the cause to the settled call. Bounded so an unread cause cannot leak. */
export function recordToolTerminalCause(toolCallId: string, cause: ToolTerminalCause): void {
	causes.delete(toolCallId);
	causes.set(toolCallId, cause);
	while (causes.size > MAX_CAUSES) {
		const oldest = causes.keys().next().value;
		if (oldest === undefined) break;
		causes.delete(oldest);
	}
}

/** Read and forget the cause of a settled call. */
export function takeToolTerminalCause(toolCallId: string): ToolTerminalCause | undefined {
	const cause = causes.get(toolCallId);
	causes.delete(toolCallId);
	return cause;
}
