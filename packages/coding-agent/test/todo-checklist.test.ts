import { visibleWidth } from "@earendil-works/omk-tui";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setTodoItems, type TodoItem, type TodoState } from "../src/core/todo-state.ts";
import { TodoChecklistComponent } from "../src/modes/interactive/components/todo-checklist.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const SAMPLE_ITEMS: TodoItem[] = [
	{ id: "1", label: "Write tests", status: "done" },
	{ id: "2", label: "Build feature", status: "active", detail: "core module" },
	{ id: "3", label: "Deploy", status: "pending" },
	{ id: "4", label: "Fix CI", status: "blocked" },
];

function makeState(items: TodoItem[]): TodoState {
	return setTodoItems({ items: [], updatedAt: 0 }, items);
}

describe("TodoChecklistComponent (NO_COLOR plain text)", () => {
	const originalNoColor = process.env.NO_COLOR;

	beforeEach(() => {
		process.env.NO_COLOR = "1";
	});

	afterEach(() => {
		if (originalNoColor === undefined) {
			delete process.env.NO_COLOR;
		} else {
			process.env.NO_COLOR = originalNoColor;
		}
	});

	it("renders the expected plain-text block for a known item set at width 40", () => {
		const component = new TodoChecklistComponent(() => makeState(SAMPLE_ITEMS));
		const lines = component.render(40);
		const expected =
			"+-- TODO  [1/4] ------------------------\n" +
			"| [x] Write tests\n" +
			"| [>] Build feature — core module\n" +
			"| [ ] Deploy\n" +
			"| [!] Fix CI\n" +
			"+-- END --------------------------------";
		expect(lines.join("\n")).toBe(expected);
	});

	it("emits no ANSI escape sequences when NO_COLOR is set", () => {
		const component = new TodoChecklistComponent(() => makeState(SAMPLE_ITEMS));
		const lines = component.render(60);
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			expect(line).not.toContain("\u001b");
		}
	});

	it("returns [] when width <= 0", () => {
		const component = new TodoChecklistComponent(() => makeState(SAMPLE_ITEMS));
		expect(component.render(0)).toEqual([]);
		expect(component.render(-3)).toEqual([]);
	});

	it("returns [] when there are no items", () => {
		const component = new TodoChecklistComponent(() => makeState([]));
		expect(component.render(40)).toEqual([]);
	});

	it("invalidate() and dispose() do not throw and reset internal state", () => {
		const component = new TodoChecklistComponent(() => makeState(SAMPLE_ITEMS));
		component.render(40);
		expect(() => component.invalidate()).not.toThrow();
		expect(() => component.dispose()).not.toThrow();
		// Still renders correctly after invalidate/dispose.
		expect(component.render(40).length).toBe(6);
	});
});

describe("TodoChecklistComponent width safety", () => {
	const originalNoColor = process.env.NO_COLOR;

	beforeAll(() => {
		// Plain text keeps width math deterministic regardless of TTY/capabilities.
		process.env.NO_COLOR = "1";
	});

	afterAll(() => {
		if (originalNoColor === undefined) {
			delete process.env.NO_COLOR;
		} else {
			process.env.NO_COLOR = originalNoColor;
		}
	});

	it("keeps every rendered line within the requested width across a range of widths", () => {
		const component = new TodoChecklistComponent(() => makeState(SAMPLE_ITEMS));
		for (const width of [5, 8, 10, 15, 20, 28, 40, 60, 100]) {
			const lines = component.render(width);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("TodoChecklistComponent color smoke", () => {
	const originalNoColor = process.env.NO_COLOR;

	beforeAll(() => {
		delete process.env.NO_COLOR;
		initTheme(undefined, false);
	});

	afterAll(() => {
		if (originalNoColor === undefined) {
			delete process.env.NO_COLOR;
		} else {
			process.env.NO_COLOR = originalNoColor;
		}
	});

	it("renders ANSI foreground color escapes when color is enabled", () => {
		const component = new TodoChecklistComponent(() => makeState(SAMPLE_ITEMS));
		const joined = component.render(60).join("\n");
		// theme.fg emits an SGR foreground sequence (truecolor 38;2;..;..;.. or 256-color 38;5;N).
		expect(joined).toContain("\u001b[38;");
		// theme.fg resets foreground with \x1b[39m.
		expect(joined).toContain("\u001b[39m");
	});
});
