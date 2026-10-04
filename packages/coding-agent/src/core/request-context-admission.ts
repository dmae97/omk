import type { StreamFn } from "omk-agent-core";
import type { Api, Context, Model, SimpleStreamOptions } from "omk-ai";
import { createFallbackTokenCounter, type TokenCounterAdapter } from "./context-budget-token-counter.ts";
import {
	decideRequestAdmission,
	type RequestAdmissionDecision,
	type RequestAdmissionPolicy,
	RequestInputAdmissionError,
	snapshotRequestAdmissionPolicy,
} from "./request-admission-policy.ts";
import { projectRequestForAdmission } from "./request-admission-projection.ts";

export interface RequestAdmissionSnapshot {
	readonly inspected: number;
	readonly admitted: number;
	readonly wouldReject: number;
	readonly denied: number;
	readonly unmeasured: number;
	readonly last?: RequestAdmissionDecision;
}
export interface RequestAdmissionGuard {
	check(model: Model<Api>, context: Context, options?: SimpleStreamOptions): void;
	snapshot(): RequestAdmissionSnapshot;
}
export function createRequestAdmissionGuard(
	input: Partial<RequestAdmissionPolicy> = {},
	counter: TokenCounterAdapter = createFallbackTokenCounter(),
): RequestAdmissionGuard {
	const policy = snapshotRequestAdmissionPolicy(input);
	let inspected = 0,
		admitted = 0,
		wouldReject = 0,
		denied = 0,
		unmeasured = 0;
	let last: RequestAdmissionDecision | undefined;
	return {
		check(model, context, options) {
			options?.signal?.throwIfAborted();
			if (policy.mode === "off") return;
			inspected++;
			let decision: RequestAdmissionDecision;
			try {
				const projection = projectRequestForAdmission(context, policy);
				const tokens = [projection.system, projection.messages, projection.tools].map(
					(text) => counter.countText(text, model.id).tokens,
				);
				if (tokens.some((n) => !Number.isSafeInteger(n) || n < 0)) throw new TypeError("admission.invalid_count");
				const total = tokens.reduce((a, b) => a + b, 0) + projection.imageCount * policy.imageTokens;
				decision = decideRequestAdmission(
					{
						estimatedInputTokens: total,
						contextWindow: model.contextWindow,
						modelMaxTokens: model.maxTokens,
						requestedMaxTokens: options?.maxTokens,
						reasoning: options?.reasoning,
					},
					policy,
				);
			} catch (error) {
				decision = {
					reason:
						error instanceof RangeError && error.message === "admission.representation_limit"
							? "representation_limit"
							: "invalid_input",
				};
			}
			last = Object.freeze({ ...decision });
			if (decision.reason === "unknown_window") unmeasured++;
			const refuse =
				decision.reason !== "fits" && (decision.reason !== "unknown_window" || policy.rejectUnknownWindow);
			if (refuse) {
				wouldReject++;
				if (policy.mode === "enforce") {
					denied++;
					throw new RequestInputAdmissionError(last);
				}
			}
			admitted++;
		},
		snapshot: () =>
			Object.freeze({ inspected, admitted, wouldReject, denied, unmeasured, ...(last ? { last } : {}) }),
	};
}
/** Explicit SDK adapter; preserves credential identity symbols, not payloads or credentials. */
export function withRequestContextAdmission(source: StreamFn, guard: RequestAdmissionGuard): StreamFn {
	const wrapped: StreamFn = (model, context, options) => {
		guard.check(model, context, options);
		options?.signal?.throwIfAborted();
		return source(model, context, options);
	};
	for (const key of Object.getOwnPropertySymbols(source)) {
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (descriptor) Object.defineProperty(wrapped, key, descriptor);
	}
	return wrapped;
}
