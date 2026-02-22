import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { type Static, Type } from "@sinclair/typebox";
import chalk from "chalk";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import todoWriteDescription from "../prompts/tools/todo-write.md" with { type: "text" };
import type { ToolSession } from "../sdk";
import type { SessionEntry } from "../session/session-manager";
import { renderStatusLine, renderTreeList } from "../tui";
import { PREVIEW_LIMITS } from "./render-utils";

// =============================================================================
// Types
// =============================================================================

export type TodoStatus = "pending" | "in_progress" | "completed" | "abandoned";

export interface TodoItem {
	id: string;
	content: string;
	status: TodoStatus;
	notes?: string;
}

export interface TodoPhase {
	id: string;
	name: string;
	tasks: TodoItem[];
}

export interface TodoWriteToolDetails {
	phases: TodoPhase[];
	storage: "session" | "memory";
}

// =============================================================================
// Schema
// =============================================================================

const StatusEnum = StringEnum(["pending", "in_progress", "completed", "abandoned"] as const);

const InputTask = Type.Object({
	content: Type.String(),
	status: Type.Optional(StatusEnum),
	notes: Type.Optional(Type.String()),
});

const InputPhase = Type.Object({
	name: Type.String(),
	tasks: Type.Optional(Type.Array(InputTask)),
});

const todoWriteSchema = Type.Object({
	ops: Type.Array(
		Type.Union([
			Type.Object({
				op: Type.Literal("replace"),
				phases: Type.Array(InputPhase),
			}),
			Type.Object({
				op: Type.Literal("add_phase"),
				name: Type.String(),
				tasks: Type.Optional(Type.Array(InputTask)),
			}),
			Type.Object({
				op: Type.Literal("add_task"),
				phase: Type.String({ description: "Phase ID, e.g. phase-1" }),
				content: Type.String(),
				notes: Type.Optional(Type.String()),
			}),
			Type.Object({
				op: Type.Literal("update"),
				id: Type.String({ description: "Task ID, e.g. task-3" }),
				status: Type.Optional(StatusEnum),
				content: Type.Optional(Type.String()),
				notes: Type.Optional(Type.String()),
			}),
			Type.Object({
				op: Type.Literal("remove_task"),
				id: Type.String({ description: "Task ID, e.g. task-3" }),
			}),
		]),
	),
});

type TodoWriteParams = Static<typeof todoWriteSchema>;

// =============================================================================
// File format
// =============================================================================

interface TodoFile {
	phases: TodoPhase[];
	nextTaskId: number;
	nextPhaseId: number;
}

// =============================================================================
// State helpers
// =============================================================================

function makeEmptyFile(): TodoFile {
	return { phases: [], nextTaskId: 1, nextPhaseId: 1 };
}

function findTask(phases: TodoPhase[], id: string): TodoItem | undefined {
	for (const phase of phases) {
		const task = phase.tasks.find(t => t.id === id);
		if (task) return task;
	}
	return undefined;
}

function buildPhaseFromInput(
	input: { name: string; tasks?: Array<{ content: string; status?: TodoStatus; notes?: string }> },
	phaseId: string,
	nextTaskId: number,
): { phase: TodoPhase; nextTaskId: number } {
	const tasks: TodoItem[] = [];
	let tid = nextTaskId;
	for (const t of input.tasks ?? []) {
		tasks.push({ id: `task-${tid++}`, content: t.content, status: t.status ?? "pending", notes: t.notes });
	}
	return { phase: { id: phaseId, name: input.name, tasks }, nextTaskId: tid };
}

function getNextIds(phases: TodoPhase[]): { nextTaskId: number; nextPhaseId: number } {
	let maxTaskId = 0;
	let maxPhaseId = 0;

	for (const phase of phases) {
		const phaseMatch = /^phase-(\d+)$/.exec(phase.id);
		if (phaseMatch) {
			const value = Number.parseInt(phaseMatch[1], 10);
			if (Number.isFinite(value) && value > maxPhaseId) maxPhaseId = value;
		}

		for (const task of phase.tasks) {
			const taskMatch = /^task-(\d+)$/.exec(task.id);
			if (!taskMatch) continue;
			const value = Number.parseInt(taskMatch[1], 10);
			if (Number.isFinite(value) && value > maxTaskId) maxTaskId = value;
		}
	}

	return { nextTaskId: maxTaskId + 1, nextPhaseId: maxPhaseId + 1 };
}

