/**
 * Ask Tool - Interactive user prompting during execution
 *
 * Use this tool when you need to ask the user questions during execution.
 * This allows you to:
 *   1. Gather user preferences or requirements
 *   2. Clarify ambiguous instructions
 *   3. Get decisions on implementation choices as you work
 *   4. Offer choices to the user about what direction to take
 *
 * Usage notes:
 *   - Users will always be able to select "Other" to provide custom text input
 *   - Use multi: true to allow multiple answers to be selected for a question
 *   - If you recommend a specific option, make that the first option in the list
 *     and add "(Recommended)" at the end of the label
 */

import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "$c/config/prompt-templates";
import type { RenderResultOptions } from "$c/extensibility/custom-tools/types";
import { type Theme, theme } from "$c/modes/theme/theme";
import askDescription from "$c/prompts/tools/ask.md" with { type: "text" };
import { renderStatusLine } from "$c/tui";
import type { ToolSession } from "./index";
import { ToolUIKit } from "./render-utils";

// =============================================================================
// Types
// =============================================================================

const OptionItem = Type.Object({
	label: Type.String({ description: "Display label" }),
});

const QuestionItem = Type.Object({
	id: Type.String({ description: "Question ID, e.g. 'auth', 'cache'" }),
	question: Type.String({ description: "Question text" }),
	options: Type.Array(OptionItem, { description: "Available options" }),
	multi: Type.Optional(Type.Boolean({ description: "Allow multiple selections" })),
});

const askSchema = Type.Object({
	question: Type.Optional(Type.String({ description: "Question to ask" })),
	options: Type.Optional(Type.Array(OptionItem, { description: "Available options" })),
	multi: Type.Optional(Type.Boolean({ description: "Allow multiple selections (default: false)" })),
	questions: Type.Optional(Type.Array(QuestionItem, { description: "Multiple questions in sequence" })),
});

/** Result for a single question */
export interface QuestionResult {
	id: string;
	question: string;
	options: string[];
	multi: boolean;
	selectedOptions: string[];
	customInput?: string;
}

export interface AskToolDetails {
	/** Single question mode (backwards compatible) */
	question?: string;
	options?: string[];
	multi?: boolean;
	selectedOptions?: string[];
	customInput?: string;
	/** Multi-part question mode */
	results?: QuestionResult[];
}

// =============================================================================
// Constants
// =============================================================================

const OTHER_OPTION = "Other (type your own)";
function getDoneOptionLabel(): string {
	return `${theme.status.success} Done selecting`;
}

// =============================================================================
// Question Selection Logic
// =============================================================================

interface SelectionResult {
	selectedOptions: string[];
	customInput?: string;
}

interface UIContext {
	select(prompt: string, options: string[], options_?: { initialIndex?: number }): Promise<string | undefined>;
	input(prompt: string): Promise<string | undefined>;
}

async function askSingleQuestion(
	ui: UIContext,
	question: string,
	optionLabels: string[],
	multi: boolean,
): Promise<SelectionResult> {
	const doneLabel = getDoneOptionLabel();
	let selectedOptions: string[] = [];
	let customInput: string | undefined;

	if (multi) {
		const selected = new Set<string>();
		let cursorIndex = 0;

		while (true) {
			const opts: string[] = [];

			for (const opt of optionLabels) {
				const checkbox = selected.has(opt) ? theme.checkbox.checked : theme.checkbox.unchecked;
				opts.push(`${checkbox} ${opt}`);
			}

			// Done after options, before Other - so cursor stays on options after toggle
			if (selected.size > 0) {
				opts.push(doneLabel);
			}
			opts.push(OTHER_OPTION);

			const prefix = selected.size > 0 ? `(${selected.size} selected) ` : "";
			const choice = await ui.select(`${prefix}${question}`, opts, { initialIndex: cursorIndex });

			if (choice === undefined || choice === doneLabel) break;

			if (choice === OTHER_OPTION) {
				const input = await ui.input("Enter your response:");
				if (input) customInput = input;
				break;
			}

			// Find which index was selected and update cursor position
			const selectedIdx = opts.indexOf(choice);
			if (selectedIdx >= 0) {
				cursorIndex = selectedIdx;
			}

			const checkedPrefix = `${theme.checkbox.checked} `;
			const uncheckedPrefix = `${theme.checkbox.unchecked} `;
			let opt: string | undefined;
			if (choice.startsWith(checkedPrefix)) {
				opt = choice.slice(checkedPrefix.length);
			} else if (choice.startsWith(uncheckedPrefix)) {
				opt = choice.slice(uncheckedPrefix.length);
			}
			if (opt) {
				if (selected.has(opt)) {
					selected.delete(opt);
				} else {
					selected.add(opt);
				}
			}
		}
		selectedOptions = Array.from(selected);
	} else {
		const choice = await ui.select(question, [...optionLabels, OTHER_OPTION]);
		if (choice === OTHER_OPTION) {
			const input = await ui.input("Enter your response:");
			if (input) customInput = input;
		} else if (choice) {
			selectedOptions = [choice];
		}
	}

	return { selectedOptions, customInput };
}

