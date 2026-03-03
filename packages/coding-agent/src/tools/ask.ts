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
import { untilAborted } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { type Theme, theme } from "../modes/theme/theme";
import askDescription from "../prompts/tools/ask.md" with { type: "text" };
import { renderStatusLine } from "../tui";
import type { ToolSession } from ".";
import { formatErrorMessage, formatMeta, formatTitle } from "./render-utils";
import { ToolAbortError } from "./tool-errors";

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

export type AskToolInput = Static<typeof askSchema>;

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

function getAutoSelectionOnTimeout(optionLabels: string[], recommended?: number): string[] {
	if (optionLabels.length === 0) return [];
	if (typeof recommended === "number" && recommended >= 0 && recommended < optionLabels.length) {
		return [optionLabels[recommended]];
	}
	return [optionLabels[0]];
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
	timedOut: boolean;
	navigation?: "back" | "forward";
	cancelled?: boolean;
}

interface NavigationControls {
	allowBack: boolean;
	allowForward: boolean;
	progressText?: string;
}
interface AskSingleQuestionOptions {
	recommended?: number;
	timeout?: number;
	signal?: AbortSignal;
	initialSelection?: Pick<SelectionResult, "selectedOptions" | "customInput">;
	navigation?: NavigationControls;
}

interface UIContext {
	select(
		prompt: string,
		options: string[],
		options_?: {
			initialIndex?: number;
			timeout?: number;
			signal?: AbortSignal;
			outline?: boolean;
			onTimeout?: () => void;
			onLeft?: () => void;
			onRight?: () => void;
			helpText?: string;
		},
	): Promise<string | undefined>;
	input(
		prompt: string,
		options_?: { signal?: AbortSignal; timeout?: number; onTimeout?: () => void },
	): Promise<string | undefined>;
}

