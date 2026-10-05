import { Container, Text, truncateToWidth } from "omk-tui";
import type { ToolDefinition, ToolRenderResultOptions } from "../../../core/extensions/types.ts";
import type { BashToolDetails } from "../../../core/tools/bash.ts";
import { str } from "../../../core/tools/render-utils.ts";
import { DEFAULT_MAX_BYTES, formatSize } from "../../../core/tools/truncate.ts";
import { keyHint } from "../components/keybinding-hints.ts";
import { truncateToVisualLines } from "../components/visual-truncate.ts";
import { theme } from "../theme/theme.ts";
import { getTextOutput, invalidArgText } from "./render-utils.ts";

const BASH_PREVIEW_LINES = 5;

type BashResultRenderState = {
	cachedWidth: number | undefined;
	cachedLines: string[] | undefined;
	cachedSkipped: number | undefined;
};

class BashResultRenderComponent extends Container {
	state: BashResultRenderState = {
		cachedWidth: undefined,
		cachedLines: undefined,
		cachedSkipped: undefined,
	};
}

function formatBashCall(args: { command?: string; timeout?: number } | undefined): string {
	const command = str(args?.command);
	const timeout = args?.timeout as number | undefined;
	const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
	const commandDisplay = command === null ? invalidArgText(theme) : command ? command : theme.fg("toolOutput", "...");
	return theme.fg("toolTitle", theme.bold(`$ ${commandDisplay}`)) + timeoutSuffix;
}

function rebuildBashResultRenderComponent(
	component: BashResultRenderComponent,
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: BashToolDetails;
	},
	options: ToolRenderResultOptions,
	showImages: boolean,
	startedAt: number | undefined,
	endedAt: number | undefined,
): void {
	const state = component.state;
	component.clear();

	let output = getTextOutput(result, showImages).trim();
	const truncation = result.details?.truncation;
	const fullOutputPath = result.details?.fullOutputPath;
	if (!options.isPartial && truncation?.truncated && fullOutputPath && output.endsWith("]")) {
		const footerStart = output.lastIndexOf("\n\n[");
		if (footerStart !== -1 && output.slice(footerStart).includes(fullOutputPath)) {
			output = output.slice(0, footerStart).trimEnd();
		}
	}

	if (output) {
		const styledOutput = output
			.split("\n")
			.map((line) => theme.fg("toolOutput", line))
			.join("\n");

		if (options.expanded) {
			component.addChild(new Text(`\n${styledOutput}`, 0, 0));
		} else {
			component.addChild({
				render: (width: number) => {
					if (state.cachedLines === undefined || state.cachedWidth !== width) {
						const preview = truncateToVisualLines(styledOutput, BASH_PREVIEW_LINES, width);
						state.cachedLines = preview.visualLines;
						state.cachedSkipped = preview.skippedCount;
						state.cachedWidth = width;
					}
					if (state.cachedSkipped && state.cachedSkipped > 0) {
						const hint =
							theme.fg("muted", `... (${state.cachedSkipped} earlier lines,`) +
							` ${keyHint("app.tools.expand", "to expand")})`;
						return ["", truncateToWidth(hint, width, "..."), ...(state.cachedLines ?? [])];
					}
					return ["", ...(state.cachedLines ?? [])];
				},
				invalidate: () => {
					state.cachedWidth = undefined;
					state.cachedLines = undefined;
					state.cachedSkipped = undefined;
				},
			});
		}
	}

	if (truncation?.truncated || fullOutputPath) {
		const warnings: string[] = [];
		if (fullOutputPath) {
			warnings.push(`Full output: ${fullOutputPath}`);
		}
		if (truncation?.truncated) {
			if (truncation.truncatedBy === "lines") {
				warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
			} else {
				warnings.push(
					`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
				);
			}
		}
		component.addChild(new Text(`\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`, 0, 0));
	}

	if (startedAt !== undefined) {
		const endTime = endedAt ?? Date.now();
		const timing = `${options.isPartial ? "Elapsed" : "Took"} ${((endTime - startedAt) / 1000).toFixed(1)}s`;
		component.addChild(new Text(`\n${theme.fg("muted", timing)}`, 0, 0));
	}
}

export const bashToolRenderers: Pick<ToolDefinition, "renderCall" | "renderResult"> = {
	renderCall(args, _theme, context) {
		const state = context.state;
		if (context.executionStarted && state.startedAt === undefined) {
			state.startedAt = Date.now();
			state.endedAt = undefined;
		}
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatBashCall(args as { command?: string; timeout?: number } | undefined));
		return text;
	},
	renderResult(result, options, _theme, context) {
		const state = context.state;
		if (state.startedAt !== undefined && options.isPartial && !state.interval) {
			state.interval = setInterval(() => context.invalidate(), 1000);
		}
		if (!options.isPartial || context.isError) {
			state.endedAt ??= Date.now();
			if (state.interval) {
				clearInterval(state.interval);
				state.interval = undefined;
			}
		}
		const component =
			(context.lastComponent as BashResultRenderComponent | undefined) ?? new BashResultRenderComponent();
		rebuildBashResultRenderComponent(
			component,
			result as Parameters<typeof rebuildBashResultRenderComponent>[1],
			options,
			context.showImages,
			state.startedAt,
			state.endedAt,
		);
		component.invalidate();
		return component;
	},
};
