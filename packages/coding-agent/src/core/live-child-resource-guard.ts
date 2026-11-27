import type { WorkloadPermitPool } from "./workload-permit-pool.ts";
import { WorkloadPermitError } from "./workload-permit-pool.ts";

export interface LiveChildResourceGuardOptions {
	readonly permitPool: WorkloadPermitPool;
	readonly maxRssBytes: number;
}

export type TrackedChildExecutionResult =
	| { readonly status: "completed" }
	| { readonly status: "failed" }
	| { readonly status: "unsettled"; readonly settlement: Promise<void> };

export type TrackedChildOutcome =
	| { readonly status: "completed" }
	| { readonly status: "failed" }
	| { readonly status: "unsettled" }
	| { readonly status: "aborted" }
	| { readonly status: "memory_budget_exceeded"; readonly reason: "rss_exceeds_max" }
	| { readonly status: "permit_denied"; readonly code: string };

export interface TrackedChildRunInput {
	readonly requestId: string;
	readonly promptRunId: string;
	readonly currentRssBytes: number;
	readonly weight?: 1 | 2;
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
	readonly execute: () => Promise<TrackedChildExecutionResult>;
}

export interface LiveChildResourceGuard {
	runTracked(input: TrackedChildRunInput): Promise<TrackedChildOutcome>;
	liveUnsettledCount(): number;
}

/**
 * Combines WorkloadPermitPool concurrency caps, memory (RSS) limits, and cancel safety.
 * Crucial invariant: a child returning `unsettled` retains its permit until its settlement
 * promise resolves cleanly; a rejected settlement never releases the permit prematurely.
 */
export function createLiveChildResourceGuard(options: LiveChildResourceGuardOptions): LiveChildResourceGuard {
	const maxRssBytes = Math.max(1, Math.floor(options.maxRssBytes));
	let unsettled = 0;

	return {
		liveUnsettledCount: () => unsettled,
		async runTracked(input) {
			if (input.signal?.aborted) return { status: "aborted" };
			if (input.currentRssBytes > maxRssBytes) {
				return { status: "memory_budget_exceeded", reason: "rss_exceeds_max" };
			}

			let release: (() => void) | undefined;
			try {
				const permit = await options.permitPool.acquire({
					requestId: input.requestId,
					promptRunId: input.promptRunId,
					workloadClass: "heavy",
					weight: input.weight ?? 1,
					signal: input.signal,
					timeoutMs: input.timeoutMs,
				});
				release = () => permit.release();
			} catch (error) {
				const code = error instanceof WorkloadPermitError ? error.code : "unknown";
				return { status: "permit_denied", code };
			}

			let retained = false;
			try {
				const result = await input.execute();
				if (result.status === "unsettled") {
					retained = true;
					unsettled += 1;
					void result.settlement.then(
						() => {
							unsettled = Math.max(0, unsettled - 1);
							release?.();
						},
						() => {
							// Termination unproven: keep permit retained.
						},
					);
					return { status: "unsettled" };
				}
				return { status: result.status };
			} catch {
				return { status: input.signal?.aborted ? "aborted" : "failed" };
			} finally {
				if (!retained) release?.();
			}
		},
	};
}
