/**
 * Component for displaying bash command execution with streaming output.
 */

import { Container, Loader, Spacer, Text, type TUI } from "@oh-my-pi/pi-tui";
import stripAnsi from "strip-ansi";
import { getSymbolTheme, theme } from "$c/modes/theme/theme";
import type { TruncationMeta } from "$c/tools/output-meta";
import { formatSize } from "$c/tools/truncate";
import { DynamicBorder } from "./dynamic-border";
import { truncateToVisualLines } from "./visual-truncate";

// Preview line limit when not expanded (matches tool execution behavior)
const PREVIEW_LINES = 20;

export class BashExecutionComponent extends Container {
	private command: string;
	private outputLines: string[] = [];
	private status: "running" | "complete" | "cancelled" | "error" = "running";
	private exitCode: number | undefined = undefined;
	private loader: Loader;
	private truncation?: TruncationMeta;
	private expanded = false;
	private contentContainer: Container;

	constructor(command: string, ui: TUI, excludeFromContext = false) {
		super();
		this.command = command;

		// Use dim border for excluded-from-context commands (!! prefix)
		const colorKey = excludeFromContext ? "dim" : "bashMode";
		const borderColor = (str: string) => theme.fg(colorKey, str);

		// Add spacer
		this.addChild(new Spacer(1));

		// Top border
		this.addChild(new DynamicBorder(borderColor));

		// Content container (holds dynamic content between borders)
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		// Command header
		const header = new Text(theme.fg(colorKey, theme.bold(`$ ${command}`)), 1, 0);
		this.contentContainer.addChild(header);

		// Loader
		this.loader = new Loader(
			ui,
			(spinner) => theme.fg(colorKey, spinner),
			(text) => theme.fg("muted", text),
			`Running${theme.format.ellipsis} (esc to cancel)`,
			getSymbolTheme().spinnerFrames,
		);
		this.contentContainer.addChild(this.loader);

		// Bottom border
		this.addChild(new DynamicBorder(borderColor));
	}

	/**
	 * Set whether the output is expanded (shows full output) or collapsed (preview only).
	 */
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

		// Append to output lines
		const newLines = clean.split("\n");
		if (this.outputLines.length > 0 && newLines.length > 0) {
			// Append first chunk to last line (incomplete line continuation)
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

		// Stop loader
		this.loader.stop();

		this.updateDisplay();
	}

	private updateDisplay(): void {
		const availableLines = this.outputLines;

		// Apply preview truncation based on expanded state
		const previewLogicalLines = availableLines.slice(-PREVIEW_LINES);
		const hiddenLineCount = availableLines.length - previewLogicalLines.length;

		// Rebuild content container
		this.contentContainer.clear();

		// Command header
		const header = new Text(theme.fg("bashMode", theme.bold(`$ ${this.command}`)), 1, 0);
		this.contentContainer.addChild(header);

		// Output
		if (availableLines.length > 0) {
			if (this.expanded) {
				// Show all lines
				const displayText = availableLines.map((line) => theme.fg("muted", line)).join("\n");
				this.contentContainer.addChild(new Text(`\n${displayText}`, 1, 0));
			} else {
				// Use shared visual truncation utility, recomputed per render width
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

		// Loader or status
		if (this.status === "running") {
			this.contentContainer.addChild(this.loader);
		} else {
			const statusParts: string[] = [];

			// Show how many lines are hidden (collapsed preview)
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
		// Strip ANSI codes and normalize line endings
		// Note: binary data is already sanitized in tui-renderer.ts executeBashCommand
		return stripAnsi(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	}

	private setOutput(output: string): void {
		const clean = this.normalizeOutput(output);
		this.outputLines = clean ? clean.split("\n") : [];
	}

	/**
	 * Get the raw output for creating BashExecutionMessage.
	 */
	getOutput(): string {
		return this.outputLines.join("\n");
	}

	/**
	 * Get the command that was executed.
	 */
	getCommand(): string {
		return this.command;
	}
}
