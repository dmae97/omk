/**
 * TUI rendering for task tool.
 *
 * Provides renderCall and renderResult functions for displaying
 * task execution in the terminal UI.
 */

import path from "node:path";
import type { Component } from "@oh-my-pi/pi-tui";
import { Container, Text } from "@oh-my-pi/pi-tui";
import type { RenderResultOptions } from "$c/extensibility/custom-tools/types";
import type { Theme } from "$c/modes/theme/theme";
import {
	formatBadge,
	formatDuration,
	formatMoreItems,
	formatStatusIcon,
	formatTokens,
	truncate,
} from "$c/tools/render-utils";
import {
	type FindingPriority,
	getPriorityInfo,
	PRIORITY_LABELS,
	type ReportFindingDetails,
	type SubmitReviewDetails,
} from "$c/tools/review";
import { renderStatusLine } from "$c/tui";
import { subprocessToolRegistry } from "./subprocess-tool-registry";
import type { AgentProgress, SingleResult, TaskParams, TaskToolDetails } from "./types";

/**
 * Get status icon for agent state.
 * For running status, uses animated spinner if spinnerFrame is provided.
 * Maps AgentProgress status to styled icon format.
 */
function getStatusIcon(status: AgentProgress["status"], theme: Theme, spinnerFrame?: number): string {
	switch (status) {
		case "pending":
			return formatStatusIcon("pending", theme);
		case "running":
			return formatStatusIcon("running", theme, spinnerFrame);
		case "completed":
			return formatStatusIcon("success", theme);
		case "failed":
			return formatStatusIcon("error", theme);
		case "aborted":
			return formatStatusIcon("aborted", theme);
	}
}

function formatFindingSummary(findings: ReportFindingDetails[], theme: Theme): string {
	if (findings.length === 0) return theme.fg("dim", "Findings: none");

	const counts: { [P in FindingPriority]?: number } = {};
	for (const finding of findings) {
		counts[finding.priority] = (counts[finding.priority] ?? 0) + 1;
	}

	const parts: string[] = [];
	for (const label of PRIORITY_LABELS) {
		const { symbol, color } = getPriorityInfo(label);
		const count = counts[label] ?? 0;
		const text = theme.fg(color, `${label}:${count}`);
		parts.push(theme.styledSymbol(symbol, color) ? `${theme.styledSymbol(symbol, color)} ${text}` : text);
	}

	return `${theme.fg("dim", "Findings:")} ${parts.join(theme.sep.dot)}`;
}

function formatJsonScalar(value: unknown, theme: Theme): string {
	if (value === null) return "null";
	if (typeof value === "string") {
		const trimmed = truncate(value, 70, theme.format.ellipsis);
		return `"${trimmed}"`;
	}
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}

function buildTreePrefix(ancestors: boolean[], theme: Theme): string {
	return ancestors.map((hasNext) => (hasNext ? `${theme.tree.vertical}  ` : "   ")).join("");
}

