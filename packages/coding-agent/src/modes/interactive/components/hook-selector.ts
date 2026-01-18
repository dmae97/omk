/**
 * Generic selector component for hooks.
 * Displays a list of string options with keyboard navigation.
 */

import { Container, matchesKey, Spacer, Text, type TUI } from "@oh-my-pi/pi-tui";
import { theme } from "../theme/theme";
import { CountdownTimer } from "./countdown-timer";
import { DynamicBorder } from "./dynamic-border";

export interface HookSelectorOptions {
	tui?: TUI;
	timeout?: number;
	initialIndex?: number;
}

export class HookSelectorComponent extends Container {
	private options: string[];
	private selectedIndex: number;
	private listContainer: Container;
	private onSelectCallback: (option: string) => void;
	private onCancelCallback: () => void;
	private titleText: Text;
	private baseTitle: string;
	private countdown: CountdownTimer | undefined;

	constructor(
		title: string,
		options: string[],
		onSelect: (option: string) => void,
		onCancel: () => void,
		opts?: HookSelectorOptions,
	) {
		super();

		this.options = options;
		this.selectedIndex = Math.min(opts?.initialIndex ?? 0, options.length - 1);
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;
		this.baseTitle = title;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		this.titleText = new Text(theme.fg("accent", title), 1, 0);
		this.addChild(this.titleText);
		this.addChild(new Spacer(1));

		if (opts?.timeout && opts.timeout > 0 && opts.tui) {
			this.countdown = new CountdownTimer(
				opts.timeout,
				opts.tui,
				(s) => this.titleText.setText(theme.fg("accent", `${this.baseTitle} (${s}s)`)),
				() => this.onCancelCallback(),
			);
		}

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "up/down navigate  enter select  esc cancel"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();
		for (let i = 0; i < this.options.length; i++) {
			const isSelected = i === this.selectedIndex;
			const text = isSelected
				? theme.fg("accent", `${theme.nav.cursor} `) + theme.fg("accent", this.options[i])
				: `  ${theme.fg("text", this.options[i])}`;
			this.listContainer.addChild(new Text(text, 1, 0));
		}
	}

	handleInput(keyData: string): void {
		if (matchesKey(keyData, "up") || keyData === "k") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
		} else if (matchesKey(keyData, "down") || keyData === "j") {
			this.selectedIndex = Math.min(this.options.length - 1, this.selectedIndex + 1);
			this.updateList();
		} else if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			const selected = this.options[this.selectedIndex];
			if (selected) this.onSelectCallback(selected);
		} else if (matchesKey(keyData, "escape") || matchesKey(keyData, "esc") || matchesKey(keyData, "ctrl+c")) {
			this.onCancelCallback();
		}
	}

	dispose(): void {
		this.countdown?.dispose();
	}
}
