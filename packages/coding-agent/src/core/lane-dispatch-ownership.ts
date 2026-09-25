/** One dispatch lease per shared pool, across recreated authority instances. */
const active = new WeakMap<object, symbol>();

/** Synchronous claim before any await. Rejection, cancellation and reentry do not steal a lease. */
export function tryAcquireLaneDispatch(pool: object): (() => void) | undefined {
	if (active.has(pool)) return undefined;
	const token = Symbol("lane-dispatch");
	active.set(pool, token);
	return () => {
		if (active.get(pool) === token) active.delete(pool);
	};
}
