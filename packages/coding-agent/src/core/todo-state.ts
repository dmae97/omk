/**
 * Pure state for the dynamic LLM-generated TODO checklist.
 *
 * All functions are pure and deterministic except `updatedAt`, which is set
 * to `Date.now()` on the mutating transitions. No I/O, no side effects.
 */

export type TodoStatus = "pending" | "active" | "done" | "blocked";

export interface TodoItem {
	id: string;
	label: string;
	status: TodoStatus;
	/** Optional human-readable detail appended after the label. */
	detail?: string;
}

export interface TodoState {
	items: TodoItem[];
	updatedAt: number;
}

export interface TodoSummary {
	total: number;
	done: number;
	active: number;
	pending: number;
	blocked: number;
}

export const EMPTY_TODO_STATE: TodoState = { items: [], updatedAt: 0 };

/**
 * Replace every item in the state. Order is preserved as given. A defensive
 * shallow copy of each item is stored so external mutation cannot corrupt the
 * returned state.
 */
export function setTodoItems(state: TodoState, items: TodoItem[]): TodoState {
	return {
		...state,
		items: items.map((item) => ({ ...item })),
		updatedAt: Date.now(),
	};
}

/**
 * Update the status of a single item by id. Returns the same state reference
 * (no-op) when the id is not present, otherwise returns a new state with the
 * item updated and `updatedAt` bumped.
 */
export function updateTodoStatus(state: TodoState, id: string, status: TodoStatus): TodoState {
	let found = false;
	const nextItems = state.items.map((item) => {
		if (item.id === id) {
			found = true;
			return { ...item, status };
		}
		return item;
	});
	if (!found) {
		return state;
	}
	return { items: nextItems, updatedAt: Date.now() };
}

/**
 * Remove all items. Returns a fresh empty state with `updatedAt` bumped.
 */
export function clearTodo(state: TodoState): TodoState {
	return { ...state, items: [], updatedAt: Date.now() };
}

/**
 * Count items per status plus the total.
 */
export function summary(state: TodoState): TodoSummary {
	let done = 0;
	let active = 0;
	let pending = 0;
	let blocked = 0;
	for (const item of state.items) {
		switch (item.status) {
			case "done":
				done++;
				break;
			case "active":
				active++;
				break;
			case "pending":
				pending++;
				break;
			case "blocked":
				blocked++;
				break;
		}
	}
	return { total: state.items.length, done, active, pending, blocked };
}

/**
 * Pick the next actionable todo. Precedence is: first `active`, then first
 * `pending`, then first `blocked` (in list order). Returns `undefined` when
 * there is no non-done candidate.
 */
export function nextActiveTodo(state: TodoState): TodoItem | undefined {
	const active = state.items.find((item) => item.status === "active");
	if (active) {
		return active;
	}
	const pending = state.items.find((item) => item.status === "pending");
	if (pending) {
		return pending;
	}
	return state.items.find((item) => item.status === "blocked");
}
