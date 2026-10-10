import type { ToolDefinition } from "../../../core/extensions/types.ts";
import { bashToolRenderers } from "./bash.ts";
import { editToolRenderers } from "./edit.ts";
import { findToolRenderers } from "./find.ts";
import { grepToolRenderers } from "./grep.ts";
import { lsToolRenderers } from "./ls.ts";
import { readToolRenderers } from "./read.ts";
import { writeToolRenderers } from "./write.ts";

type ToolRendererFields = Pick<ToolDefinition, "renderCall" | "renderResult" | "renderShell">;

const BUILTIN_TOOL_RENDERERS: Record<string, ToolRendererFields> = {
	bash: bashToolRenderers,
	edit: editToolRenderers,
	find: findToolRenderers,
	grep: grepToolRenderers,
	ls: lsToolRenderers,
	read: readToolRenderers,
	write: writeToolRenderers,
};

/** TUI-only builtin renderers. Headless `-p` / workers never import this module. */
export function getBuiltinToolRenderers(name: string): ToolRendererFields | undefined {
	return BUILTIN_TOOL_RENDERERS[name];
}

/** Attach builtin TUI renderers when a definition does not already supply them. */
export function withBuiltinToolRenderers(definition: ToolDefinition): ToolDefinition {
	const renderers = BUILTIN_TOOL_RENDERERS[definition.name];
	if (!renderers) return definition;
	return {
		...definition,
		renderCall: definition.renderCall ?? renderers.renderCall,
		renderResult: definition.renderResult ?? renderers.renderResult,
		renderShell: definition.renderShell ?? renderers.renderShell,
	};
}
