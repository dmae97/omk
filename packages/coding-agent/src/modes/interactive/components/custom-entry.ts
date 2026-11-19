import type { Component } from "omk-tui";
import { Container, Spacer, Text } from "omk-tui";
import type { EntryRenderer } from "../../../core/extensions/types.ts";
import type { CustomEntry } from "../../../core/session-manager.ts";
import { theme } from "../theme/theme.ts";
import { guardExtensionRender } from "./extension-render-guard.ts";

/** Renders extension-owned custom entries without projecting them into LLM messages. */
export class CustomEntryComponent extends Container {
	private expanded = false;
	private readonly entry: CustomEntry;
	private readonly renderer: EntryRenderer;

	constructor(entry: CustomEntry, renderer: EntryRenderer) {
		super();
		this.entry = entry;
		this.renderer = renderer;
		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		if (this.expanded === expanded) return;
		this.expanded = expanded;
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		let component: Component | null | undefined;
		try {
			component = this.renderer(this.entry, { expanded: this.expanded }, theme);
		} catch {
			return;
		}
		if (!component) return;
		this.addChild(new Spacer(1));
		this.addChild(guardExtensionRender(component, () => new Text("Custom entry rendering failed.", 0, 0)));
	}
}
