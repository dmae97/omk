import type { StreamFn } from "omk-agent-core";
import { linkAbortSignals } from "./abort-link.ts";
import { requestAdmissionPolicyFromEnv } from "./request-admission-policy.ts";
import { createRequestAdmissionGuard, type RequestAdmissionGuard } from "./request-context-admission.ts";
import { requestTraceFromEnv } from "./request-trace.ts";
import type { RunBudget } from "./run-budget.ts";
export function wrapBudgetStream(
	source: StreamFn,
	budget: RunBudget,
	admission: RequestAdmissionGuard = createRequestAdmissionGuard(requestAdmissionPolicyFromEnv()),
): StreamFn {
	const trace = requestTraceFromEnv(budget.signal);
	const wrapped: StreamFn = async (model, context, options) => {
		options?.signal?.throwIfAborted();
		budget.assertActive();
		admission.check(model, context, options);
		options?.signal?.throwIfAborted();
		const release = budget.admit();
		const remainingMs = budget.remainingMs;
		let returnedStream = false;
		let traceId: string | undefined;
		// Explicit forwarding instead of AbortSignal.any(): see abort-link.ts for the Node 22 leak.
		const link = options?.signal ? linkAbortSignals(options.signal, budget.signal) : undefined;
		try {
			traceId = trace?.begin(model.provider, model.id);
			const stream = await source(model, context, {
				...options,
				signal: link?.signal ?? budget.signal,
				...(Object.keys(budget.limits).length > 0 ? { maxRetries: 0 } : {}),
				...(remainingMs === undefined
					? {}
					: { timeoutMs: Math.min(options?.timeoutMs ?? remainingMs, remainingMs) }),
			});
			returnedStream = true;
			// A returned stream is not yet a completed request. Missing terminal metadata
			// retains the reservation; abort alone never refunds it.
			void stream.result().then(
				(message) => {
					try {
						if (traceId) trace?.terminal(traceId, message);
					} catch {
						/* Trace failure is not a new execution. */
					} finally {
						link?.dispose();
						release();
					}
				},
				() => {
					try {
						if (traceId) trace?.terminal(traceId, undefined);
					} catch {
						/* Incomplete trace stays non-rankable. */
					} finally {
						link?.dispose();
						release();
					}
				},
			);
			return stream;
		} catch (error) {
			// A broken result() contract leaves termination unknown, not refunded.
			if (!returnedStream) {
				link?.dispose();
				try {
					if (traceId) trace?.terminal(traceId, undefined, true);
				} catch {
					/* Preserve the original dispatch error. */
				} finally {
					release();
				}
			}
			throw error;
		}
	};
	// Preserve source-owned identity brands used by mandatory credential checks.
	for (const key of Object.getOwnPropertySymbols(source)) {
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (descriptor) Object.defineProperty(wrapped, key, descriptor);
	}
	return wrapped;
}