function renderJsonTreeLines(
	value: unknown,
	theme: Theme,
	maxDepth: number,
	maxLines: number,
): { lines: string[]; truncated: boolean } {
	const lines: string[] = [];
	let truncated = false;

	const iconObject = theme.styledSymbol("icon.folder", "muted");
	const iconArray = theme.styledSymbol("icon.package", "muted");
	const iconScalar = theme.styledSymbol("icon.file", "muted");

	const pushLine = (line: string) => {
		if (lines.length >= maxLines) {
			truncated = true;
			return false;
		}
		lines.push(line);
		return true;
	};

	const renderNode = (val: unknown, key: string | undefined, ancestors: boolean[], isLast: boolean, depth: number) => {
		if (lines.length >= maxLines) {
			truncated = true;
			return;
		}

		const connector = isLast ? theme.tree.last : theme.tree.branch;
		const prefix = `${buildTreePrefix(ancestors, theme)}${theme.fg("dim", connector)} `;
		const scalar = formatJsonScalar(val, theme);

		if (scalar) {
			const label = key ? theme.fg("muted", key) : theme.fg("muted", "value");
			pushLine(`${prefix}${iconScalar} ${label}: ${theme.fg("dim", scalar)}`);
			return;
		}

		if (Array.isArray(val)) {
			const header = key ? theme.fg("muted", key) : theme.fg("muted", "array");
			pushLine(`${prefix}${iconArray} ${header}`);
			if (val.length === 0) {
				pushLine(
					`${buildTreePrefix([...ancestors, !isLast], theme)}${theme.fg("dim", theme.tree.last)} ${theme.fg(
						"dim",
						"[]",
					)}`,
				);
				return;
			}
			if (depth >= maxDepth) {
				pushLine(
					`${buildTreePrefix([...ancestors, !isLast], theme)}${theme.fg("dim", theme.tree.last)} ${theme.fg(
						"dim",
						theme.format.ellipsis,
					)}`,
				);
				return;
			}
			const nextAncestors = [...ancestors, !isLast];
			for (let i = 0; i < val.length; i++) {
				renderNode(val[i], `[${i}]`, nextAncestors, i === val.length - 1, depth + 1);
				if (lines.length >= maxLines) {
					truncated = true;
					return;
				}
			}
			return;
		}

		if (val && typeof val === "object") {
			const header = key ? theme.fg("muted", key) : theme.fg("muted", "object");
			pushLine(`${prefix}${iconObject} ${header}`);
			const entries = Object.entries(val as Record<string, unknown>);
			if (entries.length === 0) {
				pushLine(
					`${buildTreePrefix([...ancestors, !isLast], theme)}${theme.fg("dim", theme.tree.last)} ${theme.fg(
						"dim",
						"{}",
					)}`,
				);
				return;
			}
			if (depth >= maxDepth) {
				pushLine(
					`${buildTreePrefix([...ancestors, !isLast], theme)}${theme.fg("dim", theme.tree.last)} ${theme.fg(
						"dim",
						theme.format.ellipsis,
					)}`,
				);
				return;
			}
			const nextAncestors = [...ancestors, !isLast];
			for (let i = 0; i < entries.length; i++) {
				const [childKey, child] = entries[i];
				renderNode(child, childKey, nextAncestors, i === entries.length - 1, depth + 1);
				if (lines.length >= maxLines) {
					truncated = true;
					return;
				}
			}
			return;
		}

		const label = key ? theme.fg("muted", key) : theme.fg("muted", "value");
		pushLine(`${prefix}${iconScalar} ${label}: ${theme.fg("dim", String(val))}`);
	};

	const renderRoot = (val: unknown) => {
		if (Array.isArray(val)) {
			for (let i = 0; i < val.length; i++) {
				renderNode(val[i], `[${i}]`, [], i === val.length - 1, 1);
				if (lines.length >= maxLines) {
					truncated = true;
					return;
				}
			}
			return;
		}
		if (val && typeof val === "object") {
			const entries = Object.entries(val as Record<string, unknown>);
			for (let i = 0; i < entries.length; i++) {
				const [childKey, child] = entries[i];
				renderNode(child, childKey, [], i === entries.length - 1, 1);
				if (lines.length >= maxLines) {
					truncated = true;
					return;
				}
			}
			return;
		}
		renderNode(val, undefined, [], true, 0);
	};

	renderRoot(value);

	return { lines, truncated };
}

