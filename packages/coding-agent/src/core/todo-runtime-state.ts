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
