import { basename, dirname } from "node:path";
import type { SessionEntry } from "../../core/session-manager.ts";
import { isSkillAdmissionRecord, SKILL_ADMISSION_ENTRY_TYPE } from "../../core/skill-admission-ledger.ts";
import { nextActiveTodo, type TodoItem, type TodoStatus } from "../../core/todo-state.ts";
import { observeStatusCheck, type StatusChecks } from "./status-panel-checks.ts";

export type StatusHistory = {
	task?: { label: string; done: number; total: number; blocked: number };
	skills: { selected: string[]; loaded: string[] };
	checks: StatusChecks;
};

function textContent(content: string | readonly { type: string; text?: string }[]): string {
	return typeof content === "string"
		? content
		: content.flatMap((part) => (part.type === "text" ? [part.text ?? ""] : [])).join("\n");
}
function selectedSkills(text: string): string[] | undefined {
	const block = /<active_skills\b[^>]*>([\s\S]*?)<\/active_skills>/.exec(text)?.[1];
	return block === undefined ? undefined : [...block.matchAll(/<name>([^<]*)<\/name>/g)].map((match) => match[1]);
}
function todoItems(value: unknown): TodoItem[] | undefined {
	if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items)) return undefined;
	const items: TodoItem[] = [];
	for (const item of value.items) {
		if (
			!item ||
			typeof item !== "object" ||
			typeof item.id !== "string" ||
			typeof item.label !== "string" ||
			!["active", "pending", "done", "blocked"].includes(item.status)
		)
			return undefined;
		items.push({ id: item.id, label: item.label, status: item.status as TodoStatus });
	}
	return items;
}

/** Current branch only. Proposed calls, failed updates and recommended-but-unloaded skills are not state. */
export function readStatusHistory(entries: readonly SessionEntry[], systemPrompt: string): StatusHistory {
	let selected = selectedSkills(systemPrompt) ?? [];
	let loaded = new Set<string>();
	let todos: TodoItem[] = [];
	const calls = new Map<string, { name: string; arguments: unknown }>();
	const checks: StatusChecks = {};
	for (const entry of entries) {
		if (
			entry.type === "custom" &&
			entry.customType === SKILL_ADMISSION_ENTRY_TYPE &&
			isSkillAdmissionRecord(entry.data) &&
			entry.data.status === "admitted"
		)
			loaded.add(entry.data.skillId);
		if (entry.type === "custom_message" && entry.customType === "prompt-skills") {
			const text = textContent(entry.content);
			selected = selectedSkills(text) ?? selected;
			for (const match of text.matchAll(/<skill name="([^"]+)" location=/g)) loaded.add(match[1]);
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "user") {
			loaded = new Set();
			for (const match of textContent(message.content).matchAll(/<skill name="([^"]+)" location=/g))
				loaded.add(match[1]);
		} else if (message.role === "assistant") {
			for (const block of message.content) if (block.type === "toolCall") calls.set(block.id, block);
		} else if (message.role === "toolResult") {
			const call = calls.get(message.toolCallId);
			if (!call || call.name !== message.toolName) continue;
			calls.delete(message.toolCallId);
			const text = textContent(message.content);
			if (call.name === "update_todo" && !message.isError) todos = todoItems(call.arguments) ?? todos;
			if (["edit", "write"].includes(call.name)) {
				for (const check of Object.values(checks)) check.stale = true;
			}
			if (call.name === "read" && !message.isError && !/^\[skill admission\].*was not loaded/.test(text)) {
				const args = call.arguments;
				if (
					args &&
					typeof args === "object" &&
					"path" in args &&
					typeof args.path === "string" &&
					basename(args.path) === "SKILL.md"
				)
					loaded.add(/^name:\s*["']?([^\r\n"']+)/m.exec(text)?.[1].trim() ?? basename(dirname(args.path)));
			}
			const observed = observeStatusCheck(call.name, call.arguments, text, message.details, message.isError);
			if (observed) checks[observed.kind] = observed.check;
		}
	}
	const state = { items: todos, updatedAt: 0 };
	return {
		...(todos.length
			? {
					task: {
						label: nextActiveTodo(state)?.label ?? "All tasks done",
						done: todos.filter((item) => item.status === "done").length,
						total: todos.length,
						blocked: todos.filter((item) => item.status === "blocked").length,
					},
				}
			: {}),
		skills: { selected: [...new Set(selected)], loaded: [...loaded] },
		checks,
	};
}
