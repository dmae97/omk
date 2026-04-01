import type { Tool } from "../../tools";

export interface ToolsMarkdownBindings {
	tools: ReadonlyArray<Pick<Tool, "description" | "name">>;
}

function escapeTableCell(value: string): string {
	return value
		.replace(/\|/g, "\\|")
		.replace(/\r?\n+/g, " ")
		.trim();
}

export function buildToolsMarkdown(bindings: ToolsMarkdownBindings): string {
	if (bindings.tools.length === 0) {
		return "No tools are currently visible to the agent.";
	}

	return [
		"| Tool | Description |",
		"|------|-------------|",
		...bindings.tools.map(tool => {
			const description = escapeTableCell(tool.description) || "No description provided.";
			return `| \`${tool.name}\` | ${description} |`;
		}),
	].join("\n");
}
