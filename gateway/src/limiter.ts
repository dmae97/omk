export class KeyLimiter {
	private hits = new Map<string, number[]>();
	private inflight = new Map<string, number>();
	constructor(
		private rpm: number | null,
		private concurrent: number | null,
		private clock: () => number,
	) {}

	/** Returns null when allowed (and counts the request), else seconds to wait. */
	checkRate(key: string): number | null {
		if (this.rpm === null) return null;
		const now = this.clock();
		const arr = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
		if (arr.length >= this.rpm) {
			this.hits.set(key, arr);
			return Math.max(1, Math.ceil((60_000 - (now - (arr[0] as number))) / 1000));
		}
		arr.push(now);
		this.hits.set(key, arr);
		return null;
	}

	/** Returns true if a concurrency slot was taken. */
	acquire(key: string): boolean {
		const cur = this.inflight.get(key) ?? 0;
		if (this.concurrent !== null && cur >= this.concurrent) return false;
		this.inflight.set(key, cur + 1);
		return true;
	}

	release(key: string): void {
		this.inflight.set(key, Math.max(0, (this.inflight.get(key) ?? 0) - 1));
	}

	inFlight(key: string): number {
		return this.inflight.get(key) ?? 0;
	}
}
