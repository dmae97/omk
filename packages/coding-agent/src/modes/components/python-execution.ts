/**
 * Component for displaying user-initiated Python execution with streaming output.
 * Shares the same kernel session as the agent's Python tool.
 */

import { Container, Loader, Spacer, Text, type TUI } from "@oh-my-pi/pi-tui";
import stripAnsi from "strip-ansi";
import { getSymbolTheme, highlightCode, theme } from "$c/modes/theme/theme";
import type { TruncationMeta } from "$c/tools/output-meta";
import { formatSize } from "$c/tools/truncate";
import { DynamicBorder } from "./dynamic-border";
import { truncateToVisualLines } from "./visual-truncate";

const PREVIEW_LINES = 20;

export class PythonExecutionComponent extends Container {
	private code: string;
	private outputLines: string[] = [];
	private status: "running" | "complete" | "cancelled" | "error" = "running";
	private exitCode: number | undefined = undefined;
	private loader: Loader;
	private truncation?: TruncationMeta;
	private expanded = false;
	private contentContainer: Container;
	private excludeFromContext: boolean;

	private formatHeader(colorKey: "dim" | "pythonMode"): Text {
		const prompt = theme.fg(colorKey, theme.bold(">>>"));
		const continuation = theme.fg(colorKey, "    ");
		const codeLines = highlightCode(this.code, "python");
		const headerLines = codeLines.map((line, index) =>
			index === 0 ? `${prompt} ${line}` : `${continuation}${line}`,
		);
		return new Text(headerLines.join("\n"), 1, 0);
	}

	constructor(code: string, ui: TUI, excludeFromContext = false) {
		super();
		this.code = code;
		this.excludeFromContext = excludeFromContext;

		const colorKey = this.excludeFromContext ? "dim" : "pythonMode";
		const borderColor = (str: string) => theme.fg(colorKey, str);

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder(borderColor));

		this.contentContainer = new Container();
		this.addChild(this.contentContainer);
		this.contentContainer.addChild(this.formatHeader(colorKey));

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
		const clean = this.normalizeOutput(chunk);

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
		options?: { output?: string; truncation?: TruncationMeta },
	): void {
		this.exitCode = exitCode;
		this.status = cancelled
			? "cancelled"
			: exitCode !== 0 && exitCode !== undefined && exitCode !== null
				? "error"
				: "complete";
		this.truncation = options?.truncation;
		if (options?.output !== undefined) {
			this.setOutput(options.output);
		}

		this.loader.stop();
		this.updateDisplay();
	}

	private updateDisplay(): void {
		const availableLines = this.outputLines;
		const previewLogicalLines = availableLines.slice(-PREVIEW_LINES);
		const hiddenLineCount = availableLines.length - previewLogicalLines.length;

		this.contentContainer.clear();

		const colorKey = this.excludeFromContext ? "dim" : "pythonMode";
		this.contentContainer.addChild(this.formatHeader(colorKey));

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

			if (this.truncation) {
				const warnings: string[] = [];
				if (this.truncation.artifactId) {
					warnings.push(`Full output: artifact://${this.truncation.artifactId}`);
				}
				if (this.truncation.truncatedBy === "lines") {
					warnings.push(
						`Truncated: showing ${this.truncation.outputLines} of ${this.truncation.totalLines} lines`,
					);
				} else {
					warnings.push(
						`Truncated: ${this.truncation.outputLines} lines shown (${formatSize(this.truncation.outputBytes)} limit)`,
					);
				}
				statusParts.push(theme.fg("warning", warnings.join(". ")));
			}

			if (statusParts.length > 0) {
				this.contentContainer.addChild(new Text(`\n${statusParts.join("\n")}`, 1, 0));
			}
		}
	}

	private normalizeOutput(text: string): string {
		return stripAnsi(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	}

	private setOutput(output: string): void {
		const clean = this.normalizeOutput(output);
		this.outputLines = clean ? clean.split("\n") : [];
	}

	getOutput(): string {
		return this.outputLines.join("\n");
	}

	getCode(): string {
		return this.code;
	}
}
