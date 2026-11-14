import type { Component } from "omk-tui";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { CustomEntry } from "../session-manager.ts";

export interface MessageRenderOptions {
	expanded: boolean;
}

/** Render a persisted custom entry without adding its contents to the LLM context. */
export type EntryRenderer<T = unknown> = (
	entry: CustomEntry<T>,
	options: MessageRenderOptions,
	theme: Theme,
) => Component | null | undefined;

export function findRenderer<TOwner, TRenderer>(
	owners: readonly TOwner[],
	select: (owner: TOwner) => TRenderer | undefined,
): TRenderer | undefined {
	for (const owner of owners) {
		const renderer = select(owner);
		if (renderer !== undefined) return renderer;
	}
	return undefined;
}