function renderOutputSection(
	output: string,
	continuePrefix: string,
	expanded: boolean,
	theme: Theme,
	maxCollapsed = 3,
	maxExpanded = 10,
): string[] {
	const lines: string[] = [];
	const trimmedOutput = output.trim();
	if (!trimmedOutput) return lines;

	if (trimmedOutput.startsWith("{") || trimmedOutput.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmedOutput);

			// Collapsed: inline format like Args
			if (!expanded) {
				lines.push(`${continuePrefix}${theme.fg("dim", formatOutputInline(parsed, theme))}`);
				return lines;
			}

			// Expanded: tree format
			lines.push(`${continuePrefix}${theme.fg("dim", "Output")}`);
			const tree = renderJsonTreeLines(parsed, theme, expanded ? 6 : 2, expanded ? 24 : 6);
			if (tree.lines.length > 0) {
				for (const line of tree.lines) {
					lines.push(`${continuePrefix}  ${line}`);
				}
				if (tree.truncated) {
					lines.push(`${continuePrefix}  ${theme.fg("dim", theme.format.ellipsis)}`);
				}
				return lines;
			}
		} catch {
			// Fall back to raw output
		}
	}

	lines.push(`${continuePrefix}${theme.fg("dim", "Output")}`);

	const outputLines = output.split("\n").filter((line) => line.trim());
	const previewCount = expanded ? maxExpanded : maxCollapsed;
	for (const line of outputLines.slice(0, previewCount)) {
		lines.push(`${continuePrefix}  ${theme.fg("dim", truncate(line, 70, theme.format.ellipsis))}`);
	}

	if (outputLines.length > previewCount) {
		lines.push(
			`${continuePrefix}  ${theme.fg("dim", formatMoreItems(outputLines.length - previewCount, "line", theme))}`,
		);
	}

	return lines;
}

function formatArgsInline(args: Record<string, string>, theme: Theme): string {
	const entries = Object.entries(args);
	if (entries.length === 0) return "No arguments";

	// Single variable: show inline as "Key: value" without tree structure
	if (entries.length === 1) {
		const [key, value] = entries[0];
		const humanKey = humanizeKey(key);
		const displayValue = `"${truncate(value, 32, theme.format.ellipsis)}"`;
		return `${humanKey}: ${displayValue}`;
	}

	const pairs = entries.map(([key, value]) => `${key}=${truncate(value, 24, theme.format.ellipsis)}`);
	return `Args: ${pairs.join(", ")}`;
}

/** Convert snake_case or kebab-case to Title Case */
function humanizeKey(key: string): string {
	return key.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatScalarInline(value: unknown, maxLen: number, theme: Theme): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "boolean") return String(value);
	if (typeof value === "number") return String(value);
	if (typeof value === "string") return `"${truncate(value, maxLen, theme.format.ellipsis)}"`;
	if (Array.isArray(value)) return `[${value.length} items]`;
	if (typeof value === "object") {
		const keys = Object.keys(value);
		return `{${keys.length} keys}`;
	}
	return String(value);
}

function formatOutputInline(data: unknown, theme: Theme, maxWidth = 80): string {
	if (data === null || data === undefined) return "Output: none";

	// For scalars, show directly
	if (typeof data !== "object") {
		return `Output: ${formatScalarInline(data, 60, theme)}`;
	}

	// For arrays, show count and first element preview
	if (Array.isArray(data)) {
		if (data.length === 0) return "Output: []";
		const preview = formatScalarInline(data[0], 40, theme);
		return `Output: [${data.length} items] ${preview}${data.length > 1 ? theme.format.ellipsis : ""}`;
	}

	// For objects, show key=value pairs inline
	const entries = Object.entries(data as Record<string, unknown>);
	if (entries.length === 0) return "Output: {}";

	const pairs: string[] = [];
	let totalLen = "Output: ".length;

	for (const [key, value] of entries) {
		const valueStr = formatScalarInline(value, 24, theme);
		const pairStr = `${key}=${valueStr}`;
		const addLen = pairs.length > 0 ? pairStr.length + 2 : pairStr.length; // +2 for ", "

		if (totalLen + addLen > maxWidth && pairs.length > 0) {
			pairs.push(theme.format.ellipsis);
			break;
		}

		pairs.push(pairStr);
		totalLen += addLen;
	}

	return `Output: ${pairs.join(", ")}`;
}

