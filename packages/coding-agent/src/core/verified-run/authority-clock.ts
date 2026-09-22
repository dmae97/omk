import { AuthorityStoreError } from "./authority-errors.ts";

class ClockAnomalyError extends AuthorityStoreError {
	readonly previous: number;
	readonly observed: number;
	constructor(previous: number, observed: number) {
		super("clock_anomaly");
		this.message = `authority-store: clock_anomaly (previous=${previous}, observed=${observed})`;
		this.previous = previous;
		this.observed = observed;
	}
}

/** Host-owned wall clock for durable authorizations; rollback never extends a grant. */
export function createAuthorityClock(source: () => number = Date.now): () => number {
	let last = source();
	if (!Number.isSafeInteger(last) || last < 0) throw new ClockAnomalyError(last, last);
	return () => {
		const now = source();
		if (!Number.isSafeInteger(now) || now < 0 || now < last) throw new ClockAnomalyError(last, now);
		last = now;
		return now;
	};
}
