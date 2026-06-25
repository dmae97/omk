import { describe, expect, it } from "vitest";
import {
	clearTodo,
	EMPTY_TODO_STATE,
	nextActiveTodo,
	setTodoItems,
	summary,
	type TodoItem,
	updateTodoStatus,
} from "../src/core/todo-state.ts";

describe("todo-state pure functions", () => {
	const items: TodoItem[] = [
		{ id: "1", label: "A", status: "pending" },
		{ id: "2", label: "B", status: "active" },
		{ id: "3", label: "C", status: "done" },
		{ id: "4", label: "D", status: "blocked" },
	];

	it("setTodoItems replaces all items, preserves order, and sets updatedAt to now", () => {
		const before = Date.now();
		const result = setTodoItems(EMPTY_TODO_STATE, items);
		const after = Date.now();

		expect(result.items.map((i) => i.id)).toEqual(["1", "2", "3", "4"]);
		expect(result.items).toHaveLength(4);
		expect(result.updatedAt).toBeGreaterThanOrEqual(before);
		expect(result.updatedAt).toBeLessThanOrEqual(after);
		// Defensive copy: returned array is not the input reference.
		expect(result.items).not.toBe(items);
	});

	it("setTodoItems fully replaces prior items when state already populated", () => {
		const first = setTodoItems(EMPTY_TODO_STATE, items);
		const replacement: TodoItem[] = [{ id: "x", label: "X", status: "pending" }];
		const result = setTodoItems(first, replacement);

		expect(result.items.map((i) => i.id)).toEqual(["x"]);
		expect(result.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
	});

	it("updateTodoStatus updates the matching item and bumps updatedAt", () => {
		const state = setTodoItems(EMPTY_TODO_STATE, items);
		const before = Date.now();
		const result = updateTodoStatus(state, "1", "active");
		const after = Date.now();

		expect(result).not.toBe(state);
		expect(result.items.find((i) => i.id === "1")?.status).toBe("active");
		// Untouched items keep their status.
		expect(result.items.find((i) => i.id === "2")?.status).toBe("active");
		expect(result.items.find((i) => i.id === "3")?.status).toBe("done");
		expect(result.items.find((i) => i.id === "4")?.status).toBe("blocked");
		expect(result.updatedAt).toBeGreaterThanOrEqual(before);
		expect(result.updatedAt).toBeLessThanOrEqual(after);
	});

	it("updateTodoStatus is a no-op (same reference, unchanged updatedAt) when id is missing", () => {
		const state = setTodoItems(EMPTY_TODO_STATE, items);
		const result = updateTodoStatus(state, "does-not-exist", "done");

		expect(result).toBe(state);
		expect(result.updatedAt).toBe(state.updatedAt);
	});

	it("clearTodo empties items and sets updatedAt", () => {
		const state = setTodoItems(EMPTY_TODO_STATE, items);
		const before = Date.now();
		const cleared = clearTodo(state);
		const after = Date.now();

		expect(cleared.items).toEqual([]);
		expect(cleared.updatedAt).toBeGreaterThanOrEqual(before);
		expect(cleared.updatedAt).toBeLessThanOrEqual(after);
	});

	it("summary counts each status plus the total", () => {
		const state = setTodoItems(EMPTY_TODO_STATE, items);
		expect(summary(state)).toEqual({ total: 4, done: 1, active: 1, pending: 1, blocked: 1 });
	});

	it("summary of an empty state is all zeros", () => {
		expect(summary(EMPTY_TODO_STATE)).toEqual({ total: 0, done: 0, active: 0, pending: 0, blocked: 0 });
	});

	it("nextActiveTodo prefers active over pending and blocked", () => {
		const state = setTodoItems(EMPTY_TODO_STATE, items);
		expect(nextActiveTodo(state)?.id).toBe("2");
	});

	it("nextActiveTodo respects list order among equal-priority statuses", () => {
		const state = setTodoItems(EMPTY_TODO_STATE, [
			{ id: "a", label: "first", status: "active" },
			{ id: "b", label: "second", status: "active" },
		]);
		expect(nextActiveTodo(state)?.id).toBe("a");
	});

	it("nextActiveTodo falls back to pending when there is no active item", () => {
		const state = setTodoItems(EMPTY_TODO_STATE, [
			{ id: "1", label: "A", status: "pending" },
			{ id: "2", label: "B", status: "done" },
			{ id: "3", label: "C", status: "blocked" },
		]);
		expect(nextActiveTodo(state)?.id).toBe("1");
	});

	it("nextActiveTodo falls back to blocked when there is no active or pending item", () => {
		const state = setTodoItems(EMPTY_TODO_STATE, [
			{ id: "1", label: "A", status: "done" },
			{ id: "2", label: "B", status: "blocked" },
		]);
		expect(nextActiveTodo(state)?.id).toBe("2");
	});

	it("nextActiveTodo returns undefined when every item is done or the list is empty", () => {
		const allDone = setTodoItems(EMPTY_TODO_STATE, [{ id: "1", label: "A", status: "done" }]);
		expect(nextActiveTodo(allDone)).toBeUndefined();
		expect(nextActiveTodo(EMPTY_TODO_STATE)).toBeUndefined();
	});
});
