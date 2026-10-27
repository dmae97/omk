/**
 * Spec 096: the TUI rendering of `task_result` (emitted only with OMK_TASK_RESULT on).
 * Kept out of interactive-mode.ts; ChatContainer feeds every session event through here.
 */
import { type Component, Spacer, Text } from "omk-tui";
import { taskResultSurfaceLine } from "../../core/task-result-format.ts";
import { theme } from "./theme/theme.ts";

/** The dim status line for a `task_result` or `task_result_downgrade` event, the same text print mode writes. */
export function taskResultStatusLine(event: { type: string }): string | undefined {
	return taskResultSurfaceLine(event);
}

/** Spacer + dim line for the transcript, or undefined for any other event. */
export function taskResultStatusComponents(event: { type: string }): Component[] | undefined {
	const line = taskResultStatusLine(event);
	return line === undefined ? undefined : [new Spacer(1), new Text(theme.fg("dim", line), 1, 0)];
}