function renderArgsSection(
	args: Record<string, string> | undefined,
	continuePrefix: string,
	expanded: boolean,
	theme: Theme,
): string[] {
	if (!args) return [];
	// Filter out auto-injected id and description
	const filteredArgs = Object.fromEntries(
		Object.entries(args).filter(([key]) => key !== "id" && key !== "description"),
	);
	if (Object.keys(filteredArgs).length === 0) return [];
	const lines: string[] = [];
	const entries = Object.entries(filteredArgs);

	if (!expanded) {
		lines.push(`${continuePrefix}${theme.fg("dim", formatArgsInline(filteredArgs, theme))}`);
		return lines;
	}

	// Single variable: show inline as "Key: value" without tree structure
	if (entries.length === 1) {
		const [key, value] = entries[0];
		const humanKey = humanizeKey(key);
		const displayValue = `"${truncate(value, 60, theme.format.ellipsis)}"`;
		lines.push(`${continuePrefix}${theme.fg("dim", `${humanKey}: ${displayValue}`)}`);
		return lines;
	}

	lines.push(`${continuePrefix}${theme.fg("dim", "Args")}`);
	const tree = renderJsonTreeLines(filteredArgs, theme, 4, 16);
	for (const line of tree.lines) {
		lines.push(`${continuePrefix}  ${line}`);
	}
	if (tree.truncated) {
		lines.push(`${continuePrefix}  ${theme.fg("dim", theme.format.ellipsis)}`);
	}

	return lines;
}

/**
 * Render the tool call arguments.
 */
export function renderCall(args: TaskParams, theme: Theme): Component {
	const lines: string[] = [];
	lines.push(renderStatusLine({ icon: "pending", title: "Task", description: args.agent }, theme));

	const contextTemplate = args.context ?? "";
	const context = contextTemplate.trim();
	const hasContext = context.length > 0;
	const branch = theme.fg("dim", theme.tree.branch);
	const last = theme.fg("dim", theme.tree.last);
	const vertical = theme.fg("dim", theme.tree.vertical);
	const showIsolated = args.isolated === true;

	if (hasContext) {
		lines.push(` ${branch} ${theme.fg("dim", "Context")}`);
		for (const line of context.split("\n")) {
			const content = line ? theme.fg("muted", line) : "";
			lines.push(` ${vertical}  ${content}`);
		}
		const taskPrefix = showIsolated ? branch : last;
		lines.push(` ${taskPrefix} ${theme.fg("dim", "Tasks")}: ${theme.fg("muted", `${args.tasks.length} agents`)}`);
		if (showIsolated) {
			lines.push(` ${last} ${theme.fg("dim", "Isolated")}: ${theme.fg("muted", "true")}`);
		}
		return new Text(lines.join("\n"), 0, 0);
	}

	lines.push(`${theme.fg("dim", "Tasks")}: ${theme.fg("muted", `${args.tasks.length} agents`)}`);
	if (showIsolated) {
		lines.push(`${theme.fg("dim", "Isolated")}: ${theme.fg("muted", "true")}`);
	}

	return new Text(lines.join("\n"), 0, 0);
}

/**
 * Render streaming progress for a single agent.
 */
