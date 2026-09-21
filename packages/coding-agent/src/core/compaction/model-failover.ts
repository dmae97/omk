import type { Api, Model } from "omk-ai";
import { isQuotaExhaustionMessage, isTerminalProviderErrorMessage } from "../provider-resilience.ts";

export interface CompactionRequestAuth {
	readonly apiKey?: string;
	readonly headers?: Record<string, string>;
}

export interface CompactFailoverOptions {
	/** Cross-provider candidates need their own credential; never replay the primary key. */
	readonly resolveCandidateAuth?: (candidate: Model<Api>) => Promise<CompactionRequestAuth>;
}

interface ModelFailoverInput<T> {
	readonly model: Model<Api>;
	readonly auth: CompactionRequestAuth;
	readonly signal?: AbortSignal;
	readonly candidates?: readonly Model<Api>[];
	readonly options?: CompactFailoverOptions;
	readonly run: (model: Model<Api>, auth: CompactionRequestAuth) => Promise<T>;
}

/** Preserve the primary quota failure when no authenticated candidate can serve. */
export async function withCompactionModelFailover<T>(input: ModelFailoverInput<T>): Promise<T> {
	try {
		return await input.run(input.model, input.auth);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!isQuotaExhaustionMessage(message) || !input.candidates?.length) throw error;
		for (const candidate of input.candidates) {
			if (candidate.provider === input.model.provider && candidate.id === input.model.id) continue;
			if (input.signal?.aborted) throw error;
			let auth: CompactionRequestAuth;
			if (candidate.provider === input.model.provider && !input.options?.resolveCandidateAuth) {
				auth = input.auth;
			} else {
				try {
					auth = (await input.options?.resolveCandidateAuth?.(candidate)) ?? {};
				} catch {
					// An unavailable credential excludes this candidate, not the remaining chain.
					continue;
				}
				if (!auth.apiKey) continue;
			}
			if (input.signal?.aborted) throw error;
			try {
				return await input.run(candidate, auth);
			} catch (candidateError) {
				const candidateMessage = candidateError instanceof Error ? candidateError.message : String(candidateError);
				if (!isTerminalProviderErrorMessage(candidateMessage)) {
					throw new Error(`Failover candidate ${candidate.provider}/${candidate.id} failed: ${candidateMessage}`);
				}
			}
		}
		throw error;
	}
}
