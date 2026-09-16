export type SubscriptionUsageWindow = {
	readonly label: string;
	readonly usedPercent: number;
	readonly resetsAt?: number;
};

export type SubscriptionUsageSnapshot = {
	readonly label: string;
	readonly windows: readonly SubscriptionUsageWindow[];
	readonly message?: string;
};

export type CodexUsageWindow = { readonly usedPercent: number; readonly resetsAt?: number };
export type CodexUsageSnapshot = {
	readonly fiveHour?: CodexUsageWindow;
	readonly sevenDay?: CodexUsageWindow;
};

export type ParsedCodexWindow = CodexUsageWindow & { readonly windowSeconds?: number };
export type ObservedCodexWindow = { readonly window: ParsedCodexWindow; readonly observedAt: number };
export type PassiveUsageEntry = { readonly primary?: ObservedCodexWindow; readonly secondary?: ObservedCodexWindow };
export type UsageKind =
	| "codex"
	| "claude"
	| "kimi"
	| "zai"
	| "grok"
	| "devin"
	| "commandcode"
	| "qwen-token-plan"
	| "unavailable";
export type CredentialCandidate = { readonly provider: string; readonly oauthOnly: boolean };

export type SubscriptionUsageSource = {
	readonly label: string;
	readonly kind: UsageKind;
	readonly credentials: readonly CredentialCandidate[];
	readonly ttlMs: number;
	readonly unavailableMessage?: string;
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
