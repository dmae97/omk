import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { untilAborted } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import type { RenderResultOptions } from "$c/extensibility/custom-tools/types";
import type { Theme } from "$c/modes/theme/theme";
import type { ToolSession } from "$c/sdk";
import { renderCodeCell, renderStatusLine } from "$c/tui";
import { resolveToCwd } from "./path-utils";
import { formatCount, formatErrorMessage, PREVIEW_LIMITS } from "./render-utils";

const notebookSchema = Type.Object({
	action: StringEnum(["edit", "insert", "delete"], {
		description: "Action to perform on the notebook cell",
	}),
	notebook_path: Type.String({ description: "Path to the .ipynb file (relative or absolute)" }),
	cell_index: Type.Number({ description: "0-based index of the cell to operate on" }),
	content: Type.Optional(Type.String({ description: "New cell content (required for edit/insert)" })),
	cell_type: Type.Optional(
		StringEnum(["code", "markdown"], {
			description: "Cell type for insert (default: code)",
		}),
	),
});

export interface NotebookToolDetails {
	/** Action performed */
	action: "edit" | "insert" | "delete";
	/** Cell index operated on */
	cellIndex: number;
	/** Cell type */
	cellType?: string;
	/** Total cell count after operation */
	totalCells: number;
	/** Cell content lines after operation (or removed content for delete) */
	cellSource?: string[];
}

interface NotebookCell {
	cell_type: "code" | "markdown" | "raw";
	source: string[];
	metadata: Record<string, unknown>;
	execution_count?: number | null;
	outputs?: unknown[];
}

interface Notebook {
	cells: NotebookCell[];
	metadata: Record<string, unknown>;
	nbformat: number;
	nbformat_minor: number;
}

function splitIntoLines(content: string): string[] {
	return content.split("\n").map((line, i, arr) => (i < arr.length - 1 ? `${line}\n` : line));
}

type NotebookParams = Static<typeof notebookSchema>;

export class NotebookTool implements AgentTool<typeof notebookSchema, NotebookToolDetails> {
	public readonly name = "notebook";
	public readonly label = "Notebook";
	public readonly description =
		"Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.";
	public readonly parameters = notebookSchema;

	private readonly session: ToolSession;

	constructor(session: ToolSession) {
		this.session = session;
	}

