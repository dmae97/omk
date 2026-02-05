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
 *   - Use recommended: <index> to mark the default option; "(Recommended)" suffix is added automatically
 *   - Questions may time out and auto-select the recommended option (configurable, disabled in plan mode)
 */
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { TERMINAL, Text } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { type Theme, theme } from "../modes/theme/theme";
import askDescription from "../prompts/tools/ask.md" with { type: "text" };
import { renderStatusLine } from "../tui";
import type { ToolSession } from ".";
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
	recommended: Type.Optional(Type.Number({ description: "Index of recommended option (0-indexed)" })),
});

const askSchema = Type.Object({
	questions: Type.Array(QuestionItem, { description: "Questions to ask", minItems: 1 }),
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
const RECOMMENDED_SUFFIX = " (Recommended)";
/** Default timeout in milliseconds (used when settings unavailable) */
const _DEFAULT_ASK_TIMEOUT_MS = 30000;

function getDoneOptionLabel(): string {
	return `${theme.status.success} Done selecting`;
}

/** Add "(Recommended)" suffix to the option at the given index if not already present */
function addRecommendedSuffix(labels: string[], recommendedIndex?: number): string[] {
	if (recommendedIndex === undefined || recommendedIndex < 0 || recommendedIndex >= labels.length) {
		return labels;
	}
	return labels.map((label, i) => {
		if (i === recommendedIndex && !label.endsWith(RECOMMENDED_SUFFIX)) {
			return label + RECOMMENDED_SUFFIX;
		}
		return label;
	});
}

/** Strip "(Recommended)" suffix from a label */
function stripRecommendedSuffix(label: string): string {
	return label.endsWith(RECOMMENDED_SUFFIX) ? label.slice(0, -RECOMMENDED_SUFFIX.length) : label;
}

// =============================================================================
// Question Selection Logic
// =============================================================================

interface SelectionResult {
	selectedOptions: string[];
	customInput?: string;
}

interface UIContext {
	select(
		prompt: string,
		options: string[],
		options_?: { initialIndex?: number; timeout?: number; outline?: boolean },
	): Promise<string | undefined>;
	input(prompt: string): Promise<string | undefined>;
}

interface AskQuestionOptions {
	/** Timeout in milliseconds, null/undefined to disable */
	timeout?: number | null;
}

async function askSingleQuestion(
	ui: UIContext,
	question: string,
	optionLabels: string[],
	multi: boolean,
	recommended?: number,
	options?: AskQuestionOptions,
): Promise<SelectionResult> {
	const timeout = options?.timeout ?? undefined;
	const doneLabel = getDoneOptionLabel();
	let selectedOptions: string[] = [];
	let customInput: string | undefined;

	if (multi) {
		const selected = new Set<string>();
		let cursorIndex = Math.min(Math.max(recommended ?? 0, 0), optionLabels.length - 1);

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
			const selectionStart = Date.now();
			const choice = await ui.select(`${prefix}${question}`, opts, {
				initialIndex: cursorIndex,
				timeout: timeout ?? undefined,
				outline: true,
			});
			const elapsed = Date.now() - selectionStart;
			const timedOut = timeout != null && elapsed >= timeout;

			if (choice === undefined || choice === doneLabel) break;

			if (choice === OTHER_OPTION) {
				if (!timedOut) {
					const input = await ui.input("Enter your response:");
					if (input) customInput = input;
				}
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

			if (timedOut) {
				break;
			}
		}
		selectedOptions = Array.from(selected);
	} else {
		const displayLabels = addRecommendedSuffix(optionLabels, recommended);
		const choice = await ui.select(question, [...displayLabels, OTHER_OPTION], {
			timeout: timeout ?? undefined,
			initialIndex: recommended,
			outline: true,
		});
		if (choice === OTHER_OPTION) {
			const input = await ui.input("Enter your response:");
			if (input) customInput = input;
		} else if (choice) {
			selectedOptions = [stripRecommendedSuffix(choice)];
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
	questions: Array<{
		id: string;
		question: string;
		options: Array<{ label: string }>;
		multi?: boolean;
		recommended?: number;
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
	private readonly session: ToolSession;

	constructor(session: ToolSession) {
		this.session = session;
		this.description = renderPromptTemplate(askDescription);
	}

	static createIf(session: ToolSession): AskTool | null {
		return session.hasUI ? new AskTool(session) : null;
	}

	/** Send terminal notification when ask tool is waiting for input */
	private sendAskNotification(): void {
		const method = this.session.settings.get("ask.notify");
		if (method === "off") return;
		TERMINAL.sendNotification("Waiting for input");
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

		// Determine timeout based on settings and plan mode
		const planModeEnabled = this.session.getPlanModeState?.()?.enabled ?? false;
		// Settings.get("ask.timeout") returns seconds (0 = disabled), convert to ms
		const timeoutSeconds = this.session.settings.get("ask.timeout");
		const settingsTimeout = timeoutSeconds === 0 ? null : timeoutSeconds * 1000;
		const timeout = planModeEnabled ? null : settingsTimeout;

		// Send notification if waiting and not suppressed
		this.sendAskNotification();

		if (params.questions.length === 0) {
			return {
				content: [{ type: "text" as const, text: "Error: questions must not be empty" }],
				details: {},
			};
		}

		if (params.questions.length === 1) {
			const [q] = params.questions;
			const optionLabels = q.options.map(o => o.label);
			const { selectedOptions, customInput } = await askSingleQuestion(
				ui,
				q.question,
				optionLabels,
				q.multi ?? false,
				q.recommended,
				{ timeout },
			);

			const details: AskToolDetails = {
				question: q.question,
				options: optionLabels,
				multi: q.multi ?? false,
				selectedOptions,
				customInput,
			};

			let responseText: string;
			if (customInput) {
				responseText = `User provided custom input: ${customInput}`;
			} else if (selectedOptions.length > 0) {
				responseText = q.multi
					? `User selected: ${selectedOptions.join(", ")}`
					: `User selected: ${selectedOptions[0]}`;
			} else {
				responseText = "User cancelled the selection";
			}

			return { content: [{ type: "text" as const, text: responseText }], details };
		}

		const results: QuestionResult[] = [];

		for (const q of params.questions) {
			const optionLabels = q.options.map(o => o.label);
			const { selectedOptions, customInput } = await askSingleQuestion(
				ui,
				q.question,
				optionLabels,
				q.multi ?? false,
				q.recommended,
				{ timeout },
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
				r => r.customInput || (r.selectedOptions && r.selectedOptions.length > 0),
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
