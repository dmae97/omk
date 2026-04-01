export interface AbortSourceTracker {
	requestAbortController: AbortController;
	requestSignal: AbortSignal;
	abortLocally(reason: Error): Error;
	getLocalAbortReason(): Error | undefined;
	wasCallerAbort(): boolean;
}

/**
 * Tracks whether a merged request signal was aborted by the caller or by provider-local logic.
 */
export function createAbortSourceTracker(callerSignal?: AbortSignal): AbortSourceTracker {
	const requestAbortController = new AbortController();
	const requestSignal = callerSignal
		? AbortSignal.any([callerSignal, requestAbortController.signal])
		: requestAbortController.signal;
	let localAbortReason: Error | undefined;

	return {
		requestAbortController,
		requestSignal,
		abortLocally(reason) {
			localAbortReason = reason;
			requestAbortController.abort(reason);
			return reason;
		},
		getLocalAbortReason() {
			if (!localAbortReason) return undefined;
			return requestSignal.reason === localAbortReason ? localAbortReason : undefined;
		},
		wasCallerAbort() {
			if (!callerSignal?.aborted) return false;
			return requestSignal.reason !== localAbortReason;
		},
	};
}
