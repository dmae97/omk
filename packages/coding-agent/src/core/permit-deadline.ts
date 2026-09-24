export interface PermitDeadline {
	expired(): boolean;
	cancel(): void;
}

/** Monotonic queue deadline, including event-loop lag and >32-bit timer delays. */
export function createPermitDeadline(
	durationMs: number,
	onExpire: () => void,
	now: () => number = () => performance.now(),
): PermitDeadline {
	if (!Number.isFinite(durationMs) || durationMs <= 0)
		throw new RangeError("Deadline duration must be finite and positive");
	const start = now();
	if (!Number.isFinite(start)) throw new RangeError("Deadline clock must be finite");
	let timer: ReturnType<typeof setTimeout> | undefined;
	let cancelled = false;
	const remaining = (): number => durationMs - (now() - start);
	const tick = (): void => {
		if (cancelled) return;
		const delay = remaining();
		if (delay <= 0) {
			cancelled = true;
			onExpire();
			return;
		}
		timer = setTimeout(tick, Math.min(2_147_483_647, Math.max(1, Math.ceil(delay))));
	};
	timer = setTimeout(tick, Math.min(2_147_483_647, Math.max(1, Math.ceil(durationMs))));
	return {
		expired: () => remaining() <= 0,
		cancel: () => {
			cancelled = true;
			if (timer !== undefined) clearTimeout(timer);
		},
	};
}
