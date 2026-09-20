import type { CompactionControlState } from "./compaction/control-state.ts";
import { EMPTY_TODO_STATE, type TodoState } from "./todo-state.ts";

let currentTodoState: TodoState = EMPTY_TODO_STATE;

export function getCurrentTodoState(): TodoState {
	return currentTodoState;
}

export function setCurrentTodoState(state: TodoState): void {
	currentTodoState = state;
}

export function resetCurrentTodoState(): void {
	currentTodoState = EMPTY_TODO_STATE;
}

/**
 * Host control authority for the compaction service. Maps the live TODO ledger
 * onto the preserved-provenance fields: every non-done item stays an open task
 * so resume never mistakes "summarized" for "finished", and blocked items keep
 * their blocker reason. The snapshot is deterministic for unchanged state —
 * it deliberately excludes `updatedAt` — because the commit boundary digests
 * it and discards a summary captured under different control state. `branch`
 * stays null until a VCS-branch authority is attached; no production producer
 * exists today and an empty string would be worse than an explicit null.
 */
export function todoControlState(): CompactionControlState {
	const openTasks: string[] = [];
	const blockerReasons: string[] = [];
	for (const item of currentTodoState.items) {
		if (item.status === "done") continue;
		openTasks.push(`${item.id} ${item.label}`);
		if (item.status === "blocked") {
			blockerReasons.push(
				item.detail === undefined ? `${item.id} ${item.label}` : `${item.id} ${item.label} — ${item.detail}`,
			);
		}
	}
	return { openTasks, blockerReasons, branch: null };
}
