/**
 * Simple text input component for hooks.
 */

import { Container, Input, matchesKey, Spacer, Text, type TUI } from "@oh-my-pi/pi-tui";
import { theme } from "../theme/theme";
import { CountdownTimer } from "./countdown-timer";
import { DynamicBorder } from "./dynamic-border";

export interface HookInputOptions {
	tui?: TUI;
	timeout?: number;
}

export class HookInputComponent extends Container {
	private input: Input;
	private onSubmitCallback: (value: string) => void;
	private onCancelCallback: () => void;
	private titleText: Text;
	private baseTitle: string;
	private countdown: CountdownTimer | undefined;

	constructor(
		title: string,
		_placeholder: string | undefined,
		onSubmit: (value: string) => void,
		onCancel: () => void,
		opts?: HookInputOptions,
	) {
		super();

		this.onSubmitCallback = onSubmit;
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

		this.input = new Input();
		this.addChild(this.input);
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "enter submit  esc cancel"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
	}

	handleInput(keyData: string): void {
		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			this.onSubmitCallback(this.input.getValue());
		} else if (matchesKey(keyData, "escape") || matchesKey(keyData, "esc")) {
			this.onCancelCallback();
		} else {
			this.input.handleInput(keyData);
		}
	}

	dispose(): void {
		this.countdown?.dispose();
	}
}
