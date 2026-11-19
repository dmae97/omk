import type { StreamFn } from "omk-agent-core";
import type { Api, Model, RetryCallbacks, RetryPolicy } from "omk-ai";
import type { ModelRegistry } from "../model-registry.ts";
import { resolveFailoverCandidates } from "../provider-resilience.ts";
import type { SettingsManager } from "../settings-manager.ts";
import { compact } from "./compaction.ts";
import type { CompactionRequestAuth } from "./model-failover.ts";
import { summarizeWithOAuthRecovery } from "./oauth-recovery.ts";
import type { CompactionSummaryInput } from "./session-summary.ts";

export type SummarizationRetryEvent =
	| {
			type: "summarization_retry_scheduled";
			attempt: number;
			maxAttempts: number;
			delayMs: number;
			errorMessage: string;
	  }
	| { type: "summarization_retry_attempt_start"; source: "branchSummary" }
	| {
			type: "summarization_retry_attempt_start";
			source: "compaction";
			reason: "manual" | "threshold" | "overflow";
	  }
	| { type: "summarization_retry_finished" };

/** Retry notifications shared by compaction and branch summaries; payloads are unchanged. */
export function summarizationRetryCallbacks(
	emit: (event: SummarizationRetryEvent) => void,
	source: { source: "branchSummary" } | { source: "compaction"; reason: "manual" | "threshold" | "overflow" },
): RetryCallbacks {
	return {
		onRetryScheduled: (attempt, maxAttempts, delayMs, errorMessage) => {
			emit({ type: "summarization_retry_scheduled", attempt, maxAttempts, delayMs, errorMessage });
		},
		onRetryAttemptStart: () => {
			emit({ type: "summarization_retry_attempt_start", ...source });
		},
		onRetryFinished: () => {
			emit({ type: "summarization_retry_finished" });
		},
	};
}

export function compactionFailoverModels(
	primary: Model<Api>,
	settings: Pick<SettingsManager, "getProviderResilienceSettings">,
	registry: Pick<ModelRegistry, "getAvailable">,
): Model<Api>[] {
	const candidates = resolveFailoverCandidates(settings.getProviderResilienceSettings());
	const available = registry.getAvailable();
	const models: Model<Api>[] = [];
	for (const candidate of candidates) {
		if (candidate.provider === primary.provider && candidate.id === primary.id) continue;
		const resolved = available.find((m) => m.provider === candidate.provider && m.id === candidate.id);
		if (resolved) models.push(resolved);
	}
	return models;
}

export function summarizeObservedCompaction(
	input: CompactionSummaryInput,
	options: {
		readonly refreshRejectedToken: (rejected: string) => Promise<string | undefined>;
		readonly request: () => {
			readonly thinkingLevel: Parameters<typeof compact>[6];
			readonly streamFn: StreamFn;
			readonly retry: RetryPolicy;
			readonly callbacks: RetryCallbacks;
			readonly failoverModels: Model<Api>[];
			readonly resolveCandidateAuth: (model: Model<Api>) => Promise<CompactionRequestAuth>;
		};
	},
) {
	return summarizeWithOAuthRecovery({
		apiKey: input.apiKey,
		provider: input.model.provider,
		refreshRejectedToken: options.refreshRejectedToken,
		run: (requestApiKey) => {
			const request = options.request();
			return compact(
				input.preparation,
				input.model,
				requestApiKey,
				input.headers,
				input.customInstructions,
				input.signal,
				request.thinkingLevel,
				request.streamFn,
				request.retry,
				request.callbacks,
				request.failoverModels,
				{ resolveCandidateAuth: request.resolveCandidateAuth },
			);
		},
	});
}
