/**
 * TUI rendering for MCP tools.
 *
 * Provides structured display of MCP tool calls and results,
 * showing args and output in JSON tree format similar to task tool.
 */
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import { formatExpandHint, truncateToWidth } from "../tools/render-utils";
import { renderStatusLine } from "../tui";
import type { MCPToolDetails } from "./tool-bridge";

/** Max depth for JSON tree rendering */
const JSON_TREE_MAX_DEPTH_COLLAPSED = 2;
const JSON_TREE_MAX_DEPTH_EXPANDED = 6;
const JSON_TREE_MAX_LINES_COLLAPSED = 6;
const JSON_TREE_MAX_LINES_EXPANDED = 200;
const JSON_TREE_SCALAR_LEN_COLLAPSED = 60;
const JSON_TREE_SCALAR_LEN_EXPANDED = 2000;

/**
 * Format a scalar value for inline display.
 */
function formatScalar(value: unknown, maxLen: number): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "boolean") return String(value);
	if (typeof value === "number") return String(value);
	if (typeof value === "string") {
		const escaped = value.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
		const truncated = truncateToWidth(escaped, maxLen);
		return `"${truncated}"`;
	}
	if (Array.isArray(value)) return `[${value.length} items]`;
	if (typeof value === "object") {
		const keys = Object.keys(value);
		return `{${keys.length} keys}`;
	}
	return String(value);
}

/**
 * Format args inline for collapsed view.
 */
function formatArgsInline(args: Record<string, unknown>, maxWidth: number): string {
	const entries = Object.entries(args);
	if (entries.length === 0) return "";

	// Single arg: show key=value
	if (entries.length === 1) {
		const [key, value] = entries[0];
		return `${key}=${formatScalar(value, maxWidth - key.length - 1)}`;
	}

	// Multiple args: show key=value, key=value...
	const pairs: string[] = [];
	let totalLen = 0;

	for (const [key, value] of entries) {
		const valueStr = formatScalar(value, 24);
		const pairStr = `${key}=${valueStr}`;
		const addLen = pairs.length > 0 ? pairStr.length + 2 : pairStr.length;

		if (totalLen + addLen > maxWidth && pairs.length > 0) {
			pairs.push("…");
			break;
		}

		pairs.push(pairStr);
		totalLen += addLen;
	}

	return pairs.join(", ");
}

/**
 * Build tree prefix for nested rendering.
 */
function buildTreePrefix(ancestors: boolean[], theme: Theme): string {
	return ancestors.map(hasNext => (hasNext ? `${theme.tree.vertical}  ` : "   ")).join("");
}

/**
 * Render a JSON value as tree lines.
 */