function fileFromPhases(phases: TodoPhase[]): TodoFile {
	const { nextTaskId, nextPhaseId } = getNextIds(phases);
	return { phases, nextTaskId, nextPhaseId };
}

function clonePhases(phases: TodoPhase[]): TodoPhase[] {
	return phases.map(phase => ({ ...phase, tasks: phase.tasks.map(task => ({ ...task })) }));
}

export function getLatestTodoPhasesFromEntries(entries: SessionEntry[]): TodoPhase[] {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "message") continue;

		const message = entry.message as { role?: string; toolName?: string; details?: unknown; isError?: boolean };
		if (message.role !== "toolResult" || message.toolName !== "todo_write" || message.isError) continue;

		const details = message.details as { phases?: unknown } | undefined;
		if (!details || !Array.isArray(details.phases)) continue;

		return clonePhases(details.phases as TodoPhase[]);
	}

	return [];
}

function applyOps(file: TodoFile, ops: TodoWriteParams["ops"]): { file: TodoFile; errors: string[] } {
	const errors: string[] = [];

	for (const op of ops) {
		switch (op.op) {
			case "replace": {
				const next = makeEmptyFile();
				for (const inputPhase of op.phases) {
					const phaseId = `phase-${next.nextPhaseId++}`;
					const { phase, nextTaskId } = buildPhaseFromInput(inputPhase, phaseId, next.nextTaskId);
					next.phases.push(phase);
					next.nextTaskId = nextTaskId;
				}
				file = next;
				break;
			}

			case "add_phase": {
				const phaseId = `phase-${file.nextPhaseId++}`;
				const { phase, nextTaskId } = buildPhaseFromInput(op, phaseId, file.nextTaskId);
				file.phases.push(phase);
				file.nextTaskId = nextTaskId;
				break;
			}

			case "add_task": {
				const target = file.phases.find(p => p.id === op.phase);
				if (!target) {
					errors.push(`Phase "${op.phase}" not found`);
					break;
				}
				target.tasks.push({
					id: `task-${file.nextTaskId++}`,
					content: op.content,
					status: "pending",
					notes: op.notes,
				});
				break;
			}

			case "update": {
				const task = findTask(file.phases, op.id);
				if (!task) {
					errors.push(`Task "${op.id}" not found`);
					break;
				}
				if (op.status !== undefined) task.status = op.status;
				if (op.content !== undefined) task.content = op.content;
				if (op.notes !== undefined) task.notes = op.notes;
				break;
			}

			case "remove_task": {
				let removed = false;
				for (const phase of file.phases) {
					const idx = phase.tasks.findIndex(t => t.id === op.id);
					if (idx !== -1) {
						phase.tasks.splice(idx, 1);
						removed = true;
						break;
					}
				}
				if (!removed) errors.push(`Task "${op.id}" not found`);
				break;
			}
		}
	}

	return { file, errors };
}

function formatSummary(phases: TodoPhase[], errors: string[]): string {
	const tasks = phases.flatMap(p => p.tasks);
	if (tasks.length === 0) return errors.length > 0 ? `Errors: ${errors.join("; ")}` : "Todo list cleared.";

	// Find current phase
	let currentIdx = phases.findIndex(p => p.tasks.some(t => t.status === "pending" || t.status === "in_progress"));
	if (currentIdx === -1) currentIdx = phases.length - 1;
	const current = phases[currentIdx];
	const done = current.tasks.filter(t => t.status === "completed" || t.status === "abandoned").length;

	const lines: string[] = [];
	if (errors.length > 0) lines.push(`Errors: ${errors.join("; ")}`);
	lines.push(
		`Phase ${currentIdx + 1}/${phases.length} "${current.name}" — ${done}/${current.tasks.length} tasks complete`,
	);
	for (const phase of phases) {
		lines.push(`  ${phase.name}:`);
		for (const task of phase.tasks) {
			const sym =
				task.status === "completed"
					? "✓"
					: task.status === "in_progress"
						? "→"
						: task.status === "abandoned"
							? "✗"
							: "○";
			lines.push(`    ${sym} ${task.id} ${task.content}`);
		}
	}
	return lines.join("\n");
}

