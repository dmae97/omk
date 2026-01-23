/**
 * TUI renderers for built-in tools.
 *
 * These provide rich visualization for tool calls and results in the TUI.
 */

import type { Component } from "@oh-my-pi/pi-tui";
import type { RenderResultOptions } from "$c/extensibility/custom-tools/types";
import { lspToolRenderer } from "$c/lsp/render";
import type { Theme } from "$c/modes/theme/theme";
import { editToolRenderer } from "$c/patch";
import { taskToolRenderer } from "$c/task/render";
import { webSearchToolRenderer } from "$c/web/search/render";
import { askToolRenderer } from "./ask";
import { bashToolRenderer } from "./bash";
import { calculatorToolRenderer } from "./calculator";
import { fetchToolRenderer } from "./fetch";
import { findToolRenderer } from "./find";
import { grepToolRenderer } from "./grep";
import { lsToolRenderer } from "./ls";
import { notebookToolRenderer } from "./notebook";
import { pythonToolRenderer } from "./python";
import { readToolRenderer } from "./read";
import { sshToolRenderer } from "./ssh";
import { todoWriteToolRenderer } from "./todo-write";
import { writeToolRenderer } from "./write";

export interface RenderCallOptions {
	spinnerFrame?: number;
}

type ToolRenderer = {
	renderCall: (args: unknown, theme: Theme, options?: RenderCallOptions) => Component;
	renderResult: (
		result: { content: Array<{ type: string; text?: string }>; details?: unknown; isError?: boolean },
		options: RenderResultOptions & { renderContext?: Record<string, unknown> },
		theme: Theme,
		args?: unknown,
	) => Component;
	mergeCallAndResult?: boolean;
	/** Render without background box, inline in the response flow */
	inline?: boolean;
};

export const toolRenderers: Record<string, ToolRenderer> = {
	ask: askToolRenderer as ToolRenderer,
	bash: bashToolRenderer as ToolRenderer,
	python: pythonToolRenderer as ToolRenderer,
	calc: calculatorToolRenderer as ToolRenderer,
	edit: editToolRenderer as ToolRenderer,
	find: findToolRenderer as ToolRenderer,
	grep: grepToolRenderer as ToolRenderer,
	ls: lsToolRenderer as ToolRenderer,
	lsp: lspToolRenderer as ToolRenderer,
	notebook: notebookToolRenderer as ToolRenderer,
	read: readToolRenderer as ToolRenderer,
	ssh: sshToolRenderer as ToolRenderer,
	task: taskToolRenderer as ToolRenderer,
	todo_write: todoWriteToolRenderer as ToolRenderer,
	fetch: fetchToolRenderer as ToolRenderer,
	web_search: webSearchToolRenderer as ToolRenderer,
	write: writeToolRenderer as ToolRenderer,
};