async function askSingleQuestion(
	ui: UIContext,
	question: string,
	optionLabels: string[],
	multi: boolean,
	options: AskSingleQuestionOptions = {},
): Promise<SelectionResult> {
	const { recommended, timeout, signal, initialSelection, navigation } = options;
	const doneLabel = getDoneOptionLabel();
	let selectedOptions = [...(initialSelection?.selectedOptions ?? [])];
	let customInput = initialSelection?.customInput;
	let timedOut = false;

	const selectOption = async (
		prompt: string,
		optionsToShow: string[],
		initialIndex?: number,
	): Promise<{ choice: string | undefined; timedOut: boolean; navigation?: "back" | "forward" }> => {
		let timeoutTriggered = false;
		const onTimeout = () => {
			timeoutTriggered = true;
		};
		let navigationAction: "back" | "forward" | undefined;
		const helpText = navigation
			? "up/down navigate  enter select  ←/→ question  esc cancel"
			: "up/down navigate  enter select  esc cancel";
		const dialogOptions = {
			initialIndex,
			timeout,
			signal,
			outline: true,
			onTimeout,
			helpText,
			onLeft: navigation?.allowBack
				? () => {
						navigationAction = "back";
					}
				: undefined,
			onRight: navigation?.allowForward
				? () => {
						navigationAction = "forward";
					}
				: undefined,
		};
		const startMs = Date.now();
		const choice = signal
			? await untilAborted(signal, () => ui.select(prompt, optionsToShow, dialogOptions))
			: await ui.select(prompt, optionsToShow, dialogOptions);
		if (!timeoutTriggered && choice === undefined && typeof timeout === "number") {
			timeoutTriggered = Date.now() - startMs >= timeout;
		}
		return { choice, timedOut: timeoutTriggered, navigation: navigationAction };
	};

	const promptForInput = async (): Promise<{ input: string | undefined; timedOut: boolean }> => {
		let inputTimedOut = false;
		const onTimeout = () => {
			inputTimedOut = true;
		};
		const input = signal
			? await untilAborted(signal, () => ui.input("Enter your response:", { signal, timeout, onTimeout }))
			: await ui.input("Enter your response:", { signal, timeout, onTimeout });
		return { input, timedOut: inputTimedOut };
	};

	const promptWithProgress = navigation?.progressText ? `${question} (${navigation.progressText})` : question;
	if (multi) {
		const selected = new Set<string>(selectedOptions);
		let cursorIndex = Math.min(Math.max(recommended ?? 0, 0), Math.max(optionLabels.length - 1, 0));
		const firstSelected = selectedOptions[0];
		if (firstSelected) {
			const selectedIndex = optionLabels.indexOf(firstSelected);
			if (selectedIndex >= 0) cursorIndex = selectedIndex;
		}
		while (true) {
			const opts: string[] = [];

			for (const opt of optionLabels) {
				const checkbox = selected.has(opt) ? theme.checkbox.checked : theme.checkbox.unchecked;
				opts.push(`${checkbox} ${opt}`);
			}

			if (!navigation?.allowForward && selected.size > 0) {
				opts.push(doneLabel);
			}
			opts.push(OTHER_OPTION);

			const prefix = selected.size > 0 ? `(${selected.size} selected) ` : "";
			const {
				choice,
				timedOut: selectTimedOut,
				navigation: arrowNavigation,
			} = await selectOption(`${prefix}${promptWithProgress}`, opts, cursorIndex);

			if (arrowNavigation) {
				return { selectedOptions: Array.from(selected), customInput, timedOut, navigation: arrowNavigation };
			}
			if (choice === undefined) {
				if (selectTimedOut) {
					timedOut = true;
					break;
				}
				return { selectedOptions: Array.from(selected), customInput, timedOut, cancelled: true };
			}
			if (choice === doneLabel) break;

			if (choice === OTHER_OPTION) {
				if (selectTimedOut) {
					timedOut = true;
					break;
				}
				const inputResult = await promptForInput();
				if (inputResult.input) customInput = inputResult.input;
				if (inputResult.timedOut) timedOut = true;
				break;
			}

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

			if (selectTimedOut) {
				timedOut = true;
				break;
			}
		}
		selectedOptions = Array.from(selected);
	} else {
		const displayLabels = addRecommendedSuffix(optionLabels, recommended);
		const optionsWithNavigation = [...displayLabels, OTHER_OPTION];

		let initialIndex = recommended;
		const previouslySelected = selectedOptions[0];
		if (previouslySelected) {
			const selectedIndex = optionLabels.indexOf(previouslySelected);
			if (selectedIndex >= 0) initialIndex = selectedIndex;
		} else if (customInput) {
			initialIndex = displayLabels.length;
		}
		if (initialIndex !== undefined) {
			const maxIndex = Math.max(optionsWithNavigation.length - 1, 0);
			initialIndex = Math.max(0, Math.min(initialIndex, maxIndex));
		}

		const {
			choice,
			timedOut: selectTimedOut,
			navigation: arrowNavigation,
		} = await selectOption(promptWithProgress, optionsWithNavigation, initialIndex);
		timedOut = selectTimedOut;

		if (arrowNavigation) {
			return { selectedOptions, customInput, timedOut, navigation: arrowNavigation };
		}
		if (choice === undefined) {
			if (!timedOut) {
				return { selectedOptions, customInput, timedOut, cancelled: true };
			}
		} else if (choice === OTHER_OPTION) {
			if (!selectTimedOut) {
				const inputResult = await promptForInput();
				if (inputResult.input) customInput = inputResult.input;
				if (inputResult.timedOut) timedOut = true;
			}
			selectedOptions = [];
		} else {
			selectedOptions = [stripRecommendedSuffix(choice)];
			customInput = undefined;
		}
		if (navigation?.allowForward) {
			return { selectedOptions, customInput, timedOut, navigation: "forward" };
		}
	}

	if (timedOut && selectedOptions.length === 0 && !customInput) {
		selectedOptions = getAutoSelectionOnTimeout(optionLabels, recommended);
	}

	return { selectedOptions, customInput, timedOut };
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

type AskParams = AskToolInput;

/**
 * Ask tool for interactive user prompting during execution.
 *
 * Allows gathering user preferences, clarifying instructions, and getting decisions
 * on implementation choices as the agent works.
 */
export class AskTool implements AgentTool<typeof askSchema, AskToolDetails> {
	readonly name = "ask";
	readonly label = "Ask";
	readonly description: string;
	readonly parameters = askSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {
		this.description = renderPromptTemplate(askDescription);
	}

	static createIf(session: ToolSession): AskTool | null {
		return session.hasUI ? new AskTool(session) : null;
	}

	/** Send terminal notification when ask tool is waiting for input */
	#sendAskNotification(): void {
		const method = this.session.settings.get("ask.notify");
		if (method === "off") return;
		TERMINAL.sendNotification("Waiting for input");
	}

	async execute(
		_toolCallId: string,
		params: AskParams,
		signal?: AbortSignal,
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

		const extensionUi = context.ui;
		const ui: UIContext = {
			select: (prompt, options, dialogOptions) => extensionUi.select(prompt, options, dialogOptions),
			input: (prompt, dialogOptions) => extensionUi.input(prompt, undefined, dialogOptions),
		};

		// Determine timeout based on settings and plan mode
		const planModeEnabled = this.session.getPlanModeState?.()?.enabled ?? false;
		// Settings.get("ask.timeout") returns seconds (0 = disabled), convert to ms
		const timeoutSeconds = this.session.settings.get("ask.timeout");
		const settingsTimeout = timeoutSeconds === 0 ? null : timeoutSeconds * 1000;
		const timeout = planModeEnabled ? null : settingsTimeout;

		// Send notification if waiting and not suppressed
		this.#sendAskNotification();

		if (params.questions.length === 0) {
			return {
				content: [{ type: "text" as const, text: "Error: questions must not be empty" }],
				details: {},
			};
		}

		const askQuestion = async (
			q: AskParams["questions"][number],
			options?: { previous?: QuestionResult; navigation?: NavigationControls },
		) => {
			const optionLabels = q.options.map(o => o.label);
			try {
				const { selectedOptions, customInput, navigation, cancelled, timedOut } = await askSingleQuestion(
					ui,
					q.question,
					optionLabels,
					q.multi ?? false,
					{
						recommended: q.recommended,
						timeout: timeout ?? undefined,
						signal,
						initialSelection: options?.previous,
						navigation: options?.navigation,
					},
				);
				return { optionLabels, selectedOptions, customInput, navigation, cancelled, timedOut };
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					throw new ToolAbortError("Ask input was cancelled");
				}
				throw error;
			}
		};

		if (params.questions.length === 1) {
			const [q] = params.questions;
			const { optionLabels, selectedOptions, customInput, cancelled, timedOut } = await askQuestion(q);

			if (!timedOut && (cancelled || (selectedOptions.length === 0 && !customInput))) {
				context.abort();
				throw new ToolAbortError("Ask tool was cancelled by the user");
			}
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

		const resultsByIndex: Array<QuestionResult | undefined> = Array.from({ length: params.questions.length });
		let questionIndex = 0;
		while (questionIndex < params.questions.length) {
			const q = params.questions[questionIndex]!;
			const previous = resultsByIndex[questionIndex];
			const navigation: NavigationControls = {
				allowBack: questionIndex > 0,
				allowForward: true,
				progressText: `${questionIndex + 1}/${params.questions.length}`,
			};
			const {
				optionLabels,
				selectedOptions,
				customInput,
				navigation: navAction,
				cancelled,
				timedOut,
			} = await askQuestion(q, { previous, navigation });

			if (cancelled && !timedOut) {
				context.abort();
				throw new ToolAbortError("Ask tool was cancelled by the user");
			}

			resultsByIndex[questionIndex] = {
				id: q.id,
				question: q.question,
				options: optionLabels,
				multi: q.multi ?? false,
				selectedOptions,
				customInput,
			};

			if (navAction === "back") {
				questionIndex = Math.max(0, questionIndex - 1);
				continue;
			}

			questionIndex += 1;
		}

		const results = resultsByIndex.map((result, index) => {
			if (result) return result;
			const q = params.questions[index]!;
			return {
				id: q.id,
				question: q.question,
				options: q.options.map(o => o.label),
				multi: q.multi ?? false,
				selectedOptions: [],
			};
		});

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
	renderCall(args: AskRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const label = formatTitle("Ask", uiTheme);

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
			return new Text(formatErrorMessage("No question provided", uiTheme), 0, 0);
		}

		let text = `${label} ${uiTheme.fg("accent", args.question)}`;
		const meta: string[] = [];
		if (args.multi) meta.push("multi");
		if (args.options?.length) meta.push(`options:${args.options.length}`);
		text += formatMeta(meta, uiTheme);

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
		_options: RenderResultOptions,
		uiTheme: Theme,
	): Component {
		const { details } = result;
		if (!details) {
			const txt = result.content[0];
			const fallback = txt?.type === "text" && txt.text ? txt.text : "";
			const header = renderStatusLine({ icon: "warning", title: "Ask" }, uiTheme);
			return new Text(`${header}\n${uiTheme.fg("dim", fallback)}`, 0, 0);
		}

		// Multi-part results
		if (details.results && details.results.length > 0) {
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
			let text = header;

			for (let i = 0; i < details.results.length; i++) {
				const r = details.results[i];
				const isLastQuestion = i === details.results.length - 1;
				const branch = isLastQuestion ? uiTheme.tree.last : uiTheme.tree.branch;
				const continuation = isLastQuestion ? "   " : `${uiTheme.fg("dim", uiTheme.tree.vertical)}  `;
				const hasSelection = r.customInput || r.selectedOptions.length > 0;
				const statusIcon = hasSelection
					? uiTheme.styledSymbol("status.success", "success")
					: uiTheme.styledSymbol("status.warning", "warning");

				text += `\n ${uiTheme.fg("dim", branch)} ${statusIcon} ${uiTheme.fg("dim", `[${r.id}]`)} ${uiTheme.fg("accent", r.question)}`;

				if (r.customInput) {
					text += `\n${continuation}${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.styledSymbol("status.success", "success")} ${uiTheme.fg("toolOutput", r.customInput)}`;
				} else if (r.selectedOptions.length > 0) {
					for (let j = 0; j < r.selectedOptions.length; j++) {
						const isLast = j === r.selectedOptions.length - 1;
						const optBranch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
						text += `\n${continuation}${uiTheme.fg("dim", optBranch)} ${uiTheme.fg("success", uiTheme.checkbox.checked)} ${uiTheme.fg("toolOutput", r.selectedOptions[j])}`;
					}
				} else {
					text += `\n${continuation}${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.styledSymbol("status.warning", "warning")} ${uiTheme.fg("warning", "Cancelled")}`;
				}
			}

			return new Text(text, 0, 0);
		}

		// Single question result
		if (!details.question) {
			const txt = result.content[0];
			const fallback = txt?.type === "text" && txt.text ? txt.text : "";
			return new Text(fallback, 0, 0);
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
