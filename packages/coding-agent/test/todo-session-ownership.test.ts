import { afterEach, describe, expect, it } from "vitest";
import { resetCurrentTodoState, setCurrentTodoState, todoControlState } from "../src/core/todo-runtime-state.ts";

afterEach(() => resetCurrentTodoState());

describe("session-owned TODO control state", () => {
	it("does not let another session's reset erase this session's open tasks", () => {
		setCurrentTodoState({ items: [{ id: "a", label: "Fix", status: "active" }], updatedAt: 1 }, "session-a");
		setCurrentTodoState({ items: [{ id: "b", label: "Other", status: "active" }], updatedAt: 2 }, "session-b");
		resetCurrentTodoState("session-b");
		expect(todoControlState("session-a").openTasks).toEqual(["a Fix"]);
		expect(todoControlState("session-b").openTasks).toEqual([]);
	});
});
