import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { logger } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";
import chalk from "chalk";
import { renderPromptTemplate } from "$c/config/prompt-templates";
import type { RenderResultOptions } from "$c/extensibility/custom-tools/types";
import type { Theme } from "$c/modes/theme/theme";
import todoWriteDescription from "$c/prompts/tools/todo-write.md" with { type: "text" };
import type { ToolSession } from "$c/sdk";
import { renderStatusLine, renderTreeList } from "$c/tui";

const todoWriteSchema = Type.Object({
	todos: Type.Array(
		Type.Object({
			id: Type.Optional(Type.String({ description: "Stable todo id" })),
			content: Type.String({ description: "Task description (e.g., 'Run tests')" }),
			status: StringEnum(["pending", "in_progress", "completed"]),
		}),
		{ description: "The updated todo list" },
	),
});

type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
	id: string;
	content: string;
	status: TodoStatus;
}

interface TodoFile {
	updatedAt: number;
	todos: TodoItem[];
}

export interface TodoWriteToolDetails {
	todos: TodoItem[];
	updatedAt: number;
	storage: "session" | "memory";
}

const TODO_FILE_NAME = "todos.json";

type TodoWriteParams = { todos: Array<{ id?: string; content?: string; status?: string }> };

function normalizeTodoStatus(status?: string): TodoStatus {
	switch (status) {
		case "in_progress":
			return "in_progress";
		case "completed":
		case "done":
		case "complete":
			return "completed";
		default:
			return "pending";
	}
}

function normalizeTodos(items: Array<{ id?: string; content?: string; status?: string }>): TodoItem[] {
	return items.map((item) => {
		if (!item.content) {
			throw new Error("Todo content is required.");
		}
		const content = item.content.trim();
		if (!content) {
			throw new Error("Todo content cannot be empty.");
		}
		return {
			id: item.id && item.id.trim().length > 0 ? item.id : randomUUID(),
			content,
			status: normalizeTodoStatus(item.status),
		};
	});
}

function validateSequentialTodos(todos: TodoItem[]): { valid: boolean; error?: string } {
	if (todos.length === 0) return { valid: true };

	const firstIncompleteIndex = todos.findIndex((todo) => todo.status !== "completed");
	if (firstIncompleteIndex >= 0) {
		for (let i = firstIncompleteIndex + 1; i < todos.length; i++) {
			if (todos[i].status === "completed") {
				return {
					valid: false,
					error: `Error: Cannot complete "${todos[i].content}" before completing "${todos[firstIncompleteIndex].content}". Todos must be completed sequentially.`,
				};
			}
		}
	}

	const inProgressIndices = todos.reduce<number[]>((acc, todo, index) => {
		if (todo.status === "in_progress") acc.push(index);
		return acc;
	}, []);

	if (inProgressIndices.length > 1) {
		return { valid: false, error: "Only one todo can be in progress at a time." };
	}

	if (inProgressIndices.length === 1 && firstIncompleteIndex >= 0) {
		if (inProgressIndices[0] !== firstIncompleteIndex) {
			return { valid: false, error: "Todo in progress must be the next incomplete item." };
		}
	}

	return { valid: true };
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

function formatTodoSummary(todos: TodoItem[]): string {
	if (todos.length === 0) return "Todo list cleared.";
	const completed = todos.filter((t) => t.status === "completed").length;
	const inProgress = todos.filter((t) => t.status === "in_progress").length;
	const pending = todos.filter((t) => t.status === "pending").length;
	return `Saved ${todos.length} todos (${pending} pending, ${inProgress} in progress, ${completed} completed).`;
}

function formatTodoLine(item: TodoItem, uiTheme: Theme, prefix: string): string {
	const checkbox = uiTheme.checkbox;
	switch (item.status) {
		case "completed":
			return uiTheme.fg("success", `${prefix}${checkbox.checked} ${chalk.strikethrough(item.content)}`);
		case "in_progress":
			return uiTheme.fg("accent", `${prefix}${checkbox.unchecked} ${item.content}`);
		default:
			return uiTheme.fg("dim", `${prefix}${checkbox.unchecked} ${item.content}`);
	}
}

// =============================================================================
// Tool Class
// =============================================================================

export class TodoWriteTool implements AgentTool<typeof todoWriteSchema, TodoWriteToolDetails> {
	public readonly name = "todo_write";
	public readonly label = "Todo Write";
	public readonly description: string;
	public readonly parameters = todoWriteSchema;

	private readonly session: ToolSession;

	constructor(session: ToolSession) {
		this.session = session;
		this.description = renderPromptTemplate(todoWriteDescription);
	}

	public async execute(
		_toolCallId: string,
		params: TodoWriteParams,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<TodoWriteToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<TodoWriteToolDetails>> {
		const todos = normalizeTodos(params.todos ?? []);
		const validation = validateSequentialTodos(todos);
		if (!validation.valid) {
			throw new Error(validation.error ?? "Todos must be completed sequentially.");
		}
		const updatedAt = Date.now();

		const sessionFile = this.session.getSessionFile();
		if (!sessionFile) {
			return {
				content: [{ type: "text", text: formatTodoSummary(todos) }],
				details: { todos, updatedAt, storage: "memory" },
			};
		}

		const todoPath = path.join(sessionFile.slice(0, -6), TODO_FILE_NAME);
		const existing = await loadTodoFile(todoPath);
		const storedTodos = existing?.todos ?? [];
		const merged = todos.length > 0 ? todos : [];
		const fileData: TodoFile = { updatedAt, todos: merged };

		try {
			await Bun.write(todoPath, JSON.stringify(fileData, null, 2));
		} catch (error) {
			logger.error("Failed to write todo file", { path: todoPath, error: String(error) });
			return {
				content: [{ type: "text", text: "Failed to save todos." }],
				details: { todos: storedTodos, updatedAt, storage: "session" },
			};
		}

		return {
			content: [{ type: "text", text: formatTodoSummary(merged) }],
			details: { todos: merged, updatedAt, storage: "session" },
		};
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface TodoWriteRenderArgs {
	todos?: Array<{ id?: string; content?: string; status?: string }>;
}

export const todoWriteToolRenderer = {
	renderCall(args: TodoWriteRenderArgs, uiTheme: Theme): Component {
		const count = args.todos?.length ?? 0;
		const meta = count > 0 ? [`${count} items`] : ["empty"];
		const text = renderStatusLine({ icon: "pending", title: "Todo Write", meta }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: TodoWriteToolDetails },
		_options: RenderResultOptions,
		uiTheme: Theme,
		_args?: TodoWriteRenderArgs,
	): Component {
		const todos = result.details?.todos ?? [];
		const header = renderStatusLine({ icon: "success", title: "Todos", meta: [`${todos.length} items`] }, uiTheme);
		const lines = renderTreeList(
			{
				items: todos,
				expanded: true,
				maxCollapsed: todos.length,
				itemType: "todo",
				renderItem: (todo) => formatTodoLine(todo, uiTheme, ""),
			},
			uiTheme,
		);

		return new Text([header, ...lines].join("\n"), 0, 0);
	},
};