function renderAgentProgress(
	progress: AgentProgress,
	isLast: boolean,
	expanded: boolean,
	theme: Theme,
	spinnerFrame?: number,
): string[] {
	const lines: string[] = [];
	const prefix = isLast ? theme.fg("dim", theme.tree.last) : theme.fg("dim", theme.tree.branch);
	const continuePrefix = isLast ? "   " : `${theme.fg("dim", theme.tree.vertical)}  `;

	const icon = getStatusIcon(progress.status, theme, spinnerFrame);
	const iconColor =
		progress.status === "completed"
			? "success"
			: progress.status === "failed" || progress.status === "aborted"
				? "error"
				: "accent";

	// Main status line: id: description [status] · stats · ⟨agent⟩
	const description = progress.description?.trim();
	const titlePart = description ? `${theme.bold(progress.id)}: ${description}` : progress.id;
	let statusLine = `${prefix} ${theme.fg(iconColor, icon)} ${theme.fg("accent", titlePart)}`;

	// Only show badge for non-running states (spinner already indicates running)
	if (progress.status === "failed" || progress.status === "aborted") {
		const statusLabel = progress.status === "failed" ? "failed" : "aborted";
		statusLine += ` ${formatBadge(statusLabel, iconColor, theme)}`;
	}

	if (progress.status === "running") {
		if (!description) {
			const taskPreview = truncate(progress.task, 40, theme.format.ellipsis);
			statusLine += ` ${theme.fg("muted", taskPreview)}`;
		}
		statusLine += `${theme.sep.dot}${theme.fg("dim", `${progress.toolCount} tools`)}`;
		if (progress.tokens > 0) {
			statusLine += `${theme.sep.dot}${theme.fg("dim", `${formatTokens(progress.tokens)} tokens`)}`;
		}
	} else if (progress.status === "completed") {
		statusLine += `${theme.sep.dot}${theme.fg("dim", `${progress.toolCount} tools`)}`;
		statusLine += `${theme.sep.dot}${theme.fg("dim", `${formatTokens(progress.tokens)} tokens`)}`;
	}

	lines.push(statusLine);

	lines.push(...renderArgsSection(progress.args, continuePrefix, expanded, theme));

	// Current tool (if running) or most recent completed tool
	if (progress.status === "running") {
		if (progress.currentTool) {
			let toolLine = `${continuePrefix}${theme.tree.hook} ${theme.fg("muted", progress.currentTool)}`;
			if (progress.currentToolArgs) {
				toolLine += `: ${theme.fg("dim", truncate(progress.currentToolArgs, 40, theme.format.ellipsis))}`;
			}
			if (progress.currentToolStartMs) {
				const elapsed = Date.now() - progress.currentToolStartMs;
				if (elapsed > 5000) {
					toolLine += `${theme.sep.dot}${theme.fg("warning", formatDuration(elapsed))}`;
				}
			}
			lines.push(toolLine);
		} else if (progress.recentTools.length > 0) {
			// Show most recent completed tool when idle between tools
			const recent = progress.recentTools[0];
			let toolLine = `${continuePrefix}${theme.tree.hook} ${theme.fg("dim", recent.tool)}`;
			if (recent.args) {
				toolLine += `: ${theme.fg("dim", truncate(recent.args, 40, theme.format.ellipsis))}`;
			}
			lines.push(toolLine);
		}
	}

	// Render extracted tool data inline (e.g., review findings)
	if (progress.extractedToolData) {
		// For completed tasks, check for review verdict from complete tool
		if (progress.status === "completed") {
			const completeData = progress.extractedToolData.complete as Array<{ data: unknown }> | undefined;
			const reportFindingData = progress.extractedToolData.report_finding as ReportFindingDetails[] | undefined;
			const reviewData = completeData
				?.map((c) => c.data as SubmitReviewDetails)
				.filter((d) => d && typeof d === "object" && "overall_correctness" in d);
			if (reviewData && reviewData.length > 0) {
				const summary = reviewData[reviewData.length - 1];
				const findings = reportFindingData ?? [];
				lines.push(...renderReviewResult(summary, findings, continuePrefix, expanded, theme));
				return lines; // Review result handles its own rendering
			}
		}

		for (const [toolName, dataArray] of Object.entries(progress.extractedToolData)) {
			// Handle report_finding with tree formatting
			if (toolName === "report_finding" && (dataArray as ReportFindingDetails[]).length > 0) {
				const findings = dataArray as ReportFindingDetails[];
				lines.push(`${continuePrefix}${formatFindingSummary(findings, theme)}`);
				lines.push(...renderFindings(findings, continuePrefix, expanded, theme));
				continue;
			}

			const handler = subprocessToolRegistry.getHandler(toolName);
			if (handler?.renderInline) {
				const displayCount = expanded ? (dataArray as unknown[]).length : 3;
				const recentData = (dataArray as unknown[]).slice(-displayCount);
				for (const data of recentData) {
					const component = handler.renderInline(data, theme);
					if (component instanceof Text) {
						lines.push(`${continuePrefix}${component.getText()}`);
					}
				}
				if ((dataArray as unknown[]).length > displayCount) {
					lines.push(
						`${continuePrefix}${theme.fg(
							"dim",
							formatMoreItems((dataArray as unknown[]).length - displayCount, "item", theme),
						)}`,
					);
				}
			}
		}
	}

	// Expanded view: recent output and tools
	if (expanded && progress.status === "running") {
		const output = progress.recentOutput.join("\n");
		lines.push(...renderOutputSection(output, continuePrefix, true, theme, 2, 6));
	}

	return lines;
}

