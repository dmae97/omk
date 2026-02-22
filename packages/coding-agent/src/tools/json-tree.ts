/**
 * JSON tree rendering utilities shared across tool renderers.
 */
import type { Theme } from "../modes/theme/theme";
import { truncateToWidth } from "./render-utils";

/** Max depth for JSON tree rendering */
export const JSON_TREE_MAX_DEPTH_COLLAPSED = 2;
export const JSON_TREE_MAX_DEPTH_EXPANDED = 6;
export const JSON_TREE_MAX_LINES_COLLAPSED = 6;
export const JSON_TREE_MAX_LINES_EXPANDED = 200;
export const JSON_TREE_SCALAR_LEN_COLLAPSED = 60;
export const JSON_TREE_SCALAR_LEN_EXPANDED = 2000;

/** Keys injected by the harness that should not be displayed to users */
const HIDDEN_ARG_KEYS = new Set(["agent__intent"]);

/** Strip harness-internal keys from tool args for display */
export function stripInternalArgs(args: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args)) {
		if (!HIDDEN_ARG_KEYS.has(key)) result[key] = value;
	}
	return result;
}
/**
 * Format a scalar value for inline display.
 */
export function formatScalar(value: unknown, maxLen: number): string {
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
export function formatArgsInline(args: Record<string, unknown>, maxWidth: number): string {
	const entries = Object.entries(args).filter(([k]) => !HIDDEN_ARG_KEYS.has(k));
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
export function renderJsonTreeLines(
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
