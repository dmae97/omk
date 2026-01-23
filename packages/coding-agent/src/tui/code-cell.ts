/**
 * Render a code cell with optional output section.
 */

import { highlightCode, type Theme } from "$c/modes/theme/theme";
import { formatDuration, formatExpandHint, formatMoreItems, replaceTabs } from "$c/tools/render-utils";
import { renderOutputBlock } from "./output-block";
import type { State } from "./types";
import { getStateIcon } from "./utils";

export interface CodeCellOptions {
	code: string;
	language?: string;
	index?: number;
	total?: number;
	title?: string;
	status?: "pending" | "running" | "complete" | "error";
	spinnerFrame?: number;
	duration?: number;
	output?: string;
	outputMaxLines?: number;
	codeMaxLines?: number;
	expanded?: boolean;
	width: number;
}

function getState(status?: CodeCellOptions["status"]): State | undefined {
	if (!status) return undefined;
	if (status === "complete") return "success";
	if (status === "error") return "error";
	if (status === "running") return "running";
	return "pending";
}

function formatHeader(options: CodeCellOptions, theme: Theme): { title: string; meta?: string } {
	const { index, total, title, status, spinnerFrame, duration } = options;
	const parts: string[] = [];
	if (index !== undefined && total !== undefined) {
		parts.push(theme.fg("accent", `[${index + 1}/${total}]`));
	}
	if (title) {
		parts.push(theme.fg("toolTitle", title));
	}
	const headerTitle = parts.length > 0 ? parts.join(" ") : theme.fg("toolTitle", "Code");

	const metaParts: string[] = [];
	if (duration !== undefined) {
		metaParts.push(theme.fg("dim", `(${formatDuration(duration)})`));
	}
	if (status) {
		const icon = getStateIcon(
			status === "complete"
				? "success"
				: status === "error"
					? "error"
					: status === "running"
						? "running"
						: "pending",
			theme,
			spinnerFrame,
		);
		if (status === "pending" || status === "running") {
			metaParts.push(`${icon} ${theme.fg("muted", status)}`);
		} else {
			metaParts.push(icon);
		}
	}

	if (metaParts.length === 0) return { title: headerTitle };
	return { title: headerTitle, meta: metaParts.join(theme.fg("dim", theme.sep.dot)) };
}

export function renderCodeCell(options: CodeCellOptions, theme: Theme): string[] {
	const { code, language, output, expanded = false, outputMaxLines = 6, codeMaxLines = 12, width } = options;
	const { title, meta } = formatHeader(options, theme);
	const state = getState(options.status);

	const rawCodeLines = highlightCode(replaceTabs(code ?? ""), language);
	const maxCodeLines = expanded ? rawCodeLines.length : Math.min(rawCodeLines.length, codeMaxLines);
	const codeLines = rawCodeLines.slice(0, maxCodeLines);
	const hiddenCodeLines = rawCodeLines.length - codeLines.length;
	if (hiddenCodeLines > 0) {
		const hint = formatExpandHint(theme, expanded, hiddenCodeLines > 0);
		const moreLine = `${formatMoreItems(hiddenCodeLines, "line", theme)}${hint ? ` ${hint}` : ""}`;
		codeLines.push(theme.fg("dim", moreLine));
	}

	const outputLines: string[] = [];
	if (output?.trim()) {
		const rawLines = output.split("\n");
		const maxLines = expanded ? rawLines.length : Math.min(rawLines.length, outputMaxLines);
		const displayLines = rawLines
			.slice(0, maxLines)
			.map((line) => (line.includes("\x1b[") ? line : theme.fg("toolOutput", line)));
		outputLines.push(...displayLines);
		const remaining = rawLines.length - maxLines;
		if (remaining > 0) {
			const hint = formatExpandHint(theme, expanded, remaining > 0);
			const moreLine = `${formatMoreItems(remaining, "line", theme)}${hint ? ` ${hint}` : ""}`;
			outputLines.push(theme.fg("dim", moreLine));
		}
	}

	const sections: Array<{ label?: string; lines: string[] }> = [{ lines: codeLines }];
	if (outputLines.length > 0) {
		sections.push({ label: theme.fg("toolTitle", "Output"), lines: outputLines });
	}

	return renderOutputBlock({ header: title, headerMeta: meta, state, sections, width }, theme);
}