/**
 * Render review result with combined verdict + findings in tree structure.
 */
function renderReviewResult(
	summary: SubmitReviewDetails,
	findings: ReportFindingDetails[],
	continuePrefix: string,
	expanded: boolean,
	theme: Theme,
): string[] {
	const lines: string[] = [];

	// Verdict line
	const verdictColor = summary.overall_correctness === "correct" ? "success" : "error";
	const verdictIcon = summary.overall_correctness === "correct" ? theme.status.success : theme.status.error;
	lines.push(
		`${continuePrefix} Patch is ${theme.fg(verdictColor, summary.overall_correctness)} ${theme.fg(
			verdictColor,
			verdictIcon,
		)} ${theme.fg("dim", `(${(summary.confidence * 100).toFixed(0)}% confidence)`)}`,
	);

	// Explanation preview (first ~80 chars when collapsed, full when expanded)
	if (summary.explanation) {
		if (expanded) {
			lines.push(`${continuePrefix}${theme.fg("dim", "Summary")}`);
			const explanationLines = summary.explanation.split("\n");
			for (const line of explanationLines) {
				lines.push(`${continuePrefix}  ${theme.fg("dim", line)}`);
			}
		} else {
			// Preview: first sentence or ~100 chars
			const preview = truncate(`${summary.explanation.split(/[.!?]/)[0]}.`, 100, theme.format.ellipsis);
			lines.push(`${continuePrefix}${theme.fg("dim", preview)}`);
		}
	}

	// Findings summary + list
	lines.push(`${continuePrefix}${formatFindingSummary(findings, theme)}`);

	if (findings.length > 0) {
		lines.push(...renderFindings(findings, continuePrefix, expanded, theme));
	}

	return lines;
}

/**
 * Render review findings list.
 */
function renderFindings(
	findings: ReportFindingDetails[],
	continuePrefix: string,
	expanded: boolean,
	theme: Theme,
): string[] {
	const lines: string[] = [];

	// Sort by priority (lower = more severe) when collapsed to show most important first
	const sortedFindings = expanded
		? findings
		: [...findings].sort((a, b) => getPriorityInfo(a.priority).ord - getPriorityInfo(b.priority).ord);
	const displayCount = expanded ? sortedFindings.length : Math.min(3, sortedFindings.length);

	for (let i = 0; i < displayCount; i++) {
		const finding = sortedFindings[i];
		const isLastFinding = i === displayCount - 1 && (expanded || sortedFindings.length <= 3);
		const findingPrefix = isLastFinding ? theme.tree.last : theme.tree.branch;
		const findingContinue = isLastFinding ? "   " : `${theme.tree.vertical}  `;

		const { color } = getPriorityInfo(finding.priority);
		const titleText = finding.title.replace(/^\[P\d\]\s*/, "");
		const loc = `${path.basename(finding.file_path)}:${finding.line_start}`;

		lines.push(
			`${continuePrefix}${findingPrefix} ${theme.fg(color, `[${finding.priority}]`)} ${titleText} ${theme.fg("dim", loc)}`,
		);

		// Show body when expanded
		if (expanded && finding.body) {
			// Wrap body text
			const bodyLines = finding.body.split("\n");
			for (const bodyLine of bodyLines) {
				lines.push(`${continuePrefix}${findingContinue}${theme.fg("dim", bodyLine)}`);
			}
		}
	}

	if (!expanded && findings.length > 3) {
		lines.push(`${continuePrefix}${theme.fg("dim", formatMoreItems(findings.length - 3, "finding", theme))}`);
	}

	return lines;
}

