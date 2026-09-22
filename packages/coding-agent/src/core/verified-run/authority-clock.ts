import { AuthorityStoreError } from "./authority-errors.ts";

/** Host-owned wall clock for durable authorizations; rollback never extends a grant. */
export function createAuthorityClock(source: () => number = Date.now): () => number {
	let last = source();
	if (!Number.isSafeInteger(last) || last < 0) throw new AuthorityStoreError("clock_anomaly");
	return () => {
		const now = source();
		if (!Number.isSafeInteger(now) || now < 0 || now < last) throw new AuthorityStoreError("clock_anomaly");
		last = now;
		return now;
	};
}