function formatQuestionResult(result: QuestionResult): string {
	if (result.customInput) {
		return `${result.id}: "${result.customInput}"`;
	}
	if (result.selectedOptions.length > 0) {
		return result.multi
			? `${result.id}: [${result.selectedOptions.join(", ")}]`
			: `${result.id}: ${result.selectedOptions[0]}`;
	}
	return `${result.id}: (cancelled)`;
}

// =============================================================================
// Tool Class
// =============================================================================

interface AskParams {
	question?: string;
	options?: Array<{ label: string }>;
	multi?: boolean;
	questions?: Array<{
		id: string;
		question: string;
		options: Array<{ label: string }>;
		multi?: boolean;
	}>;
}

/**
 * Ask tool for interactive user prompting during execution.
 *
 * Allows gathering user preferences, clarifying instructions, and getting decisions
 * on implementation choices as the agent works.
 */
export class AskTool implements AgentTool<typeof askSchema, AskToolDetails> {
	public readonly name = "ask";
	public readonly label = "Ask";
	public readonly description: string;
	public readonly parameters = askSchema;

	constructor(_session: ToolSession) {
		this.description = renderPromptTemplate(askDescription);
	}

	static createIf(session: ToolSession): AskTool | null {
		return session.hasUI ? new AskTool(session) : null;
	}

