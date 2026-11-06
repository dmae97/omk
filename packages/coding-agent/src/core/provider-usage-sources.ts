import type { AgentSession } from "./agent-session.ts";
import type { CredentialCandidate, SubscriptionUsageSource, UsageKind } from "./provider-usage-types.ts";

type UsageSession = Pick<AgentSession, "state" | "modelRegistry" | "settingsManager">;
const MINUTE_TTL_MS = 60_000;
const VISIBLE_USAGE_PROVIDERS = [
	"openai-codex",
	"anthropic",
	"kimi-coding",
	"zai",
	"modelstudio-maas",
	"qwen-oauth",
	"xai",
	"meta",
	"devin",
	"commandcode",
	"opencode-go",
] as const;
const SOURCES: Readonly<Record<string, SubscriptionUsageSource>> = {
	"openai-codex": source("CODEX", "codex", [{ provider: "openai-codex", oauthOnly: true }]),
	anthropic: source("CLAUDE", "claude", [{ provider: "anthropic", oauthOnly: true }], 5 * MINUTE_TTL_MS),
	"qwen-oauth": source("QWEN", "unavailable", [{ provider: "qwen-oauth", oauthOnly: true }]),
	// Model Studio exposes no API-key quota endpoint (console gateway is
	// session-only), so the token-plan quota rides the official QwenCloud
	// management CLI, which holds its own OAuth credential.
	"modelstudio-maas": source(
		"QWEN TOKEN PLAN",
		"qwen-token-plan",
		[{ provider: "modelstudio-maas", oauthOnly: false }],
		5 * MINUTE_TTL_MS,
	),
	"kimi-code": source("KIMI", "kimi", [
		{ provider: "kimi-code", oauthOnly: true },
		{ provider: "kimi-coding", oauthOnly: false },
	]),
	"kimi-coding": source("KIMI", "kimi", [
		{ provider: "kimi-code", oauthOnly: true },
		{ provider: "kimi-coding", oauthOnly: false },
	]),
	"zhipu-coding-plan": source("GLM", "zai", [{ provider: "zhipu-coding-plan", oauthOnly: true }]),
	zai: source("GLM", "zai", [
		{ provider: "zai", oauthOnly: false },
		{ provider: "zai-coding-cn", oauthOnly: false },
		{ provider: "zhipu-coding-plan", oauthOnly: true },
	]),
	"zai-coding-cn": source("GLM", "zai", [
		{ provider: "zai-coding-cn", oauthOnly: false },
		{ provider: "zhipu-coding-plan", oauthOnly: true },
	]),
	xai: source("GROK", "grok", [{ provider: "xai", oauthOnly: true }]),
	// Muse Code exposes no public quota endpoint, so the rail shows
	// the subscription entry without live usage windows (qwen-oauth precedent).
	meta: source("META", "unavailable", [{ provider: "meta", oauthOnly: true }]),
	// Devin CLI subscription: GetUserStatus accepts the session token whether it
	// came from /login devin (OAuth store) or an already-owned DEVIN_API_KEY.
	devin: source("DEVIN", "devin", [
		{ provider: "devin", oauthOnly: true },
		{ provider: "devin", oauthOnly: false },
	]),
	// Command Code Provider API: billing + 5H/7D windows via /alpha with the stored API key.
	commandcode: source("COMMAND CODE", "commandcode", [{ provider: "commandcode", oauthOnly: false }]),
	// OpenCode Go: plan windows (5-hour rolling, UTC week, paid period) through the
	// fixed Console status endpoint with the stored OAuth user token.
	"opencode-go": source("OPENCODE GO", "opencode-go", [{ provider: "opencode-go", oauthOnly: true }]),
};

function source(
	label: string,
	kind: UsageKind,
	credentials: readonly CredentialCandidate[],
	ttlMs = MINUTE_TTL_MS,
	unavailableMessage?: string,
): SubscriptionUsageSource {
	return { label, kind, credentials, ttlMs, unavailableMessage };
}

export function getSubscriptionUsageSource(provider: string | undefined): SubscriptionUsageSource | undefined {
	if (!provider) return undefined;
	const configured = SOURCES[provider];
	if (configured) return configured;
	if (/^openai-codex-\d+$/.test(provider)) {
		return source("CODEX", "codex", [
			{ provider, oauthOnly: true },
			{ provider: "openai-codex", oauthOnly: true },
		]);
	}
	return undefined;
}
export function supportsSubscriptionUsage(session: UsageSession, provider = session.state.model?.provider): boolean {
	const usageSource = getSubscriptionUsageSource(provider);
	return usageSource?.credentials.some((candidate) => credentialConfigured(session, candidate)) ?? false;
}

/** Configured quota groups shown in the rail, with the active group first. */
export function getConfiguredSubscriptionUsageProviders(session: UsageSession): readonly string[] {
	const activeProvider = session.state.model?.provider;
	const activeSource = getSubscriptionUsageSource(activeProvider);
	const allowed = session.settingsManager.getSubscriptionUsageProviders();
	const providers = VISIBLE_USAGE_PROVIDERS.filter(
		(provider) =>
			(allowed === undefined || allowed.includes(provider)) && supportsSubscriptionUsage(session, provider),
	);
	if (!activeProvider || !activeSource || !supportsSubscriptionUsage(session, activeProvider)) return providers;
	const activeCanonical = providers.find(
		(provider) => getSubscriptionUsageSource(provider)?.label === activeSource.label,
	);
	if (!activeCanonical) return allowed === undefined ? [activeProvider, ...providers] : providers;
	return [activeCanonical, ...providers.filter((provider) => provider !== activeCanonical)];
}
export function credentialConfigured(session: UsageSession, candidate: CredentialCandidate): boolean {
	if (candidate.oauthOnly) return session.modelRegistry.isUsingOAuthProvider(candidate.provider);
	const status = session.modelRegistry.getProviderAuthStatus(candidate.provider);
	return status.configured || status.source !== undefined;
}
