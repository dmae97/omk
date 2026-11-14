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
 * - Headless / no-UI sessions (`ctx.hasUI === false`, e.g. `omk -p` workers)
 *   still update state and return a summary, but skip the widget entirely so
 *   the TUI component (and omk-tui) never loads on that path.
 * - Web/extension observations are never involved; this tool only carries the
 *   model's own plan text.
 * - Spec 049: with `OMK_TODO_VERIFY` on (read once, at load) items also take
 *   optional `kind`, `difficulty` and `check`, and the verifier module is loaded
 *   here. Off, the factory stays synchronous and the schema, description and
 *   result text are exactly main's.
 */

import { StringEnum, Type } from "omk-ai";
import { resetCurrentTodoState, setCurrentTodoState } from "../../todo-runtime-state.ts";
import type { TodoItem, TodoState, TodoStatus } from "../../todo-state.ts";
import { EMPTY_TODO_STATE, resolveTodoVerify, setTodoItems, summary } from "../../todo-state.ts";
import type { ExtensionAPI } from "../types.ts";

type TodoVerify = typeof import("../../todo-verify.ts");

export interface TodoChecklistOptions {
	readonly env?: NodeJS.ProcessEnv;
}

export default function todoChecklist(omk: ExtensionAPI, options: TodoChecklistOptions = {}): void | Promise<void> {
	const env = options.env ?? process.env;
	if (!resolveTodoVerify(env.OMK_TODO_VERIFY)) return registerTodoChecklist(omk, undefined, env);
	return import("../../todo-verify.ts").then((verify) => registerTodoChecklist(omk, verify, env));
}

const ITEM_FIELDS = {
	id: Type.String({ description: "Stable identifier for the task (reuse across updates)." }),
	label: Type.String({ description: "Short human-readable task description." }),
	status: StringEnum(["pending", "active", "done", "blocked"], {
		description: "pending=not started, active=in progress, done=complete, blocked=stuck.",
	}),
	detail: Type.Optional(Type.String({ description: "Optional extra context for the task." })),
};

/** Older embedded callers can lack a session manager; they keep the compatibility owner. */
const todoOwner = (ctx: { sessionManager?: { getSessionId?: () => string } }) =>
	ctx.sessionManager?.getSessionId?.() ?? "default";

function registerTodoChecklist(omk: ExtensionAPI, verify: TodoVerify | undefined, env: NodeJS.ProcessEnv): void {
	let state: TodoState = EMPTY_TODO_STATE;
	// Typed as main's fields: with the flag on the extra fields reach `normalizeTodoFields` untyped, and only there.
	const itemFields = (
		verify ? { ...ITEM_FIELDS, ...verify.TODO_VERIFY_ITEM_FIELDS } : ITEM_FIELDS
	) as typeof ITEM_FIELDS;

	omk.on("session_start", (_event, ctx) => {
		state = EMPTY_TODO_STATE;
		resetCurrentTodoState(todoOwner(ctx));
	});
	omk.on("session_shutdown", (_event, ctx) => {
		resetCurrentTodoState(todoOwner(ctx));
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
			items: Type.Array(Type.Object(itemFields), { description: "Full current list of checklist items." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			state = setTodoItems(
				state,
				params.items.map(
					(item): TodoItem =>
						verify
							? {
									id: item.id,
									label: item.label,
									status: item.status as TodoStatus,
									...(item.detail !== undefined ? { detail: item.detail } : {}),
									...verify.normalizeTodoFields(item),
								}
							: { ...item, status: item.status as TodoStatus },
				),
			);
			setCurrentTodoState(state, todoOwner(ctx));
			if (verify) verify.logTodoSnapshot(state.items, env);
			const snapshot = state;
			// Only a UI session mounts the widget. With a UI present, a failed import
			// or setWidget is a real bug, so it surfaces instead of being swallowed.
			if (ctx.hasUI) {
				const { TodoChecklistComponent } = await import("../../../modes/interactive/components/todo-checklist.ts");
				ctx.ui.setWidget("omk-todo", () => new TodoChecklistComponent(() => snapshot), {
					placement: "aboveEditor",
				});
			}
			const s = summary(state);
			return {
				content: [
					{
						type: "text",
						text: `TODO updated: ${s.done}/${s.total} done · ${s.active} active · ${s.pending} pending · ${s.blocked} blocked${verify ? `\n${verify.todoChecksLine(state.items)}` : ""}`,
					},
				],
				details: { summary: s, total: s.total },
			};
		},
	});
}
