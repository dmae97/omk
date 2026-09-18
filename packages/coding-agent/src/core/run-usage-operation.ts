import type { RunUsageAmounts, RunUsageLedger } from "./run-usage-ledger.ts";

/** Explicit adapter: promise settlement, not AbortSignal, releases operation ownership. */
export async function runUsageOperation<T>(
	ledger: RunUsageLedger,
	input: { attemptId: string; requestId: string; reservation: RunUsageAmounts },
	operation: () => Promise<T>,
): Promise<T> {
	const { attemptId, requestId, reservation } = input;
	ledger.reserve(attemptId, requestId, reservation);
	try {
		return await operation();
	} finally {
		ledger.settle(attemptId);
	}
}
