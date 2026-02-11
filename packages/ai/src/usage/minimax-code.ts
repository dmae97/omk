import type { UsageFetchContext, UsageFetchParams, UsageProvider, UsageReport } from "../usage";

/**
 * MiniMax Coding Plan usage provider.
 *
 * MiniMax Coding Plan is a subscription-based service with a 5-hour rolling window
 * quota system. The quota resets automatically based on a rolling window.
 *
 * Currently, MiniMax does not expose a usage/quota API endpoint for the Coding Plan.
 * Usage is tracked via the web dashboard at https://platform.minimax.io/user-center/payment/coding-plan
 *
 * This provider exists to register support for the minimax-code provider in the
 * usage system. When MiniMax adds a usage API, this can be implemented.
 */
async function fetchMiniMaxCodeUsage(params: UsageFetchParams, _ctx: UsageFetchContext): Promise<UsageReport | null> {
	if (params.provider !== "minimax-code" && params.provider !== "minimax-code-cn") {
		return null;
	}

	// MiniMax Coding Plan does not currently expose a usage API
	// Users can check their usage via the web dashboard
	return null;
}

export const minimaxCodeUsageProvider: UsageProvider = {
	id: "minimax-code",
	fetchUsage: fetchMiniMaxCodeUsage,
	supports: (params: UsageFetchParams) =>
		(params.provider === "minimax-code" || params.provider === "minimax-code-cn") &&
		params.credential.type === "api_key",
};
