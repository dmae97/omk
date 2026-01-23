/**
 * TUI renderers for built-in tools.
 *
 * These provide rich visualization for tool calls and results in the TUI.
 */

import type { RenderResultOptions } from "@oh-my-pi/pi-coding-agent/extensibility/custom-tools/types";
import { lspToolRenderer } from "@oh-my-pi/pi-coding-agent/lsp/render";
import type { Theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { editToolRenderer } from "@oh-my-pi/pi-coding-agent/patch";
import { taskToolRenderer } from "@oh-my-pi/pi-coding-agent/task/render";
import { webSearchToolRenderer } from "@oh-my-pi/pi-coding-agent/web/search/render";
import type { Component } from "@oh-my-pi/pi-tui";
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
