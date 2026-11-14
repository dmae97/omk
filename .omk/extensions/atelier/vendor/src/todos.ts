import type { ExtensionContext } from "open-multi-agent-kit";
import { isRecord } from "./text.ts";
import type { NormalizedTodo } from "./types.ts";

/** Item of the classic `todo` tool. */
interface ClassicTodo {
	id: number;
	text: string;
	done: boolean;
}

/** Item of a task-list `todo` tool. */
interface TodoTask {
	id: number;
	subject: string;
	status: string;
}

const TODO_STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "completed"]);

const isTodoStatus = (value: string): value is NormalizedTodo["status"] => TODO_STATUSES.has(value);

const isClassicTodo = (item: unknown): item is ClassicTodo =>
	isRecord(item) &&
	typeof item.id === "number" &&
	typeof item.text === "string" &&
	typeof item.done === "boolean";

const isTodoTask = (item: unknown): item is TodoTask =>
	isRecord(item) &&
	typeof item.id === "number" &&
	typeof item.subject === "string" &&
	typeof item.status === "string";

/**
 * The todo list carried by `todo` tool details, or undefined when they hold no
 * well-formed list. Tasks with an unknown status are skipped.
 */
export function todosFromDetails(details: unknown): NormalizedTodo[] | undefined {
	if (!isRecord(details)) return undefined;
	const { todos, tasks } = details;
	if (Array.isArray(details.items) && details.items.every((item) => isRecord(item) && typeof item.id === "string" && typeof item.label === "string" && ["pending", "active", "done", "blocked"].includes(String(item.status)))) {
		return details.items.map((item, index) => ({
			id: index + 1, text: item.status === "blocked" ? `[blocked] ${item.label}` : item.label,
			status: item.status === "active" ? "in_progress" : item.status === "done" ? "completed" : "pending",
		}));
	}
	if (Array.isArray(todos) && todos.every(isClassicTodo)) {
		return todos.map((item) => ({
			id: item.id,
			text: item.text,
			status: item.done ? "completed" : "pending",
		}));
	}
	if (Array.isArray(tasks) && tasks.every(isTodoTask)) {
		return tasks.flatMap((item) =>
			isTodoStatus(item.status) ? [{ id: item.id, text: item.subject, status: item.status }] : [],
		);
	}
	return undefined;
}

/** The latest successful todo list on the current branch. */
export function reconstructTodos(ctx: ExtensionContext): NormalizedTodo[] {
	let todos: NormalizedTodo[] = [];
	const updates = new Map<string, unknown>();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type === "toolCall" && block.name === "update_todo") updates.set(block.id, block.arguments);
			}
		} else if (message.role === "toolResult" && !message.isError) {
			const details = message.toolName === "update_todo" ? updates.get(message.toolCallId) : message.toolName === "todo" ? message.details : undefined;
			todos = todosFromDetails(details) ?? todos;
		}
	}
	return todos;
}