/**
 * Render final result for a single agent.
 */
function renderAgentResult(result: SingleResult, isLast: boolean, expanded: boolean, theme: Theme): string[] {
	const lines: string[] = [];
	const prefix = isLast ? theme.fg("dim", theme.tree.last) : theme.fg("dim", theme.tree.branch);
	const continuePrefix = isLast ? "   " : `${theme.fg("dim", theme.tree.vertical)}  `;

	const aborted = result.aborted ?? false;
	const success = !aborted && result.exitCode === 0;
	const icon = aborted ? theme.status.aborted : success ? theme.status.success : theme.status.error;
	const iconColor = success ? "success" : "error";
	const statusText = aborted ? "aborted" : success ? "done" : "failed";

	// Main status line: id: description [status] · stats · ⟨agent⟩
	const description = result.description?.trim();
	const titlePart = description ? `${theme.bold(result.id)}: ${description}` : result.id;
	let statusLine = `${prefix} ${theme.fg(iconColor, icon)} ${theme.fg("accent", titlePart)} ${formatBadge(
		statusText,
		iconColor,
		theme,
	)}`;
	if (result.tokens > 0) {
		statusLine += `${theme.sep.dot}${theme.fg("dim", `${formatTokens(result.tokens)} tokens`)}`;
	}
	statusLine += `${theme.sep.dot}${theme.fg("dim", formatDuration(result.durationMs))}`;

	if (result.truncated) {
		statusLine += ` ${theme.fg("warning", "[truncated]")}`;
	}

	lines.push(statusLine);
	lines.push(...renderArgsSection(result.args, continuePrefix, expanded, theme));

	// Check for review result (complete with review schema + report_finding)
	const completeData = result.extractedToolData?.complete as Array<{ data: unknown }> | undefined;
	const reportFindingData = result.extractedToolData?.report_finding as ReportFindingDetails[] | undefined;

	// Extract review verdict from complete tool's data field if it matches SubmitReviewDetails
	const reviewData = completeData
		?.map((c) => c.data as SubmitReviewDetails)
		.filter((d) => d && typeof d === "object" && "overall_correctness" in d);
	const submitReviewData = reviewData && reviewData.length > 0 ? reviewData : undefined;

	if (submitReviewData && submitReviewData.length > 0) {
		// Use combined review renderer
		const summary = submitReviewData[submitReviewData.length - 1];
		const findings = reportFindingData ?? [];
		lines.push(...renderReviewResult(summary, findings, continuePrefix, expanded, theme));
		return lines;
	}
	if (reportFindingData && reportFindingData.length > 0) {
		const hasCompleteData = completeData && completeData.length > 0;
		const message = hasCompleteData
			? "Review verdict missing expected fields"
			: "Review incomplete (complete not called)";
		lines.push(`${continuePrefix}${theme.fg("warning", theme.status.warning)} ${theme.fg("dim", message)}`);
		lines.push(`${continuePrefix}${formatFindingSummary(reportFindingData, theme)}`);
		lines.push(...renderFindings(reportFindingData, continuePrefix, expanded, theme));
		return lines;
	}

	// Check for extracted tool data with custom renderers (skip review tools)
	let hasCustomRendering = false;
	if (result.extractedToolData) {
		for (const [toolName, dataArray] of Object.entries(result.extractedToolData)) {
			// Skip review tools - handled above
			if (toolName === "complete" || toolName === "report_finding") continue;

			const handler = subprocessToolRegistry.getHandler(toolName);
			if (handler?.renderFinal && (dataArray as unknown[]).length > 0) {
				hasCustomRendering = true;
				const component = handler.renderFinal(dataArray as unknown[], theme, expanded);
				if (component instanceof Text) {
					// Prefix each line with continuePrefix
					const text = component.getText();
					for (const line of text.split("\n")) {
						if (line.trim()) {
							lines.push(`${continuePrefix}${line}`);
						}
					}
				} else if (component instanceof Container) {
					// For containers, render each child
					for (const child of (component as Container).children) {
						if (child instanceof Text) {
							lines.push(`${continuePrefix}${child.getText()}`);
						}
					}
				}
			}
		}
	}

	// Fallback to output preview if no custom rendering
	if (!hasCustomRendering) {
		lines.push(...renderOutputSection(result.output, continuePrefix, expanded, theme, 3, 12));
	}

	if (result.patchPath && !aborted && result.exitCode === 0) {
		lines.push(`${continuePrefix}${theme.fg("dim", `Patch: ${result.patchPath}`)}`);
	}

	// Error message
	if (result.error && !success) {
		lines.push(`${continuePrefix}${theme.fg("error", truncate(result.error, 70, theme.format.ellipsis))}`);
	}

	return lines;
}

