/**
 * Component for displaying user-initiated Python execution with streaming output.
 * Shares the same kernel session as the agent's Python tool.
 */

import { Container, Loader, Spacer, Text, type TUI } from "@oh-my-pi/pi-tui";
import stripAnsi from "strip-ansi";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type TruncationResult,
	truncateTail,
} from "../../../core/tools/truncate";
import { getSymbolTheme, theme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";
import { truncateToVisualLines } from "./visual-truncate";

const PREVIEW_LINES = 20;

export class PythonExecutionComponent extends Container {
	private code: string;
	private outputLines: string[] = [];
	private status: "running" | "complete" | "cancelled" | "error" = "running";
	private exitCode: number | undefined = undefined;
	private loader: Loader;
	private truncationResult?: TruncationResult;
	private fullOutputPath?: string;
	private expanded = false;
	private contentContainer: Container;
	private excludeFromContext: boolean;

	constructor(code: string, ui: TUI, excludeFromContext = false) {
		super();
		this.code = code;
		this.excludeFromContext = excludeFromContext;

		const colorKey = excludeFromContext ? "dim" : "bashMode";
		const borderColor = (str: string) => theme.fg(colorKey, str);

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder(borderColor));

		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		const header = new Text(theme.fg(colorKey, theme.bold(`>>> ${code}`)), 1, 0);
		this.contentContainer.addChild(header);

		this.loader = new Loader(
			ui,
			(spinner) => theme.fg(colorKey, spinner),
			(text) => theme.fg("muted", text),
			`Running${theme.format.ellipsis} (esc to cancel)`,
			getSymbolTheme().spinnerFrames,
		);
		this.contentContainer.addChild(this.loader);

		this.addChild(new DynamicBorder(borderColor));
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	appendOutput(chunk: string): void {
		const clean = stripAnsi(chunk).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

		const newLines = clean.split("\n");
		if (this.outputLines.length > 0 && newLines.length > 0) {
			this.outputLines[this.outputLines.length - 1] += newLines[0];
			this.outputLines.push(...newLines.slice(1));
		} else {
			this.outputLines.push(...newLines);
		}

		this.updateDisplay();
	}

	setComplete(
		exitCode: number | undefined,
		cancelled: boolean,
		truncationResult?: TruncationResult,
		fullOutputPath?: string,
	): void {
		this.exitCode = exitCode;
		this.status = cancelled
			? "cancelled"
			: exitCode !== 0 && exitCode !== undefined && exitCode !== null
				? "error"
				: "complete";
		this.truncationResult = truncationResult;
		this.fullOutputPath = fullOutputPath;

		this.loader.stop();
		this.updateDisplay();
	}

	private updateDisplay(): void {
		const fullOutput = this.outputLines.join("\n");
		const contextTruncation = truncateTail(fullOutput, {
			maxLines: DEFAULT_MAX_LINES,
			maxBytes: DEFAULT_MAX_BYTES,
		});

		const availableLines = contextTruncation.content ? contextTruncation.content.split("\n") : [];
		const previewLogicalLines = availableLines.slice(-PREVIEW_LINES);
		const hiddenLineCount = availableLines.length - previewLogicalLines.length;

		this.contentContainer.clear();

		const colorKey = this.excludeFromContext ? "dim" : "bashMode";
		const header = new Text(theme.fg(colorKey, theme.bold(`>>> ${this.code}`)), 1, 0);
		this.contentContainer.addChild(header);

		if (availableLines.length > 0) {
			if (this.expanded) {
				const displayText = availableLines.map((line) => theme.fg("muted", line)).join("\n");
				this.contentContainer.addChild(new Text(`\n${displayText}`, 1, 0));
			} else {
				const styledOutput = previewLogicalLines.map((line) => theme.fg("muted", line)).join("\n");
				const previewText = `\n${styledOutput}`;
				this.contentContainer.addChild({
					render: (width: number) => {
						const { visualLines } = truncateToVisualLines(previewText, PREVIEW_LINES, width, 1);
						return visualLines;
					},
					invalidate: () => {},
				});
			}
		}

		if (this.status === "running") {
			this.contentContainer.addChild(this.loader);
		} else {
			const statusParts: string[] = [];

			if (hiddenLineCount > 0) {
				statusParts.push(
					theme.fg("dim", `${theme.format.ellipsis} ${hiddenLineCount} more lines (ctrl+o to expand)`),
				);
			}

			if (this.status === "cancelled") {
				statusParts.push(theme.fg("warning", "(cancelled)"));
			} else if (this.status === "error") {
				statusParts.push(theme.fg("error", `(exit ${this.exitCode})`));
			}

			const wasTruncated = this.truncationResult?.truncated || contextTruncation.truncated;
			if (wasTruncated && this.fullOutputPath) {
				statusParts.push(theme.fg("warning", `Output truncated. Full output: ${this.fullOutputPath}`));
			}

			if (statusParts.length > 0) {
				this.contentContainer.addChild(new Text(`\n${statusParts.join("\n")}`, 1, 0));
			}
		}
	}

	getOutput(): string {
		return this.outputLines.join("\n");
	}

	getCode(): string {
		return this.code;
	}
}
