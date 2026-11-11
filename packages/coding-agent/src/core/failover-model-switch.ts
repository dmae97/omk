/** Provider-error failover: which model to switch to, and when a failover-picked candidate is itself dead. */
import type { Api, AssistantMessage, Model } from "omk-ai";
import {
	isQuotaExhaustionMessage,
	isTerminalProviderErrorMessage,
	type ProviderResilienceSettings,
	pickFailoverCandidate,
	resolveProviderResilience,
	shouldHonorProviderFailover,
} from "./provider-resilience.ts";
import { failoverModelKey, isFailoverTriggerError } from "./provider-retry.ts";

/**
 * The model failover/rotation picked this turn rejected the request outright (403 entitlement,
 * auth, unsupported model). It can never serve this turn, so the chain advances instead of the
 * turn ending on it. `refused` is non-empty only inside an automatic sequence, so a denial from
 * the user's own model stays non-retryable. A `--model` pin keeps the pre-existing behavior: the
 * turn ends on the denial rather than moving to yet another model.
 */
export function isFailoverCandidateDenial(
	message: AssistantMessage,
	current: { readonly provider: string; readonly id: string } | undefined,
	refused: ReadonlySet<string>,
	modelPinned: boolean,
): boolean {
	if (modelPinned || !current || refused.size === 0) return false;
	if (message.provider !== current.provider || message.model !== current.id) return false;
	if (refused.has(failoverModelKey(current.provider, current.id))) return false;
	return message.stopReason === "error" && isTerminalProviderErrorMessage(message.errorMessage);
}

export interface FailoverSwitchHost {
	readonly model: Model<Api> | undefined;
	readonly modelPinned: boolean;
	readonly settings: ProviderResilienceSettings | undefined;
	/** Models that failed this turn; mutated so later retries advance the chain. */
	readonly refused: Set<string>;
	readonly registry: {
		find(provider: string, id: string): Model<Api> | undefined;
		hasConfiguredAuth(model: Model<Api>): boolean;
	};
	/** Session-only switch: a failover target must never become the saved default. */
	switchTo(model: Model<Api>): Promise<void>;
}

/**
 * Content/safety stops (often false positives on Fable and Claude Opus/Sonnet), quota exhaustion,
 * and a denied failover candidate cannot be fixed by a same-model retry: switch to the first
 * authenticated candidate that has not failed this turn. Returns the model switched to.
 */
export async function switchFailoverModel(
	host: FailoverSwitchHost,
	message: AssistantMessage,
): Promise<Model<Api> | undefined> {
	const resilience = resolveProviderResilience(host.settings);
	const current = host.model;
	const candidateDenied = isFailoverCandidateDenial(message, current, host.refused, host.modelPinned);
	if (!candidateDenied) {
		const quotaExhausted = isQuotaExhaustionMessage(message.errorMessage);
		if (!shouldHonorProviderFailover(quotaExhausted, resilience, host.modelPinned, current)) return undefined;
		if (!isFailoverTriggerError(message.errorMessage)) return undefined;
	}
	// Do not gate on the source being sticky: Opus emits the same refusal false positive.
	// Mark the model that just failed so it is never re-picked this turn.
	if (current) host.refused.add(failoverModelKey(current.provider, current.id));

	const pick = pickFailoverCandidate(
		resilience.failoverCandidates,
		current ? { provider: current.provider, id: current.id } : undefined,
		(c) => {
			if (host.refused.has(failoverModelKey(c.provider, c.id))) return false;
			const next = host.registry.find(c.provider, c.id);
			return next !== undefined && host.registry.hasConfiguredAuth(next);
		},
	);
	const next = pick ? host.registry.find(pick.provider, pick.id) : undefined;
	if (!pick || !next) return undefined;
	try {
		await host.switchTo(next);
		return next;
	} catch {
		// Auth or guard rejected the switch: blacklist it so the next retry advances further.
		host.refused.add(failoverModelKey(pick.provider, pick.id));
		return undefined;
	}
}
