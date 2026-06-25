/**
 * Built-in TODO checklist extension.
 *
 * Exposes an `update_todo` tool the model calls to maintain a visible,
 * dynamically-generated checklist of the current plan. The checklist is NOT
 * hardcoded: the LLM emits the items on every call (replacing the previous
 * list), and they render live in the terminal UI above the editor.
 *
 * Design notes:
 * - State is held per-loaded-extension and reset on session_start.
 * - The widget is mounted via ctx.ui.setWidget with a factory that binds the
 *   latest state snapshot, so each update re-renders with current items.
 * - Headless / no-UI sessions still update state and return a summary; the
 *   setWidget call is wrapped so a missing UI never breaks the tool.
 * - Web/extension observations are never involved; this tool only carries the
 *   model's own plan text.
 */

import { StringEnum, Type } from "@earendil-works/omk-ai";
import { TodoChecklistComponent } from "../../../modes/interactive/components/todo-checklist.ts";
import type { TodoState, TodoStatus } from "../../todo-state.ts";
import { EMPTY_TODO_STATE, setTodoItems, summary } from "../../todo-state.ts";
import type { ExtensionAPI } from "../types.ts";

export default function todoChecklist(omk: ExtensionAPI): void {
	let state: TodoState = EMPTY_TODO_STATE;

	omk.on("session_start", () => {
		state = EMPTY_TODO_STATE;
	});

	omk.registerTool({
		name: "update_todo",
		label: "Update TODO checklist",
		description:
			"Update the visible TODO checklist shown in the terminal UI with the current plan. Pass the FULL current list of tasks on every call (this replaces the previous list). Use this to keep the user informed of progress: mark items pending/active/done/blocked as work proceeds.",
		promptSnippet:
			"Maintain a live TODO checklist in the terminal UI by calling update_todo with the current plan and item statuses.",
		promptGuidelines: [
			"Call update_todo at the start of non-trivial multi-step work and after each task transitions state.",
			"Pass the complete current list each call (the tool replaces, not appends). Keep labels short and verb-led.",
			"Set exactly one item to 'active' (the task in progress); mark finished items 'done' and blockers 'blocked'.",
		],
		parameters: Type.Object({
			items: Type.Array(
				Type.Object({
					id: Type.String({ description: "Stable identifier for the task (reuse across updates)." }),
					label: Type.String({ description: "Short human-readable task description." }),
					status: StringEnum(["pending", "active", "done", "blocked"], {
						description: "pending=not started, active=in progress, done=complete, blocked=stuck.",
					}),
					detail: Type.Optional(Type.String({ description: "Optional extra context for the task." })),
				}),
				{ description: "Full current list of checklist items." },
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			state = setTodoItems(
				state,
				params.items.map((item) => ({ ...item, status: item.status as TodoStatus })),
			);
			const snapshot = state;
			try {
				ctx.ui.setWidget("omk-todo", () => new TodoChecklistComponent(() => snapshot), {
					placement: "aboveEditor",
				});
			} catch {
				// UI may be unavailable in headless mode; state still updates.
			}
			const s = summary(state);
			return {
				content: [
					{
						type: "text",
						text: `TODO updated: ${s.done}/${s.total} done · ${s.active} active · ${s.pending} pending · ${s.blocked} blocked`,
					},
				],
				details: { summary: s, total: s.total },
			};
		},
	});
}
