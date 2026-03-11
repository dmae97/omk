import { renderPromptTemplate } from "../config/prompt-templates";
import subagentUserPromptTemplate from "../prompts/system/subagent-user-prompt.md" with { type: "text" };
import type { TaskItem } from "./types";

interface RenderResult {
	/** Full task text sent to the subagent */
	task: string;
	/** Raw per-task assignment text, without prompt template boilerplate */
	assignment: string;
	id: string;
	description: string;
}

/**
 * Build the full task text from shared context and per-task assignment.
 *
 * If context is provided, it is prepended with a separator.
 */
export function renderTemplate(context: string | undefined, task: TaskItem): RenderResult {
	let { id, description, assignment } = task;
	assignment = assignment.trim();
	context = context?.trim();

	if (!context || !assignment) {
		return { task: assignment || context!, assignment: assignment || context!, id, description };
	}
	return {
		task: renderPromptTemplate(subagentUserPromptTemplate, { context, assignment }),
		assignment,
		id,
		description,
	};
}
