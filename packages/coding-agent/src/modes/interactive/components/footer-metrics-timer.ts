/**
 * Drives the footer's 2s CPU/MEM refresh. The interval exists only while metrics
 * are enabled and a handler is registered, so the default (metrics off) never
 * wakes the event loop, and it is unref'd so it cannot keep the process alive.
 */
export class FooterMetricsTimer {
	private timer: ReturnType<typeof setInterval> | undefined;
	private onTick: (() => void) | undefined;
	private enabled = false;
	private readonly intervalMs: number;

	constructor(intervalMs = 2000) {
		this.intervalMs = intervalMs;
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		this.sync();
	}

	setHandler(onTick: (() => void) | undefined): void {
		this.onTick = onTick;
		this.sync();
	}

	private sync(): void {
		const wanted = this.enabled && this.onTick !== undefined;
		if (wanted && !this.timer) {
			this.timer = setInterval(() => this.onTick?.(), this.intervalMs);
			this.timer.unref();
		} else if (!wanted && this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}
}
