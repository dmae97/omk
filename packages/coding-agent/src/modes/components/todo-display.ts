import * as path from "node:path";
import { Ellipsis, Text, truncateToWidth } from "@oh-my-pi/pi-tui";
import { logger } from "@oh-my-pi/pi-utils";
import { theme } from "../../modes/theme/theme";
import type { TodoItem } from "../../modes/types";
import { Hasher, type RenderCache } from "../../tui";

const TODO_FILE_NAME = "todos.json";

interface TodoFile {
	updatedAt: number;
	todos: TodoItem[];
}

async function loadTodoFile(filePath: string): Promise<TodoFile | null> {
	const file = Bun.file(filePath);
	if (!(await file.exists())) return null;
	try {
		const text = await file.text();
		const data = JSON.parse(text) as TodoFile;
		if (!data || !Array.isArray(data.todos)) return null;
		return data;
	} catch (error) {
		logger.warn("Failed to read todo file", { path: filePath, error: String(error) });
		return null;
	}
}

export class TodoDisplayComponent {
	todos: TodoItem[] = [];
	#expanded = false;
	#visible = false;
	#cached: RenderCache | undefined;

	constructor(private readonly sessionFile: string | null) {}

	async loadTodos(): Promise<void> {
		if (!this.sessionFile) {
			this.todos = [];
			this.#visible = false;
			return;
		}

		const artifactsDir = this.sessionFile.slice(0, -6); // strip .jsonl extension
		const todoPath = path.join(artifactsDir, TODO_FILE_NAME);
		const data = await loadTodoFile(todoPath);
		this.todos = data?.todos ?? [];
		this.#visible = this.todos.length > 0;
		this.#cached = undefined;
	}

	setTodos(todos: TodoItem[]): void {
		this.todos = todos;
		this.#visible = this.todos.length > 0;
		this.#cached = undefined;
	}

	setExpanded(expanded: boolean): void {
		this.#expanded = expanded;
		this.#cached = undefined;
	}

	isVisible(): boolean {
		return this.#visible;
	}

	render(width: number): string[] {
		if (!this.#visible || this.todos.length === 0) {
			return [];
		}

		const key = new Hasher().bool(this.#expanded).u32(width).digest();
		if (this.#cached?.key === key) return this.#cached.lines;

		const lines: string[] = [];
		const maxItems = this.#expanded ? this.todos.length : Math.min(5, this.todos.length);
		const hasMore = !this.#expanded && this.todos.length > 5;

		for (let i = 0; i < maxItems; i++) {
			const todo = this.todos[i];
			const prefix = i === 0 ? `  ${theme.tree.hook} ` : "    ";

			let checkbox: string;
			let text: string;

			if (todo.status === "completed") {
				checkbox = theme.checkbox.checked;
				text = theme.fg("success", `${prefix}${checkbox} ${theme.strikethrough(todo.content)}`);
			} else if (todo.status === "in_progress") {
				checkbox = theme.checkbox.unchecked;
				text = theme.fg("accent", `${prefix}${checkbox} ${todo.content}`);
			} else {
				checkbox = theme.checkbox.unchecked;
				text = theme.fg("dim", `${prefix}${checkbox} ${todo.content}`);
			}

			lines.push(text);
		}

		if (hasMore) {
			lines.push(theme.fg("dim", `        ${theme.tree.hook} +${this.todos.length - 5} more (Ctrl+T to expand)`));
		}

		const result = lines.map(l => truncateToWidth(l, width, Ellipsis.Omit));
		this.#cached = { key, lines: result };
		return result;
	}

	getRenderedComponent(): Text | null {
		if (!this.#visible) return null;
		const lines = this.render(80);
		return new Text(lines.join("\n"), 0, 0);
	}
}
