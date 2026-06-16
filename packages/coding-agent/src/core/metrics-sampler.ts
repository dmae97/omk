import * as os from "node:os";

const DEFAULT_EMA_ALPHA = 0.3;

// Cap the smoothed-sample history so a long-running process cannot grow it
// without bound. The rolling average only ever reads the tail, so retaining a
// fixed recent window is sufficient (120 samples = 4 minutes at a 2s interval).
const MAX_CPU_HISTORY = 120;

type MetricsSamplerOptions = {
	now?: () => number;
	readCpu?: (prev?: NodeJS.CpuUsage) => NodeJS.CpuUsage;
	readMemory?: () => { rss: number };
	cpuCount?: number;
};

/**
 * Samples process CPU and memory usage on a fixed interval.
 *
 * CPU% is computed from `process.cpuUsage(prev)` deltas normalized by elapsed
 * wall-clock time and the number of logical CPUs. The raw delta percent is
 * then smoothed with an exponential moving average (EMA). Memory is read from
 * `process.memoryUsage().rss`.
 *
 * The interval timer is `unref()`-ed so it never keeps the process alive.
 */
export class MetricsSampler {
	private readonly now: () => number;
	private readonly readCpu: (prev?: NodeJS.CpuUsage) => NodeJS.CpuUsage;
	private readonly readMemory: () => { rss: number };

	private timer: ReturnType<typeof setInterval> | null = null;
	private prevCpu: NodeJS.CpuUsage | null = null;
	private prevTime: number | null = null;
	private cpuPercent: number | null = null;
	private memoryRssBytes: number | null = null;
	private cpuCount: number;
	private cpuPeak: number | null = null;
	private readonly smoothedHistory: number[] = [];

	/**
	 * Create a sampler. All dependencies can be injected for deterministic
	 * testing; omitted options default to real process/OS sources.
	 */
	constructor(options?: MetricsSamplerOptions) {
		this.now = options?.now ?? (() => Date.now());
		this.readCpu = options?.readCpu ?? ((prev?: NodeJS.CpuUsage) => process.cpuUsage(prev));
		this.readMemory = options?.readMemory ?? (() => process.memoryUsage());
		this.cpuCount = Math.max(1, options?.cpuCount ?? os.cpus().length);
	}

	/**
	 * Start sampling. If already running, the existing timer is stopped and
	 * restarted with the new interval.
	 */
	start(intervalMs = 2000): void {
		this.stop();
		this.prevCpu = this.readCpu();
		this.prevTime = this.now();
		this.cpuPercent = null;
		this.memoryRssBytes = null;
		this.cpuPeak = null;
		this.smoothedHistory.length = 0;

		this.timer = setInterval(() => this.sample(), intervalMs);
		this.timer.unref();
	}

	/** Stop sampling and reset all cached values to `null`. */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.prevCpu = null;
		this.prevTime = null;
		this.cpuPercent = null;
		this.memoryRssBytes = null;
		this.cpuPeak = null;
		this.smoothedHistory.length = 0;
	}

	/** The most recently sampled, EMA-smoothed CPU percent (0-100), or `null` before the first sample. */
	getCpuPercent(): number | null {
		return this.cpuPercent;
	}

	/** The most recently sampled RSS memory size in bytes, or `null` before the first sample. */
	getMemoryRssBytes(): number | null {
		return this.memoryRssBytes;
	}

	/** The highest smoothed CPU percent observed since start, or `null` before the first sample. */
	getCpuPeak(): number | null {
		return this.cpuPeak;
	}

	/**
	 * The mean of the last `window` smoothed CPU percent samples, or `null` if
	 * fewer than `window` samples have been collected.
	 */
	getCpuRollingAvg(window = 5): number | null {
		if (window <= 0 || this.smoothedHistory.length < window) {
			return null;
		}
		const start = this.smoothedHistory.length - window;
		let sum = 0;
		for (let i = start; i < this.smoothedHistory.length; i++) {
			sum += this.smoothedHistory[i];
		}
		return sum / window;
	}

	private sample(): void {
		if (!this.prevCpu || this.prevTime === null) {
			return;
		}

		const now = this.now();
		const elapsedMs = now - this.prevTime;
		if (elapsedMs <= 0) {
			return;
		}

		const delta = this.readCpu(this.prevCpu);
		const deltaMicroseconds = delta.user + delta.system;

		// Convert microseconds of CPU time into a percentage of total CPU capacity.
		// One core-second per elapsed wall second is 100% of one core; dividing by
		// cpuCount gives the percentage of total system CPU capacity.
		const coreFraction = deltaMicroseconds / (elapsedMs * 1000);
		const rawPercent = (coreFraction / this.cpuCount) * 100;
		const clampedRaw = clamp(rawPercent, 0, 100);

		// First sample seeds the EMA; subsequent samples blend with prior value.
		const smoothed =
			this.cpuPercent === null
				? clampedRaw
				: DEFAULT_EMA_ALPHA * clampedRaw + (1 - DEFAULT_EMA_ALPHA) * this.cpuPercent;

		this.cpuPercent = smoothed;
		this.memoryRssBytes = this.readMemory().rss;
		this.smoothedHistory.push(smoothed);
		if (this.smoothedHistory.length > MAX_CPU_HISTORY) {
			this.smoothedHistory.shift();
		}
		if (this.cpuPeak === null || smoothed > this.cpuPeak) {
			this.cpuPeak = smoothed;
		}

		// Accumulate the delta so the next sample computes from the same baseline.
		this.prevCpu = {
			user: this.prevCpu.user + delta.user,
			system: this.prevCpu.system + delta.system,
		};
		this.prevTime = now;
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
