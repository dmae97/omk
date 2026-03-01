import type { TUI } from "../tui";
import { sliceByColumn, visibleWidth } from "../utils";
import { Text } from "./text";

/**
 * Loader component that updates every 80ms with spinning animation
 */
export class Loader extends Text {
	#frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	#currentFrame = 0;
	#intervalId?: NodeJS.Timeout;
	#ui: TUI | null = null;

	constructor(
		ui: TUI,
		private spinnerColorFn: (str: string) => string,
		private messageColorFn: (str: string) => string,
		private message: string = "Loading...",
		spinnerFrames?: string[],
	) {
		super("", 1, 0);
		this.#ui = ui;
		if (spinnerFrames && spinnerFrames.length > 0) {
			this.#frames = spinnerFrames;
		}
		this.start();
	}

	render(width: number): string[] {
		const lines = ["", ...super.render(width)];
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (visibleWidth(line) > width) {
				lines[i] = sliceByColumn(line, 0, width, true);
			}
		}
		return lines;
	}

	start() {
		this.#updateDisplay();
		this.#intervalId = setInterval(() => {
			this.#currentFrame = (this.#currentFrame + 1) % this.#frames.length;
			this.#updateDisplay();
		}, 80);
	}

	stop() {
		if (this.#intervalId) {
			clearInterval(this.#intervalId);
			this.#intervalId = undefined;
		}
	}

	setMessage(message: string) {
		this.message = message;
		this.#updateDisplay();
	}

	#updateDisplay() {
		const frame = this.#frames[this.#currentFrame];
		this.setText(`${this.spinnerColorFn(frame)} ${this.messageColorFn(this.message)}`);
		if (this.#ui) {
			this.#ui.requestRender();
		}
	}
}
