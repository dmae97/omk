import { truncateToWidth, visibleWidth } from "omk-tui";
import { stripAnsi } from "../../../utils/ansi.ts";
import { theme } from "../theme/theme.ts";

const SECTION_NAMES: Record<string, string> = {
	MODEL: "Model",
	USAGE: "Usage",
	CONTEXT: "Context",
	TOKENS: "Tokens",
	MCP: "Connections",
	SYSTEM: "Runtime",
	EXT: "Extensions",
};

/** The tmux boundary replaces the outer box; keep the existing live values and semantic colors. */
export function statusPaneLayout(lines: string[], width: number): string[] {
	const inner = Math.max(1, width - 2);
	const output = [
		` ${theme.fg("text", theme.bold("OMK"))}  ${theme.fg("accent", "/")}  ${theme.fg("text", "Session")}`,
		"",
	];
	for (const line of lines.slice(1, -1)) {
		const plain = stripAnsi(line);
		const section = plain.match(/^│─ ([A-Z]+) /);
		if (section) {
			const label = SECTION_NAMES[section[1]] ?? section[1];
			const count = plain.match(/ (\d+(?:\/\d+)?)\s*│$/)?.[1];
			const suffix = count ? ` ${count}` : "";
			const rule = "─".repeat(Math.max(1, inner - visibleWidth(label + suffix) - 1));
			output.push(
				"",
				` ${theme.fg("text", theme.bold(label))} ${theme.fg("borderMuted", rule)}${theme.fg("muted", suffix)}`,
			);
		} else if (!plain.includes(" unpin")) {
			// Remove only the frame glyphs, not column slices that can reorder inherited SGR colors.
			const body = line.slice(line.indexOf("│ ") + 2, line.lastIndexOf(" │"));
			const label = stripAnsi(body).match(/^(up|act|run|vrfy|cwd|git|sess|id|endp|think|ctx|cost)\s+/);
			output.push(` ${label ? body.replace(label[0], label[1].padEnd(6)) : body}`);
		}
	}
	return output.map((line) => truncateToWidth(line, width, ""));
}
