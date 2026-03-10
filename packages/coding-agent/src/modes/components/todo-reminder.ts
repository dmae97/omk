import { Box, Container, Spacer, Text } from "@oh-my-pi/pi-tui";
import { theme } from "../../modes/theme/theme";
import type { TodoItem } from "../../tools/todo-write";

/**
 * Component that renders a todo completion reminder notification.
 * Shows when the agent stops with incomplete todos.
 */
export class TodoReminderComponent extends Container {
	#box: Box;

	constructor(
		private readonly todos: TodoItem[],
		private readonly attempt: number,
		private readonly maxAttempts: number,
	) {
		super();

		this.addChild(new Spacer(1));

		this.#box = new Box(1, 1, t => theme.inverse(theme.fg("warning", t)));
		this.addChild(this.#box);

		this.#rebuild();
	}

	#rebuild(): void {
		this.#box.clear();

		const count = this.todos.length;
		const label = count === 1 ? "todo" : "todos";
		const header = `${theme.icon.warning} ${count} incomplete ${label} - reminder ${this.attempt}/${this.maxAttempts}`;

		this.#box.addChild(new Text(header, 0, 0));
		this.#box.addChild(new Spacer(1));

		const todoList = this.todos
			.map(t => {
				const line = `  ${theme.checkbox.unchecked} ${t.content}`;
				if (!t.details) return line;
				const detailLines = t.details.split("\n").map(l => `    ${l}`);
				return [line, ...detailLines].join("\n");
			})
			.join("\n");
		this.#box.addChild(new Text(theme.italic(todoList), 0, 0));
	}
}
