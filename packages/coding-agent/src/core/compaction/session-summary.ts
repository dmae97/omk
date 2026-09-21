import type { Api, Model } from "omk-ai";
import type { CompactionPreparation, CompactionResult } from "./compaction.ts";
import { summarizeWithFallback } from "./fallback.ts";
import type { CompactionRequestAuth } from "./model-failover.ts";

export interface CompactionSummaryInput {
	readonly preparation: CompactionPreparation;
	readonly model: Model<Api>;
	readonly apiKey: string | undefined;
	readonly headers: Record<string, string> | undefined;
	readonly customInstructions?: string;
	readonly signal: AbortSignal;
	readonly reason: "manual" | "overflow" | "threshold";
}

interface SessionSummaryInput extends CompactionSummaryInput {
	readonly sessionModel: Model<Api> | undefined;
	readonly resolveAuth: (model: Model<Api>) => Promise<CompactionRequestAuth>;
	readonly summarize: (input: CompactionSummaryInput) => Promise<CompactionResult>;
}

/** Manual and automatic compaction share one credential-bound rescue ladder. */
export function summarizeSessionCompaction(input: SessionSummaryInput): Promise<CompactionResult> {
	return summarizeWithFallback({
		preparation: input.preparation,
		primaryModel: input.model,
		sessionModel: input.sessionModel,
		isAborted: () => input.signal.aborted,
		alwaysRescue: input.reason === "overflow",
		summarize: async (model) => {
			const auth =
				model.provider === input.model.provider && model.id === input.model.id
					? { apiKey: input.apiKey, headers: input.headers }
					: await input.resolveAuth(model);
			input.signal.throwIfAborted();
			return input.summarize({
				preparation: input.preparation,
				model,
				apiKey: auth.apiKey,
				headers: auth.headers,
				customInstructions: input.customInstructions,
				signal: input.signal,
				reason: input.reason,
			});
		},
	});
}
