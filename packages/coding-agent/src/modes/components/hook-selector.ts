/**
 * Generic selector component for hooks.
 * Displays a list of string options with keyboard navigation.
 */
import { Container, matchesKey, padding, Spacer, Text, type TUI, visibleWidth } from "@oh-my-pi/pi-tui";
import { theme } from "../../modes/theme/theme";
import { CountdownTimer } from "./countdown-timer";
import { DynamicBorder } from "./dynamic-border";

export interface HookSelectorOptions {
	tui?: TUI;
	timeout?: number;
	initialIndex?: number;
	outline?: boolean;
	maxVisible?: number;
}

class OutlinedList extends Container {
	private lines: string[] = [];

	setLines(lines: string[]): void {
		this.lines = lines;
		this.invalidate();
	}

	render(width: number): string[] {
		const borderColor = (text: string) => theme.fg("border", text);
		const horizontal = borderColor(theme.boxSharp.horizontal.repeat(Math.max(1, width)));
		const innerWidth = Math.max(1, width - 2);
		const content = this.lines.map(line => {
			const pad = Math.max(0, innerWidth - visibleWidth(line));
			return `${borderColor(theme.boxSharp.vertical)}${line}${padding(pad)}${borderColor(theme.boxSharp.vertical)}`;
		});
		return [horizontal, ...content, horizontal];
	}
}

export class HookSelectorComponent extends Container {
	private options: string[];
	private selectedIndex: number;
	private maxVisible: number;
	private listContainer: Container | undefined;
	private outlinedList: OutlinedList | undefined;
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
		this.maxVisible = Math.max(3, opts?.maxVisible ?? 12);
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
				s => this.titleText.setText(theme.fg("accent", `${this.baseTitle} (${s}s)`)),
				() => {
					// Auto-select current option on timeout (typically the first/recommended option)
					const selected = this.options[this.selectedIndex];
					if (selected) {
						this.onSelectCallback(selected);
					} else {
						this.onCancelCallback();
					}
				},
			);
		}

		if (opts?.outline) {
			this.outlinedList = new OutlinedList();
			this.addChild(this.outlinedList);
		} else {
			this.listContainer = new Container();
			this.addChild(this.listContainer);
		}
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "up/down navigate  enter select  esc cancel"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.updateList();
	}

	private updateList(): void {
		const lines: string[] = [];
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.options.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.options.length);

		for (let i = startIndex; i < endIndex; i++) {
			const isSelected = i === this.selectedIndex;
			const text = isSelected
				? theme.fg("accent", `${theme.nav.cursor} `) + theme.fg("accent", this.options[i])
				: `  ${theme.fg("text", this.options[i])}`;
			lines.push(text);
		}

		if (startIndex > 0 || endIndex < this.options.length) {
			lines.push(theme.fg("dim", `  (${this.selectedIndex + 1}/${this.options.length})`));
		}
		if (this.outlinedList) {
			this.outlinedList.setLines(lines);
			return;
		}
		this.listContainer?.clear();
		for (const line of lines) {
			this.listContainer?.addChild(new Text(line, 1, 0));
		}
	}

	handleInput(keyData: string): void {
		// Reset countdown on any interaction
		this.countdown?.reset();

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