function renderJsonTreeLines(
	value: unknown,
	theme: Theme,
	maxDepth: number,
	maxLines: number,
	maxScalarLen: number,
): { lines: string[]; truncated: boolean } {
	const lines: string[] = [];
	let truncated = false;

	const iconObject = theme.styledSymbol("icon.folder", "muted");
	const iconArray = theme.styledSymbol("icon.package", "muted");
	const iconScalar = theme.styledSymbol("icon.file", "muted");

	const pushLine = (line: string): boolean => {
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

		// Handle scalars
		if (val === null || val === undefined || typeof val !== "object") {
			const label = key ? theme.fg("muted", key) : theme.fg("muted", "value");

			// Special handling for multiline strings
			if (typeof val === "string" && val.includes("\n")) {
				const strLines = val.split("\n");
				const maxStrLines = Math.min(strLines.length, Math.max(1, maxLines - lines.length - 1));
				const continuePrefix = buildTreePrefix([...ancestors, !isLast], theme);

				// First line with label
				const firstLine = truncateToWidth(strLines[0], maxScalarLen);
				pushLine(`${prefix}${iconScalar} ${label}: ${theme.fg("dim", `"${firstLine}`)}`);

				// Subsequent lines indented
				for (let i = 1; i < maxStrLines; i++) {
					if (lines.length >= maxLines) {
						truncated = true;
						break;
					}
					const line = truncateToWidth(strLines[i], maxScalarLen);
					pushLine(`${continuePrefix}   ${theme.fg("dim", ` ${line}`)}`);
				}

				// Show truncation and closing quote
				if (strLines.length > maxStrLines) {
					truncated = true;
					pushLine(`${continuePrefix}   ${theme.fg("dim", ` …(${strLines.length - maxStrLines} more lines)"`)}`);
				} else {
					// Add closing quote to last line - need to modify the last pushed line
					const lastIdx = lines.length - 1;
					lines[lastIdx] = `${lines[lastIdx]}${theme.fg("dim", '"')}`;
				}
				return;
			}

			const scalar = formatScalar(val, maxScalarLen);
			pushLine(`${prefix}${iconScalar} ${label}: ${theme.fg("dim", scalar)}`);
			return;
		}

		// Handle arrays
		if (Array.isArray(val)) {
			const header = key ? theme.fg("muted", key) : theme.fg("muted", "array");
			pushLine(`${prefix}${iconArray} ${header}`);
			if (val.length === 0) {
				pushLine(
					`${buildTreePrefix([...ancestors, !isLast], theme)}${theme.fg("dim", theme.tree.last)} ${theme.fg("dim", "[]")}`,
				);
				return;
			}
			if (depth >= maxDepth) {
				pushLine(
					`${buildTreePrefix([...ancestors, !isLast], theme)}${theme.fg("dim", theme.tree.last)} ${theme.fg("dim", "…")}`,
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

		// Handle objects
		const header = key ? theme.fg("muted", key) : theme.fg("muted", "object");
		pushLine(`${prefix}${iconObject} ${header}`);
		const entries = Object.entries(val as Record<string, unknown>);
		if (entries.length === 0) {
			pushLine(
				`${buildTreePrefix([...ancestors, !isLast], theme)}${theme.fg("dim", theme.tree.last)} ${theme.fg("dim", "{}")}`,
			);
			return;
		}
		if (depth >= maxDepth) {
			pushLine(
				`${buildTreePrefix([...ancestors, !isLast], theme)}${theme.fg("dim", theme.tree.last)} ${theme.fg("dim", "…")}`,
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
	};

	// Render root level
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const entries = Object.entries(value as Record<string, unknown>);
		for (let i = 0; i < entries.length; i++) {
			const [childKey, child] = entries[i];
			renderNode(child, childKey, [], i === entries.length - 1, 1);
			if (lines.length >= maxLines) {
				truncated = true;
				break;
			}
		}
	} else if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			renderNode(value[i], `[${i}]`, [], i === value.length - 1, 1);
			if (lines.length >= maxLines) {
				truncated = true;
				break;
			}
		}
	} else {
		renderNode(value, undefined, [], true, 0);
	}

	return { lines, truncated };
}

/**
 * Render MCP tool call.
 */
export function renderMCPCall(args: Record<string, unknown>, theme: Theme, label: string): Component {
	const lines: string[] = [];
	lines.push(renderStatusLine({ icon: "pending", title: label }, theme));

	if (args && typeof args === "object" && Object.keys(args).length > 0) {
		// Show args inline preview
		const preview = formatArgsInline(args, 70);
		if (preview) {
			lines.push(` ${theme.fg("dim", theme.tree.last)} ${theme.fg("dim", preview)}`);
		}
	}

	return new Text(lines.join("\n"), 0, 0);
}

/**
 * Render MCP tool result.
 */
export function renderMCPResult(
	result: { content: Array<{ type: string; text?: string }>; details?: MCPToolDetails; isError?: boolean },
	options: RenderResultOptions,
	theme: Theme,
	args?: Record<string, unknown>,
): Component {
	const { expanded } = options;
	const lines: string[] = [];

	// Args section (when expanded)
	if (expanded && args && typeof args === "object" && Object.keys(args).length > 0) {
		lines.push(`${theme.fg("dim", "Args")}`);
		const maxDepth = JSON_TREE_MAX_DEPTH_EXPANDED;
		const maxLines = JSON_TREE_MAX_LINES_EXPANDED;
		const tree = renderJsonTreeLines(args, theme, maxDepth, maxLines, JSON_TREE_SCALAR_LEN_EXPANDED);
		for (const line of tree.lines) {
			lines.push(line);
		}
		if (tree.truncated) {
			lines.push(theme.fg("dim", "…"));
		}
		lines.push(""); // Blank line before output
	}

	// Output section
	const textContent = result.content?.find(c => c.type === "text")?.text ?? "";
	const trimmedOutput = textContent.trimEnd();

	if (!trimmedOutput) {
		lines.push(theme.fg("dim", "(no output)"));
		return new Text(lines.join("\n"), 0, 0);
	}

	// Try to parse as JSON for structured display
	if (trimmedOutput.startsWith("{") || trimmedOutput.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmedOutput);
			const maxDepth = expanded ? JSON_TREE_MAX_DEPTH_EXPANDED : JSON_TREE_MAX_DEPTH_COLLAPSED;
			const maxLines = expanded ? JSON_TREE_MAX_LINES_EXPANDED : JSON_TREE_MAX_LINES_COLLAPSED;
			const maxScalarLen = expanded ? JSON_TREE_SCALAR_LEN_EXPANDED : JSON_TREE_SCALAR_LEN_COLLAPSED;
			const tree = renderJsonTreeLines(parsed, theme, maxDepth, maxLines, maxScalarLen);

			if (tree.lines.length > 0) {
				for (const line of tree.lines) {
					lines.push(line);
				}
				// Always show expand hint when collapsed (expanded view shows longer values and deeper nesting)
				if (!expanded) {
					lines.push(formatExpandHint(theme, expanded, true));
				} else if (tree.truncated) {
					lines.push(theme.fg("dim", "…"));
				}
				return new Text(lines.join("\n"), 0, 0);
			}
		} catch {
			// Fall through to raw output
		}
	}

	// Raw text output
	const outputLines = trimmedOutput.split("\n");
	const maxOutputLines = expanded ? 12 : 4;
	const displayLines = outputLines.slice(0, maxOutputLines);

	for (const line of displayLines) {
		lines.push(theme.fg("toolOutput", truncateToWidth(line, 80)));
	}

	if (outputLines.length > maxOutputLines) {
		const remaining = outputLines.length - maxOutputLines;
		lines.push(`${theme.fg("dim", `… ${remaining} more lines`)} ${formatExpandHint(theme, expanded, true)}`);
	} else if (!expanded) {
		// Show expand hint when collapsed even if all lines shown (lines may be truncated)
		lines.push(formatExpandHint(theme, expanded, true));
	}

	return new Text(lines.join("\n"), 0, 0);
}
