/** Total control-connection lifetime; activity never replenishes this deadline. */
export function controlTimeoutMs(value = 10000): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new RangeError("control.invalid_timeout");
	return value;
}
export function controlDeadline(
	durationMs: number,
	expire: () => void,
	now: () => number = () => performance.now(),
): {
	expired(): boolean;
	cancel(): void;
} {
	controlTimeoutMs(durationMs);
	const start = now();
	if (!Number.isFinite(start)) throw new RangeError("control.invalid_clock");
	let cancelled = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = (): boolean => {
		const value = now();
		return !Number.isFinite(value) || value < start || value - start >= durationMs;
	};
	const tick = (): void => {
		if (cancelled) return;
		if (expired()) {
			cancelled = true;
			expire();
			return;
		}
		timer = setTimeout(tick, Math.max(1, Math.ceil(durationMs - (now() - start))));
		timer.unref?.();
	};
	timer = setTimeout(tick, durationMs);
	timer.unref?.();
	return {
		expired,
		cancel: () => {
			cancelled = true;
			clearTimeout(timer);
		},
	};
}
