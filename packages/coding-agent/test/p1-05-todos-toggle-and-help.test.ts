import { Container, Text } from "omk-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { setTodoItems } from "../src/core/todo-state.ts";
import { renderOmkStatusHeader } from "../src/modes/interactive/components/omk-status-header.ts";
import { TodoChecklistComponent } from "../src/modes/interactive/components/todo-checklist.ts";
import { renderWidgetPair } from "../src/modes/interactive/components/widget-container.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("P1-05: files/mouse help & TODOS hide/show button", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("exposes /todos and updated /files help descriptions in builtin slash commands", () => {
		const files = BUILTIN_SLASH_COMMANDS.find((c) => c.name === "files");
		const todos = BUILTIN_SLASH_COMMANDS.find((c) => c.name === "todos");
		expect(files?.description).toContain("mouse");
		expect(files?.description).toContain("help");
		expect(todos?.description).toMatch(/hide|show|todo/i);
	});

	it("persists showTodos with default true and OMK_SHOW_TODOS=0 fallback in SettingsManager", () => {
		const prev = process.env.OMK_SHOW_TODOS;
		try {
			delete process.env.OMK_SHOW_TODOS;
			const sm = SettingsManager.inMemory();
			expect(sm.getShowTodos()).toBe(true);
			sm.setShowTodos(false);
			expect(sm.getShowTodos()).toBe(false);

			process.env.OMK_SHOW_TODOS = "0";
			const fresh = SettingsManager.inMemory();
			expect(fresh.getShowTodos()).toBe(false);
			// Explicit setting takes precedence over env
			fresh.setShowTodos(true);
			expect(fresh.getShowTodos()).toBe(true);
		} finally {
			if (prev === undefined) delete process.env.OMK_SHOW_TODOS;
			else process.env.OMK_SHOW_TODOS = prev;
		}
	});

	it("renders clickable Todos hide/show button chip in OMK STATUS header and hit-tests clicks", async () => {
		const { hitTestOmkHeaderChips } = await import("../src/modes/interactive/todos-visibility.ts");
		const base = {
			version: "3.0.0",
			modelLabel: "anthropic/claude-opus-5-5",
			thinkingLevel: "medium",
			runState: "ok" as const,
			runLabel: "idle",
			verifyState: "unknown" as const,
			verifyLabel: "unverified",
			contextPercent: 10,
			contextWindowTokens: 1_000_000,
			cwdLabel: "~/repo",
			gitBranch: "main",
			planBadge: undefined,
			mcpReady: 0,
			mcpTotal: 0,
			herdrActive: false,
			filesSidebarMode: "open" as const,
		};

		const shown = renderOmkStatusHeader({ ...base, todosVisible: true }, 120)[0] ?? "";
		const hidden = renderOmkStatusHeader({ ...base, todosVisible: false }, 120)[0] ?? "";
		expect(shown).toContain("☑ Todos ▾");
		expect(hidden).toContain("☐ Todos ▸");

		// Left gutter = 28 -> row 1 starts at col 29 ("┌─ ◧ Files ◂  ☑ Todos ▾  ◉ OMK · STATUS ...")
		expect(hitTestOmkHeaderChips(34, 28, "open")).toBe("files");
		expect(hitTestOmkHeaderChips(46, 28, "open")).toBe("todos");
		expect(hitTestOmkHeaderChips(80, 28, "open")).toBeUndefined();
	});

	it("renders [Hide]/[Show] toggle button on TodoChecklistComponent when showToggleButton is enabled", () => {
		const prevNoColor = process.env.NO_COLOR;
		process.env.NO_COLOR = "1";
		try {
			const state = setTodoItems({ items: [], updatedAt: 0 }, [{ id: "1", label: "Ship P1", status: "active" }]);
			let hidden = false;
			const comp = new TodoChecklistComponent(() => state, {
				showToggleButton: true,
				isHidden: () => hidden,
			});
			const expandedLines = comp.render(52);
			expect(expandedLines.length).toBe(3);
			expect(expandedLines[0]).toContain("[Hide]");

			hidden = true;
			const collapsedLines = comp.render(52);
			expect(collapsedLines.length).toBe(1);
			expect(collapsedLines[0]).toContain("hidden");
			expect(collapsedLines[0]).toContain("[Show]");
		} finally {
			if (prevNoColor === undefined) delete process.env.NO_COLOR;
			else process.env.NO_COLOR = prevNoColor;
		}
	});

	it("collapses above-editor TODO widgets when todosVisible is false and restores them when true", () => {
		const above = new Container();
		const below = new Container();
		const widgetsAbove = new Map<string, Text>([
			["omk-todo", new Text("TODO ITEM CONTENT", 0, 0)],
			["custom-info", new Text("KEEP ME", 0, 0)],
		]);
		const widgetsBelow = new Map<string, Text>();

		renderWidgetPair({
			widgetContainerAbove: above,
			widgetContainerBelow: below,
			extensionWidgetsAbove: widgetsAbove,
			extensionWidgetsBelow: widgetsBelow,
			ui: { requestRender() {} },
			filesSidebar: { isTodosVisible: () => false },
		});
		const hiddenText = above.render(100).join("\n");
		expect(hiddenText).not.toContain("TODO ITEM CONTENT");
		expect(hiddenText).toContain("TODOS hidden");
		expect(hiddenText).toContain("KEEP ME");

		renderWidgetPair({
			widgetContainerAbove: above,
			widgetContainerBelow: below,
			extensionWidgetsAbove: widgetsAbove,
			extensionWidgetsBelow: widgetsBelow,
			ui: { requestRender() {} },
			filesSidebar: { isTodosVisible: () => true },
		});
		const shownText = above.render(100).join("\n");
		expect(shownText).toContain("TODO ITEM CONTENT");
		expect(shownText).toContain("KEEP ME");
	});

	it("reports accurate files/mouse defaults, precedence, opt-outs, and persistence in /files help", async () => {
		const { formatFilesAndMouseHelp } = await import("../src/modes/interactive/todos-visibility.ts");
		const help = formatFilesAndMouseHelp("open", true, undefined);
		expect(help).toContain("default: on");
		expect(help).toContain("settings.json");
		expect(help).toContain("OMK_FILES_SIDEBAR=0");
		expect(help).toContain("OMK_TUI_MOUSE=0");
		expect(help).toMatch(/session-only|not saved/i);
	});
});
