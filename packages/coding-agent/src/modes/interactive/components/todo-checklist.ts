import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/omk-tui";
import { EMPTY_TODO_STATE, nextActiveTodo, summary, type TodoItem, type TodoState } from "../../../core/todo-state.ts";
import { type ThemeColor, theme } from "../theme/theme.ts";

const STATUS_ICON: Record<TodoItem["status"], string> = {
	done: "[x]",
	active: "[>]",
	pending: "[ ]",
	blocked: "[!]",
};

const STATUS_ICON_COLOR: Record<TodoItem["status"], ThemeColor> = {
	done: "success",
	active: "accent",
	pending: "muted",
	blocked: "warning",
};

/**
 * Widget that renders the dynamic LLM-generated TODO checklist as a bordered
 * panel, mirroring the divider / text-line style of {@link ControlPanelComponent}.
 *
 * State is pulled from an injected getter so the panel always reflects the
 * latest todo list. Coloring is suppressed (plain text) when `NO_COLOR` is set.
 */
export class TodoChecklistComponent implements Component {
	private readonly stateGetter: () => TodoState;
	private lastState: TodoState = EMPTY_TODO_STATE;

	constructor(stateGetter: () => TodoState) {
		this.stateGetter = stateGetter;
	}

	/** Clear the cached snapshot. Output is recomputed on the next render. */
	invalidate(): void {
		this.lastState = EMPTY_TODO_STATE;
	}

	/** Release resources. This component holds no external handles. */
	dispose(): void {
		this.lastState = EMPTY_TODO_STATE;
	}

	render(width: number): string[] {
		if (width <= 0) {
			return [];
		}

		const state = this.stateGetter();
		this.lastState = state;
		if (state.items.length === 0) {
			return [];
		}

		const counts = summary(state);
		const lines: string[] = [];
		lines.push(this.headerDivider(width, counts.done, counts.total));
		for (const item of state.items) {
			lines.push(this.itemLine(width, item));
		}
		lines.push(this.endDivider(width));
		return lines;
	}

	private noColor(): boolean {
		return process.env.NO_COLOR !== undefined;
	}

	private color(color: ThemeColor, text: string): string {
		return this.noColor() ? text : theme.fg(color, text);
	}

	private bold(text: string): string {
		return this.noColor() ? text : theme.bold(text);
	}

	private boldColor(color: ThemeColor, text: string): string {
		return this.bold(this.color(color, text));
	}

	private clipLine(line: string, width: number): string {
		if (visibleWidth(line) <= width) {
			return line;
		}
		return truncateToWidth(line, width, "");
	}

	private headerDivider(width: number, done: number, total: number): string {
		const labelPlain = `TODO  [${done}/${total}]`;
		const prefix = this.color("border", "+-- ");
		const coloredLabel = `${this.boldColor("accent", "TODO")}  ${this.color("muted", `[${done}/${total}]`)}`;
		const visiblePrefix = visibleWidth("+-- ");
		const labelWidth = visibleWidth(labelPlain);
		const fillWidth = Math.max(0, width - visiblePrefix - labelWidth - 1);
		return this.clipLine(`${prefix}${coloredLabel}${this.color("border", ` ${"-".repeat(fillWidth)}`)}`, width);
	}

	private endDivider(width: number): string {
		const prefix = this.color("border", "+-- ");
		const label = this.boldColor("borderMuted", "END");
		const visiblePrefix = visibleWidth("+-- ");
		const labelWidth = visibleWidth("END");
		const fillWidth = Math.max(0, width - visiblePrefix - labelWidth - 1);
		return this.clipLine(`${prefix}${label}${this.color("border", ` ${"-".repeat(fillWidth)}`)}`, width);
	}

	private itemLine(width: number, item: TodoItem): string {
		const prefix = this.color("borderMuted", "| ");
		const icon = this.color(STATUS_ICON_COLOR[item.status], STATUS_ICON[item.status]);
		const labelBody = this.renderLabel(item);
		let body = `${icon} ${labelBody}`;
		if (item.detail) {
			body += this.color("dim", ` — ${item.detail}`);
		}
		return this.clipLine(`${prefix}${body}`, width);
	}

	private renderLabel(item: TodoItem): string {
		switch (item.status) {
			case "done":
				return this.color("dim", item.label);
			case "active":
				return this.boldColor("accent", item.label);
			case "pending":
				return this.color("text", item.label);
			case "blocked":
				return this.color("warning", item.label);
		}
	}

	// Exposed for tests / debugging: the most recently rendered state.
	getLastState(): TodoState {
		return this.lastState;
	}

	// Exposed for tests / debugging: the next actionable todo.
	getNextActive(): TodoItem | undefined {
		return nextActiveTodo(this.lastState);
	}
}