/**
 * Render the tool result.
 */
export function renderResult(
	result: { content: Array<{ type: string; text?: string }>; details?: TaskToolDetails },
	options: RenderResultOptions,
	theme: Theme,
): Component {
	const { expanded, isPartial, spinnerFrame } = options;
	const fallbackText = result.content.find((c) => c.type === "text")?.text ?? "";
	const details = result.details;

	if (!details) {
		// Fallback to simple text
		const text = result.content.find((c) => c.type === "text")?.text || "";
		return new Text(theme.fg("dim", truncate(text, 100, theme.format.ellipsis)), 0, 0);
	}

	const lines: string[] = [];

	if (isPartial && details.progress) {
		// Streaming progress view
		details.progress.forEach((progress, i) => {
			const isLast = i === details.progress!.length - 1;
			lines.push(...renderAgentProgress(progress, isLast, expanded, theme, spinnerFrame));
		});
	} else if (details.results.length > 0) {
		// Final results view
		details.results.forEach((res, i) => {
			const isLast = i === details.results.length - 1;
			lines.push(...renderAgentResult(res, isLast, expanded, theme));
		});

		// Summary line
		const abortedCount = details.results.filter((r) => r.aborted).length;
		const successCount = details.results.filter((r) => !r.aborted && r.exitCode === 0).length;
		const failCount = details.results.length - successCount - abortedCount;
		let summary = `${theme.fg("dim", "Total:")} `;
		if (abortedCount > 0) {
			summary += theme.fg("error", `${abortedCount} aborted`);
			if (successCount > 0 || failCount > 0) summary += theme.sep.dot;
		}
		if (successCount > 0) {
			summary += theme.fg("success", `${successCount} succeeded`);
			if (failCount > 0) summary += theme.sep.dot;
		}
		if (failCount > 0) {
			summary += theme.fg("error", `${failCount} failed`);
		}
		summary += `${theme.sep.dot}${theme.fg("dim", formatDuration(details.totalDurationMs))}`;
		lines.push(summary);

		// Artifacts suppressed from user view - available via session file
	}

	if (lines.length === 0) {
		const text = fallbackText.trim() ? fallbackText : "No results";
		return new Text(theme.fg("dim", truncate(text, 140, theme.format.ellipsis)), 0, 0);
	}

	if (fallbackText.trim()) {
		const summaryLines = fallbackText.split("\n");
		const markerIndex = summaryLines.findIndex(
			(line) => line.includes("<system-notification>") || line.startsWith("Applied patches:"),
		);
		if (markerIndex >= 0) {
			const extra = summaryLines.slice(markerIndex);
			for (const line of extra) {
				if (!line.trim()) continue;
				lines.push(theme.fg("dim", line));
			}
		}
	}

	const indented = lines.map((line) => (line.trim() ? `   ${line}` : ""));
	return new Text(indented.join("\n"), 0, 0);
}

export const taskToolRenderer = {
	renderCall,
	renderResult,
};
