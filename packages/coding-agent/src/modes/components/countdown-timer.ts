/**
 * Reusable countdown timer for dialog components.
 */
import type { TUI } from "@oh-my-pi/pi-tui";

export class CountdownTimer {
	#intervalId: NodeJS.Timeout | undefined;
	#remainingSeconds: number;
	readonly #initialMs: number;

	constructor(
		timeoutMs: number,
		private tui: TUI | undefined,
		private onTick: (seconds: number) => void,
		private onExpire: () => void,
	) {
		this.#initialMs = timeoutMs;
		this.#remainingSeconds = Math.ceil(timeoutMs / 1000);
		this.onTick(this.#remainingSeconds);

		this.#intervalId = setInterval(() => {
			this.#remainingSeconds--;
			this.onTick(this.#remainingSeconds);
			this.tui?.requestRender();

			if (this.#remainingSeconds <= 0) {
				this.dispose();
				this.onExpire();
			}
		}, 1000);
	}

	/** Reset the countdown to its initial value */
	reset(): void {
		this.#remainingSeconds = Math.ceil(this.#initialMs / 1000);
		this.onTick(this.#remainingSeconds);
		this.tui?.requestRender();
	}

	dispose(): void {
		if (this.#intervalId) {
			clearInterval(this.#intervalId);
			this.#intervalId = undefined;
		}
	}
}