// =============================================================================
// Tool Class
// =============================================================================

export class TodoWriteTool implements AgentTool<typeof todoWriteSchema, TodoWriteToolDetails> {
	readonly name = "todo_write";
	readonly label = "Todo Write";
	readonly description: string;
	readonly parameters = todoWriteSchema;
	readonly concurrency = "exclusive";

	constructor(private readonly session: ToolSession) {
		this.description = renderPromptTemplate(todoWriteDescription);
	}

	async execute(
		_toolCallId: string,
		params: TodoWriteParams,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<TodoWriteToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<TodoWriteToolDetails>> {
		const previousPhases = this.session.getTodoPhases?.() ?? [];
		const current = fileFromPhases(previousPhases);
		const { file: updated, errors } = applyOps(current, params.ops);
		this.session.setTodoPhases?.(updated.phases);
		const storage = this.session.getSessionFile() ? "session" : "memory";

		return {
			content: [{ type: "text", text: formatSummary(updated.phases, errors) }],
			details: { phases: updated.phases, storage },
		};
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface TodoWriteRenderArgs {
	ops?: Array<{ op: string }>;
}

function formatTodoLine(item: TodoItem, uiTheme: Theme, prefix: string): string {
	const checkbox = uiTheme.checkbox;
	switch (item.status) {
		case "completed":
			return uiTheme.fg("success", `${prefix}${checkbox.checked} ${chalk.strikethrough(item.content)}`);
		case "in_progress":
			return uiTheme.fg("accent", `${prefix}${checkbox.unchecked} ${item.content}`);
		case "abandoned":
			return uiTheme.fg("error", `${prefix}${checkbox.unchecked} ${chalk.strikethrough(item.content)}`);
		default:
			return uiTheme.fg("dim", `${prefix}${checkbox.unchecked} ${item.content}`);
	}
}

export const todoWriteToolRenderer = {
	renderCall(args: TodoWriteRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const count = args.ops?.length ?? 0;
		const label = count === 1 ? (args.ops?.[0]?.op ?? "update") : `${count} ops`;
		const text = renderStatusLine({ icon: "pending", title: "Todo Write", meta: [label] }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: TodoWriteToolDetails },
		options: RenderResultOptions,
		uiTheme: Theme,
		_args?: TodoWriteRenderArgs,
	): Component {
		const phases = (result.details?.phases ?? []).filter(p => p.tasks.length > 0);
		const allTasks = phases.flatMap(p => p.tasks);
		const header = renderStatusLine(
			{ icon: "success", title: "Todo Write", meta: [`${allTasks.length} tasks`] },
			uiTheme,
		);
		if (allTasks.length === 0) {
			const fallback = result.content?.find(c => c.type === "text")?.text ?? "No todos";
			return new Text(`${header}\n${uiTheme.fg("dim", fallback)}`, 0, 0);
		}

		const { expanded } = options;
		const lines: string[] = [header];
		for (const phase of phases) {
			if (phases.length > 1) {
				lines.push(uiTheme.fg("accent", `  ${uiTheme.tree.hook} ${phase.name}`));
			}
			const treeLines = renderTreeList(
				{
					items: phase.tasks,
					expanded,
					maxCollapsed: PREVIEW_LIMITS.COLLAPSED_ITEMS,
					itemType: "todo",
					renderItem: todo => formatTodoLine(todo, uiTheme, ""),
				},
				uiTheme,
			);
			lines.push(...treeLines);
		}
		return new Text(lines.join("\n"), 0, 0);
	},
	mergeCallAndResult: true,
};
