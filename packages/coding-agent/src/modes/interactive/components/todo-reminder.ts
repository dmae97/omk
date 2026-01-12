import { Box, Container, Spacer, Text } from "@oh-my-pi/pi-tui";
import type { TodoItem } from "../../../core/tools/todo-write";
import { theme } from "../theme/theme";

/**
 * Component that renders a todo completion reminder notification.
 * Shows when the agent stops with incomplete todos.
 */
export class TodoReminderComponent extends Container {
	private todos: TodoItem[];
	private attempt: number;
	private maxAttempts: number;
	private box: Box;

	constructor(todos: TodoItem[], attempt: number, maxAttempts: number) {
		super();
		this.todos = todos;
		this.attempt = attempt;
		this.maxAttempts = maxAttempts;

		this.addChild(new Spacer(1));

		this.box = new Box(1, 1, (t) => theme.inverse(theme.fg("warning", t)));
		this.addChild(this.box);

		this.rebuild();
	}

	private rebuild(): void {
		this.box.clear();

		const count = this.todos.length;
		const label = count === 1 ? "todo" : "todos";
		const header = `${theme.icon.warning} ${count} incomplete ${label} - reminder ${this.attempt}/${this.maxAttempts}`;

		this.box.addChild(new Text(header, 0, 0));
		this.box.addChild(new Spacer(1));

		const todoList = this.todos.map((t) => `  ${theme.checkbox.unchecked} ${t.content}`).join("\n");
		this.box.addChild(new Text(theme.italic(todoList), 0, 0));
	}
}