	public async execute(
		_toolCallId: string,
		params: NotebookParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<NotebookToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<NotebookToolDetails>> {
		const { action, notebook_path, cell_index, content, cell_type } = params;
		const absolutePath = resolveToCwd(notebook_path, this.session.cwd);

		return untilAborted(signal, async () => {
			// Check if file exists
			const file = Bun.file(absolutePath);
			if (!(await file.exists())) {
				throw new Error(`Notebook not found: ${notebook_path}`);
			}

			// Read and parse notebook
			let notebook: Notebook;
			try {
				notebook = await file.json();
			} catch {
				throw new Error(`Invalid JSON in notebook: ${notebook_path}`);
			}

			// Validate notebook structure
			if (!notebook.cells || !Array.isArray(notebook.cells)) {
				throw new Error(`Invalid notebook structure (missing cells array): ${notebook_path}`);
			}

			const cellCount = notebook.cells.length;

			// Validate cell_index based on action
			if (action === "insert") {
				if (cell_index < 0 || cell_index > cellCount) {
					throw new Error(`Cell index ${cell_index} out of range for insert (0-${cellCount}) in ${notebook_path}`);
				}
			} else {
				if (cell_index < 0 || cell_index >= cellCount) {
					throw new Error(`Cell index ${cell_index} out of range (0-${cellCount - 1}) in ${notebook_path}`);
				}
			}

			// Validate content for edit/insert
			if ((action === "edit" || action === "insert") && content === undefined) {
				throw new Error(`Content is required for ${action} action`);
			}

			// Perform the action
			let resultMessage: string;
			let finalCellType: string | undefined;
			let cellSource: string[] | undefined;

			switch (action) {
				case "edit": {
					const sourceLines = splitIntoLines(content!);
					notebook.cells[cell_index].source = sourceLines;
					finalCellType = notebook.cells[cell_index].cell_type;
					cellSource = sourceLines;
					resultMessage = `Replaced cell ${cell_index} (${finalCellType})`;
					break;
				}
				case "insert": {
					const sourceLines = splitIntoLines(content!);
					const newCellType = (cell_type as "code" | "markdown") || "code";
					const newCell: NotebookCell = {
						cell_type: newCellType,
						source: sourceLines,
						metadata: {},
					};
					if (newCellType === "code") {
						newCell.execution_count = null;
						newCell.outputs = [];
					}
					notebook.cells.splice(cell_index, 0, newCell);
					finalCellType = newCellType;
					cellSource = sourceLines;
					resultMessage = `Inserted ${newCellType} cell at position ${cell_index}`;
					break;
				}
				case "delete": {
					const removedCell = notebook.cells[cell_index];
					finalCellType = removedCell.cell_type;
					cellSource = removedCell.source;
					notebook.cells.splice(cell_index, 1);
					resultMessage = `Deleted cell ${cell_index} (${finalCellType})`;
					break;
				}
				default: {
					throw new Error(`Invalid action: ${action}`);
				}
			}

			// Write back with single-space indentation
			await Bun.write(absolutePath, JSON.stringify(notebook, null, 1));

			const newCellCount = notebook.cells.length;
			return {
				content: [
					{
						type: "text",
						text: `${resultMessage}. Notebook now has ${newCellCount} cells.`,
					},
				],
				details: {
					action: action as "edit" | "insert" | "delete",
					cellIndex: cell_index,
					cellType: finalCellType,
					totalCells: newCellCount,
					cellSource,
				},
			};
		});
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface NotebookRenderArgs {
	action: string;
	notebookPath: string;
	cellNumber?: number;
	cellType?: string;
	content?: string;
}

const COLLAPSED_TEXT_LIMIT = PREVIEW_LIMITS.COLLAPSED_LINES * 2;

export const notebookToolRenderer = {
	renderCall(args: NotebookRenderArgs, uiTheme: Theme): Component {
		const meta: string[] = [];
		meta.push(`in ${args.notebookPath || "?"}`);
		if (args.cellNumber !== undefined) meta.push(`cell:${args.cellNumber}`);
		if (args.cellType) meta.push(`type:${args.cellType}`);

		const text = renderStatusLine(
			{ icon: "pending", title: "Notebook", description: args.action || "?", meta },
			uiTheme,
		);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: NotebookToolDetails },
		{ expanded }: RenderResultOptions,
		uiTheme: Theme,
	): Component {
		const content = result.content?.[0];
		if (content?.type === "text" && content.text?.startsWith("Error:")) {
			return new Text(formatErrorMessage(content.text, uiTheme), 0, 0);
		}

		const details = result.details;
		const action = details?.action ?? "edit";
		const cellIndex = details?.cellIndex;
		const cellType = details?.cellType;
		const totalCells = details?.totalCells;
		const cellSource = details?.cellSource ?? [];
		const lineCount = cellSource.length;

		const actionLabel = action === "insert" ? "Inserted" : action === "delete" ? "Deleted" : "Edited";
		const cellLabel = cellType || "cell";
		const summaryParts = [`${actionLabel} ${cellLabel} ${cellIndex ?? "?"}`];
		if (lineCount > 0) summaryParts.push(formatCount("line", lineCount));
		if (totalCells !== undefined) summaryParts.push(`${totalCells} total`);

		const outputLines = summaryParts.map((part) => uiTheme.fg("dim", part));
		const codeText = cellSource.join("");
		const language = cellType === "markdown" ? "markdown" : undefined;

		return {
			render: (width: number) =>
				renderCodeCell(
					{
						code: codeText,
						language,
						title: "Notebook",
						status: "complete",
						output: outputLines.join("\n"),
						codeMaxLines: expanded ? Number.POSITIVE_INFINITY : COLLAPSED_TEXT_LIMIT,
						expanded,
						width,
					},
					uiTheme,
				),
			invalidate: () => {},
		};
	},
};
