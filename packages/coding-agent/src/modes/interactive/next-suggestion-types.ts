import type { StreamFn } from "omk-agent-core";
import type { QuotaUsage, SuggestionPlan } from "../../core/next-suggestion.ts";
import type { SuggestionAcceptTracker } from "../../core/next-suggestion-accept-trace.ts";
import type { SuggestionBudget } from "../../core/next-suggestion-budget.ts";
import type * as settlement from "../../core/next-suggestion-settlement.ts";

export interface SuggestionSessionPort {
	readonly agent: { streamFn: StreamFn; readonly state: { readonly messages: readonly unknown[] } };
	readonly model: { readonly provider: string; readonly id: string } | undefined;
	subscribe(
		listener: (event: { readonly type: string; readonly outcome?: string; readonly message?: unknown }) => unknown,
	): () => void;
}

export interface NextSuggestionOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => number;
	readonly isTab?: (data: string) => boolean;
	/** Quota usage for the 90% rule; called at most once per settled turn, only with the flag on. */
	readonly quotaUsage?: () => Promise<QuotaUsage>;
	readonly usageTimeoutMs?: number;
	readonly requestRender?: () => void;
	readonly onPlan?: (plan: SuggestionPlan) => void;
	/** Spec 103: settle every suggestion request's usage, including discarded and cancelled ones. */
	readonly settle?: (s: settlement.AnySuggestionSettlement) => void;
	/** Accept-trace sink (`OMK_NEXT_SUGGESTIONS_ACCEPT_TRACE`); absent ⇒ nothing recorded, behavior unchanged. */
	readonly acceptTrace?: SuggestionAcceptTracker;
	/** Spec 103 caps budget (caps flag only); defaults to the env budget. */
	readonly budget?: SuggestionBudget;
	readonly timeoutSignal?: (ms: number) => AbortSignal;
}
