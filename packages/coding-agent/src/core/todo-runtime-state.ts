import type { CompactionControlState } from "./compaction/control-state.ts";
import {
	EMPTY_TODO_STATE,
	nextActiveTodo,
	TODO_DIFFICULTIES,
	TODO_KINDS,
	type TodoDifficulty,
	type TodoKind,
	type TodoState,
} from "./todo-state.ts";

const DEFAULT_OWNER = "default";
const states = new Map<string, TodoState>();
let currentOwner = DEFAULT_OWNER;

/** Without an owner this is the compatibility view of the most recently updated session. */
export function getCurrentTodoState(owner = currentOwner): TodoState {
	return states.get(owner) ?? EMPTY_TODO_STATE;
}

export function setCurrentTodoState(state: TodoState, owner = DEFAULT_OWNER): void {
	currentOwner = owner;
	states.set(owner, state);
}

export function resetCurrentTodoState(owner?: string): void {
	if (owner === undefined) {
		states.clear();
		currentOwner = DEFAULT_OWNER;
		return;
	}
	states.delete(owner);
	if (currentOwner === owner) currentOwner = DEFAULT_OWNER;
}

/**
 * Kind of the todo the run is on now (spec 049 R3): `nextActiveTodo`'s item, `undefined` when there is
 * none or its kind is unknown. Read-only; this and `activeTodoDifficulty` are spec 037's only inputs from todos.
 */
export function activeTodoKind(owner?: string): TodoKind | undefined {
	const kind = nextActiveTodo(getCurrentTodoState(owner))?.kind;
	return kind !== undefined && TODO_KINDS.includes(kind) ? kind : undefined;
}

/** The model's difficulty estimate for the same item as `activeTodoKind`; `undefined` when not given. */
export function activeTodoDifficulty(owner?: string): TodoDifficulty | undefined {
	const difficulty = nextActiveTodo(getCurrentTodoState(owner))?.difficulty;
	return difficulty !== undefined && TODO_DIFFICULTIES.includes(difficulty) ? difficulty : undefined;
}

/**
 * Host control authority for the compaction service. Maps the live TODO ledger
 * onto the preserved-provenance fields: every non-done item stays an open task
 * so resume never mistakes "summarized" for "finished", and blocked items keep
 * their blocker reason. The snapshot is deterministic for unchanged state —
 * it deliberately excludes `updatedAt` — because the commit boundary digests
 * it and discards a summary captured under different control state. `branch`
 * stays null until a VCS-branch authority is attached.
 */
export function todoControlState(owner?: string): CompactionControlState {
	const openTasks: string[] = [];
	const blockerReasons: string[] = [];
	for (const item of getCurrentTodoState(owner).items) {
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