	public async execute(
		_toolCallId: string,
		params: AskParams,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<AskToolDetails>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<AskToolDetails>> {
		// Headless fallback
		if (!context?.hasUI || !context.ui) {
			return {
				content: [{ type: "text" as const, text: "Error: User prompt requires interactive mode" }],
				details: {},
			};
		}

		const { ui } = context;

		// Multi-part questions mode
		if (params.questions && params.questions.length > 0) {
			const results: QuestionResult[] = [];

			for (const q of params.questions) {
				const optionLabels = q.options.map((o) => o.label);
				const { selectedOptions, customInput } = await askSingleQuestion(
					ui,
					q.question,
					optionLabels,
					q.multi ?? false,
				);

				results.push({
					id: q.id,
					question: q.question,
					options: optionLabels,
					multi: q.multi ?? false,
					selectedOptions,
					customInput,
				});
			}

			const details: AskToolDetails = { results };
			const responseLines = results.map(formatQuestionResult);
			const responseText = `User answers:\n${responseLines.join("\n")}`;

			return { content: [{ type: "text" as const, text: responseText }], details };
		}

		// Single question mode (backwards compatible)
		const question = params.question ?? "";
		const options = params.options ?? [];
		const multi = params.multi ?? false;
		const optionLabels = options.map((o) => o.label);

		if (!question || optionLabels.length === 0) {
			return {
				content: [{ type: "text" as const, text: "Error: question and options are required" }],
				details: {},
			};
		}

		const { selectedOptions, customInput } = await askSingleQuestion(ui, question, optionLabels, multi);

		const details: AskToolDetails = {
			question,
			options: optionLabels,
			multi,
			selectedOptions,
			customInput,
		};

		let responseText: string;
		if (customInput) {
			responseText = `User provided custom input: ${customInput}`;
		} else if (selectedOptions.length > 0) {
			responseText = multi ? `User selected: ${selectedOptions.join(", ")}` : `User selected: ${selectedOptions[0]}`;
		} else {
			responseText = "User cancelled the selection";
		}

		return { content: [{ type: "text" as const, text: responseText }], details };
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface AskRenderArgs {
	question?: string;
	options?: Array<{ label: string }>;
	multi?: boolean;
	questions?: Array<{
		id: string;
		question: string;
		options: Array<{ label: string }>;
		multi?: boolean;
	}>;
}

export const askToolRenderer = {
	renderCall(args: AskRenderArgs, uiTheme: Theme): Component {
		const ui = new ToolUIKit(uiTheme);
		const label = ui.title("Ask");

		// Multi-part questions
		if (args.questions && args.questions.length > 0) {
			let text = `${label} ${uiTheme.fg("muted", `${args.questions.length} questions`)}`;

			for (let i = 0; i < args.questions.length; i++) {
				const q = args.questions[i];
				const isLastQ = i === args.questions.length - 1;
				const qBranch = isLastQ ? uiTheme.tree.last : uiTheme.tree.branch;
				const continuation = isLastQ ? " " : uiTheme.tree.vertical;

				// Question line with metadata
				const meta: string[] = [];
				if (q.multi) meta.push("multi");
				if (q.options?.length) meta.push(`options:${q.options.length}`);
				const metaStr = meta.length > 0 ? uiTheme.fg("dim", ` · ${meta.join(" · ")}`) : "";

				text += `\n ${uiTheme.fg("dim", qBranch)} ${uiTheme.fg("dim", `[${q.id}]`)} ${uiTheme.fg("accent", q.question)}${metaStr}`;

				// Options under question
				if (q.options?.length) {
					for (let j = 0; j < q.options.length; j++) {
						const opt = q.options[j];
						const isLastOpt = j === q.options.length - 1;
						const optBranch = isLastOpt ? uiTheme.tree.last : uiTheme.tree.branch;
						text += `\n ${uiTheme.fg("dim", continuation)}   ${uiTheme.fg("dim", optBranch)} ${uiTheme.fg("dim", uiTheme.checkbox.unchecked)} ${uiTheme.fg("muted", opt.label)}`;
					}
				}
			}
			return new Text(text, 0, 0);
		}

		// Single question
		if (!args.question) {
			return new Text(ui.errorMessage("No question provided"), 0, 0);
		}

		let text = `${label} ${uiTheme.fg("accent", args.question)}`;
		const meta: string[] = [];
		if (args.multi) meta.push("multi");
		if (args.options?.length) meta.push(`options:${args.options.length}`);
		text += ui.meta(meta);

		if (args.options?.length) {
			for (let i = 0; i < args.options.length; i++) {
				const opt = args.options[i];
				const isLast = i === args.options.length - 1;
				const branch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
				text += `\n ${uiTheme.fg("dim", branch)} ${uiTheme.fg("dim", uiTheme.checkbox.unchecked)} ${uiTheme.fg("muted", opt.label)}`;
			}
		}

		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: AskToolDetails },
		_opts: RenderResultOptions,
		uiTheme: Theme,
	): Component {
		const { details } = result;
		if (!details) {
			const txt = result.content[0];
			const fallback = txt?.type === "text" && txt.text ? txt.text : "";
			const header = renderStatusLine({ icon: "warning", title: "Ask" }, uiTheme);
			return new Text([header, uiTheme.fg("dim", fallback)].join("\n"), 0, 0);
		}

		// Multi-part results
		if (details.results && details.results.length > 0) {
			const lines: string[] = [];
			const hasAnySelection = details.results.some(
				(r) => r.customInput || (r.selectedOptions && r.selectedOptions.length > 0),
			);
			const header = renderStatusLine(
				{
					icon: hasAnySelection ? "success" : "warning",
					title: "Ask",
					meta: [`${details.results.length} questions`],
				},
				uiTheme,
			);
			lines.push(header);

			for (let i = 0; i < details.results.length; i++) {
				const r = details.results[i];
				const isLastQuestion = i === details.results.length - 1;
				const branch = isLastQuestion ? uiTheme.tree.last : uiTheme.tree.branch;
				const continuation = isLastQuestion ? "   " : `${uiTheme.fg("dim", uiTheme.tree.vertical)}  `;
				const hasSelection = r.customInput || r.selectedOptions.length > 0;
				const statusIcon = hasSelection
					? uiTheme.styledSymbol("status.success", "success")
					: uiTheme.styledSymbol("status.warning", "warning");

				lines.push(
					` ${uiTheme.fg("dim", branch)} ${statusIcon} ${uiTheme.fg("dim", `[${r.id}]`)} ${uiTheme.fg("accent", r.question)}`,
				);

				if (r.customInput) {
					lines.push(
						`${continuation}${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.styledSymbol("status.success", "success")} ${uiTheme.fg("toolOutput", r.customInput)}`,
					);
				} else if (r.selectedOptions.length > 0) {
					for (let j = 0; j < r.selectedOptions.length; j++) {
						const isLast = j === r.selectedOptions.length - 1;
						const optBranch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
						lines.push(
							`${continuation}${uiTheme.fg("dim", optBranch)} ${uiTheme.fg("success", uiTheme.checkbox.checked)} ${uiTheme.fg("toolOutput", r.selectedOptions[j])}`,
						);
					}
				} else {
					lines.push(
						`${continuation}${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.styledSymbol("status.warning", "warning")} ${uiTheme.fg("warning", "Cancelled")}`,
					);
				}
			}

			return new Text(lines.join("\n"), 0, 0);
		}

		// Single question result
		if (!details.question) {
			const txt = result.content[0];
			return new Text(txt?.type === "text" && txt.text ? txt.text : "", 0, 0);
		}

		const hasSelection = details.customInput || (details.selectedOptions && details.selectedOptions.length > 0);
		const header = renderStatusLine(
			{ icon: hasSelection ? "success" : "warning", title: "Ask", description: details.question },
			uiTheme,
		);

		let text = header;

		if (details.customInput) {
			text += `\n ${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.styledSymbol("status.success", "success")} ${uiTheme.fg("toolOutput", details.customInput)}`;
		} else if (details.selectedOptions && details.selectedOptions.length > 0) {
			for (let i = 0; i < details.selectedOptions.length; i++) {
				const isLast = i === details.selectedOptions.length - 1;
				const branch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
				text += `\n ${uiTheme.fg("dim", branch)} ${uiTheme.fg("success", uiTheme.checkbox.checked)} ${uiTheme.fg("toolOutput", details.selectedOptions[i])}`;
			}
		} else {
			text += `\n ${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.styledSymbol("status.warning", "warning")} ${uiTheme.fg("warning", "Cancelled")}`;
		}

		return new Text(text, 0, 0);
	},
};
