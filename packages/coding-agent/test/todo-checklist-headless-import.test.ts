import { describe, expect, it, vi } from "vitest";
import todoChecklist from "../src/core/extensions/builtin/todo-checklist.ts";
import type { ExtensionAPI, ToolDefinition } from "../src/core/extensions/types.ts";

// The widget component pulls omk-tui. Headless sessions (`omk -p` workers) must
// not load it on every update_todo, and UI sessions must not hide real failures.
const loads = vi.hoisted(() => ({ component: 0 }));

vi.mock("../src/modes/interactive/components/todo-checklist.ts", async (importOriginal) => {
	loads.component++;
	return importOriginal();
});

function registerUpdateTodo(): ToolDefinition {
	let tool: ToolDefinition | undefined;
	const omk = {
		on: () => {},
		registerTool: (definition: ToolDefinition) => {
			tool = definition;
		},
	} as unknown as ExtensionAPI;
	todoChecklist(omk);
	if (!tool) throw new Error("update_todo was not registered");
	return tool;
}

const PARAMS = { items: [{ id: "a", label: "write tests", status: "active" }] };

describe("update_todo widget loading", () => {
	it("skips the TUI widget import in headless sessions", async () => {
		const setWidget = vi.fn();
		const result = await registerUpdateTodo().execute("c1", PARAMS, undefined, undefined, {
			hasUI: false,
			ui: { setWidget },
		} as never);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining("0/1 done") });
		expect(setWidget).not.toHaveBeenCalled();
		expect(loads.component).toBe(0);
	});

	it("mounts the widget when a UI is present", async () => {
		const setWidget = vi.fn();
		await registerUpdateTodo().execute("c2", PARAMS, undefined, undefined, {
			hasUI: true,
			ui: { setWidget },
		} as never);
		expect(loads.component).toBe(1);
		expect(setWidget).toHaveBeenCalledWith("omk-todo", expect.any(Function), { placement: "aboveEditor" });
	});

	it("surfaces widget failures instead of swallowing them when a UI is present", async () => {
		const setWidget = vi.fn(() => {
			throw new Error("widget exploded");
		});
		await expect(
			registerUpdateTodo().execute("c3", PARAMS, undefined, undefined, { hasUI: true, ui: { setWidget } } as never),
		).rejects.toThrow("widget exploded");
	});
});
